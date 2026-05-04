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
      const raw: Record<string, unknown> = Array.isArray(values)
        ? values.reduce(
            (acc: Record<string, unknown>, m: any) =>
              m.role === 'user' ? { ...acc, ...m.values } : acc,
            {}
          )
        : (values as Record<string, unknown>);
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
    let actorResult: any;
    let actorFieldValues: Record<string, unknown> = {};
    let nonContextValues: Record<string, unknown>;

    if (!p.contextExplorer) {
      // Task-only flow
      const taskRun = await primary._runActorLoop(
        ai,
        task.input,
        { ...options, abortSignal: effectiveAbortSignal },
        effectiveAbortSignal,
        functionCalls
      );
      actionLog = taskRun.actionLog;
      guidanceLog = taskRun.guidanceLog;
      turnCount = taskRun.turnCount;
      actorResult = taskRun.actorResult;
      actorFieldValues = taskRun.actorFieldValues;
      nonContextValues = taskRun.nonContextValues;
    } else {
      const { nonCtxValues } = splitValues(task.input);
      const ctxRun = await p.contextExplorer._runActorLoop(
        ai,
        task.input,
        { ...options, abortSignal: effectiveAbortSignal },
        effectiveAbortSignal,
        functionCalls
      );
      actionLog = ctxRun.actionLog;
      guidanceLog = ctxRun.guidanceLog;
      turnCount = ctxRun.turnCount;

      if (ctxRun.actorResult.type === 'askClarification') {
        actorResult = ctxRun.actorResult;
        actorFieldValues = ctxRun.actorFieldValues;
        nonContextValues = nonCtxValues;
      } else {
        // Staged context flow: explorer feeds the executor directly.
        // `executorRequest` and
        // `distilledContext` come from the explorer's `final(task, evidence)`
        // payload (`actorResult.args[0]` / `args[1]`).
        const explorerArgs = (ctxRun.actorResult as any)?.args ?? [];
        const taskInputs = {
          ...nonCtxValues,
          ...(ctxRun.nonContextValues as Record<string, unknown>),
          executorRequest: explorerArgs[0],
          distilledContext: explorerArgs[1],
        };
        const taskRun = await p.taskExecutor._runActorLoop(
          ai,
          taskInputs,
          { ...options, abortSignal: effectiveAbortSignal },
          effectiveAbortSignal,
          functionCalls
        );
        actionLog = taskRun.actionLog;
        guidanceLog = taskRun.guidanceLog;
        turnCount = taskRun.turnCount;
        actorResult = taskRun.actorResult;
        actorFieldValues = taskRun.actorFieldValues;
        nonContextValues = taskRun.nonContextValues;
      }
    }

    const toolErrors = functionCalls
      .filter((call) => Boolean(call.error))
      .map((call) => `${call.qualifiedName}: ${call.error ?? 'unknown error'}`);

    if (actorResult.type === 'askClarification') {
      return {
        completionType: 'askClarification',
        clarification: normalizeClarificationForError(
          actorResult.args[0] as AxAgentClarification
        ),
        guidanceLog,
        actionLog,
        functionCalls,
        toolErrors,
        turnCount,
      };
    }

    // The task stage's actor inputs include `executorRequest` and
    // `distilledContext` in staged context flows. The finalResponder's signature does not,
    // so drop them before forward.
    const {
      executorRequest: _ignoreT,
      distilledContext: _ignoreC,
      ...nonCtxForResponder
    } = nonContextValues as Record<string, unknown>;
    const responderResult = await p.finalResponder.forward(ai, {
      nonContextValues: nonCtxForResponder,
      actorResult,
      options: { ...options, abortSignal: effectiveAbortSignal },
    });
    return {
      completionType: 'final',
      output: { ...responderResult, ...actorFieldValues } as OUT,
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
