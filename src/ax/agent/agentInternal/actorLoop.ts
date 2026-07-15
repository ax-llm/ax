import type { AxAIService } from '../../ai/types.js';
import type { AxGenIn, AxProgramForwardOptions } from '../../dsp/types.js';
import { createCompletionBindings } from '../completion.js';
import {
  DEFAULT_RLM_MAX_TURNS,
  getActorModelMatchedNamespaces,
} from '../config.js';
import { emitContextEvent, normalizeContextStage } from '../contextEvents.js';
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
import type { AxAgentFailureReport } from './failureReport.js';
import { buildFailureReport } from './failureReport.js';
import { renderGuidanceLog } from './guidanceHelpers.js';
import {
  mergeUsedMemoryResults,
  rankCatalogMemories,
} from './memoriesHelpers.js';
import { buildModuleRankInputs, rankModules } from './relevanceRanker.js';
import type { AxAgentSharedRuntimeSession } from './sharedSession.js';
import {
  ingestSkillResults,
  mergeUsedSkillResults,
  rankCatalogSkills,
} from './skillsHelpers.js';
import { resolveStagePolicy } from './stagePolicy.js';
import type {
  AxAgentEvalFunctionCall,
  AxAgentExecutorResultPayload,
  AxAgentGuidanceState,
  AxAgentRuntimeCompletionState,
  AxAgentUsedMemory,
  AxAgentUsedSkill,
} from './types.js';

