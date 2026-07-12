import { AxAgentClarificationError } from '../agent/agentInternal/agentStateTypes.js';
import type { AxGenDeltaOut, AxProgrammable } from '../dsp/types.js';
import {
  AxInMemoryEventStore,
  AxInMemoryProgramStateStore,
} from './memoryStore.js';
import {
  type AxEventCloseOptions,
  type AxEventContext,
  type AxEventContinuation,
  AxEventContinuationNotFoundError,
  type AxEventContinuationRegistration,
  type AxEventDeadLetter,
  type AxEventDelivery,
  type AxEventIngress,
  AxEventOutcomeUnknownError,
  type AxEventProgramStateAdapter,
  type AxEventPublishReceipt,
  type AxEventRoute,
  type AxEventRun,
  type AxEventRuntimeOptions,
  type AxEventSink,
  type AxEventSourceHandle,
  type AxEventTarget,
  type AxProgramStateEnvelope,
  AxSystemEventClock,
} from './types.js';
import {
  axEventErrorMessage,
  axEventId,
  axEventIdentityScope,
  axEventMatches,
  axEventSizeBytes,
  axValidateEventEnvelope,
} from './util.js';

type AnyProgram = AxProgrammable<any, any>;

type InvocationResult = {
  output?: unknown;
  chunks?: AxGenDeltaOut<unknown>[];
  waiting: boolean;
  invoked: boolean;
};

class AxRuntimeEventContext implements AxEventContext {
  private readonly registrations: Array<{
    id: string;
    value: Readonly<AxEventContinuationRegistration>;
  }> = [];

  constructor(
    readonly runtimeId: string,
    readonly runId: string,
    readonly deliveryId: string,
    readonly routeId: string,
    readonly targetId: string | undefined,
    readonly instanceKey: string,
    readonly ingress: Readonly<AxEventIngress>,
    readonly identity: Readonly<NonNullable<AxEventIngress['identity']>>,
    readonly trust: NonNullable<AxEventIngress['trust']>,
    readonly attempt: number,
    readonly idempotencyKey: string,
    readonly abortSignal: AbortSignal,
    readonly continuation?: Readonly<AxEventContinuation>,
    readonly fencingToken?: number
  ) {}

  registerContinuation(
    registration: Readonly<AxEventContinuationRegistration>
  ): string {
    if (registration.correlation.length === 0) {
      throw new Error(
        'Event continuations require at least one correlation key'
      );
    }
    for (const correlation of registration.correlation) {
      if (!correlation.kind.trim() || !correlation.value.trim()) {
        throw new Error(
          'Event continuation correlation values must be non-empty'
        );
      }
    }
    const id = axEventId('continuation');
    this.registrations.push({ id, value: structuredClone(registration) });
    return id;
  }

  takeRegistrations() {
    return this.registrations.splice(0, this.registrations.length);
  }
}

export function eventTarget<IN, OUT>(
  target: Readonly<AxEventTarget<IN, OUT>>
): AxEventTarget<IN, OUT> {
  if (!target.id.trim()) throw new Error('AxEventTarget.id must be non-empty');
  if (Boolean(target.program) === Boolean(target.createProgram)) {
    throw new Error(
      `AxEventTarget ${target.id} must provide exactly one of program or createProgram`
    );
  }
  return { ...target };
}

export function eventRoute(route: Readonly<AxEventRoute>): AxEventRoute {
  if (!route.id.trim()) throw new Error('AxEventRoute.id must be non-empty');
  if ((route.action === 'wake' || route.action === 'resume') && !route.target) {
    if (route.action === 'wake') {
      throw new Error(`Wake route ${route.id} requires a target`);
    }
  }
  if (route.action === 'invalidate' && !route.invalidator) {
    throw new Error(`Invalidate route ${route.id} requires an invalidator`);
  }
  if (
    route.debounceMs !== undefined &&
    (!Number.isFinite(route.debounceMs) || route.debounceMs < 0)
  ) {
    throw new Error(`Event route ${route.id} debounceMs must be non-negative`);
  }
  if (route.coalesce && !route.debounceMs) {
    throw new Error(`Event route ${route.id} coalescing requires debounceMs`);
  }
  return { ...route };
}

