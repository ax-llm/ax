import { AxAIServiceAbortedError } from '../../util/apicall.js';
import type { createCompletionBindings } from '../completion.js';
import type { ActionLogEntry } from '../contextManager.js';
import { buildRuntimeStateProvenance } from '../contextManager.js';
import type { AxCodeRuntime, AxCodeSession } from '../rlm.js';
import {
  formatBootstrapContextSummary,
  formatInterpreterError,
  isSessionClosedError,
} from '../runtime.js';
import {
  runtimeStateProvenanceToRecord,
  serializeAgentStateActionLogEntries,
} from '../state.js';
import {
  restoreDiscoveryPromptState,
  serializeDiscoveryPromptState,
} from './discoveryHelpers.js';
import {
  buildInspectHelpers,
  getPatchableSession,
  getSnapshotableSession,
  prepareRestoredState,
} from './runtimeSessionHelpers.js';
import type { AxAgentSharedRuntimeSession } from './sharedSession.js';
import {
  restoreSkillsPromptState,
  serializeSkillsPromptState,
} from './skillsHelpers.js';
import type { AxAgentStagePolicy } from './stagePolicy.js';
import {
  AxAgentClarificationError,
  type AxAgentGuidanceState,
  type AxAgentRuntimeCompletionState,
  type AxAgentState,
  type AxLlmQueryBudgetState,
  type AxPreparedRestoredState,
  type AxResolvedContextPolicy,
} from './types.js';

export interface SessionLifecycleDeps {
  /** The owning `ActorAgentRLM` internals blob. */
  s: any;
  runtime: AxCodeRuntime;
  stagePolicy: AxAgentStagePolicy;
  sharedSession: AxAgentSharedRuntimeSession | undefined;
  sharedActive: boolean;
  effectiveAbortSignal?: AbortSignal;
  effectiveContextConfig: AxResolvedContextPolicy;
  baseMaxRuntimeChars: number;
  getMaxRuntimeChars: () => number;
  llmQueryBudgetState: AxLlmQueryBudgetState;
  completionState: AxAgentRuntimeCompletionState;
  guidanceState: AxAgentGuidanceState;
  completionBindings: ReturnType<typeof createCompletionBindings>;
  /** Evidence-budgeted wrapper around `completionBindings.finalFunction`. */
  guardedFinalFunction: (...args: unknown[]) => never;
  llmQuery: unknown;
  toolGlobals: Record<string, unknown>;
  runtimeInputs: Record<string, unknown>;
  runtimeTopLevelInputAliases: Record<string, unknown>;
  refreshRuntimeBindings: () => void;
  inspectReservedNames: readonly string[];
  bootstrapGlobals: Record<string, unknown>;
  bootstrapGlobalNames: ReadonlySet<string>;
  runtimeActionLogEntries: ActionLogEntry[];
}

export interface SessionLifecycle {
  sessionRef: { current: AxCodeSession };
  createSession: () => AxCodeSession;
  prepareSharedSession?: () => Promise<void>;
  bootstrapContextSummary?: string;
  applyBootstrapRuntimeContext: () => Promise<string | undefined>;
  captureRuntimeStateSummary: () => Promise<string | undefined>;
  waitForCompletionSignal: () => Promise<void>;
  restoreRuntimeState: (
    state: Readonly<AxAgentState>,
    options?: Readonly<{ skipBindings?: boolean }>
  ) => Promise<AxPreparedRestoredState>;
  exportRuntimeState: (
    options?: Readonly<{ includeBindings?: boolean }>
  ) => Promise<AxAgentState>;
  syncRuntimeInputsToSession: () => Promise<void>;
  close: () => void;
}

/**
 * Owns the run's code session: creation (or shared-session adoption), the
 * phase-scoped host globals, input syncing, state restore/export, runtime
 * inspection, and close semantics. Extracted from
 * `createRuntimeExecutionContext` so the composition root stays readable.
 */
