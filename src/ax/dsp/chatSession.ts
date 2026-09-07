import type { AxChatSession } from '../ai/session.js';
import type {
  AxAIService,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxFunction,
  AxFunctionResult,
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import { AxStreamingAssertionError } from './asserts.js';
import { AxStopFunctionCallException } from './functions.js';

/** Runs one provider-pinned conversation. Completed calls are consumed exactly once. */
export async function axRunChatSession(args: {
  ai: Readonly<AxAIService>;
  request: AxChatRequest;
  options: AxAIServiceOptions;
  functions: readonly AxFunction[];
  maxResponses: number;
  finalFunctions?: readonly string[];
  onDelta?: (
    responseId: string,
    response: AxChatResponse
  ) => void | Promise<void>;
  onResponse?: (responseId: string) => void;
  mem: AxAIMemory;
  execute: (
    call: NonNullable<
      AxChatResponse['results'][number]['functionCalls']
    >[number]
  ) => Promise<readonly AxFunctionResult[]>;
  recordUsage: (response: AxChatResponse) => void;
}): Promise<AxChatResponse> {
  const { ai, request, options, functions, mem } = args;
  const control = options.control;
  const path = options.executionPath ?? 'root';
  const pending = new Map<string, Promise<void>>();
  const calls = new Set<string>();
  let ready: AxFunctionResult[] = [];
  let failure: unknown;
  let updatesAfter = 0;
  const awaitingBoundary = new Set<number>();
  let nativeSuccessorPending = false;
  let queuedResults = false;
  const nativeUpdateIds: number[] = [];
  let needsContinuation = false;
  let atBoundary = false;
  let session: AxChatSession | undefined;
  let updateTask = Promise.resolve();
  let unsubscribe = () => {};
  const update = () => {
    updateTask = updateTask.then(async () => {
      for (const item of control?.pending(path, updatesAfter) ?? []) {
        updatesAfter = item.id;
        const timing =
          item.type === 'steer'
            ? await session!.steer(item.text)
            : await session!.setThinkingTokenBudget(item.level);
        needsContinuation = true;
        if (timing === 'native') {
          nativeSuccessorPending = true;
          nativeUpdateIds.push(item.id);
        } else awaitingBoundary.add(item.id);
      }
    });
    // Observe immediately; propagate through the run loop rather than an unhandled rejection.
    void updateTask.catch((error) => {
      failure = error;
      session?.close();
    });
  };
  const start = (
    call: NonNullable<
      AxChatResponse['results'][number]['functionCalls']
    >[number]
  ) => {
    if (calls.has(call.id)) return;
    calls.add(call.id);
    const work = args
      .execute(call)
      .then(
        (results) => {
          ready.push(...results);
        },
        (error) => {
          failure = error;
        }
      )
      .finally(() => {
        pending.delete(call.id);
        control?.emit({ type: 'tool.completed', path, callId: call.id });
      });
    pending.set(call.id, work);
  };
  const waitForWork = async () => {
    const signals = [options.abortSignal, session?.signal].filter(
      (signal): signal is AbortSignal => !!signal
    );
    for (const signal of signals) signal.throwIfAborted();
    const cleanups: (() => void)[] = [];
    try {
      await Promise.race([
        ...pending.values(),
        ...signals.map(
          (signal) =>
            new Promise<never>((_, reject) => {
              const abort = () => reject(signal.reason);
              signal.addEventListener('abort', abort, { once: true });
              cleanups.push(() => signal.removeEventListener('abort', abort));
              if (signal.aborted) abort();
            })
        ),
      ]);
      if (failure) throw failure;
    } finally {
      for (const cleanup of cleanups) cleanup();
    }
  };
  const drain = async () => {
    while (pending.size) await waitForWork();
  };
  const continueAtBoundary = async () => {
    if (!atBoundary) return;
    await updateTask;
    if (failure) throw failure;
    const appliedUpdates = [...awaitingBoundary];
    needsContinuation = false;
    await session!.continue();
    atBoundary = false;
    queuedResults = false;
    for (const updateId of appliedUpdates) {
      awaitingBoundary.delete(updateId);
      control?.emit({
        type: 'applied',
        path,
        updateId,
        timing: 'next-response',
      });
    }
  };
  try {
    session = await ai.openChatSession!(request, options);
    unsubscribe = control?.subscribe(update) ?? unsubscribe;
    update();
    let responses = 0;
    for await (const event of session.events()) {
      options.abortSignal?.throwIfAborted();
      if (failure) throw failure;
      if (event.type === 'response') {
        atBoundary = false;
        await args.onDelta?.(event.responseId, event.response);
      }
      if (event.type === 'response')
        control?.emit({
          type: 'model.output',
          path,
          pendingCallIds: [...pending.keys()],
        });
      if (event.type === 'tool.call') {
        if (pending.size)
          control?.emit({
            type: 'model.output',
            path,
            pendingCallIds: [...pending.keys()],
          });
        const tool = functions.find(
          (fn) => fn.name === event.call.function.name
        );
        if (tool?.execution === 'background') start(event.call);
        continue;
      }
      if (event.type === 'steering') {
        if (event.status === 'pending') {
          nativeSuccessorPending = false;
          needsContinuation = true;
          await continueAtBoundary();
        }
        if (event.status === 'failed')
          throw new Error(event.error ?? 'Provider rejected steering');
        if (event.status === 'accepted')
          control?.emit({
            type: 'applied',
            path,
            timing: 'native',
            updateId: nativeUpdateIds.shift(),
          });
        continue;
      }
      if (event.type !== 'response.completed') continue;
      atBoundary = true;
      args.onResponse?.(event.responseId);
      responses++;
      await updateTask;
      if (failure) throw failure;
      const response = event.response;
      const responseCalls = response.results.flatMap(
        (result) => result.functionCalls ?? []
      );
      const blocking = responseCalls.filter(
        (call) =>
          functions.find((fn) => fn.name === call.function.name)?.execution !==
          'background'
      );
      const hasWork =
        responseCalls.length > 0 ||
        pending.size > 0 ||
        ready.length > 0 ||
        queuedResults ||
        awaitingBoundary.size > 0 ||
        needsContinuation;
      if (!hasWork) {
        return response;
      }
      args.recordUsage(response);
      mem.addResponse(response.results, options.sessionId);
      for (const call of responseCalls) {
        if (!blocking.includes(call)) start(call);
      }
      if (blocking.length) {
        const hasUnincorporatedWork =
          pending.size > 0 || ready.length > 0 || queuedResults;
        await drain();
        for (const call of blocking) {
          if (
            hasUnincorporatedWork &&
            args.finalFunctions?.includes(call.function.name)
          ) {
            calls.add(call.id);
            ready.push({
              role: 'function',
              index: 0,
              functionId: call.id,
              isError: true,
              result:
                'Not executed: incorporate the background tool results before calling this finalization function again.',
            });
          } else {
            start(call);
            await drain();
          }
        }
      }
      // A provisional answer cannot finish the run. Wait for at least one result,
      // then continue with that result while other independent work remains pending.
      if (!ready.length && pending.size) await waitForWork();
      if (failure) throw failure;
      if (ready.length) {
        const results = ready;
        ready = [];
        mem.addFunctionResults(results, options.sessionId);
        await session.submitToolResults(results);
        queuedResults = true;
      }
      if (responses >= args.maxResponses) {
        await drain();
        throw new Error(
          `Maximum steps reached with unincorporated tool results (${ready.length})`
        );
      }
      if (nativeSuccessorPending) {
        nativeSuccessorPending = false;
        needsContinuation = false;
      } else await continueAtBoundary();
    }
    throw (
      failure ??
      new Error(
        `Chat session closed with ${pending.size} unresolved tool calls`
      )
    );
  } catch (error) {
    if (error instanceof AxStopFunctionCallException) throw error;
    // A correction may retry safely before host tools have started. Once a tool
    // starts, fail the run instead of replaying its work in a fresh session.
    if (error instanceof AxStreamingAssertionError && calls.size === 0)
      throw error;
    throw new Error(
      `Chat session failed: ${error instanceof Error ? error.message : String(error)}; unresolved calls: ${[...pending.keys()].join(', ') || 'none'}`,
      { cause: error }
    );
  } finally {
    unsubscribe();
    session?.close();
  }
}