export class AxEventRuntime {
  readonly id: string;
  private readonly options: Readonly<AxEventRuntimeOptions>;
  private readonly store;
  private readonly stateStore;
  private readonly clock;
  private readonly routes = new Map<string, AxEventRoute>();
  private readonly targets = new Map<string, AxEventTarget<any, any>>();
  private readonly singletonTargetInstances = new Map<string, string>();
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly sourceHandles: AxEventSourceHandle[] = [];
  private readonly sourceController = new AbortController();
  private readonly workerController = new AbortController();
  private workerPromises: Promise<void>[] = [];
  private started = false;
  private closing = false;

  constructor(options: Readonly<AxEventRuntimeOptions>) {
    this.options = options;
    this.id = options.id ?? axEventId('event-runtime');
    this.clock = options.clock ?? new AxSystemEventClock();
    this.store =
      options.store ?? new AxInMemoryEventStore({ clock: this.clock });
    this.stateStore =
      options.programStateStore ?? new AxInMemoryProgramStateStore();
    for (const value of options.routes) {
      const route = eventRoute(value);
      if (this.routes.has(route.id)) {
        throw new Error(`Duplicate AxEventRoute id: ${route.id}`);
      }
      this.routes.set(route.id, route);
      if (route.target) {
        const target = eventTarget(route.target);
        const previous = this.targets.get(target.id);
        if (previous && previous !== route.target) {
          throw new Error(`Duplicate AxEventTarget id: ${target.id}`);
        }
        this.targets.set(target.id, route.target);
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.closing) throw new Error('AxEventRuntime is closing');
    const durableRequired = (this.options.sources ?? []).filter(
      (source) => source.requiresDurable
    );
    if (
      durableRequired.length > 0 &&
      this.store.capabilities.durability !== 'persistent' &&
      !this.options.allowVolatile
    ) {
      throw new Error(
        `Event sources ${durableRequired.map((source) => source.id).join(', ')} require a persistent AxEventStore`
      );
    }
    if (this.options.coordination === 'multi-worker') {
      const capability = this.store.capabilities;
      if (
        capability.coordination !== 'multi-worker' ||
        !capability.leases ||
        !capability.transactions ||
        !capability.compareAndSet ||
        !capability.outputPersistence ||
        !capability.conformance?.multiWorker
      ) {
        throw new Error(
          'AxEventRuntime multi-worker mode requires a conforming persistent store with leases, transactions, compare-and-set, and output persistence'
        );
      }
    }
    const leaseMs = this.options.leaseMs ?? 30_000;
    const heartbeatMs = this.options.heartbeatMs ?? Math.floor(leaseMs / 3);
    if (leaseMs < 100 || heartbeatMs < 1 || heartbeatMs >= leaseMs) {
      throw new Error(
        'AxEventRuntime requires 0 < heartbeatMs < leaseMs and leaseMs >= 100'
      );
    }
    this.started = true;
    const workers = this.options.workerConcurrency ?? 4;
    if (!Number.isInteger(workers) || workers < 1) {
      throw new Error('AxEventRuntime workerConcurrency must be positive');
    }
    this.workerPromises = Array.from({ length: workers }, (_, index) =>
      this.workerLoop(`${this.options.workerId ?? this.id}:${index}`)
    );
    try {
      for (const source of this.options.sources ?? []) {
        const handle = await source.start({
          signal: this.sourceController.signal,
          publish: (ingress, signal) => this.publish(ingress, signal),
          reportError: (error) => {
            void this.options.onSourceError?.(source.id, error);
          },
        });
        if (handle) this.sourceHandles.push(handle);
      }
    } catch (error) {
      await this.close({ drain: false });
      throw error;
    }
  }

  async publish(
    ingress: Readonly<AxEventIngress>,
    signal?: AbortSignal
  ): Promise<AxEventPublishReceipt> {
    if (!this.started) throw new Error('AxEventRuntime must be started first');
    if (this.closing) throw new Error('AxEventRuntime is closing');
    axValidateEventEnvelope(ingress.event);
    const normalized: AxEventIngress = {
      event: structuredClone(ingress.event),
      identity: structuredClone(ingress.identity ?? {}),
      trust: ingress.trust ?? 'untrusted',
      correlation: structuredClone(ingress.correlation ?? []),
      ...(ingress.partitionKey ? { partitionKey: ingress.partitionKey } : {}),
    };
    const sizeBytes = axEventSizeBytes(normalized);
    const deliveries: Array<{
      routeId: string;
      action: AxEventRoute['action'];
      targetId?: string;
      instanceKey: string;
      sizeBytes: number;
      availableAt: number;
      coalesce?: 'latest';
      ordering?: 'strict' | 'relaxed';
      retrySafety?: 'idempotent' | 'unknown';
    }> = [];
    for (const route of this.routes.values()) {
      if (!(await this.routeMatches(route, normalized))) continue;
      const identityScope = axEventIdentityScope(normalized.identity);
      const instanceKey =
        (await route.instanceKey?.(normalized)) ??
        normalized.partitionKey ??
        normalized.event.subject ??
        identityScope;
      deliveries.push({
        routeId: route.id,
        action: route.action,
        ...(route.target ? { targetId: route.target.id } : {}),
        instanceKey,
        sizeBytes,
        availableAt: this.clock.now() + (route.debounceMs ?? 0),
        ...(route.coalesce ? { coalesce: route.coalesce } : {}),
        ordering: route.ordering ?? 'strict',
        retrySafety: route.target
          ? (route.target.retrySafety ?? 'unknown')
          : 'idempotent',
      });
    }
    return this.store.enqueue(
      {
        ingress: normalized,
        deliveries,
        acceptedAt: this.clock.now(),
        publishTimeoutMs: this.options.publishTimeoutMs ?? 5_000,
      },
      signal
    );
  }

  getRun(runId: string): Promise<Readonly<AxEventRun> | undefined> {
    return this.store.getRun(runId);
  }

  listDeadLetters(): Promise<readonly Readonly<AxEventDeadLetter>[]> {
    return this.store.listDeadLetters();
  }

  async redrive(deadLetterId: string): Promise<void> {
    const deadLetter = await this.store.getDeadLetter(deadLetterId);
    if (!deadLetter)
      throw new Error(`Unknown event dead letter: ${deadLetterId}`);
    if (deadLetter.kind === 'delivery') {
      await this.store.redriveDelivery(deadLetter.deliveryId, this.clock.now());
      await this.store.removeDeadLetter(deadLetterId);
      return;
    }
    const run = deadLetter.runId
      ? await this.store.getRun(deadLetter.runId)
      : undefined;
    const delivery = await this.store.getDelivery(deadLetter.deliveryId);
    if (!run || !delivery || !deadLetter.sinkId || run.output === undefined) {
      throw new Error(`Sink dead letter ${deadLetterId} cannot be redriven`);
    }
    const target = run.targetId ? this.targets.get(run.targetId) : undefined;
    const sink = target?.sinks?.find((value) => value.id === deadLetter.sinkId);
    if (!target || !sink) {
      throw new Error(`Sink ${deadLetter.sinkId} is no longer configured`);
    }
    const controller = new AbortController();
    const context = new AxRuntimeEventContext(
      this.id,
      run.id,
      delivery.id,
      delivery.routeId,
      target.id,
      delivery.instanceKey,
      delivery.ingress,
      delivery.ingress.identity ?? {},
      delivery.ingress.trust ?? 'untrusted',
      delivery.attempt,
      delivery.id,
      controller.signal
    );
    await sink.write(run.output, {
      run,
      eventContext: context,
      idempotencyKey: `${run.id}:${sink.id}`,
      signal: controller.signal,
    });
    await this.store.removeDeadLetter(deadLetterId);
  }

  cancelRun(runId: string, reason = 'Cancelled by caller'): boolean {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    controller.abort(reason);
    return true;
  }

  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = this.clock.now() + timeoutMs;
    while (!(await this.store.isIdle()) || this.activeRuns.size > 0) {
      if (this.clock.now() >= deadline) {
        throw new Error(
          `AxEventRuntime did not become idle within ${timeoutMs}ms`
        );
      }
      await this.clock.sleep(10);
    }
  }

