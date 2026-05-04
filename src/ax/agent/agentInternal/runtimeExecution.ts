import type { AxAIService } from '../../ai/types.js';
import { f } from '../../dsp/sig.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import { AxAIServiceAbortedError } from '../../util/apicall.js';
import type { createCompletionBindings } from '../completion.js';
import {
  DEFAULT_AGENT_MODULE_NAMESPACE,
  DEFAULT_RLM_BATCH_CONCURRENCY,
  DEFAULT_RLM_MAX_LLM_CALLS,
  DEFAULT_RLM_MAX_LLM_CALLS_PER_CHILD,
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
import { buildExecutionHelpers } from './runtimeExecutionHelpers.js';
import { buildLlmQueryBindings } from './runtimeExecutionLlmQuery.js';
import {
  buildInspectHelpers,
  getPatchableSession,
  getSnapshotableSession,
  prepareRestoredState,
} from './runtimeSessionHelpers.js';
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
  }>
): AxAgentRuntimeExecutionContext {
  const s = self as any;
  const rlm = s.rlmConfig;
  const runtime = s.runtime;
  const maxSubAgentCalls = rlm.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
  const maxSubAgentCallsPerChild =
    rlm.maxSubAgentCallsPerChild ?? DEFAULT_RLM_MAX_LLM_CALLS_PER_CHILD;
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
    maxSubAgentCallsPerChild,
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
  const consumeDiscoveryTurnArtifacts = () => {
    const summary = formatDiscoveryTurnSummary(pendingDiscoveryTurnSummary);
    const texts = [...pendingDiscoveryTurnSummary.texts];
    pendingDiscoveryTurnSummary = createDiscoveryTurnSummary();
    return {
      ...(summary ? { summary } : {}),
      texts,
    };
  };

  const toolGlobals = s.buildRuntimeGlobals(
    effectiveAbortSignal,
    ai,
    completionBindings.protocolForTrigger,
    functionCallRecorder,
    noteDiscoveredActorModelNamespaces,
    noteDiscoveredModules,
    noteDiscoveredFunctions
  );
  const agentFunctionNamespaces = [
    ...new Set(
      s.agentFunctions.map(
        (f: { namespace?: string }) => f.namespace ?? 'utils'
      )
    ),
  ];
  const runtimeInputs = { ...inputState.currentInputs };
  const reservedTopLevelNames = new Set([
    'inputs',
    'llmQuery',
    DEFAULT_AGENT_MODULE_NAMESPACE,
    s.agentModuleNamespace,
    'final',
    'askClarification',
    ...(s.agentStatusCallback ? ['success', 'failed'] : []),
    ...agentFunctionNamespaces,
    ...(effectiveContextConfig.stateInspection.enabled
      ? ['inspect_runtime']
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

    for (const key of runtimeAliasKeys) {
      runtimeTopLevelInputAliases[key] = inputState.currentInputs[key];
    }
  };

  const protectedRuntimeNames = [...reservedTopLevelNames];
  const inspectReservedNames = [...reservedTopLevelNames, ...runtimeAliasKeys];
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
    });

  const inspectRuntime = effectiveContextConfig.stateInspection.enabled
    ? async (): Promise<string> =>
        renderRuntimeState(await inspectRuntimeState())
    : undefined;

  const createSession = () => {
    resetInspectBaseline();
    return runtime.createSession(
      {
        ...runtimeTopLevelInputAliases,
        inputs: runtimeInputs,
        ...bootstrapGlobals,
        llmQuery,
        final: completionBindings.finalFunction,
        askClarification: completionBindings.askClarificationFunction,
        ...(inspectRuntime ? { inspect_runtime: inspectRuntime } : {}),
        ...(s.agentStatusCallback
          ? {
              success: async (message: string) => {
                await s.agentStatusCallback!(message, 'success');
              },
              failed: async (message: string) => {
                await s.agentStatusCallback!(message, 'failed');
              },
            }
          : {}),
        ...toolGlobals,
      },
      {
        shouldBubbleError: (err: unknown) =>
          err instanceof AxAgentClarificationError ||
          err instanceof AxAIServiceAbortedError ||
          s.shouldBubbleUserError(err),
      }
    );
  };

  session = createSession();

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
    state: Readonly<AxAgentState>
  ): Promise<AxPreparedRestoredState> => {
    const preparedState = prepareRestoredState(state, inspectReservedNames);
    const patchableSession = getPatchableSession(session);
    await patchableSession.patchGlobals(preparedState.runtimeBindings, {
      signal: effectiveAbortSignal,
    });
    s.currentDiscoveryPromptState = restoreDiscoveryPromptState(
      preparedState.discoveryPromptState
    );
    return preparedState;
  };

  const exportRuntimeState = async (): Promise<AxAgentState> => {
    const snapshotableSession = getSnapshotableSession(session);
    const snapshot = await snapshotableSession.snapshotGlobals({
      signal: effectiveAbortSignal,
      reservedNames: inspectReservedNames,
    });
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
      provenance: runtimeStateProvenanceToRecord(provenance),
    };
  };

  const syncRuntimeInputsToSession = async (): Promise<void> => {
    refreshRuntimeBindings();

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
    close: () => {
      session.close();
    },
  };
}
