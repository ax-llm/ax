import type { AxAIService } from '../../ai/types.js';
import {
  computeEffectiveChatBudget,
  resetActorModelErrorTurns,
  updateActorModelErrorTurns,
  updateActorModelMatchedNamespaces,
} from '../config.js';
import { emitContextEvent } from '../contextEvents.js';
import type {
  ActionLogEntry,
  ActionLogHygieneMode,
  ActionLogParts,
} from '../contextManager.js';
import {
  buildActionLogParts,
  buildActionLogReplayPlan,
  buildActionLogWithPolicy,
  buildCheckpointSupersessionNotes,
  type CheckpointSummaryState,
  generateCheckpointSummaryAsync,
  getPromptFacingActionLogEntries,
} from '../contextManager.js';
import { renderDiscoveryPromptMarkdown } from './discoveryHelpers.js';
import { renderGuidanceLog } from './guidanceHelpers.js';
import { renderMemoriesPromptMarkdown } from './memoriesHelpers.js';
import { renderRelevanceHintsMarkdown } from './relevanceRanker.js';
import { renderSkillsPromptMarkdown } from './skillsHelpers.js';
import type {
  AxAgentContextStage,
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
  contextStage: AxAgentContextStage;
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
    summarizedActorLog?: string,
    contextPressure?: string
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
    checkpointTurns?: readonly number[],
    hygieneMode?: ActionLogHygieneMode
  ) => string;
  renderActionLog: () => string;
  renderActionLogPartsWithReplayMode: (
    actionReplay: AxResolvedContextPolicy['actionReplay'],
    checkpointSummary?: string,
    checkpointTurns?: readonly number[],
    hygieneMode?: ActionLogHygieneMode
  ) => ActionLogParts;
  renderActionLogParts: () => ActionLogParts;
  resetActorModelErrorState: () => void;
  noteActorTurnErrorState: (isError: boolean) => void;
  syncDiscoveredActorModelNamespaces: () => void;
  refreshCheckpointSummary: (turnForEvent: number) => Promise<boolean>;
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
    contextStage,
    getCheckpointState,
    setCheckpointState,
    getActorModelState,
    setActorModelState,
    getRestoreNotice,
    getRuntimeStateSummary,
  } = deps;

  const getPromptFacingEntries = () =>
    getPromptFacingActionLogEntries(actionLogEntries);
  const defaultHygieneMode =
    runtimeContext.effectiveContextConfig.contextHygiene?.defaultMode ?? 'none';
  const pressureHygieneMode =
    runtimeContext.effectiveContextConfig.contextHygiene?.pressureMode;

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
    summarizedActorLog?: string,
    contextPressure?: string
  ) => {
    const nonContextValues = { ...inputState.getNonContextValues() };
    if (
      typeof s.onMemoriesSearch === 'function' &&
      Array.isArray(nonContextValues.memories)
    ) {
      const memoriesMarkdown = renderMemoriesPromptMarkdown(
        nonContextValues.memories
      );
      if (memoriesMarkdown) {
        nonContextValues.memories = memoriesMarkdown;
      } else {
        delete nonContextValues.memories;
      }
    }
    const values: Record<string, unknown> = {
      ...nonContextValues,
      ...inputState.getActorInlineContextValues(),
      actionLog,
    };
    if (s.options?.stageVariant === 'distiller' && s.contextMapText) {
      values.contextMap = s.contextMapText;
    }
    if (s.options?.stageVariant !== 'distiller') {
      const discoveredToolDocs = renderDiscoveryPromptMarkdown(
        s.currentDiscoveryPromptState
      );
      if (discoveredToolDocs) {
        values.discoveredToolDocs = discoveredToolDocs;
      }
      const loadedSkills = renderSkillsPromptMarkdown(
        s.currentSkillsPromptState
      );
      if (loadedSkills) {
        values.loadedSkills = loadedSkills;
      }
      if (s.relevanceHintsEnabled) {
        const relevanceHints = renderRelevanceHintsMarkdown(
          s._relevanceHintsForTurn ?? {}
        );
        if (relevanceHints) {
          values.relevanceHints = relevanceHints;
        }
      }
    }
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
    if (contextPressure) {
      values.contextPressure = contextPressure;
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
    checkpointTurns?: readonly number[],
    hygieneMode: ActionLogHygieneMode = defaultHygieneMode
  ) =>
    buildActionLogWithPolicy(getPromptFacingEntries(), {
      actionReplay,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
      hygieneMode,
      hygieneGraceTurns:
        runtimeContext.effectiveContextConfig.rankPruneGraceTurns,
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
    checkpointTurns?: readonly number[],
    hygieneMode: ActionLogHygieneMode = defaultHygieneMode
  ) =>
    buildActionLogParts(getPromptFacingEntries(), {
      actionReplay,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
      hygieneMode,
      hygieneGraceTurns:
        runtimeContext.effectiveContextConfig.rankPruneGraceTurns,
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

  const refreshCheckpointSummary = async (
    turnForEvent: number
  ): Promise<boolean> => {
    const applyNext = async (
      nextState: CheckpointSummaryState | undefined,
      reason: 'over_budget' | 'under_budget' | 'disabled'
    ) => {
      const current = getCheckpointState();
      const changed =
        (current?.fingerprint ?? null) !== (nextState?.fingerprint ?? null);
      setCheckpointState(nextState);
      if (changed) {
        if (nextState) {
          await emitContextEvent(s.onContextEvent, {
            kind: 'checkpoint_created',
            stage: contextStage,
            turn: turnForEvent,
            coveredTurns: [...nextState.turns],
            summaryChars: nextState.summary.length,
            reason,
          });
        } else if (current) {
          await emitContextEvent(s.onContextEvent, {
            kind: 'checkpoint_cleared',
            stage: contextStage,
            turn: turnForEvent,
            coveredTurns: [...current.turns],
            reason,
          });
        }
      }
      return changed;
    };

    if (!runtimeContext.effectiveContextConfig.checkpoints.enabled) {
      return applyNext(undefined, 'disabled');
    }

    const triggerChars =
      runtimeContext.effectiveContextConfig.checkpoints.triggerChars;
    const thresholdActionLogText = renderActionLogWithReplayMode(
      checkpointThresholdReplayMode,
      undefined,
      undefined,
      defaultHygieneMode
    );
    const thresholdMetrics = await measureActorPromptChars(
      thresholdActionLogText,
      renderGuidanceLog(guidanceState.entries),
      getRuntimeStateSummary()
    );
    const thresholdFixedOverhead =
      thresholdMetrics.systemPromptCharacters +
      thresholdMetrics.exampleChatContextCharacters;
    if (!triggerChars) {
      return applyNext(undefined, 'under_budget');
    }
    if (
      thresholdMetrics.mutableChatContextCharacters <=
      computeEffectiveChatBudget(triggerChars, thresholdFixedOverhead)
    ) {
      return applyNext(undefined, 'under_budget');
    }
    if (pressureHygieneMode && pressureHygieneMode !== defaultHygieneMode) {
      const pressureActionLogText = renderActionLogWithReplayMode(
        runtimeContext.effectiveContextConfig.actionReplay,
        undefined,
        undefined,
        pressureHygieneMode
      );
      const pressureMetrics = await measureActorPromptChars(
        pressureActionLogText,
        renderGuidanceLog(guidanceState.entries),
        getRuntimeStateSummary()
      );
      const pressureFixedOverhead =
        pressureMetrics.systemPromptCharacters +
        pressureMetrics.exampleChatContextCharacters;
      const pressureBudget = computeEffectiveChatBudget(
        triggerChars,
        pressureFixedOverhead
      );
      if (pressureMetrics.mutableChatContextCharacters <= pressureBudget) {
        return applyNext(undefined, 'under_budget');
      }
    }

    const checkpointReplayPlan = buildActionLogReplayPlan(actionLogEntries, {
      actionReplay: checkpointReplayMode,
      recentFullActions:
        runtimeContext.effectiveContextConfig.recentFullActions,
      hygieneMode: defaultHygieneMode,
      hygieneGraceTurns:
        runtimeContext.effectiveContextConfig.rankPruneGraceTurns,
    });
    const checkpointEntries = checkpointReplayPlan.checkpointEntries;
    if (checkpointEntries.length === 0) {
      return applyNext(undefined, 'under_budget');
    }
    const supersessionNotes = buildCheckpointSupersessionNotes(
      checkpointEntries,
      actionLogEntries
    );

    const fingerprint = JSON.stringify({
      checkpointEntries: checkpointEntries.map((entry) => ({
        turn: entry.turn,
        code: entry.code,
        output: entry.output,
        tags: entry.tags,
        tombstone: entry.tombstone,
        functionCalls: entry._functionCalls,
        stateDelta: entry.stateDelta,
      })),
      supersessionNotes,
    });

    const current = getCheckpointState();
    if (current?.fingerprint === fingerprint) {
      return false;
    }

    return applyNext(
      {
        fingerprint,
        turns: checkpointEntries.map((entry) => entry.turn),
        summary: await generateCheckpointSummaryAsync(
          ai,
          runtimeContext.effectiveContextConfig.summarizerOptions,
          summaryForwardOptions,
          checkpointEntries,
          {
            allEntries: actionLogEntries,
            supersessionNotes,
          }
        ),
      },
      'over_budget'
    );
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
