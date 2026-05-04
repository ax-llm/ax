import type { AxAIService } from '../../ai/types.js';
import type {
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramForwardOptionsWithModels,
  AxProgramStreamingForwardOptionsWithModels,
} from '../../dsp/types.js';
import type { AxAgentClarification } from './agentStateTypes.js';
import { AxAgentClarificationError } from './agentStateTypes.js';
import type { AxAgent } from './coordinator.js';

function throwOnClarification(actorResult: any, owner: any): void {
  if (actorResult?.type === 'askClarification') {
    throw new AxAgentClarificationError(
      actorResult.args[0] as AxAgentClarification,
      {
        state: owner?.state,
        stateError: owner?.stateError,
      }
    );
  }
}

/**
 * Split incoming values into (contextValues, nonContextValues) using the
 * coordinator's `contextFieldNames` set. AxMessage[] inputs are flattened by
 * merging all `user` messages — the same shape coordinator.forward used to
 * compute before delegating to the inner agents.
 */
function splitValuesByContext(
  values: any,
  contextFieldNames: Set<string>
): {
  ctxValues: Record<string, unknown>;
  nonCtxValues: Record<string, unknown>;
} {
  const rawValues: Record<string, unknown> = Array.isArray(values)
    ? values
        .filter((m: AxMessage<any>) => m.role === 'user')
        .reduce<Record<string, unknown>>(
          (acc, m: AxMessage<any>) => ({
            ...acc,
            ...(m.values as Record<string, unknown>),
          }),
          {}
        )
    : (values as Record<string, unknown>);

  const ctxValues: Record<string, unknown> = {};
  const nonCtxValues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (contextFieldNames.has(k)) {
      ctxValues[k] = v;
    } else {
      nonCtxValues[k] = v;
    }
  }
  return { ctxValues, nonCtxValues };
}

/**
 * Walk the pipeline once and return the final user output.
 *
 *   contextExplorer.run → taskExecutor.run → finalResponder.forward
 *
 * Each stage may be absent depending on the case; the function picks the
 * shortest valid path. `actorFieldValues` from the actor stages are merged
 * into the final result *after* the responder output, matching the legacy
 * "responder can't overwrite extra actor outputs" contract.
 */
export async function forwardPipeline<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  T extends Readonly<AxAIService>,
>(
  pipeline: AxAgent<IN, OUT>,
  ai: T,
  values: IN | AxMessage<IN>[],
  options?: Readonly<AxProgramForwardOptionsWithModels<T>>
): Promise<OUT> {
  const p = pipeline as any;
  const contextFieldNames: Set<string> = p.contextFieldNames;

  // ----- Task-only flow: no contextExplorer, taskExecutor only.
  if (!p.contextExplorer) {
    const taskRun = await p.taskExecutor.run(ai, values, options);
    throwOnClarification(taskRun.actorResult, p.taskExecutor);
    const responderResult = await p.finalResponder.forward(ai, {
      nonContextValues: taskRun.nonContextValues,
      actorResult: taskRun.actorResult,
      options,
    });
    return { ...responderResult, ...taskRun.actorFieldValues } as OUT;
  }

  // Staged context flow: explorer receives the full input so it can understand the task
  // while treating declared contextFields as runtime-only context. The task
  // stage receives only non-context inputs plus executorRequest/distilledContext.
  const { nonCtxValues } = splitValuesByContext(values, contextFieldNames);

  const ctxRun = await p.contextExplorer.run(ai, values, options);
  throwOnClarification(ctxRun.actorResult, p.contextExplorer);

  const explorerArgs = (ctxRun.actorResult as any)?.args ?? [];
  const taskInputs = {
    ...nonCtxValues,
    ...(ctxRun.nonContextValues as Record<string, unknown>),
    executorRequest: explorerArgs[0],
    distilledContext: explorerArgs[1],
  };
  const taskRun = await p.taskExecutor.run(ai, taskInputs, options);
  throwOnClarification(taskRun.actorResult, p.taskExecutor);
  // The task stage's signature includes `executorRequest`/`distilledContext`
  // as actor inputs, so `taskRun.nonContextValues` carries them through.
  // Strip them before handing values to the finalResponder, whose signature
  // does *not* declare those fields.
  const {
    executorRequest: _ignoreT,
    distilledContext: _ignoreC,
    ...nonCtxForResponder
  } = taskRun.nonContextValues as Record<string, unknown>;
  const responderResult = await p.finalResponder.forward(ai, {
    nonContextValues: nonCtxForResponder,
    actorResult: taskRun.actorResult,
    options,
  });
  return { ...responderResult, ...taskRun.actorFieldValues } as OUT;
}

/**
 * Streaming variant of `forwardPipeline`. All actor stages run non-streaming;
 * only the finalResponder is streamed. `actorFieldValues` are yielded as a
 * final delta so callers see them in the stream.
 */
export async function* streamingForwardPipeline<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  T extends Readonly<AxAIService>,
>(
  pipeline: AxAgent<IN, OUT>,
  ai: T,
  values: IN | AxMessage<IN>[],
  options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
): AxGenStreamingOut<OUT> {
  const p = pipeline as any;
  const contextFieldNames: Set<string> = p.contextFieldNames;

  // ----- Task-only flow
  if (!p.contextExplorer) {
    const taskRun = await p.taskExecutor.run(ai, values, options);
    throwOnClarification(taskRun.actorResult, p.taskExecutor);
    yield* p.finalResponder.streamingForward(ai, {
      nonContextValues: taskRun.nonContextValues,
      actorResult: taskRun.actorResult,
      options,
    });
    if (Object.keys(taskRun.actorFieldValues).length > 0) {
      yield {
        version: 1,
        index: 0,
        delta: taskRun.actorFieldValues,
      } as any;
    }
    return;
  }

  // Staged context flow: explorer receives the full input so it can understand the task
  // while treating declared contextFields as runtime-only context. The task
  // stage receives only non-context inputs plus executorRequest/distilledContext.
  const { nonCtxValues } = splitValuesByContext(values, contextFieldNames);

  const ctxRun = await p.contextExplorer.run(ai, values, options);
  throwOnClarification(ctxRun.actorResult, p.contextExplorer);

  const explorerArgs = (ctxRun.actorResult as any)?.args ?? [];
  const taskInputs = {
    ...nonCtxValues,
    ...(ctxRun.nonContextValues as Record<string, unknown>),
    executorRequest: explorerArgs[0],
    distilledContext: explorerArgs[1],
  };
  const taskRun = await p.taskExecutor.run(ai, taskInputs, options);
  throwOnClarification(taskRun.actorResult, p.taskExecutor);
  // Strip the actor-only `executorRequest`/`distilledContext` inputs before
  // handing values to the finalResponder (whose signature doesn't declare
  // them).
  const {
    executorRequest: _ignoreT,
    distilledContext: _ignoreC,
    ...nonCtxForResponder
  } = taskRun.nonContextValues as Record<string, unknown>;
  yield* p.finalResponder.streamingForward(ai, {
    nonContextValues: nonCtxForResponder,
    actorResult: taskRun.actorResult,
    options,
  });
  if (Object.keys(taskRun.actorFieldValues).length > 0) {
    yield {
      version: 1,
      index: 0,
      delta: taskRun.actorFieldValues,
    } as any;
  }
}
