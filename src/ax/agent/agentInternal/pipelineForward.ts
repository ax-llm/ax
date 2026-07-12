import type { AxAIService } from '../../ai/types.js';
import type {
  AxChatLogEntry,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgramStreamingForwardOptionsWithModels,
  AxProgramTrace,
  AxProgramUsage,
} from '../../dsp/types.js';
import { flow } from '../../flow/flow.js';
import { axResolveMCPExecutionContext } from '../../mcp/execution.js';
import { DEFAULT_RLM_MAX_LLM_CALLS } from '../config.js';
import {
  buildContextFieldPromptInlineValue,
  fieldAcceptsStringPreview,
} from '../runtime.js';
import type { AxAgentClarification } from './agentStateTypes.js';
import { AxAgentClarificationError } from './agentStateTypes.js';
import { transcribeAgentAudioInputs } from './audioInputs.js';
import type { AxAgent } from './coordinator.js';
import { mergeDiscoveryPromptStateInto } from './discoveryHelpers.js';
import { mergeUsedMemoryResults } from './memoriesHelpers.js';
import type {
  AxAgentUsedMemoriesCallback,
  AxAgentUsedMemory,
} from './memoriesTypes.js';
import { AUTO_PROMOTION_RESERVED_FIELDS } from './runtimeInputState.js';
import {
  AxAgentSharedRuntimeSession,
  buildEvidenceDescriptor,
  isEvidenceDescriptor,
  renderEvidenceDescriptor,
  supportsSharedRuntimeSession,
} from './sharedSession.js';
import {
  mergeSkillsPromptStateInto,
  mergeUsedSkillResults,
} from './skillsHelpers.js';
import type {
  AxAgentUsedSkill,
  AxAgentUsedSkillsCallback,
} from './skillsTypes.js';

type PipelineForwardState<IN extends AxGenIn> = {
  agentValues: IN;
  ai?: Readonly<AxAIService>;
  forwardOptions?: Readonly<Record<string, unknown>>;
};

function throwOnClarification(executorResult: any, owner: any): void {
  if (executorResult?.type === 'askClarification') {
    throw new AxAgentClarificationError(
      executorResult.args[0] as AxAgentClarification,
      {
        state: owner?.state,
        stateError: owner?.stateError,
      }
    );
  }
}

/**
 * Split incoming values into (contextValues, nonContextValues) using the
 * coordinator's `contextFieldNames` set.
 */
function splitValuesByContext(
  values: any,
  contextFieldNames: Set<string>
): {
  ctxValues: Record<string, unknown>;
  nonCtxValues: Record<string, unknown>;
} {
  const rawValues = (values ?? {}) as Record<string, unknown>;
  const ctxValues: Record<string, unknown> = {};
  const nonCtxValues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (contextFieldNames.has(k)) {
      ctxValues[k] = v;
    } else {
      nonCtxValues[k] = v;
    }
  }
  return { ctxValues, nonCtxValues };
}

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
 * Sentinel key carried in the executor stage's input record when the
 * distiller ended the run with `respond(task, evidence)`. The executor stage
 * node returns the pre-built run instead of calling the actor — the flow
 * topology stays a static three-node walk while the executor makes zero
 * model calls.
 */
const AX_DIRECT_RESPOND_RUN_KEY = '__axDirectRespondRun';

export function isDirectRespondPayload(
  payload: unknown
): payload is { type: 'respond'; args: unknown[] } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    (payload as { type?: unknown }).type === 'respond'
  );
}

/**
 * Synthesize the executor-run-shaped record for a direct-respond skip. The
 * respond payload is re-typed to `final` so everything downstream — the
 * responder's `{task, evidence}` reshape, eval `completionType`, contextMap
 * trajectory — consumes it exactly like an executor `final(task, evidence)`.
 * The respond binding passed real values across the worker boundary (unlike
 * the distiller's `final`, whose evidence stays in-session by reference), so
 * the evidence in `args` is already responder-ready.
 *
 * Distiller-side artifacts (actionLog, guidanceLog, usedMemories/usedSkills)
 * stay on the distiller run — consumers merge from `state.distillerResult`,
 * and duplicating them here would double-count.
 */