  async close(options: Readonly<AxEventCloseOptions> = {}): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.sourceController.abort('AxEventRuntime closing');
    await Promise.allSettled(
      this.sourceHandles.map((handle) => handle.close())
    );
    if (options.drain !== false) {
      try {
        await this.waitForIdle(options.timeoutMs ?? 30_000);
      } catch {
        // The abort below makes unfinished volatile deliveries visible again on
        // an explicit redrive rather than hiding the shutdown failure.
      }
    }
    this.workerController.abort('AxEventRuntime closed');
    for (const controller of this.activeRuns.values()) {
      controller.abort('AxEventRuntime closed');
    }
    await Promise.allSettled(this.workerPromises);
    await this.store.close?.();
    this.started = false;
  }

  private async routeMatches(
    route: Readonly<AxEventRoute>,
    ingress: Readonly<AxEventIngress>
  ): Promise<boolean> {
    if (
      route.requireAuthenticated &&
      ingress.trust !== 'authenticated' &&
      ingress.trust !== 'trusted'
    ) {
      return false;
    }
    const matches =
      typeof route.match === 'function'
        ? await route.match(ingress)
        : axEventMatches(ingress, route.match);
    if (!matches) return false;
    return (await route.authorize?.(ingress)) ?? true;
  }

  private async workerLoop(workerId: string): Promise<void> {
    const signal = this.workerController.signal;
    while (!signal.aborted) {
      const delivery = await this.store.claim(
        workerId,
        this.clock.now(),
        this.options.leaseMs ?? 30_000
      );
      if (!delivery) {
        try {
          const now = this.clock.now();
          const next = await this.store.nextAvailableAt(now);
          if (next === undefined) {
            await this.store.waitForWork(signal);
          } else {
            await this.clock.sleep(Math.max(1, next - now), signal);
          }
        } catch {
          return;
        }
        continue;
      }
      await this.processDelivery(delivery, workerId).catch(() => undefined);
    }
  }

  private async processDelivery(
    claimed: Readonly<AxEventDelivery>,
    workerId: string
  ): Promise<void> {
    if (
      claimed.recoveredFromExpiredLease &&
      claimed.invocationStarted &&
      claimed.retrySafety !== 'idempotent'
    ) {
      const reason =
        'outcome_unknown: expired worker lease after invocation started';
      await this.store.saveDelivery({
        ...claimed,
        status: 'outcome_unknown',
        error: reason,
      });
      await this.store.addDeadLetter({
        id: axEventId('dead-letter'),
        kind: 'delivery',
        deliveryId: claimed.id,
        reason,
        createdAt: this.clock.now(),
      });
      return;
    }
    const route = this.routes.get(claimed.routeId);
    if (!route) {
      await this.deadLetterDelivery(
        claimed,
        'Event route is no longer configured'
      );
      return;
    }
    let continuation: Readonly<AxEventContinuation> | undefined;
    let target = route.target;
    let targetId = target?.id;
    let instanceKey = claimed.instanceKey;
    try {
      if (route.action === 'resume') {
        const correlation =
          route.correlation?.(claimed.ingress) ??
          claimed.ingress.correlation?.[0];
        if (!correlation) {
          throw new Error(
            `Resume route ${route.id} did not produce a correlation key`
          );
        }
        continuation = await this.store.findContinuation(
          claimed.identityScope,
          correlation,
          this.clock.now()
        );
        if (!continuation) {
          throw new AxEventContinuationNotFoundError(correlation);
        }
        targetId = continuation.targetId;
        target = this.targets.get(targetId);
        instanceKey = continuation.instanceKey;
        if (!target) {
          throw new Error(`Continuation target ${targetId} is not configured`);
        }
      }

      const runId = axEventId('event-run');
      const controller = new AbortController();
      const heartbeatController = new AbortController();
      this.activeRuns.set(runId, controller);
      const attempt = claimed.attempt + 1;
      const eventContext = new AxRuntimeEventContext(
        this.id,
        runId,
        claimed.id,
        route.id,
        targetId,
        instanceKey,
        claimed.ingress,
        claimed.ingress.identity ?? {},
        claimed.ingress.trust ?? 'untrusted',
        attempt,
        claimed.id,
        controller.signal,
        continuation,
        claimed.fencingToken
      );
      let run: AxEventRun = {
        id: runId,
        deliveryId: claimed.id,
        routeId: route.id,
        ...(targetId ? { targetId } : {}),
        instanceKey,
        status: 'running',
        attempt,
        startedAt: this.clock.now(),
        ...(claimed.fencingToken !== undefined
          ? { fencingToken: claimed.fencingToken }
          : {}),
      };
      await this.store.saveDelivery({
        ...claimed,
        status: 'running',
        attempt,
        runId,
      });
      await this.store.saveRun(run);
      const heartbeat = this.heartbeatClaim(
        claimed,
        workerId,
        controller,
        heartbeatController.signal
      );
      let invoked = false;
      try {
        let result: InvocationResult = { waiting: false, invoked: false };
        if (route.action === 'observe') {
          await route.observe?.(claimed.ingress, eventContext);
        } else if (route.action === 'invalidate') {
          await route.invalidator!.invalidate(claimed.ingress, eventContext);
        } else {
          await this.store.saveDelivery({
            ...claimed,
            status: 'running',
            attempt,
            runId,
            invocationStarted: true,
          });
          result = await this.invokeTarget(
            target!,
            instanceKey,
            claimed.ingress,
            eventContext,
            run,
            () => {
              invoked = true;
            }
          );
          invoked = invoked || result.invoked;
          run = {
            ...run,
            ...(result.output !== undefined ? { output: result.output } : {}),
            ...(result.chunks ? { chunks: result.chunks } : {}),
          };
        }

        const registrations = eventContext.takeRegistrations();
        const continuations: AxEventContinuation[] = [];
        for (const registration of registrations) {
          const value: AxEventContinuation = {
            id: registration.id,
            targetId: targetId ?? `route:${route.id}`,
            routeId: route.id,
            instanceKey,
            identityScope: claimed.identityScope,
            correlation: registration.value.correlation,
            createdAt: this.clock.now(),
            ...(registration.value.expiresAt !== undefined
              ? { expiresAt: registration.value.expiresAt }
              : {}),
            ...(registration.value.metadata
              ? { metadata: registration.value.metadata }
              : {}),
          };
          await this.store.registerContinuation(value);
          continuations.push(value);
        }
        const waiting = result.waiting || continuations.length > 0;
        run = {
          ...run,
          status: waiting ? 'waiting_event' : 'succeeded',
          finishedAt: this.clock.now(),
          ...(continuations.length
            ? { continuationIds: continuations.map((value) => value.id) }
            : {}),
        };
        // Persist the complete output before any final sink dispatch.
        await this.store.saveRun(run);
        if (!waiting && target && run.output !== undefined) {
          run = await this.dispatchFinalSinks(target, run, eventContext);
          await this.store.saveRun(run);
        }
        await this.store.saveDelivery({
          ...claimed,
          status: waiting ? 'waiting_event' : 'succeeded',
          attempt,
          runId,
        });
        if (continuation)
          await this.store.completeContinuation(continuation.id);
      } catch (error) {
        if (controller.signal.aborted) {
          run = {
            ...run,
            status: 'cancelled',
            finishedAt: this.clock.now(),
            error: axEventErrorMessage(controller.signal.reason),
          };
          await this.store.saveRun(run);
          await this.store.saveDelivery({
            ...claimed,
            status: 'cancelled',
            attempt,
            runId,
            error: run.error,
          });
          return;
        }
        if (axEventErrorMessage(error).includes('output_persistence_failed')) {
          run = {
            ...run,
            output: undefined,
            chunks: undefined,
            status: 'output_persistence_failed',
            finishedAt: this.clock.now(),
            error: axEventErrorMessage(error),
          };
          await this.store.saveRun(run);
          await this.store.saveDelivery({
            ...claimed,
            status: 'output_persistence_failed',
            attempt,
            runId,
            error: run.error,
          });
          await this.store.addDeadLetter({
            id: axEventId('dead-letter'),
            kind: 'delivery',
            deliveryId: claimed.id,
            runId,
            reason: run.error ?? 'output_persistence_failed',
            createdAt: this.clock.now(),
          });
          return;
        }
        const unsafe =
          error instanceof AxEventOutcomeUnknownError ||
          (invoked && target?.retrySafety !== 'idempotent');
        if (unsafe) {
          run = {
            ...run,
            status: 'outcome_unknown',
            finishedAt: this.clock.now(),
            error: axEventErrorMessage(error),
          };
          await this.store.saveRun(run);
          await this.store.saveDelivery({
            ...claimed,
            status: 'outcome_unknown',
            attempt,
            runId,
            error: run.error,
          });
          await this.store.addDeadLetter({
            id: axEventId('dead-letter'),
            kind: 'delivery',
            deliveryId: claimed.id,
            runId,
            reason: run.error ?? 'Event outcome is unknown',
            createdAt: this.clock.now(),
          });
          return;
        }
        const nonRetryable = error instanceof AxEventContinuationNotFoundError;
        if (!nonRetryable && attempt < (this.options.maxAttempts ?? 5)) {
          const retryMs = Math.min(
            this.options.retryMaxMs ?? 60_000,
            (this.options.retryBaseMs ?? 1_000) * 2 ** (attempt - 1)
          );
          run = {
            ...run,
            status: 'failed',
            finishedAt: this.clock.now(),
            error: axEventErrorMessage(error),
          };
          await this.store.saveRun(run);
          await this.store.saveDelivery({
            ...claimed,
            status: 'queued',
            attempt,
            availableAt: this.clock.now() + retryMs,
            error: run.error,
            runId,
          });
          return;
        }
        run = {
          ...run,
          status: 'failed',
          finishedAt: this.clock.now(),
          error: axEventErrorMessage(error),
        };
        await this.store.saveRun(run);
        await this.deadLetterDelivery(
          { ...claimed, attempt, runId },
          run.error ?? 'Event delivery failed'
        );
      } finally {
        heartbeatController.abort('Event delivery completed');
        await heartbeat;
        this.activeRuns.delete(runId);
      }
    } catch (error) {
      await this.deadLetterDelivery(claimed, axEventErrorMessage(error));
    }
  }

  private async invokeTarget(
    target: Readonly<AxEventTarget<any, any>>,
    instanceKey: string,
    ingress: Readonly<AxEventIngress>,
    eventContext: AxRuntimeEventContext,
    run: AxEventRun,
    onInvoke: () => void
  ): Promise<InvocationResult> {
    const program = await this.resolveProgram(target, instanceKey, ingress);
    const stateAdapter = target.state ?? this.defaultStateAdapter(program);
    const stateKey = `${target.id}\n${axEventIdentityScope(ingress.identity)}\n${instanceKey}`;
    const stored = stateAdapter
      ? await this.stateStore.load(stateKey)
      : undefined;
    if (stored && stateAdapter) {
      let state = stored.state;
      if (
        stored.schemaVersion !== stateAdapter.schemaVersion ||
        stored.programVersion !== stateAdapter.programVersion
      ) {
        if (!stateAdapter.migrateState) {
          throw new Error(
            `state_migration_required:${target.id}:${stored.schemaVersion}:${stored.programVersion}`
          );
        }
        state = await stateAdapter.migrateState({
          state,
          fromSchemaVersion: stored.schemaVersion,
          fromProgramVersion: stored.programVersion,
          toSchemaVersion: stateAdapter.schemaVersion,
          toProgramVersion: stateAdapter.programVersion,
        });
      }
      await stateAdapter.restore(program, state);
    }
    const input = await target.mapInput(ingress, {
      eventContext,
      continuation: eventContext.continuation,
    });
    const options = {
      ...(target.forwardOptions ?? {}),
      eventContext,
      eventInheritance: 'all' as const,
      abortSignal: eventContext.abortSignal,
    };
    let output: unknown;
    const chunks: AxGenDeltaOut<unknown>[] = [];
    try {
      onInvoke();
      if (target.execution === 'streaming') {
        const stream = program.streamingForward(target.ai, input, options);
        for await (const chunk of stream) {
          chunks.push(structuredClone(chunk));
          const partialRun: AxEventRun = { ...run, chunks: [...chunks] };
          await this.store.saveRun(partialRun);
          for (const sink of target.sinks ?? []) {
            if (!sink.writeChunk) continue;
            await this.dispatchChunkSink(sink, chunk, partialRun, eventContext);
          }
          output = chunk.partial ?? { ...(output as object), ...chunk.delta };
        }
      } else {
        output = await program.forward(target.ai, input, options);
      }
    } catch (error) {
      if (error instanceof AxAgentClarificationError) {
        const state = error.getState();
        if (stateAdapter && state !== undefined) {
          await this.persistProgramState(
            stateKey,
            stored,
            stateAdapter,
            state,
            eventContext
          );
        }
        eventContext.registerContinuation({
          correlation: [{ kind: 'ax.clarification', value: run.id }],
          metadata: { question: error.question },
        });
        return { waiting: true, invoked: true };
      }
      if (stateAdapter) {
        const state = await stateAdapter.capture(program);
        await this.persistProgramState(
          stateKey,
          stored,
          stateAdapter,
          state,
          eventContext
        );
      }
      throw error;
    }
    if (stateAdapter) {
      const state = await stateAdapter.capture(program);
      try {
        await this.persistProgramState(
          stateKey,
          stored,
          stateAdapter,
          state,
          eventContext
        );
      } catch (error) {
        throw new AxEventOutcomeUnknownError(
          `Program completed but state persistence failed: ${axEventErrorMessage(error)}`,
          { cause: error }
        );
      }
    }
    return {
      output,
      ...(chunks.length ? { chunks } : {}),
      waiting: false,
      invoked: true,
    };
  }

  private async persistProgramState(
    key: string,
    stored: Readonly<AxProgramStateEnvelope> | undefined,
    adapter: Readonly<AxEventProgramStateAdapter<AnyProgram>>,
    state: unknown,
    eventContext: Readonly<AxEventContext>
  ): Promise<void> {
    await this.stateStore.compareAndSet(
      key,
      stored?.revision,
      {
        schemaVersion: adapter.schemaVersion,
        programVersion: adapter.programVersion,
        state,
        updatedAt: this.clock.now(),
      },
      eventContext.fencingToken === undefined
        ? undefined
        : {
            deliveryId: eventContext.deliveryId,
            fencingToken: eventContext.fencingToken,
          }
    );
  }

  private async resolveProgram(
    target: Readonly<AxEventTarget<any, any>>,
    instanceKey: string,
    ingress: Readonly<AxEventIngress>
  ): Promise<AnyProgram> {
    if (target.program) {
      const stateful = target.program as AnyProgram & {
        getState?: () => unknown;
        setState?: (state: unknown) => void;
      };
      if (target.state || (stateful.getState && stateful.setState)) {
        const previous = this.singletonTargetInstances.get(target.id);
        if (previous !== undefined && previous !== instanceKey) {
          throw new Error(
            `Stateful target ${target.id} used one program instance for both ${previous} and ${instanceKey}; configure createProgram(instance)`
          );
        }
        this.singletonTargetInstances.set(target.id, instanceKey);
      }
      return target.program;
    }
    return target.createProgram!({
      targetId: target.id,
      instanceKey,
      identity: ingress.identity ?? {},
    });
  }

  private defaultStateAdapter(
    program: AnyProgram
  ): AxEventProgramStateAdapter<AnyProgram> | undefined {
    const stateful = program as AnyProgram & {
      getState?: () => unknown;
      setState?: (state: unknown) => void;
    };
    if (!stateful.getState || !stateful.setState) return;
    return {
      schemaVersion: 1,
      programVersion: program.getId(),
      restore: (value, state) =>
        (value as typeof stateful).setState?.(structuredClone(state)),
      capture: (value) =>
        structuredClone((value as typeof stateful).getState?.()),
    };
  }

  private async dispatchFinalSinks(
    target: Readonly<AxEventTarget<any, any>>,
    run: AxEventRun,
    eventContext: AxRuntimeEventContext
  ): Promise<AxEventRun> {
    const attempts = [];
    for (const sink of target.sinks ?? []) {
      let error: unknown;
      let count = 0;
      for (; count < (this.options.maxAttempts ?? 5); count++) {
        try {
          await sink.write(run.output, {
            run,
            eventContext,
            idempotencyKey: `${run.id}:${sink.id}`,
            signal: eventContext.abortSignal,
          });
          error = undefined;
          break;
        } catch (value) {
          error = value;
          if (count + 1 < (this.options.maxAttempts ?? 5)) {
            await this.clock.sleep(
              Math.min(
                this.options.retryMaxMs ?? 60_000,
                (this.options.retryBaseMs ?? 1_000) * 2 ** count
              ),
              eventContext.abortSignal
            );
          }
        }
      }
      attempts.push({
        sinkId: sink.id,
        attempts: count + (error ? 0 : 1),
        status: error ? ('failed' as const) : ('succeeded' as const),
        ...(error ? { error: axEventErrorMessage(error) } : {}),
      });
      if (error) {
        await this.store.addDeadLetter({
          id: axEventId('dead-letter'),
          kind: 'sink',
          deliveryId: run.deliveryId,
          runId: run.id,
          sinkId: sink.id,
          reason: axEventErrorMessage(error),
          createdAt: this.clock.now(),
        });
      }
    }
    return { ...run, sinks: attempts };
  }

  private async dispatchChunkSink(
    sink: Readonly<AxEventSink<any>>,
    chunk: Readonly<AxGenDeltaOut<any>>,
    run: Readonly<AxEventRun>,
    eventContext: AxRuntimeEventContext
  ): Promise<void> {
    try {
      await sink.writeChunk?.(chunk, {
        run,
        eventContext,
        idempotencyKey: `${run.id}:${sink.id}:chunk:${chunk.index}:${chunk.version}`,
        signal: eventContext.abortSignal,
      });
    } catch (error) {
      await this.store.addDeadLetter({
        id: axEventId('dead-letter'),
        kind: 'sink',
        deliveryId: run.deliveryId,
        runId: run.id,
        sinkId: sink.id,
        reason: `Streaming chunk delivery failed: ${axEventErrorMessage(error)}`,
        createdAt: this.clock.now(),
      });
    }
  }

  private async heartbeatClaim(
    delivery: Readonly<AxEventDelivery>,
    workerId: string,
    runController: AbortController,
    signal: AbortSignal
  ): Promise<void> {
    if (delivery.fencingToken === undefined) return;
    const heartbeatMs =
      this.options.heartbeatMs ??
      Math.floor((this.options.leaseMs ?? 30_000) / 3);
    const leaseMs = this.options.leaseMs ?? 30_000;
    while (!signal.aborted) {
      try {
        await this.clock.sleep(heartbeatMs, signal);
        if (signal.aborted) return;
        await this.store.renewClaim(
          delivery.id,
          workerId,
          delivery.fencingToken,
          this.clock.now() + leaseMs
        );
      } catch (error) {
        if (!signal.aborted) runController.abort(error);
        return;
      }
    }
  }

  private async deadLetterDelivery(
    delivery: Readonly<AxEventDelivery>,
    reason: string
  ): Promise<void> {
    await this.store.saveDelivery({
      ...delivery,
      status: 'dead_lettered',
      error: reason,
    });
    await this.store.addDeadLetter({
      id: axEventId('dead-letter'),
      kind: 'delivery',
      deliveryId: delivery.id,
      ...(delivery.runId ? { runId: delivery.runId } : {}),
      reason,
      createdAt: this.clock.now(),
    });
  }
}

export function eventRuntime(
  options: Readonly<AxEventRuntimeOptions>
): AxEventRuntime {
  return new AxEventRuntime(options);
}
