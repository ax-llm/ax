import type { AxAIService } from '../../ai/types.js';
import {
  computeEffectiveChatBudget,
  resetActorModelErrorTurns,
  updateActorModelErrorTurns,
  updateActorModelMatchedNamespaces,
} from '../config.js';
import type { ActionLogEntry } from '../contextManager.js';
import {
  buildActionLogParts,
  buildActionLogReplayPlan,
  buildActionLogWithPolicy,
  type CheckpointSummaryState,
  generateCheckpointSummaryAsync,
  getPromptFacingActionLogEntries,
} from '../contextManager.js';
import { renderGuidanceLog } from './guidanceHelpers.js';
import type {
  AxAgentGuidanceState,
  AxAgentStateExecutorModelState,
  AxResolvedContextPolicy,
} from './types.js';

export interface ActorLoopSetupDeps {
  s: any;
  ai: AxAIService;
  runtimeContext: any;
  inputState: any;
  guidanceState: AxAgentGuidanceState;
  actionLogEntries: ActionLogEntry[];
  actorMergedOptions: Readonly<Record<string, unknown>>;
  summaryForwardOptions: Readonly<Record<string, unknown>> | undefined;
  delegatedContextSummary: string | undefined;
  checkpointReplayMode: AxResolvedContextPolicy['actionReplay'];
  checkpointThresholdReplayMode: AxResolvedContextPolicy['actionReplay'];
  // Mutable refs
  getCheckpointState: () => CheckpointSummaryState | undefined;
  setCheckpointState: (state: CheckpointSummaryState | undefined) => void;
  getActorModelState: () => AxAgentStateExecutorModelState | undefined;
  setActorModelState: (
    state: AxAgentStateExecutorModelState | undefined
  ) => void;
  getRestoreNotice: () => string | undefined;
  getRuntimeStateSummary: () => string | undefined;
}

export interface ActorLoopSetupHelpers {
  refreshActorInstruction: () => string;
  buildActorPromptValues: (
    actionLog: string,
    guidanceLog: string | undefined,
    liveRuntimeState?: string,
    summarizedActorLog?: string
  ) => Record<string, unknown>;
  measureActorPromptChars: (
    actionLog: string,
    guidanceLog?: string,
    liveRuntimeState?: string,
    summarizedActorLog?: string
  ) => Promise<any>;
  renderActionLogWithReplayMode: (
    actionReplay: AxResolvedContextPolicy['actionReplay'],
    checkpointSummary?: string,
    checkpointTurns?: readonly number[]
  ) => string;
  renderActionLog: () => string;
  renderActionLogPartsWithReplayMode: (
    actionReplay: AxResolvedContextPolicy['actionReplay'],
    checkpointSummary?: string,
    checkpointTurns?: readonly number[]
  ) => any;
  renderActionLogParts: () => any;
  resetActorModelErrorState: () => void;
  noteActorTurnErrorState: (isError: boolean) => void;
  syncDiscoveredActorModelNamespaces: () => void;
  refreshCheckpointSummary: () => Promise<boolean>;
  getPromptFacingEntries: () => ActionLogEntry[];
}

