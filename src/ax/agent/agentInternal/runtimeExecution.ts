import type { AxAIService } from '../../ai/types.js';
import { f } from '../../dsp/sig.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import { AxAIServiceAbortedError } from '../../util/apicall.js';
import type { createCompletionBindings } from '../completion.js';
import {
  DEFAULT_RLM_BATCH_CONCURRENCY,
  DEFAULT_RLM_MAX_EVIDENCE_CHARS,
  DEFAULT_RLM_MAX_LLM_CALLS,
  resolveContextPolicy,
} from '../config.js';
import type { ActionLogEntry } from '../contextManager.js';
import { buildRuntimeStateProvenance } from '../contextManager.js';
import type { AxCodeSession } from '../rlm.js';
import {
  buildBootstrapRuntimeGlobals,
  formatBootstrapContextSummary,
  formatInterpreterError,
  isSessionClosedError,
} from '../runtime.js';
import { normalizeDiscoveryCallableIdentifier } from '../runtimeDiscovery.js';
import {
  runtimeStateProvenanceToRecord,
  serializeAgentStateActionLogEntries,
} from '../state.js';
import { computeDynamicRuntimeChars } from '../truncate.js';
import {
  createDiscoveryTurnSummary,
  formatDiscoveryTurnSummary,
  restoreDiscoveryPromptState,
  serializeDiscoveryPromptState,
} from './discoveryHelpers.js';
import {
  type AxAgentMemoryEntry,
  mergeMemoryResults,
  normalizeUsedMemoryResult,
} from './memoriesHelpers.js';
import type {
  AxAgentMemoryResult,
  AxAgentUsedMemory,
} from './memoriesTypes.js';
import { buildExecutionHelpers } from './runtimeExecutionHelpers.js';
import { buildLlmQueryBindings } from './runtimeExecutionLlmQuery.js';
import {
  buildInspectHelpers,
  getPatchableSession,
  getSnapshotableSession,
  prepareRestoredState,
} from './runtimeSessionHelpers.js';
import {
  AX_SHARED_EVIDENCE_GLOBAL,
  type AxAgentSharedRuntimeSession,
  isEvidenceDescriptor,
  measureEvidenceChars,
} from './sharedSession.js';
import {
  ingestSkillResults,
  normalizeUsedSkillResult,
  restoreSkillsPromptState,
  serializeSkillsPromptState,
} from './skillsHelpers.js';
import type { AxAgentSkillResult, AxAgentUsedSkill } from './skillsTypes.js';
import {
  AxAgentClarificationError,
  type AxAgentFunctionCallRecorder,
  type AxAgentGuidanceState,
  type AxAgentRecursionOptions,
  type AxAgentRuntimeCompletionState,
  type AxAgentRuntimeExecutionContext,
  type AxAgentRuntimeInputState,
  type AxAgentState,
  type AxLlmQueryBudgetState,
  type AxPreparedRestoredState,
} from './types.js';

export {
  createRuntimeInputState,
  ensureLlmQueryBudgetState,
} from './runtimeInputState.js';

