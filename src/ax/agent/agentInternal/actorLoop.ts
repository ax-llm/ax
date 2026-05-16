import type { AxAIService } from '../../ai/types.js';
import type { AxGenIn, AxProgramForwardOptions } from '../../dsp/types.js';
import { createCompletionBindings } from '../completion.js';
import {
  DEFAULT_RLM_MAX_TURNS,
  getActorModelMatchedNamespaces,
} from '../config.js';
import { normalizeContextStage } from '../contextEvents.js';
import type { ActionLogEntry } from '../contextManager.js';
import {
  buildActionEvidenceSummary,
  buildRuntimeStateProvenance,
} from '../contextManager.js';
import {
  buildInternalSummaryRequestOptions,
  formatStructuredRuntimeState,
} from '../runtime.js';
import {
  buildRuntimeRestoreNotice,
  mergeRuntimeStateProvenance,
  runtimeStateProvenanceFromRecord,
} from '../state.js';
import type {
  ActorLoopContext,
  MutableActorLoopState,
} from './actorLoopContext.js';
import { buildActorLoopSetup } from './actorLoopSetup.js';
import { runActorTurn } from './actorLoopTurn.js';
import { renderGuidanceLog } from './guidanceHelpers.js';
import { ingestSkillResults } from './skillsHelpers.js';
import type {
  AxAgentEvalFunctionCall,
  AxAgentExecutorResultPayload,
  AxAgentGuidanceState,
  AxAgentRuntimeCompletionState,
} from './types.js';