export function buildDirectRespondExecutorRun(
  p: any,
  nonCtxValues: Record<string, unknown>,
  distillerRun: any
): Record<string, unknown> {
  if ((p.distiller as any)?.directRespondEnabled !== true) {
    throw new Error(
      "AxAgent: the distiller produced a respond() payload while directResponse is 'off' — refusing to skip the executor. " +
        'This indicates restored state or an out-of-band actor payload that the configuration forbids.'
    );
  }
  const respondArgs = (distillerRun.executorResult?.args ?? []) as unknown[];
  return {
    nonContextValues: {
      ...nonCtxValues,
      ...(distillerRun.nonContextValues as Record<string, unknown>),
    },
    contextMetadata: undefined,
    guidanceLog: undefined,
    actionLog: '',
    executorResult: { type: 'final', args: respondArgs },
    actorFieldValues: {},
    usedMemories: [],
    usedSkills: [],
    turnCount: 0,
  };
}

/**
 * On a direct-respond skip the distiller's exported state (bindings included
 * — see the `endedInRespond` exception in the actor loop) becomes the
 * pipeline's canonical cross-run state, replacing whatever the executor held
 * from a previous run (stale by definition once this run completed).
 */
function applyDirectRespondState(p: any): void {
  p.executor.state = p.distiller.state;
  p.executor.stateError = p.distiller.stateError;
}

class ActorStageProgram {
  private id = '';

  constructor(
    private readonly actor: any,
    private readonly stage?: 'ctx' | 'task'
  ) {}

  public async forward(
    ai: Readonly<AxAIService>,
    values: any,
    options?: Readonly<AxProgramForwardOptions<string>>
  ) {
    // Direct-respond skip: the handoff step already synthesized this stage's
    // run — return it without touching the actor (zero model calls).
    const directRespondRun = values?.[AX_DIRECT_RESPOND_RUN_KEY];
    if (directRespondRun) {
      return directRespondRun;
    }
    return this.actor.run(ai, values, options);
  }

  public async *streamingForward(
    ai: Readonly<AxAIService>,
    values: any,
    options?: Readonly<AxProgramForwardOptions<string>>
  ): AxGenStreamingOut<any> {
    yield {
      version: 1,
      index: 0,
      delta: await this.forward(ai, values, options),
    };
  }

  public getSignature() {
    return this.actor.getSignature();
  }

  public getId(): string {
    return this.id;
  }