function stripInternalChatMemoryOptions<T extends Record<string, unknown>>(
  options: T
): Omit<T, 'mem'> {
  const { mem: _mem, ...rest } = options;
  return rest;
}

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
  usedMemories: AxAgentUsedMemory[];
  usedSkills: AxAgentUsedSkill[];
  turnCount: number;
  /**
   * Deterministic failure signals harvested from this run's live action-log
   * entries (internal per-turn metadata included), before serialization drops
   * the internals. Undefined on clean runs. Transient — never persisted in
   * `AxAgentState`.
   */
  failureReport?: AxAgentFailureReport;
}> {
  const s = self as any;
  const rlm = s.rlmConfig;
  const debug = options?.debug ?? s.debug ?? ai?.getOptions()?.debug ?? false;
  const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

  const inputState = s._createRuntimeInputState(values);
  inputState.recomputeTurnInputs(false);

  const contextStage = normalizeContextStage(s.options?.stageVariant);
  for (const promotion of inputState.drainAutoPromotionEvents()) {
    await emitContextEvent(s.onContextEvent, {
      kind: 'field_auto_promoted',
      stage: contextStage,
      turn: 0,
      ...promotion,
    });
  }
  const stagePolicy = resolveStagePolicy(s.options?.stageVariant);
  // Forward-time preset skills are executor-ingested — except for a static
  // direct-respond agent, whose runs may end at the distiller: the distiller
  // ingests them there so respond-only runs still see call-time skills.
  const ingestsForwardSkillsHere =
    stagePolicy.ingestsForwardSkills ||
    (stagePolicy.variant === 'distiller' &&
      s.directRespondEnabled === true &&
      s.directRespondStatic === true);
  if (ingestsForwardSkillsHere) {
    const forwardSkills = (
      options as { skills?: readonly unknown[] } | undefined
    )?.skills;
    if (Array.isArray(forwardSkills) && forwardSkills.length > 0) {
      ingestSkillResults(s.currentSkillsPromptState, forwardSkills as any);
    }
  }

  // Advisory relevance ranker: compute once per forward (the task is stable
  // across turns). The shortlists ride a dynamic, non-cached prompt field, so
  // they never affect the prompt cache.
  s._relevanceHintsForTurn = {};
  if (stagePolicy.seesRelevanceHints && s.relevanceHintsEnabled) {
    // Rank against the user's task signal: the original non-context inputs plus
    // the distiller's expanded request. Exclude distilledContext (bulky
    // evidence) and memories (already-loaded facts) so they don't dilute it.
    const nonContextValues = inputState.getNonContextValues();
    const rankTask = Object.entries(nonContextValues)
      .filter(
        ([key, value]) =>
          typeof value === 'string' &&
          key !== 'distilledContextSummary' &&
          key !== 'contextMetadata' &&
          key !== 'memories'
      )
      .map(([, value]) => value as string)
      .join(' ');
    if (s.moduleHintEnabled) {
      const ranked = rankModules(
        rankTask,
        buildModuleRankInputs(s.agentFunctions, s.agentFunctionModuleMetadata),
        s.relevanceRankingOptions
      );
      s._relevanceHintsForTurn.modules = ranked;
      await emitContextEvent(s.onContextEvent, {
        kind: 'relevance_ranking',
        stage: contextStage,
        domain: 'modules',
        taskChars: rankTask.length,
        shortlist: ranked.map((r) => ({ id: r.namespace, score: r.score })),
        suppressed: ranked.length === 0,
      });
    }
    if (s.skillsHintEnabled) {
      const rankedSkills = rankCatalogSkills(
        rankTask,
        s.skillsCatalog ?? [],
        s.relevanceRankingOptions
      );
      s._relevanceHintsForTurn.skills = rankedSkills;
      await emitContextEvent(s.onContextEvent, {
        kind: 'relevance_ranking',
        stage: contextStage,
        domain: 'skills',
        taskChars: rankTask.length,
        shortlist: rankedSkills.map((r) => ({ id: r.id, score: r.score })),
        suppressed: rankedSkills.length === 0,
      });
    }
    if (s.memoriesHintEnabled) {
      // Hint only memories not already in scope (preloaded or prior recalls).
      const loadedMemories = inputState.currentInputs?.memories;
      const alreadyLoadedIds = new Set(
        (Array.isArray(loadedMemories) ? loadedMemories : [])
          .map((m: unknown) =>
            m && typeof (m as { id?: unknown }).id === 'string'
              ? ((m as { id: string }).id as string)
              : undefined
          )
          .filter((id): id is string => Boolean(id))
      );
      const candidates = (
        (s.memoriesCatalog ?? []) as readonly { id: string; content: string }[]
      ).filter((m) => !alreadyLoadedIds.has(m.id));
      const rankedMemories = rankCatalogMemories(
        rankTask,
        candidates,
        s.relevanceRankingOptions
      );
      s._relevanceHintsForTurn.memories = rankedMemories;
      await emitContextEvent(s.onContextEvent, {
        kind: 'relevance_ranking',
        stage: contextStage,
        domain: 'memories',
        taskChars: rankTask.length,
        shortlist: rankedMemories.map((r) => ({ id: r.id, score: r.score })),
        suppressed: rankedMemories.length === 0,
      });
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
    usedMemories: [],
    usedSkills: [],
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
    onUsedMemories: (usedMemories: readonly AxAgentUsedMemory[]) => {
      mutableState.usedMemories = mergeUsedMemoryResults(
        mutableState.usedMemories,
        usedMemories
      );
    },
    onUsedSkills: (usedSkills: readonly AxAgentUsedSkill[]) => {
      mutableState.usedSkills = mergeUsedSkillResults(
        mutableState.usedSkills,
        usedSkills
      );
    },
  });
  const sharedSession = s._sharedSession as
    | AxAgentSharedRuntimeSession
    | undefined;
  const sharedActive = Boolean(sharedSession?.isShared);

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

  const actorMergedOptions = stripInternalChatMemoryOptions({
    ...s._genOptions,
    ...s.executorForwardOptions,
    ...options,
    debug,
    abortSignal: effectiveAbortSignal,
  });
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
    if (runtimeContext.prepareSharedSession) {
      await runtimeContext.prepareSharedSession();
    }
    if (s.state) {
      // Shared mode: session variable bindings were restored once at phase-1
      // adoption (or are already live in the inherited session); each stage
      // still restores its own prompt-replay state here.
      const restoredState = await runtimeContext.restoreRuntimeState(s.state, {
        skipBindings: sharedActive,
      });
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

    if (sharedActive && sharedSession) {
      const stateSummaryEnabled =
        runtimeContext.effectiveContextConfig.stateSummary.enabled;
      if (
        stagePolicy.createsSharedSession &&
        (sharedSession.restoredEntries?.length ?? 0) > 0
      ) {
        // Phase 1: cross-run variables were patched into the shared session
        // at adoption; surface them exactly like a per-stage state restore.
        mutableState.restoreNotice = buildRuntimeRestoreNotice(
          sharedSession.restoredEntries ?? [],
          { includeLiveRuntimeState: stateSummaryEnabled }
        );
        if (stateSummaryEnabled) {
          mutableState.runtimeStateSummary =
            await runtimeContext.captureRuntimeStateSummary();
        }
      }
      if (!stagePolicy.createsSharedSession) {
        // Phase 2 inherits the session. A cross-run restore notice (from this
        // stage's own state) is richer than the generic phase-continuation
        // notice — keep it when present.
        if (mutableState.restoreNotice === undefined) {
          mutableState.restoreNotice =
            'Runtime session continued from the context (distiller) phase — its variables are already live; see Live Runtime State and `inputs.distilledContext`.';
        }
        if (stateSummaryEnabled) {
          mutableState.runtimeStateSummary =
            await runtimeContext.captureRuntimeStateSummary();
        }
      }
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
      // The shared-mode phase-1 stage's variables live on in the session;
      // only the stage owning canonical cross-run state exports bindings.
      // Exception: a run ending in respond() skips the executor entirely, so
      // this stage's export IS the run's canonical state — include bindings
      // (the pipeline copies them onto the executor's cross-run slot).
      const endedInRespond = completionState.payload?.type === 'respond';
      const nextState = await runtimeContext.exportRuntimeState(
        sharedActive && !stagePolicy.exportsSharedBindings && !endedInRespond
          ? { includeBindings: false }
          : undefined
      );
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
      nextState.mcp = options?._mcpExecutionContext?.getContinuationState();
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
    usedMemories: mutableState.usedMemories,
    usedSkills: mutableState.usedSkills,
    turnCount: actionLogEntries.length,
    failureReport: buildFailureReport(actionLogEntries, contextStage),
  };
}