export async function runActorLoop<IN extends AxGenIn>(
  self: any,
  ai: AxAIService,
  values: IN,
  options: Readonly<AxProgramForwardOptions<string>> | undefined,
  effectiveAbortSignal: AbortSignal | undefined,
  functionCallRecords?: AxAgentEvalFunctionCall[]
): Promise<{
  nonContextValues: Record<string, unknown>;
  contextMetadata: string | undefined;
  guidanceLog: string | undefined;
  actionLog: string;
  executorResult: AxAgentExecutorResultPayload;
  actorFieldValues: Record<string, unknown>;
  turnCount: number;
}> {
  const s = self as any;
  const rlm = s.rlmConfig;
  const debug = options?.debug ?? s.debug ?? ai?.getOptions()?.debug ?? false;
  const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

  const inputState = s._createRuntimeInputState(values);
  inputState.recomputeTurnInputs(false);

  const contextStage = normalizeContextStage(s.options?.stageVariant);
  const stageVariant = s.options?.stageVariant;
  if (stageVariant !== 'distiller') {
    const forwardSkills = (
      options as { skills?: readonly unknown[] } | undefined
    )?.skills;
    if (Array.isArray(forwardSkills) && forwardSkills.length > 0) {
      ingestSkillResults(s.currentSkillsPromptState, forwardSkills as any);
    }
  }

  const completionState: AxAgentRuntimeCompletionState = {
    payload: undefined,
  };
  const guidanceState: AxAgentGuidanceState = {
    entries: (s.state?.guidanceLogEntries ?? []).map((entry: any) => ({
      turn: entry.turn,
      guidance: entry.guidance,
      ...(entry.triggeredBy ? { triggeredBy: entry.triggeredBy } : {}),
    })),
  };
  const completionBindings = createCompletionBindings((payload) => {
    completionState.payload = payload;
  }, s.agentStatusCallback);
  const actionLogEntries: ActionLogEntry[] = [];
  const mutableState: MutableActorLoopState = {
    checkpointState: undefined,
    actorModelState: undefined,
    restoreNotice: undefined,
    runtimeStateSummary: undefined,
    lastDebugLoggedActorInstruction: undefined,
    actorFieldValues: {},
  };
  const internalFunctionCallRecords: AxAgentEvalFunctionCall[] = [];
  const runtimeContext = s._createRuntimeExecutionContext({
    ai,
    inputState,
    options,
    effectiveAbortSignal,
    debug,
    completionState,
    guidanceState,
    completionBindings,
    actionLogEntries,
    functionCallRecorder: (call: AxAgentEvalFunctionCall) => {
      internalFunctionCallRecords.push(call);
      functionCallRecords?.push(call);
    },
    onFunctionCall: s.onFunctionCall,
  });
  const delegatedContextSummary = runtimeContext.effectiveContextConfig
    .stateSummary.enabled
    ? undefined
    : runtimeContext.bootstrapContextSummary;

  const applyInputUpdateCallback = async () => {
    if (!s.inputUpdateCallback) {
      return;
    }
    const patch = await s.inputUpdateCallback({
      ...(inputState.currentInputs as IN),
    } as Readonly<IN>);
    if (patch === undefined) {
      return;
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error(
        'inputUpdateCallback must return an object patch or undefined'
      );
    }
    for (const [key, value] of Object.entries(
      patch as Record<string, unknown>
    )) {
      if (inputState.signatureInputFieldNames.has(key)) {
        inputState.currentInputs[key] = value;
      }
    }
  };

  const actorMergedOptions = {
    ...s._genOptions,
    ...s.executorForwardOptions,
    ...options,
    debug,
    abortSignal: effectiveAbortSignal,
  };
  const explicitActorDebugHideSystemPrompt = [
    options,
    s.executorForwardOptions,
    s._genOptions,
  ].find(
    (source): source is Readonly<{ debugHideSystemPrompt?: boolean }> =>
      source !== undefined && Object.hasOwn(source, 'debugHideSystemPrompt')
  )?.debugHideSystemPrompt;

  const contextThreshold = runtimeContext.effectiveContextConfig.stateInspection
    .enabled
    ? runtimeContext.effectiveContextConfig.stateInspection.contextThreshold
    : undefined;
  const summaryForwardOptions = buildInternalSummaryRequestOptions(
    options,
    debug,
    effectiveAbortSignal
  );
  const checkpointReplayMode =
    runtimeContext.effectiveContextConfig.actionReplay === 'checkpointed'
      ? 'minimal'
      : runtimeContext.effectiveContextConfig.actionReplay;
  const checkpointThresholdReplayMode =
    runtimeContext.effectiveContextConfig.actionReplay === 'checkpointed'
      ? 'full'
      : runtimeContext.effectiveContextConfig.actionReplay;

  const helpers = buildActorLoopSetup({
    s,
    ai,
    runtimeContext,
    inputState,
    guidanceState,
    actionLogEntries,
    actorMergedOptions,
    summaryForwardOptions,
    delegatedContextSummary,
    checkpointReplayMode,
    checkpointThresholdReplayMode,
    contextStage,
    getCheckpointState: () => mutableState.checkpointState,
    setCheckpointState: (state) => {
      mutableState.checkpointState = state;
    },
    getActorModelState: () => mutableState.actorModelState,
    setActorModelState: (state) => {
      mutableState.actorModelState = state;
    },
    getRestoreNotice: () => mutableState.restoreNotice,
    getRuntimeStateSummary: () => mutableState.runtimeStateSummary,
  });

  const {
    renderActionLog,
    resetActorModelErrorState,
    syncDiscoveredActorModelNamespaces,
    refreshCheckpointSummary,
  } = helpers;

  const ctx: ActorLoopContext = {
    s,
    ai,
    rlm,
    runtimeContext,
    inputState,
    completionState,
    guidanceState,
    actionLogEntries,
    actorMergedOptions,
    summaryForwardOptions,
    functionCallRecords: internalFunctionCallRecords,
    explicitActorDebugHideSystemPrompt,
    contextStage,
    contextThreshold,
    delegatedContextSummary,
    mutableState,
    helpers,
  };

  try {
    if (s.state) {
      const restoredState = await runtimeContext.restoreRuntimeState(s.state);
      const shouldRenderRestoredRuntimeState =
        runtimeContext.effectiveContextConfig.stateSummary.enabled;
      actionLogEntries.push(...restoredState.actionLogEntries);
      mutableState.checkpointState = restoredState.checkpointState
        ? {
            fingerprint: restoredState.checkpointState.fingerprint,
            turns: [...restoredState.checkpointState.turns],
            summary: restoredState.checkpointState.summary,
          }
        : undefined;
      mutableState.actorModelState = restoredState.actorModelState
        ? {
            consecutiveErrorTurns:
              restoredState.actorModelState.consecutiveErrorTurns,
            ...(getActorModelMatchedNamespaces(restoredState.actorModelState)
              .length > 0
              ? {
                  matchedNamespaces: getActorModelMatchedNamespaces(
                    restoredState.actorModelState
                  ),
                }
              : {}),
          }
        : undefined;
      guidanceState.entries = restoredState.guidanceLogEntries.map(
        (entry: any) => ({
          turn: entry.turn,
          guidance: entry.guidance,
          ...(entry.triggeredBy ? { triggeredBy: entry.triggeredBy } : {}),
        })
      );
      const restoredProvenance = mergeRuntimeStateProvenance(
        buildRuntimeStateProvenance(actionLogEntries),
        runtimeStateProvenanceFromRecord(restoredState.provenance)
      );
      mutableState.runtimeStateSummary = shouldRenderRestoredRuntimeState
        ? formatStructuredRuntimeState(
            restoredState.runtimeEntries,
            restoredProvenance,
            {
              maxEntries:
                runtimeContext.effectiveContextConfig.stateSummary.maxEntries &&
                runtimeContext.effectiveContextConfig.stateSummary.maxEntries >
                  0
                  ? runtimeContext.effectiveContextConfig.stateSummary
                      .maxEntries
                  : 8,
              maxChars:
                runtimeContext.effectiveContextConfig.stateSummary.maxChars &&
                runtimeContext.effectiveContextConfig.stateSummary.maxChars > 0
                  ? runtimeContext.effectiveContextConfig.stateSummary.maxChars
                  : 1_200,
            }
          ) || '(no user variables)'
        : undefined;
      mutableState.restoreNotice = buildRuntimeRestoreNotice(
        restoredState.runtimeEntries,
        {
          includeLiveRuntimeState: shouldRenderRestoredRuntimeState,
        }
      );
    }

    const bootstrappedRuntimeState =
      await runtimeContext.applyBootstrapRuntimeContext();
    if (bootstrappedRuntimeState !== undefined) {
      mutableState.runtimeStateSummary = bootstrappedRuntimeState;
    }

    for (let turn = 0; turn < maxTurns; turn++) {
      const { shouldBreak, shouldContinue } = await runActorTurn(
        ctx,
        turn,
        options,
        effectiveAbortSignal,
        applyInputUpdateCallback,
        maxTurns
      );
      if (shouldContinue) {
        continue;
      }
      if (shouldBreak) {
        break;
      }
    }
    if (await refreshCheckpointSummary(actionLogEntries.length)) {
      resetActorModelErrorState();
    }

    try {
      syncDiscoveredActorModelNamespaces();
      const nextState = await runtimeContext.exportRuntimeState();
      nextState.checkpointState = mutableState.checkpointState
        ? {
            fingerprint: mutableState.checkpointState.fingerprint,
            turns: [...mutableState.checkpointState.turns],
            summary: mutableState.checkpointState.summary,
          }
        : undefined;
      nextState.actorModelState = mutableState.actorModelState
        ? {
            consecutiveErrorTurns:
              mutableState.actorModelState.consecutiveErrorTurns,
            ...(getActorModelMatchedNamespaces(mutableState.actorModelState)
              .length > 0
              ? {
                  matchedNamespaces: getActorModelMatchedNamespaces(
                    mutableState.actorModelState
                  ),
                }
              : {}),
          }
        : undefined;
      s.state = nextState;
      s.stateError = undefined;
    } catch (err) {
      s.state = undefined;
      s.stateError =
        err instanceof Error
          ? err.message
          : `Failed to export AxAgent state: ${String(err)}`;
    }
  } finally {
    try {
      runtimeContext.close();
    } catch {
      // Ignore close errors
    }
  }

  const executorResult =
    completionState.payload && 'args' in completionState.payload
      ? completionState.payload
      : ({
          type: 'final',
          args: [
            buildActionEvidenceSummary(actionLogEntries, {
              stateSummary: mutableState.runtimeStateSummary,
              checkpointSummary: mutableState.checkpointState?.summary,
              checkpointTurns: mutableState.checkpointState?.turns,
            }),
          ],
        } satisfies AxAgentExecutorResultPayload);

  return {
    nonContextValues: inputState.getNonContextValues(),
    contextMetadata: inputState.getContextMetadata(),
    guidanceLog: renderGuidanceLog(guidanceState.entries),
    actionLog: renderActionLog(),
    executorResult,
    actorFieldValues: mutableState.actorFieldValues,
    turnCount: actionLogEntries.length,
  };
}