export function createRuntimeExecutionContext(
  self: any,
  {
    ai,
    inputState,
    options,
    effectiveAbortSignal,
    debug,
    completionState,
    guidanceState,
    completionBindings,
    actionLogEntries,
    functionCallRecorder,
    onFunctionCall,
    onUsedMemories,
    onUsedSkills,
  }: Readonly<{
    ai?: AxAIService;
    inputState: AxAgentRuntimeInputState;
    options?: Readonly<
      Partial<Omit<AxProgramForwardOptions<string>, 'functions'>>
    >;
    effectiveAbortSignal?: AbortSignal;
    debug: boolean;
    completionState: AxAgentRuntimeCompletionState;
    guidanceState: AxAgentGuidanceState;
    completionBindings: ReturnType<typeof createCompletionBindings>;
    actionLogEntries?: ActionLogEntry[];
    functionCallRecorder?: AxAgentFunctionCallRecorder;
    onFunctionCall?: import('./types.js').AxAgentOnFunctionCall;
    onUsedMemories?: (usedMemories: readonly AxAgentUsedMemory[]) => void;
    onUsedSkills?: (usedSkills: readonly AxAgentUsedSkill[]) => void;
  }>
): AxAgentRuntimeExecutionContext {
  const s = self as any;
  const rlm = s.rlmConfig;
  const runtime = s.runtime;
  // Pipeline-owned shared runtime session (set per-forward by pipelineForward).
  // In shared mode the distiller phase creates the session and the executor
  // phase adopts it; neither run closes it.
  const sharedSession = s._sharedSession as
    | AxAgentSharedRuntimeSession
    | undefined;
  const sharedActive = Boolean(sharedSession?.isShared);
  const stageVariant: 'distiller' | 'executor' =
    s.options?.stageVariant === 'distiller' ? 'distiller' : 'executor';
  const maxSubAgentCalls = rlm.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
  const maxBatchedLlmQueryConcurrency = Math.max(
    1,
    rlm.maxBatchedLlmQueryConcurrency ?? DEFAULT_RLM_BATCH_CONCURRENCY
  );
  const effectiveContextConfig = resolveContextPolicy(
    rlm.contextPolicy,
    rlm.summarizerOptions,
    rlm.maxRuntimeChars
  );
  const baseMaxRuntimeChars = effectiveContextConfig.maxRuntimeChars;
  const getMaxRuntimeChars = (): number =>
    computeDynamicRuntimeChars(
      actionLogEntries ?? [],
      effectiveContextConfig.targetPromptChars,
      baseMaxRuntimeChars
    );
  const llmQueryBudgetState: AxLlmQueryBudgetState = s.llmQueryBudgetState ?? {
    global: { used: 0 },
    globalMax: maxSubAgentCalls,
    localUsed: 0,
    localMax: maxSubAgentCalls, // fallback uses globalMax (root behavior)
  };
  const llmCallWarnThreshold = Math.floor(llmQueryBudgetState.localMax * 0.8);

  // Budget the one place evidence still materializes across the host
  // boundary. In-worker evidence descriptors (shared mode) are exempt; real
  // evidence objects (executor final, or distiller final in fallback mode)
  // must fit so the responder prompt stays bounded. Violations throw in-turn
  // so the actor can narrow and retry.
  const maxEvidenceChars =
    rlm.maxEvidenceChars ?? DEFAULT_RLM_MAX_EVIDENCE_CHARS;
  const guardedFinalFunction = (...args: unknown[]): never => {
    if (
      args.length === 2 &&
      args[1] !== null &&
      typeof args[1] === 'object' &&
      !isEvidenceDescriptor(args[1])
    ) {
      const evidenceChars = measureEvidenceChars(args[1]);
      if (evidenceChars > maxEvidenceChars) {
        throw new Error(
          `final() evidence is too large (~${evidenceChars} chars; limit ${maxEvidenceChars}). ` +
            'Narrow the evidence to only the fields the next stage needs — filter, slice, and drop bulky raw values — then call final() again.'
        );
      }
    }
    return completionBindings.finalFunction(...args);
  };

  const recursionForwardOptions: AxAgentRecursionOptions =
    s.recursionForwardOptions ?? {};
  const {
    description: ___,
    mem: ____,
    sessionId: _____,
    ...parentForwardOptions
  } = options ?? {};
  const simpleChildSignature = f()
    .input('task', f.string('Task for recursive analysis'))
    .input(
      'context',
      f.json('Optional context for the recursive task').optional()
    )
    .output('answer', f.string('Answer from recursive analysis'))
    .build();

  const { llmQuery } = buildLlmQueryBindings({
    self: s,
    ai,
    debug,
    effectiveAbortSignal,
    llmQueryBudgetState,
    maxBatchedLlmQueryConcurrency,
    recursionForwardOptions,
    parentForwardOptions,
    simpleChildSignature,
    llmCallWarnThreshold,
    getMaxRuntimeChars,
  });

  const discoveredActorModelNamespaces = new Set<string>();
  let pendingDiscoveryTurnSummary = createDiscoveryTurnSummary();
  const noteDiscoveredActorModelNamespaces = (
    namespaces: readonly string[]
  ) => {
    for (const namespace of namespaces) {
      const trimmed = namespace.trim();
      if (trimmed) {
        discoveredActorModelNamespaces.add(trimmed);
      }
    }
  };
  const noteDiscoveredModules = (
    modules: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => {
    for (const module of modules) {
      const normalizedModule = module.trim();
      const text = docs[module] ?? docs[normalizedModule];
      if (!text) {
        continue;
      }
      s.currentDiscoveryPromptState.modules.set(normalizedModule, text);
      pendingDiscoveryTurnSummary.modules.add(normalizedModule);
      pendingDiscoveryTurnSummary.texts.add(text);
    }
  };
  const noteDiscoveredFunctions = (
    qualifiedNames: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => {
    for (const qualifiedName of qualifiedNames) {
      const normalizedQualifiedName =
        normalizeDiscoveryCallableIdentifier(qualifiedName);
      const text = docs[qualifiedName] ?? docs[normalizedQualifiedName];
      if (!text) {
        continue;
      }
      s.currentDiscoveryPromptState.functions.set(
        normalizedQualifiedName,
        text
      );
      pendingDiscoveryTurnSummary.functions.add(normalizedQualifiedName);
      pendingDiscoveryTurnSummary.texts.add(text);
    }
  };
  const noteLoadedSkills = (results: readonly AxAgentSkillResult[]) => {
    ingestSkillResults(s.currentSkillsPromptState, results);
    if (typeof s.onLoadedSkills === 'function') {
      // Fire-and-forget; errors must not break the actor loop.
      Promise.resolve(s.onLoadedSkills(results)).catch(() => {});
    }
  };
  const memoriesEnabled = typeof s.onMemoriesSearch === 'function';
  let currentMemories: AxAgentMemoryEntry[] = memoriesEnabled
    ? mergeMemoryResults(
        Array.isArray(inputState.currentInputs?.memories)
          ? (inputState.currentInputs.memories as readonly AxAgentMemoryEntry[])
          : [],
        []
      )
    : [];
  if (memoriesEnabled) {
    inputState.currentInputs.memories = currentMemories;
  }
  const noteLoadedMemories = (results: readonly AxAgentMemoryResult[]) => {
    if (!memoriesEnabled) return;
    currentMemories = mergeMemoryResults(currentMemories, results);
    inputState.currentInputs.memories = currentMemories;
    if (typeof s.onLoadedMemories === 'function') {
      // Fire-and-forget; errors must not break the actor loop.
      Promise.resolve(s.onLoadedMemories(results)).catch(() => {});
    }
  };
  const stage = (
    s.options?.stageVariant === 'distiller' ? 'distiller' : 'executor'
  ) as 'distiller' | 'executor';
  const noteUsed = (id: unknown, reason: unknown) => {
    if (s.usageTrackingEnabled !== true) return;
    if (memoriesEnabled && s.memoryUsageTrackingEnabled === true) {
      const usedMemory = normalizeUsedMemoryResult(
        id,
        reason,
        currentMemories,
        stage
      );
      if (usedMemory) {
        onUsedMemories?.([usedMemory]);
      }
    }
    if (s.skillUsageTrackingEnabled === true) {
      const usedSkill = normalizeUsedSkillResult(
        id,
        reason,
        s.currentSkillsPromptState,
        stage
      );
      if (usedSkill) {
        onUsedSkills?.([usedSkill]);
      }
    }
  };
  const consumeDiscoveryTurnArtifacts = () => {
    const summary = formatDiscoveryTurnSummary(pendingDiscoveryTurnSummary);
    const texts = [...pendingDiscoveryTurnSummary.texts];
    pendingDiscoveryTurnSummary = createDiscoveryTurnSummary();
    return {
      ...(summary ? { summary } : {}),
      texts,
    };
  };

  const getCurrentMemories = () =>
    currentMemories as readonly AxAgentMemoryResult[];
  const toolGlobals = s.buildRuntimeGlobals(
    effectiveAbortSignal,
    ai,
    completionBindings.protocolForTrigger,
    functionCallRecorder,
    noteDiscoveredActorModelNamespaces,
    noteDiscoveredModules,
    noteDiscoveredFunctions,
    noteLoadedSkills,
    noteLoadedMemories,
    noteUsed,
    onFunctionCall ?? s.onFunctionCall,
    getCurrentMemories
  );
  const agentFunctionNamespaces: string[] = [
    ...new Set(
      (s.agentFunctions as readonly { namespace?: string }[]).map(
        (f) => f.namespace ?? 'utils'
      )
    ),
  ];
  const runtimeInputs = { ...inputState.currentInputs };
  // Fallback mode (non-JS runtime): the distiller's evidence crossed the host
  // and is delivered as a runtime-only input value plus a bare alias — never
  // as prompt text. Shared mode never takes this path (the evidence object
  // stays inside the worker and is promoted at the phase boundary).
  const fallbackEvidence =
    sharedSession &&
    !sharedSession.isShared &&
    stageVariant === 'executor' &&
    sharedSession.fallbackEvidence !== undefined
      ? sharedSession.fallbackEvidence
      : undefined;
  if (fallbackEvidence !== undefined) {
    runtimeInputs[AX_SHARED_EVIDENCE_GLOBAL] = fallbackEvidence;
  }
  const reservedTopLevelNames = new Set<string>([
    'inputs',
    'llmQuery',
    'final',
    'askClarification',
    ...(s.agentStatusCallback ? ['reportSuccess', 'reportFailure'] : []),
    ...agentFunctionNamespaces,
    ...(effectiveContextConfig.stateInspection.enabled
      ? ['inspectRuntime']
      : []),
    ...Object.keys(toolGlobals),
  ]);
  const runtimeAliasKeys = [
    ...new Set([
      ...Object.keys(runtimeInputs),
      ...inputState.signatureInputFieldNames,
    ]),
  ].filter((key) => !reservedTopLevelNames.has(key));
  const runtimeTopLevelInputAliases: Record<string, unknown> = {};
  for (const key of runtimeAliasKeys) {
    runtimeTopLevelInputAliases[key] = runtimeInputs[key];
  }

  const refreshRuntimeBindings = () => {
    for (const key of Object.keys(runtimeInputs)) {
      delete runtimeInputs[key];
    }
    for (const [key, value] of Object.entries(inputState.currentInputs)) {
      runtimeInputs[key] = value;
    }
    if (fallbackEvidence !== undefined) {
      runtimeInputs[AX_SHARED_EVIDENCE_GLOBAL] = fallbackEvidence;
    }

    for (const key of runtimeAliasKeys) {
      runtimeTopLevelInputAliases[key] =
        key === AX_SHARED_EVIDENCE_GLOBAL && fallbackEvidence !== undefined
          ? fallbackEvidence
          : inputState.currentInputs[key];
    }
  };

  const protectedRuntimeNames = [...reservedTopLevelNames];
  // The executor phase of a shared session also excludes phase-1 system and
  // input-alias names so inherited context aliases don't render as user
  // variables. Distiller-created variables (including the evidence global)
  // stay visible — they ARE the inherited workspace.
  const inspectReservedNames = [
    ...new Set([
      ...reservedTopLevelNames,
      ...runtimeAliasKeys,
      ...(sharedActive && stageVariant === 'executor'
        ? (sharedSession?.phase1ReservedNames ?? [])
        : []),
    ]),
  ];
  const bootstrapReservedNames = new Set(inspectReservedNames);
  const bootstrapContext = s.runtimeBootstrapContext;
  s.runtimeBootstrapContext = undefined;
  const bootstrapGlobals = buildBootstrapRuntimeGlobals(
    bootstrapContext,
    bootstrapReservedNames
  );
  const bootstrapGlobalNames = new Set(Object.keys(bootstrapGlobals));
  const runtimeActionLogEntries = actionLogEntries ?? [];
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
    stageVariant === 'executor' &&
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
          if (stageVariant === 'distiller') {
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

  const { executeActorCode, executeTestCode } = buildExecutionHelpers({
    s,
    sessionRef,
    effectiveAbortSignal,
    protectedRuntimeNames,
    completionState,
    getMaxRuntimeChars,
    waitForCompletionSignal,
    detectCompletionSignalCalls: s.isJavaScriptRuntime !== false,
    createSession,
  });

  return {
    effectiveContextConfig,
    bootstrapContextSummary,
    applyBootstrapRuntimeContext,
    captureRuntimeStateSummary,
    consumeDiscoveryTurnArtifacts,
    getActorModelMatchedNamespaces: () => [...discoveredActorModelNamespaces],
    exportRuntimeState,
    restoreRuntimeState,
    syncRuntimeInputsToSession,
    executeActorCode,
    executeTestCode,
    prepareSharedSession,
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