export function buildSessionLifecycle(
  deps: SessionLifecycleDeps
): SessionLifecycle {
  const {
    s,
    runtime,
    stagePolicy,
    sharedSession,
    sharedActive,
    effectiveAbortSignal,
    effectiveContextConfig,
    baseMaxRuntimeChars,
    getMaxRuntimeChars,
    llmQueryBudgetState,
    completionState,
    guidanceState,
    completionBindings,
    guardedFinalFunction,
    llmQuery,
    toolGlobals,
    runtimeInputs,
    runtimeTopLevelInputAliases,
    refreshRuntimeBindings,
    inspectReservedNames,
    bootstrapGlobals,
    bootstrapGlobalNames,
    runtimeActionLogEntries,
  } = deps;

  let session!: AxCodeSession;
  const sessionRef = {
    get current(): AxCodeSession {
      return session;
    },
    set current(value: AxCodeSession) {
      session = value;
    },
  };

  const { inspectRuntimeState, renderRuntimeState, resetInspectBaseline } =
    buildInspectHelpers({
      sessionRef,
      effectiveAbortSignal,
      inspectReservedNames,
      bootstrapGlobalNames,
      runtimeActionLogEntries,
      allowJavaScriptFallback: s.isJavaScriptRuntime !== false,
    });

  const inspectRuntime = effectiveContextConfig.stateInspection.enabled
    ? async (): Promise<string> =>
        renderRuntimeState(await inspectRuntimeState())
    : undefined;

  // Phase-scoped host closures. In shared mode the executor phase patches
  // these over the phase-1 bindings of the adopted session (patchGlobals
  // converts functions to fresh worker proxies), so completion, llmQuery, and
  // tool dispatch always target the *current* run's state.
  const buildPhaseGlobals = (): Record<string, unknown> => ({
    llmQuery,
    final: guardedFinalFunction,
    askClarification: completionBindings.askClarificationFunction,
    ...(inspectRuntime ? { inspectRuntime } : {}),
    ...(s.agentStatusCallback
      ? {
          reportSuccess: async (message: string) => {
            await s.agentStatusCallback!(message, 'success');
          },
          reportFailure: async (message: string) => {
            await s.agentStatusCallback!(message, 'failed');
          },
        }
      : {}),
    ...toolGlobals,
  });

  const createSession = () => {
    resetInspectBaseline();
    const next = runtime.createSession(
      {
        ...runtimeTopLevelInputAliases,
        inputs: runtimeInputs,
        ...bootstrapGlobals,
        ...buildPhaseGlobals(),
      },
      {
        shouldBubbleError: (err: unknown) =>
          err instanceof AxAgentClarificationError ||
          err instanceof AxAIServiceAbortedError ||
          s.shouldBubbleUserError(err),
      }
    );
    // Session-death recovery must keep the controller pointed at the live
    // session so pipeline-level close() targets the right one.
    if (sharedActive && sharedSession) {
      sharedSession.replaceSession(next);
    }
    return next;
  };

  if (
    sharedActive &&
    sharedSession &&
    !stagePolicy.createsSharedSession &&
    sharedSession.session
  ) {
    session = sharedSession.session;
  } else {
    session = createSession();
  }

  /**
   * Async phase wiring the loop awaits before its first turn: the distiller
   * phase adopts the fresh session (cross-run bindings restore + in-worker
   * `final` wrapper); the executor phase patches its host closures over the
   * inherited session and runs the phase-boundary snippet (evidence
   * promotion, per-key input merge, exclusions).
   */
  const prepareSharedSession =
    sharedActive && sharedSession
      ? async (): Promise<void> => {
          if (stagePolicy.createsSharedSession) {
            await sharedSession.adoptDistillerSession(session, {
              reservedNames: inspectReservedNames,
              signal: effectiveAbortSignal,
            });
            return;
          }
          await sharedSession.beginExecutorPhase({
            phaseGlobals: buildPhaseGlobals(),
            inputs: { ...runtimeInputs },
            aliasNames: Object.keys(runtimeTopLevelInputAliases),
            signal: effectiveAbortSignal,
          });
        }
      : undefined;

  const getRuntimeStateSummaryOptions = () => ({
    maxEntries:
      effectiveContextConfig.stateSummary.maxEntries &&
      effectiveContextConfig.stateSummary.maxEntries > 0
        ? effectiveContextConfig.stateSummary.maxEntries
        : 8,
    maxChars:
      effectiveContextConfig.stateSummary.maxChars &&
      effectiveContextConfig.stateSummary.maxChars > 0
        ? effectiveContextConfig.stateSummary.maxChars
        : undefined,
  });
  const getBootstrapContextSummaryOptions = () => ({
    maxEntries:
      effectiveContextConfig.stateSummary.maxEntries &&
      effectiveContextConfig.stateSummary.maxEntries > 0
        ? effectiveContextConfig.stateSummary.maxEntries
        : 6,
    maxChars:
      effectiveContextConfig.stateSummary.maxChars &&
      effectiveContextConfig.stateSummary.maxChars > 0
        ? effectiveContextConfig.stateSummary.maxChars
        : Math.min(baseMaxRuntimeChars, 1_200),
  });
  const bootstrapContextSummary =
    Object.keys(bootstrapGlobals).length > 0
      ? formatBootstrapContextSummary(bootstrapGlobals, {
          ...getBootstrapContextSummaryOptions(),
          budgetRemaining: Math.max(
            0,
            llmQueryBudgetState.localMax - llmQueryBudgetState.localUsed
          ),
          budgetTotal: llmQueryBudgetState.localMax,
        })
      : undefined;

  const waitForCompletionSignal = async (): Promise<void> => {
    if (completionState.payload) {
      return;
    }
    for (let i = 0; i < 3 && !completionState.payload; i++) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  const captureRuntimeStateSummary = async (): Promise<string | undefined> => {
    if (!effectiveContextConfig.stateSummary.enabled) {
      return undefined;
    }

    const snapshot = await inspectRuntimeState();
    const formatted = renderRuntimeState(
      snapshot,
      getRuntimeStateSummaryOptions()
    );
    return formatted || '(no user variables)';
  };

  const restoreRuntimeState = async (
    state: Readonly<AxAgentState>,
    options?: Readonly<{
      /**
       * Skip patching variable bindings into the session. Used in shared mode
       * where session variables are restored once at phase-1 adoption; each
       * stage still restores its own prompt-replay state here.
       */
      skipBindings?: boolean;
    }>
  ): Promise<AxPreparedRestoredState> => {
    const preparedState = prepareRestoredState(state, inspectReservedNames);
    if (options?.skipBindings !== true) {
      const patchableSession = getPatchableSession(session);
      await patchableSession.patchGlobals(preparedState.runtimeBindings, {
        signal: effectiveAbortSignal,
      });
    }
    s.currentDiscoveryPromptState = restoreDiscoveryPromptState(
      preparedState.discoveryPromptState
    );
    s.currentSkillsPromptState = restoreSkillsPromptState(
      preparedState.skillsPromptState
    );
    return preparedState;
  };

  const exportRuntimeState = async (
    options?: Readonly<{
      /**
       * Skip the variable-bindings snapshot. Used by the shared-mode
       * distiller phase, whose variables live on in the session and are
       * exported once by the executor phase at the end of the run.
       */
      includeBindings?: boolean;
    }>
  ): Promise<AxAgentState> => {
    const includeBindings = options?.includeBindings !== false;
    const snapshot = includeBindings
      ? await getSnapshotableSession(session).snapshotGlobals({
          signal: effectiveAbortSignal,
          reservedNames: inspectReservedNames,
        })
      : { version: 1 as const, entries: [], bindings: {} };
    const provenance = buildRuntimeStateProvenance(runtimeActionLogEntries);

    return {
      version: 1,
      runtimeBindings: snapshot.bindings,
      runtimeEntries: snapshot.entries,
      actionLogEntries: serializeAgentStateActionLogEntries(
        runtimeActionLogEntries
      ),
      ...(guidanceState.entries.length > 0
        ? {
            guidanceLogEntries: guidanceState.entries.map((entry) => ({
              turn: entry.turn,
              guidance: entry.guidance,
              ...(entry.triggeredBy ? { triggeredBy: entry.triggeredBy } : {}),
            })),
          }
        : {}),
      ...(serializeDiscoveryPromptState(s.currentDiscoveryPromptState)
        ? {
            discoveryPromptState: serializeDiscoveryPromptState(
              s.currentDiscoveryPromptState
            ),
          }
        : {}),
      ...(serializeSkillsPromptState(s.currentSkillsPromptState)
        ? {
            skillsPromptState: serializeSkillsPromptState(
              s.currentSkillsPromptState
            ),
          }
        : {}),
      provenance: runtimeStateProvenanceToRecord(provenance),
    };
  };

  const syncRuntimeInputsToSession = async (): Promise<void> => {
    refreshRuntimeBindings();

    // Shared mode merges input values per key inside the worker. A wholesale
    // `inputs` patch would delete worker-resident keys (context fields, the
    // promoted evidence) because patchGlobals reconciles plain objects by
    // removing keys missing from the patch.
    if (sharedActive && sharedSession?.session) {
      try {
        await sharedSession.mergeInputs(
          { ...runtimeInputs },
          { signal: effectiveAbortSignal }
        );
        if (Object.keys(runtimeTopLevelInputAliases).length > 0) {
          await getPatchableSession(sharedSession.session).patchGlobals(
            { ...runtimeTopLevelInputAliases },
            { signal: effectiveAbortSignal }
          );
        }
      } catch (err) {
        if (effectiveAbortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            'rlm-session',
            effectiveAbortSignal.reason ?? 'Aborted'
          );
        }
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.startsWith('Aborted'))
        ) {
          throw err;
        }
        throw new Error(
          `Failed to sync runtime inputs: ${formatInterpreterError(err, getMaxRuntimeChars())}`
        );
      }
      return;
    }

    const patchGlobals = async (targetSession: AxCodeSession) => {
      const patchableSession = getPatchableSession(targetSession);
      await patchableSession.patchGlobals(
        {
          inputs: { ...runtimeInputs },
          ...runtimeTopLevelInputAliases,
        },
        { signal: effectiveAbortSignal }
      );
    };

    try {
      await patchGlobals(session);
    } catch (err) {
      if (effectiveAbortSignal?.aborted) {
        throw new AxAIServiceAbortedError(
          'rlm-session',
          effectiveAbortSignal.reason ?? 'Aborted'
        );
      }
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.startsWith('Aborted'))
      ) {
        throw err;
      }
      if (isSessionClosedError(err)) {
        session = createSession();
        await patchGlobals(session);
        return;
      }
      throw new Error(
        `Failed to sync runtime inputs: ${formatInterpreterError(err, getMaxRuntimeChars())}`
      );
    }
  };

  const applyBootstrapRuntimeContext = async (): Promise<
    string | undefined
  > => {
    if (Object.keys(bootstrapGlobals).length === 0) {
      return undefined;
    }

    if (!effectiveContextConfig.stateSummary.enabled) {
      return undefined;
    }

    const snapshot = await inspectRuntimeState();
    const formatted = renderRuntimeState(
      snapshot,
      getRuntimeStateSummaryOptions()
    );
    return formatted || '(no user variables)';
  };

  return {
    sessionRef,
    createSession,
    prepareSharedSession,
    bootstrapContextSummary,
    applyBootstrapRuntimeContext,
    captureRuntimeStateSummary,
    waitForCompletionSignal,
    restoreRuntimeState,
    exportRuntimeState,
    syncRuntimeInputsToSession,
    close: () => {
      // Sessions the pipeline controller owns (the live shared session,
      // including one swapped in by mid-run recovery) are closed by the
      // controller; anything else is this run's own.
      if (sharedSession && sharedSession.session === session) {
        return;
      }
      session.close();
    },
  };
}
