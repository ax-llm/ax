import type { AxAIService } from '../../ai/types.js';
import { f } from '../../dsp/sig.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import type { createCompletionBindings } from '../completion.js';
import {
  DEFAULT_RLM_BATCH_CONCURRENCY,
  DEFAULT_RLM_MAX_EVIDENCE_CHARS,
  DEFAULT_RLM_MAX_LLM_CALLS,
  resolveContextPolicy,
} from '../config.js';
import type { ActionLogEntry } from '../contextManager.js';
import { buildBootstrapRuntimeGlobals } from '../runtime.js';
import { computeDynamicRuntimeChars } from '../truncate.js';
import type { AxAgentUsedMemory } from './memoriesTypes.js';
import { buildExecutionHelpers } from './runtimeExecutionHelpers.js';
import { buildLlmQueryBindings } from './runtimeExecutionLlmQuery.js';
import { buildRunNoteBindings } from './runtimeExecutionNotes.js';
import { buildSessionLifecycle } from './runtimeExecutionSession.js';
import {
  AX_SHARED_EVIDENCE_GLOBAL,
  type AxAgentSharedRuntimeSession,
  isEvidenceDescriptor,
  measureEvidenceChars,
} from './sharedSession.js';
import type { AxAgentUsedSkill } from './skillsTypes.js';
import { type AxAgentStagePolicy, resolveStagePolicy } from './stagePolicy.js';
import type {
  AxAgentFunctionCallRecorder,
  AxAgentGuidanceState,
  AxAgentRecursionOptions,
  AxAgentRuntimeCompletionState,
  AxAgentRuntimeExecutionContext,
  AxAgentRuntimeInputState,
  AxLlmQueryBudgetState,
} from './types.js';

export {
  createRuntimeInputState,
  ensureLlmQueryBudgetState,
} from './runtimeInputState.js';

/**
 * Composition root for a single actor run's execution context. Wires the
 * per-run pieces together and returns the context the actor loop drives:
 *
 * - config resolution (context policy, runtime-char + evidence budgets)
 * - `llmQuery` bindings ({@link buildLlmQueryBindings})
 * - discovery/skills/memories note callbacks ({@link buildRunNoteBindings})
 * - tool globals, reserved names, and input aliases
 * - the session lifecycle — creation or shared-phase adoption, input sync,
 *   state restore/export, close ({@link buildSessionLifecycle})
 * - code execution helpers ({@link buildExecutionHelpers})
 */
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
  const stagePolicy: AxAgentStagePolicy =
    s.stagePolicy ?? resolveStagePolicy(s.options?.stageVariant);
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

  // `respond` evidence always materializes into the responder prompt (there
  // is no downstream runtime to hold it by reference), so every 2-arg call
  // is budgeted — including in shared mode, where `final` evidence would
  // have stayed in-worker.
  const guardedRespondFunction = (...args: unknown[]): never => {
    if (args.length === 2 && args[1] !== null && typeof args[1] === 'object') {
      const evidenceChars = measureEvidenceChars(args[1]);
      if (evidenceChars > maxEvidenceChars) {
        throw new Error(
          `respond() evidence is too large (~${evidenceChars} chars; limit ${maxEvidenceChars}). ` +
            'Narrow the evidence to only the fields the answer needs — filter, slice, and drop bulky raw values — then call respond() again.'
        );
      }
    }
    return completionBindings.respondFunction(...args);
  };

  // Direct-respond binding by stage: the distiller gets the real completion;
  // the executor gets a throwing stub so that in shared mode the executor
  // phase patches over the distiller's binding instead of leaving a stale
  // closure live in the worker. Feature off ⇒ no binding at all (a stray
  // `respond()` is an in-turn ReferenceError the actor recovers from).
  const directRespondEnabled = s.directRespondEnabled === true;
  const respondBinding: ((...args: unknown[]) => never) | undefined =
    !directRespondEnabled
      ? undefined
      : stagePolicy.variant === 'distiller'
        ? guardedRespondFunction
        : (..._args: unknown[]): never => {
            throw new Error(
              'respond() is only available in the context (distiller) phase. ' +
                'Use final(task, evidence) to hand results to the responder.'
            );
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

  const notes = buildRunNoteBindings({
    s,
    inputState,
    stageVariant: stagePolicy.variant,
    onUsedMemories,
    onUsedSkills,
  });

  s._activeMCPExecutionContext = options?._mcpExecutionContext;

  const toolGlobals = s.buildRuntimeGlobals(
    effectiveAbortSignal,
    ai,
    completionBindings.protocolForTrigger,
    functionCallRecorder,
    notes.noteDiscoveredActorModelNamespaces,
    notes.noteDiscoveredModules,
    notes.noteDiscoveredFunctions,
    notes.noteLoadedSkills,
    notes.noteLoadedMemories,
    notes.noteUsed,
    onFunctionCall ?? s.onFunctionCall,
    notes.getCurrentMemories
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
    stagePolicy.receivesFallbackEvidence &&
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
    ...(directRespondEnabled ? ['respond'] : []),
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
      ...(sharedActive && stagePolicy.inheritsPhase1ReservedNames
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

  const lifecycle = buildSessionLifecycle({
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
    respondBinding,
    llmQuery,
    toolGlobals,
    runtimeInputs,
    runtimeTopLevelInputAliases,
    refreshRuntimeBindings,
    inspectReservedNames,
    bootstrapGlobals,
    bootstrapGlobalNames,
    runtimeActionLogEntries,
  });

  const { executeActorCode, executeTestCode } = buildExecutionHelpers({
    s,
    sessionRef: lifecycle.sessionRef,
    effectiveAbortSignal,
    protectedRuntimeNames,
    completionState,
    getMaxRuntimeChars,
    waitForCompletionSignal: lifecycle.waitForCompletionSignal,
    detectCompletionSignalCalls: s.isJavaScriptRuntime !== false,
    createSession: lifecycle.createSession,
  });

  return {
    effectiveContextConfig,
    bootstrapContextSummary: lifecycle.bootstrapContextSummary,
    applyBootstrapRuntimeContext: lifecycle.applyBootstrapRuntimeContext,
    captureRuntimeStateSummary: lifecycle.captureRuntimeStateSummary,
    consumeDiscoveryTurnArtifacts: notes.consumeDiscoveryTurnArtifacts,
    getActorModelMatchedNamespaces: notes.getDiscoveredActorModelNamespaces,
    exportRuntimeState: lifecycle.exportRuntimeState,
    restoreRuntimeState: lifecycle.restoreRuntimeState,
    syncRuntimeInputsToSession: lifecycle.syncRuntimeInputsToSession,
    executeActorCode,
    executeTestCode,
    prepareSharedSession: lifecycle.prepareSharedSession,
    close: lifecycle.close,
  };
}