export function buildActorLoopSetup(
  deps: ActorLoopSetupDeps
): ActorLoopSetupHelpers {
  const {
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
    getCheckpointState,
    setCheckpointState,
    getActorModelState,
    setActorModelState,
    getRestoreNotice,
    getRuntimeStateSummary,
  } = deps;

  const getPromptFacingEntries = () =>
    getPromptFacingActionLogEntries(actionLogEntries);

  const refreshActorInstruction = () => {
    const instruction = s._buildActorInstruction();
    s.actorProgram.setDescription(instruction);
    s.actorProgram.clearInstruction();
    return instruction;
  };

  const buildActorPromptValues = (
    actionLog: string,
    guidanceLog: string | undefined,
    liveRuntimeState?: string,
    summarizedActorLog?: string
  ) => {
    const values: Record<string, unknown> = {
      ...inputState.getNonContextValues(),
      ...inputState.getActorInlineContextValues(),
      actionLog,
    };
    const contextMetadata = inputState.getContextMetadata();
    if (contextMetadata) {
      values.contextMetadata = contextMetadata;
    }
    if (guidanceLog) {
      values.guidanceLog = guidanceLog;
    }
    if (liveRuntimeState) {
      values.liveRuntimeState = liveRuntimeState;
    }
    if (summarizedActorLog) {
      values.summarizedActorLog = summarizedActorLog;
    }
    return values;
  };

  const measureActorPromptChars = (
    actionLog: string,
    guidanceLog?: string,
    liveRuntimeState?: string,
    summarizedActorLog?: string
  ) => {
    refreshActorInstruction();
    return s.actorProgram._measurePromptCharsForInternalUse(
      ai,
      buildActorPromptValues(
        actionLog,
        guidanceLog,
        liveRuntimeState,
        summarizedActorLog
      ),
      actorMergedOptions
    );
  };

  const renderActionLogWithReplayMode = (
    actionReplay: AxResolvedContextPolicy['actionReplay'],
    checkpointSummary?: string,
    checkpointTurns?: readonly number[]
  ) =>
    buildActionLogWithPolicy(getPromptFacingEntries(), {
      actionReplay,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
      restoreNotice: getRestoreNotice(),
      delegatedContextSummary,
      checkpointSummary,
      checkpointTurns,
    }) || '(no actions yet)';

  const renderActionLog = () => {
    const cps = getCheckpointState();
    return renderActionLogWithReplayMode(
      runtimeContext.effectiveContextConfig.actionReplay,
      cps?.summary,
      cps?.turns
    );
  };

  const renderActionLogPartsWithReplayMode = (
    actionReplay: AxResolvedContextPolicy['actionReplay'],
    checkpointSummary?: string,
    checkpointTurns?: readonly number[]
  ) =>
    buildActionLogParts(getPromptFacingEntries(), {
      actionReplay,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
      restoreNotice: getRestoreNotice(),
      delegatedContextSummary,
      checkpointSummary,
      checkpointTurns,
    });

  const renderActionLogParts = () => {
    const cps = getCheckpointState();
    return renderActionLogPartsWithReplayMode(
      runtimeContext.effectiveContextConfig.actionReplay,
      cps?.summary,
      cps?.turns
    );
  };

  const resetActorModelErrorState = () => {
    const current = getActorModelState();
    if (!s.executorModelPolicy && !current) {
      return;
    }
    setActorModelState(resetActorModelErrorTurns(current));
  };

  const noteActorTurnErrorState = (isError: boolean) => {
    const current = getActorModelState();
    if (!s.executorModelPolicy && !current) {
      return;
    }
    setActorModelState(updateActorModelErrorTurns(current, isError));
  };

  const syncDiscoveredActorModelNamespaces = () => {
    const matchedNamespaces = runtimeContext.getActorModelMatchedNamespaces();
    if (matchedNamespaces.length === 0) {
      return;
    }
    setActorModelState(
      updateActorModelMatchedNamespaces(getActorModelState(), matchedNamespaces)
    );
  };

  const refreshCheckpointSummary = async (): Promise<boolean> => {
    const applyNext = (nextState: CheckpointSummaryState | undefined) => {
      const current = getCheckpointState();
      const changed =
        (current?.fingerprint ?? null) !== (nextState?.fingerprint ?? null);
      setCheckpointState(nextState);
      return changed;
    };

    if (!runtimeContext.effectiveContextConfig.checkpoints.enabled) {
      return applyNext(undefined);
    }

    const triggerChars =
      runtimeContext.effectiveContextConfig.checkpoints.triggerChars;
    const thresholdActionLogText = renderActionLogWithReplayMode(
      checkpointThresholdReplayMode
    );
    const thresholdMetrics = await measureActorPromptChars(
      thresholdActionLogText,
      renderGuidanceLog(guidanceState.entries),
      getRuntimeStateSummary()
    );
    const thresholdFixedOverhead =
      thresholdMetrics.systemPromptCharacters +
      thresholdMetrics.exampleChatContextCharacters;
    if (
      !triggerChars ||
      thresholdMetrics.mutableChatContextCharacters <=
        computeEffectiveChatBudget(triggerChars, thresholdFixedOverhead)
    ) {
      return applyNext(undefined);
    }

    const checkpointReplayPlan = buildActionLogReplayPlan(actionLogEntries, {
      actionReplay: checkpointReplayMode,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
    });
    const checkpointEntries = checkpointReplayPlan.checkpointEntries;
    if (checkpointEntries.length === 0) {
      return applyNext(undefined);
    }

    const fingerprint = JSON.stringify(
      checkpointEntries.map((entry) => ({
        turn: entry.turn,
        code: entry.code,
        output: entry.output,
        tags: entry.tags,
        tombstone: entry.tombstone,
      }))
    );

    const current = getCheckpointState();
    if (current?.fingerprint === fingerprint) {
      return false;
    }

    return applyNext({
      fingerprint,
      turns: checkpointEntries.map((entry) => entry.turn),
      summary: await generateCheckpointSummaryAsync(
        ai,
        runtimeContext.effectiveContextConfig.summarizerOptions,
        summaryForwardOptions,
        checkpointEntries
      ),
    });
  };

  return {
    refreshActorInstruction,
    buildActorPromptValues,
    measureActorPromptChars,
    renderActionLogWithReplayMode,
    renderActionLog,
    renderActionLogPartsWithReplayMode,
    renderActionLogParts,
    resetActorModelErrorState,
    noteActorTurnErrorState,
    syncDiscoveredActorModelNamespaces,
    refreshCheckpointSummary,
    getPromptFacingEntries,
  };
}
