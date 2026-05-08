import type { AxAIService } from '../../ai/types.js';
import type {
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptionsWithModels,
} from '../../dsp/types.js';
import { mergeAbortSignals } from '../../util/abort.js';
import { normalizeClarificationForError } from '../completion.js';
import { cloneAgentState } from '../state.js';
import type { AxAgent } from './coordinator.js';
import {
  createMutableDiscoveryPromptState,
  restoreDiscoveryPromptState,
  serializeDiscoveryPromptState,
} from './discoveryHelpers.js';
import type {
  AxAgentClarification,
  AxAgentEvalFunctionCall,
  AxAgentEvalPrediction,
  AxAgentEvalTask,
} from './types.js';

function defaultExecutorRequest(values: Record<string, unknown>): string {
  const query = values.query;
  if (typeof query === 'string' && query.trim()) return query;
  return Object.entries(values)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
    )
    .join('\n');
}

/**
 * Walk the pipeline once for the optimizer. Behaves like `forwardPipeline`
 * but additionally:
 *   - records every recursive function call into a flat list (`functionCalls`)
 *   - returns a structured `AxAgentEvalPrediction` (final or askClarification)
 *   - snapshots the primary actor's runtime state before the run and restores it
 *     afterwards so optimizer scoring doesn't leak state between examples.
 */
export async function forwardPipelineForEvaluation<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  T extends Readonly<AxAIService>,
>(
  pipeline: AxAgent<IN, OUT>,
  parentAi: T,
  task: Readonly<AxAgentEvalTask<IN>>,
  options?: Readonly<AxProgramForwardOptionsWithModels<T>>
): Promise<AxAgentEvalPrediction<OUT>> {
  const p = pipeline as any;
  const primary = p.primaryAgent;

  const savedState = primary.state ? cloneAgentState(primary.state) : undefined;
  const savedStateError = primary.stateError;
  const savedDiscoveryPromptState = serializeDiscoveryPromptState(
    primary.currentDiscoveryPromptState
  );
  primary.state = undefined;
  primary.stateError = undefined;
  primary.currentDiscoveryPromptState = createMutableDiscoveryPromptState();

  const abortController = new AbortController();
  if (primary._stopRequested) {
    abortController.abort('Stopped by user (pre-forward)');
  }
  const effectiveAbortSignal = mergeAbortSignals(
    abortController.signal,
    options?.abortSignal
  );

  primary.activeAbortControllers.add(abortController);
  const createdBudgetState = primary._ensureLlmQueryBudgetState();
  try {
    const ai = primary.ai ?? parentAi;
    const functionCalls: AxAgentEvalFunctionCall[] = [];

    // For evaluation we run the full pipeline manually so we can wire the
    // function-call recorder into each actor stage and surface per-stage
    // intermediate state in the prediction.
    const contextFieldNames: Set<string> = p.contextFieldNames;

    const splitValues = (values: any) => {
      const raw: Record<string, unknown> =
        (values as Record<string, unknown>) ?? {};
      const ctxValues: Record<string, unknown> = {};
      const nonCtxValues: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (contextFieldNames.has(k)) ctxValues[k] = v;
        else nonCtxValues[k] = v;
      }
      return { ctxValues, nonCtxValues };
    };

    let actionLog = '';
    let guidanceLog: string | undefined;
    let turnCount = 0;
    let executorResult: any;
    let nonContextValues: Record<string, unknown>;

    const { nonCtxValues } = splitValues(task.input);
    const distillerRun = await p.distiller._runActorLoop(
      ai,
      task.input,
      { ...options, abortSignal: effectiveAbortSignal },
      effectiveAbortSignal,
      functionCalls
    );
    actionLog = distillerRun.actionLog;
    guidanceLog = distillerRun.guidanceLog;
    turnCount = distillerRun.turnCount;

    if (distillerRun.executorResult.type === 'askClarification') {
      executorResult = distillerRun.executorResult;
      nonContextValues = nonCtxValues;
    } else {
      const distillerArgs = (distillerRun.executorResult as any)?.args ?? [];
      const executorRequest =
        distillerArgs[0] ?? defaultExecutorRequest(nonCtxValues);
      const executorInputs: Record<string, unknown> = {
        ...nonCtxValues,
        ...(distillerRun.nonContextValues as Record<string, unknown>),
        executorRequest,
        distilledContext: distillerArgs[1],
      };
      const executorExclude: Set<string> = p.executorExcludeFields;
      for (const key of executorExclude) delete executorInputs[key];
      const executorRun = await p.executor._runActorLoop(
        ai,
        executorInputs,
        { ...options, abortSignal: effectiveAbortSignal },
        effectiveAbortSignal,
        functionCalls
      );
      actionLog = executorRun.actionLog;
      guidanceLog = executorRun.guidanceLog;
      turnCount = executorRun.turnCount;
      executorResult = executorRun.executorResult;
      nonContextValues = executorRun.nonContextValues;
    }

    const toolErrors = functionCalls
      .filter((call) => Boolean(call.error))
      .map((call) => `${call.qualifiedName}: ${call.error ?? 'unknown error'}`);

    if (executorResult.type === 'askClarification') {
      return {
        completionType: 'askClarification',
        clarification: normalizeClarificationForError(
          executorResult.args[0] as AxAgentClarification
        ),
        guidanceLog,
        actionLog,
        functionCalls,
        toolErrors,
        turnCount,
      };
    }

    // The executor stage's actor inputs include `executorRequest`,
    // `distilledContext`, and (when memories mode is on) `memories`. The
    // responder's signature does not, so drop them.
    const {
      executorRequest: _ignoreT,
      distilledContext: _ignoreC,
      memories: _ignoreM,
      ...nonCtxFromExecutor
    } = nonContextValues as Record<string, unknown>;
    const nonCtxForResponder: Record<string, unknown> = {
      ...nonCtxFromExecutor,
    };
    const executorExcludeForResponder: Set<string> = p.executorExcludeFields;
    for (const key of executorExcludeForResponder) {
      if (key in nonCtxValues) {
        nonCtxForResponder[key] = (nonCtxValues as Record<string, unknown>)[
          key
        ];
      }
    }
    const responderExclude: Set<string> = p.responderExcludeFields;
    for (const key of responderExclude) delete nonCtxForResponder[key];
    const responderResult = await p.responder.forward(ai, {
      nonContextValues: nonCtxForResponder,
      executorResult,
      options: { ...options, abortSignal: effectiveAbortSignal },
    });
    return {
      completionType: 'final',
      output: responderResult as OUT,
      guidanceLog,
      actionLog,
      functionCalls,
      toolErrors,
      turnCount,
    };
  } finally {
    primary.state = savedState ? cloneAgentState(savedState) : undefined;
    primary.stateError = savedStateError;
    primary.currentDiscoveryPromptState = restoreDiscoveryPromptState(
      savedDiscoveryPromptState
    );
    if (createdBudgetState) {
      primary.llmQueryBudgetState = undefined;
    }
    primary.activeAbortControllers.delete(abortController);
    primary._stopRequested = false;
  }
}