  public setId(id: string): void {
    this.id = id;
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    return this.actor.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<any, any>[] {
    return this.actor.namedProgramInstances();
  }

  public getTraces(): AxProgramTrace<any, any>[] {
    return this.actor.getTraces();
  }

  public setDemos(
    demos: readonly AxProgramDemos<any, any>[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    this.actor.setDemos(demos, options);
  }

  public applyOptimization(optimizedProgram: any): void {
    this.actor.applyOptimization(optimizedProgram);
  }

  public getOptimizableComponents(): readonly any[] {
    return this.actor.getOptimizableComponents();
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.actor.applyOptimizedComponents(updates);
  }

  public getUsage(): readonly AxProgramUsage[] {
    return this.actor.getUsage();
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.actor.getChatLog().map((entry: AxChatLogEntry) => ({
      ...entry,
      ...(this.stage ? { stage: this.stage } : {}),
    }));
  }

  public resetUsage(): void {
    this.actor.resetUsage();
  }

  public stop(): void {
    this.actor.stop();
  }
}

class FinalResponderStageProgram {
  private id = '';

  constructor(
    private readonly responder: any,
    private readonly stage?: 'ctx' | 'task'
  ) {}

  public async forward(
    ai: Readonly<AxAIService>,
    values: Readonly<{
      nonContextValues: Record<string, unknown>;
      executorResult: unknown;
    }>,
    options?: Readonly<AxProgramForwardOptions<string>>
  ) {
    return this.responder.forward(ai, {
      nonContextValues: values.nonContextValues,
      executorResult: values.executorResult,
      options,
    });
  }

  public async *streamingForward(
    ai: Readonly<AxAIService>,
    values: Readonly<{
      nonContextValues: Record<string, unknown>;
      executorResult: unknown;
    }>,
    options?: Readonly<AxProgramForwardOptions<string>>
  ): AxGenStreamingOut<any> {
    yield* this.responder.streamingForward(ai, {
      nonContextValues: values.nonContextValues,
      executorResult: values.executorResult,
      options,
    });
  }

  public getSignature() {
    return this.responder.getSignature();
  }

  public getId(): string {
    return this.id;
  }

  public setId(id: string): void {
    this.id = id;
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    return this.responder.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<any, any>[] {
    return this.responder.namedProgramInstances();
  }

  public getTraces(): AxProgramTrace<any, any>[] {
    return this.responder.getTraces();
  }

  public setDemos(
    demos: readonly AxProgramDemos<any, any>[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    this.responder.setDemos(demos, options);
  }

  public applyOptimization(optimizedProgram: any): void {
    this.responder.applyOptimization(optimizedProgram);
  }

  public getOptimizableComponents(): readonly any[] {
    return this.responder.getOptimizableComponents();
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.responder.applyOptimizedComponents(updates);
  }

  public getUsage(): readonly AxProgramUsage[] {
    return this.responder.getUsage();
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.responder.getChatLog().map((entry: AxChatLogEntry) => ({
      ...entry,
      ...(this.stage ? { stage: this.stage } : {}),
    }));
  }

  public resetUsage(): void {
    this.responder.resetUsage();
  }

  public stop(): void {
    this.responder.stop();
  }
}

/**
 * Create the per-forward shared runtime session controller and thread it (and
 * a pipeline-wide llmQuery budget) into both actor stages. JS-capable
 * runtimes get shared mode (one worker session spans both phases); other
 * runtimes fall back to per-stage sessions with a host-carried evidence
 * value. Callers MUST pair with `endPipelineSharedSession` in a finally.
 */
export function beginPipelineSharedSession(
  p: any
): AxAgentSharedRuntimeSession {
  const distiller = p.distiller as any;
  const executor = p.executor as any;
  const shared =
    supportsSharedRuntimeSession(
      distiller.runtime,
      distiller.isJavaScriptRuntime !== false
    ) &&
    supportsSharedRuntimeSession(
      executor.runtime,
      executor.isJavaScriptRuntime !== false
    );
  const controller = new AxAgentSharedRuntimeSession({
    mode: shared ? 'shared' : 'fallback',
  });
  controller.excludeFieldDeletions = [...p.executorExcludeFields];
  // The executor holds the pipeline's canonical cross-run state; its variable
  // bindings are restored once into the phase-1 session at adoption.
  controller.restoreState = executor.state;

  const maxSubAgentCalls =
    executor.rlmConfig?.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
  const sharedBudget = {
    global: { used: 0 },
    globalMax: maxSubAgentCalls,
    localUsed: 0,
    localMax: maxSubAgentCalls,
  };
  distiller._sharedSession = controller;
  executor._sharedSession = controller;
  distiller.llmQueryBudgetState = sharedBudget;
  executor.llmQueryBudgetState = sharedBudget;
  return controller;
}

export function endPipelineSharedSession(
  p: any,
  controller: AxAgentSharedRuntimeSession
): void {
  const distiller = p.distiller as any;
  const executor = p.executor as any;
  distiller._sharedSession = undefined;
  executor._sharedSession = undefined;
  distiller.llmQueryBudgetState = undefined;
  executor.llmQueryBudgetState = undefined;
  controller.close();
}

/**
 * Shared distiller→executor handoff used by the flow, streaming, and
 * evaluation paths.
 *
 * - `executorRequest` comes from the distiller's `final(request, …)`.
 * - Evidence arrives as an in-worker descriptor (shared mode — the data never
 *   left the runtime) or as the real value (fallback mode — parked on the
 *   controller for injection into the executor's runtime). Either way the
 *   executor's prompt gets only `distilledContextSummary`.
 * - Discovery docs and loaded skills the distiller acquired merge into the
 *   executor's prompt state (memories already carry via nonContextValues).
 */
export function buildExecutorHandoffInputs(
  p: any,
  sharedSession: AxAgentSharedRuntimeSession | undefined,
  nonCtxValues: Record<string, unknown>,
  distillerRun: any
): Record<string, unknown> {
  const distillerArgs = distillerRun.executorResult?.args ?? [];
  const executorRequest =
    distillerArgs[0] ?? defaultExecutorRequest(nonCtxValues);

  const rawEvidence = distillerArgs[1];
  let distilledContextSummary: string | undefined;
  if (isEvidenceDescriptor(rawEvidence)) {
    distilledContextSummary = renderEvidenceDescriptor(rawEvidence);
  } else if (
    rawEvidence &&
    typeof rawEvidence === 'object' &&
    !Array.isArray(rawEvidence)
  ) {
    const evidence = rawEvidence as Record<string, unknown>;
    if (sharedSession) {
      sharedSession.fallbackEvidence = evidence;
    }
    distilledContextSummary = renderEvidenceDescriptor(
      buildEvidenceDescriptor(evidence)
    );
  }

  mergeDiscoveryPromptStateInto(
    (p.executor as any).currentDiscoveryPromptState,
    (p.distiller as any).currentDiscoveryPromptState
  );
  mergeSkillsPromptStateInto(
    (p.executor as any).currentSkillsPromptState,
    (p.distiller as any).currentSkillsPromptState
  );

  const rawExecutorInputs: Record<string, unknown> = {
    ...nonCtxValues,
    ...(distillerRun.nonContextValues as Record<string, unknown>),
    executorRequest,
    ...(distilledContextSummary !== undefined
      ? { distilledContextSummary }
      : {}),
    // In shared mode the raw context variables are still live in the session;
    // forward the distiller's rendered context metadata so the executor knows
    // they exist. Fallback mode omits it — the context truly isn't there.
    ...(sharedSession?.isShared && distillerRun.contextMetadata
      ? { contextMetadata: distillerRun.contextMetadata }
      : {}),
  };
  const executorExclude: Set<string> = p.executorExcludeFields;
  for (const key of executorExclude) delete rawExecutorInputs[key];
  return rawExecutorInputs;
}

/**
 * After the distiller runs, build the input record for the executor.
 * Merges non-context input values with the distiller's handoff payload,
 * drops `executorExcludeFields`, and preserves the original non-context
 * values so the responder can later restore actor-excluded fields it still
 * wants to see.
 */
function buildExecutorInputsFromDistiller(p: any, state: any) {
  const distillerRun = state.distillerResult;
  throwOnClarification(distillerRun.executorResult, p.distiller);
  const { nonCtxValues } = splitValuesByContext(
    state.agentValues,
    p.contextFieldNames
  );
  if (isDirectRespondPayload(distillerRun.executorResult)) {
    const directRespondRun = buildDirectRespondExecutorRun(
      p,
      nonCtxValues,
      distillerRun
    );
    applyDirectRespondState(p);
    return {
      ...state,
      executorInputs: {
        // The real task string, so the contextMap trajectory update reads a
        // meaningful `executorRequest` from the skip run too.
        executorRequest: String(distillerRun.executorResult.args?.[0] ?? ''),
        [AX_DIRECT_RESPOND_RUN_KEY]: directRespondRun,
      },
      originalNonCtxValues: nonCtxValues,
    };
  }
  const rawExecutorInputs = buildExecutorHandoffInputs(
    p,
    state._sharedSession,
    nonCtxValues,
    distillerRun
  );
  return {
    ...state,
    executorInputs: rawExecutorInputs,
    originalNonCtxValues: nonCtxValues,
  };
}

/**
 * Assemble the responder's non-context values from the executor stage's
 * returned values plus the original input. Restores executor-excluded fields
 * and any original key the executor stage dropped (stage-level auto-promotion
 * keeps oversized values runtime-only, so they never come back in
 * `nonContextValues`), substitutes a truncated preview for oversized string
 * values when auto-upgrade is on (the responder synthesizes from executor
 * evidence — it has no runtime to read full values from, so non-string
 * oversized values pass through untouched), then drops
 * `responderExcludeFields`. Shared by the flow, streaming, and evaluation
 * paths.
 */
export function finalizeResponderNonContextValues(
  p: any,
  nonCtxFromExecutor: Record<string, unknown>,
  originalNonCtxValues: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nonCtxFromExecutor };
  const executorExclude: Set<string> = p.executorExcludeFields;
  for (const [key, value] of Object.entries(originalNonCtxValues)) {
    if (executorExclude.has(key) || !(key in out)) {
      out[key] = value;
    }
  }

  const autoContext = p.autoUpgradeResolved?.contextFields as
    | { enabled: boolean; promoteAboveChars: number; previewChars: number }
    | undefined;
  if (autoContext?.enabled) {
    const fieldByName = new Map<string, { type?: unknown }>(
      (p.fullSignature?.getInputFields?.() ?? []).map(
        (fld: { name: string }) => [fld.name, fld]
      )
    );
    for (const [key, value] of Object.entries(out)) {
      if (
        typeof value !== 'string' ||
        value.length <= autoContext.promoteAboveChars ||
        AUTO_PROMOTION_RESERVED_FIELDS.has(key) ||
        !fieldAcceptsStringPreview(fieldByName.get(key) as any)
      ) {
        continue;
      }
      out[key] = buildContextFieldPromptInlineValue(value, {
        kind: 'truncate',
        keepInPromptChars: autoContext.previewChars,
        reverseTruncate: false,
      });
    }
  }

  const responderExclude: Set<string> = p.responderExcludeFields;
  for (const key of responderExclude) delete out[key];
  return out;
}

/**
 * After the executor runs, build the input for the responder. Starts
 * from the task executor's nonContextValues (so inputUpdateCallback edits
 * survive), restores actor-excluded fields from the original input, then
 * removes `responderExcludeFields`.
 */
function buildResponderInputFromExecutor(p: any, state: any) {
  const executorRun = state.executorResult;
  throwOnClarification(executorRun.executorResult, p.executor);
  const {
    executorRequest: _ignoreT,
    distilledContextSummary: _ignoreC,
    contextMetadata: _ignoreCM,
    memories: _ignoreM,
    ...nonCtxFromExecutor
  } = executorRun.nonContextValues as Record<string, unknown>;
  const originalNonCtxValues = state.originalNonCtxValues as Record<
    string,
    unknown
  >;
  const nonCtxForResponder = finalizeResponderNonContextValues(
    p,
    nonCtxFromExecutor,
    originalNonCtxValues
  );
  const usedMemories = mergeUsedMemoryResults(
    state.distillerResult?.usedMemories,
    executorRun.usedMemories ?? []
  );
  const usedSkills = mergeUsedSkillResults(
    state.distillerResult?.usedSkills,
    executorRun.usedSkills ?? []
  );
  notifyUsedMemories(p, state.forwardOptions, usedMemories);
  notifyUsedSkills(p, state.forwardOptions, usedSkills);
  return {
    ...state,
    usedMemories,
    usedSkills,
    responderInput: {
      nonContextValues: nonCtxForResponder,
      executorResult: executorRun.executorResult,
    },
  };
}

function mergePipelineReturn(state: any) {
  return state.responderResult;
}

async function updateContextMapFromState(p: any, state: any) {
  if (state.ai && typeof p._updateContextMapFromPipelineState === 'function') {
    await p._updateContextMapFromPipelineState(
      state.ai,
      state,
      state.responderResult
    );
  }
  return state;
}

function getUsedMemoriesCallback(
  p: any,
  options: unknown
): AxAgentUsedMemoriesCallback | undefined {
  const forwardCallback = (options as { onUsedMemories?: unknown } | undefined)
    ?.onUsedMemories;
  if (typeof forwardCallback === 'function') {
    return forwardCallback as AxAgentUsedMemoriesCallback;
  }
  return typeof p.options?.onUsedMemories === 'function'
    ? p.options.onUsedMemories
    : undefined;
}

function notifyUsedMemories(
  p: any,
  options: unknown,
  usedMemories: readonly AxAgentUsedMemory[]
): void {
  const callback = getUsedMemoriesCallback(p, options);
  if (!callback) {
    return;
  }
  Promise.resolve(callback(usedMemories)).catch(() => {});
}

function getUsedSkillsCallback(
  p: any,
  options: unknown
): AxAgentUsedSkillsCallback | undefined {
  const forwardCallback = (options as { onUsedSkills?: unknown } | undefined)
    ?.onUsedSkills;
  if (typeof forwardCallback === 'function') {
    return forwardCallback as AxAgentUsedSkillsCallback;
  }
  return typeof p.options?.onUsedSkills === 'function'
    ? p.options.onUsedSkills
    : undefined;
}

function notifyUsedSkills(
  p: any,
  options: unknown,
  usedSkills: readonly AxAgentUsedSkill[]
): void {
  const callback = getUsedSkillsCallback(p, options);
  if (!callback) {
    return;
  }
  Promise.resolve(callback(usedSkills)).catch(() => {});
}

export function buildPipelineFlow<IN extends AxGenIn, OUT extends AxGenOut>(
  pipeline: AxAgent<IN, OUT>
) {
  const p = pipeline as any;
  return flow<PipelineForwardState<IN>, OUT>({
    autoParallel: false,
  })
    .node('distiller', new ActorStageProgram(p.distiller, 'ctx') as any)
    .node('executor', new ActorStageProgram(p.executor, 'task') as any)
    .node(
      'responder',
      new FinalResponderStageProgram(p.responder, 'task') as any
    )
    .execute(
      'distiller',
      (state) => state.agentValues as any,
      p.distillerAi ? { ai: p.distillerAi } : undefined
    )
    .map((state) => buildExecutorInputsFromDistiller(p, state))
    .execute(
      'executor',
      (state) => (state as any).executorInputs,
      p.executorAi ? { ai: p.executorAi } : undefined
    )
    .map((state) => buildResponderInputFromExecutor(p, state))
    .execute(
      'responder',
      (state) => (state as any).responderInput,
      p.responderAi ? { ai: p.responderAi } : undefined
    )
    .map((state) => updateContextMapFromState(p, state))
    .returns(mergePipelineReturn);
}

/**
 * Walk the pipeline once and return the final user output.
 *
 *   distiller.run → executor.run → responder.forward
 *
 * Every agent run walks the static pipeline in order. `actorFieldValues` from
 * the task actor are merged into the final result *after* the responder output,
 * matching the legacy "responder can't overwrite extra actor outputs" contract.
 */
export async function forwardPipeline<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  T extends Readonly<AxAIService>,
>(
  pipeline: AxAgent<IN, OUT>,
  ai: T,
  values: IN,
  options?: Readonly<AxProgramForwardOptionsWithModels<T>>
): Promise<OUT> {
  const p = pipeline as any;
  const mcpExecutionContext = await axResolveMCPExecutionContext(
    options ?? {},
    p.options ?? {}
  );
  const runOptions = mcpExecutionContext
    ? { ...options, _mcpExecutionContext: mcpExecutionContext }
    : options;
  await mcpExecutionContext?.restoreContinuationState(p.executor.state?.mcp);
  const agentValues = await transcribeAgentAudioInputs(
    p.distillerAi ?? ai,
    p.fullSignature ?? pipeline.getSignature(),
    values,
    runOptions as any
  );
  if (typeof p._syncContextMapPrompt === 'function') {
    p._syncContextMapPrompt();
  }
  const sharedSession = beginPipelineSharedSession(p);
  try {
    return (await p.pipelineFlow.forward(
      ai,
      {
        agentValues,
        ai,
        forwardOptions: runOptions,
        _sharedSession: sharedSession,
      },
      runOptions
    )) as OUT;
  } finally {
    endPipelineSharedSession(p, sharedSession);
  }
}

/**
 * Streaming variant of `forwardPipeline`. All actor stages run non-streaming;
 * only the responder is streamed.
 */
export async function* streamingForwardPipeline<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  T extends Readonly<AxAIService>,
>(
  pipeline: AxAgent<IN, OUT>,
  ai: T,
  values: IN,
  options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
): AxGenStreamingOut<OUT> {
  const p = pipeline as any;
  const mcpExecutionContext = await axResolveMCPExecutionContext(
    options ?? {},
    p.options ?? {}
  );
  const runOptions = mcpExecutionContext
    ? { ...options, _mcpExecutionContext: mcpExecutionContext }
    : options;
  await mcpExecutionContext?.restoreContinuationState(p.executor.state?.mcp);
  const valuesForStages = await transcribeAgentAudioInputs(
    p.distillerAi ?? ai,
    p.fullSignature ?? pipeline.getSignature(),
    values,
    runOptions as any
  );
  const contextFieldNames: Set<string> = p.contextFieldNames;
  // The distiller receives the full input so it can normalize the request
  // while treating declared contextFields as runtime-only context. The task
  // stage receives only non-context inputs plus the handoff fields.
  const { nonCtxValues } = splitValuesByContext(
    valuesForStages,
    contextFieldNames
  );

  const distillerAi = p.distillerAi ?? ai;
  const executorAi = p.executorAi ?? ai;
  const responderAi = p.responderAi ?? ai;
  if (typeof p._syncContextMapPrompt === 'function') {
    p._syncContextMapPrompt();
  }

  const sharedSession = beginPipelineSharedSession(p);
  try {
    const distillerRun = await p.distiller.run(
      distillerAi,
      valuesForStages,
      runOptions
    );
    throwOnClarification(distillerRun.executorResult, p.distiller);

    let executorInputs: Record<string, unknown>;
    let executorRun: any;
    if (isDirectRespondPayload(distillerRun.executorResult)) {
      // Direct-respond skip: synthesize the executor run host-side (zero
      // executor model calls) and stream the responder as usual.
      executorRun = buildDirectRespondExecutorRun(
        p,
        nonCtxValues,
        distillerRun
      );
      applyDirectRespondState(p);
      executorInputs = {
        executorRequest: String(distillerRun.executorResult.args?.[0] ?? ''),
      };
    } else {
      executorInputs = buildExecutorHandoffInputs(
        p,
        sharedSession,
        nonCtxValues,
        distillerRun
      );
      executorRun = await p.executor.run(
        executorAi,
        executorInputs,
        runOptions
      );
      throwOnClarification(executorRun.executorResult, p.executor);
    }
    const usedMemories = mergeUsedMemoryResults(
      distillerRun.usedMemories,
      executorRun.usedMemories ?? []
    );
    const usedSkills = mergeUsedSkillResults(
      distillerRun.usedSkills,
      executorRun.usedSkills ?? []
    );
    notifyUsedMemories(p, runOptions, usedMemories);
    notifyUsedSkills(p, runOptions, usedSkills);
    const {
      executorRequest: _ignoreT,
      distilledContextSummary: _ignoreC,
      contextMetadata: _ignoreCM,
      memories: _ignoreM,
      ...nonCtxFromExecutor
    } = executorRun.nonContextValues as Record<string, unknown>;
    const nonCtxForResponder = finalizeResponderNonContextValues(
      p,
      nonCtxFromExecutor,
      nonCtxValues as Record<string, unknown>
    );
    yield* p.responder.streamingForward(responderAi, {
      nonContextValues: nonCtxForResponder,
      executorResult: executorRun.executorResult,
      options: runOptions,
    });
    if (typeof p._updateContextMapFromPipelineState === 'function') {
      await p._updateContextMapFromPipelineState(ai, {
        agentValues: valuesForStages,
        executorInputs,
        distillerResult: distillerRun,
        executorResult: executorRun,
      });
    }
  } finally {
    endPipelineSharedSession(p, sharedSession);
  }
}
