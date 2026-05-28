import type {
  AxAgentCompletionProtocol,
  AxAIService,
  AxFunction,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import {
  type AxOptimizableComponent,
  axOptimizableValidators,
} from '../dsp/optimizable.js';
import type {
  AxIField,
  AxSignatureConfig,
  AxSignatureInput,
} from '../dsp/sig.js';
import { AxSignature } from '../dsp/sig.js';
import type {
  AxChatLogEntry,
  AxGenIn,
  AxGenOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgramUsage,
} from '../dsp/types.js';
import type { createCompletionBindings } from './completion.js';
import type { ActionLogEntry } from './contextManager.js';
import type { AxCodeRuntime, AxRLMConfig } from './rlm.js';
import {
  type AxRuntimePrimitiveStage,
  renderRuntimePrimitive,
  visibleRuntimePrimitives,
} from './runtimePrimitives.js';
import { cloneAgentState } from './state.js';
import {
  requiredTemplateVariables,
  validatePromptTemplateSyntax,
} from './templateEngine.js';
import { promptTemplates, type TemplateId } from './templates.generated.js';

export * from './agentInternal/types.js';
export {
  AxAgentContextMap,
  type AxAgentContextMapConfig,
  type AxAgentContextMapOperation,
  type AxAgentContextMapOptions,
  type AxAgentContextMapSnapshot,
  type AxAgentContextMapUpdateResult,
} from './contextMap.js';

import { runActorLoop } from './agentInternal/actorLoop.js';
import {
  applyOptimization as applyOptimizationImpl,
  getFunction as getFunctionImpl,
  setState as setStateImpl,
  testAgent,
} from './agentInternal/agentPublicMethods.js';
import { createMutableDiscoveryPromptState } from './agentInternal/discoveryHelpers.js';
import { initializeAgentInternal } from './agentInternal/initialization.js';
// optimizer helpers live on the pipeline AxAgent (coordinator.ts).
import {
  buildActorInstruction,
  renderActorDefinition,
} from './agentInternal/promptAssembly.js';
import {
  listOptimizationTargetDescriptors,
  supportsRecursiveActorSlotOptimization,
} from './agentInternal/recursiveOptimization.js';
import {
  createRuntimeExecutionContext,
  createRuntimeInputState,
  ensureLlmQueryBudgetState,
} from './agentInternal/runtimeExecution.js';
import {
  buildFuncParameters,
  buildRuntimeGlobals,
  wrapFunction,
} from './agentInternal/runtimeGlobals.js';
import { buildSplitPrograms } from './agentInternal/signatureBuilders.js';
import type {
  AxAgentDemos,
  AxAgentEvalFunctionCall,
  AxAgentExecutorResultPayload,
  AxAgentFunction,
  AxAgentFunctionCallRecorder,
  AxAgentFunctionModuleMeta,
  AxAgentGuidanceState,
  AxAgentIdentity,
  AxAgentInputUpdateCallback,
  AxAgentJudgeOptions,
  AxAgentOptimizationTargetDescriptor,
  AxAgentOptions,
  AxAgentRecursionOptions,
  AxAgentRuntimeCompletionState,
  AxAgentRuntimeExecutionContext,
  AxAgentRuntimeInputState,
  AxAgentState,
  AxAgentTestResult,
  AxAgentUsedMemory,
  AxAgentUsedSkill,
  AxAnyAgentic,
  AxContextFieldPromptConfig,
  AxLlmQueryBudgetState,
  AxResolvedExecutorModelPolicy,
  AxStageDefinitionBuildOptions,
} from './agentInternal/types.js';
import {
  mergeAgentFunctionModuleMetadata,
  reservedAgentFunctionNamespaces,
  validateAgentFunctionNamespaces,
  validateConfiguredSignature,
} from './agentInternal/validation.js';

// ----- ActorAgentRLM Class -----

/**
 * RLM actor stage: a single AxGen program driven in a JS-runtime loop.
 *
 * The actor generates JavaScript, the TypeScript loop executes it in a
 * pluggable `AxCodeRuntime`, the result is appended to an action log, and the
 * loop continues until the actor terminates with `final(...)` /
 * `askClarification(...)` (or hits `maxTurns`).
 *
 * Synthesis (turning the actor's `{task, evidence}` payload into structured
 * output fields) is **not** done here — it lives in a `Synthesizer` stage
 * that the pipeline (`AxAgent`) composes after the actor loop.
 *
 * The pipeline owns up to two of these (one for context distillation, one
 * for task execution). Use `ActorAgentRLM` directly only when you need
 * precise per-instance configuration outside the standard pipeline.
 */
/**
 * Note: this no longer implements `AxAgentic` because synthesis (responder)
 * is owned by the pipeline `AxAgent`. Use `AxAgent` (or the `agent()` factory)
 * for the user-facing surface; `ActorAgentRLM` is the building block.
 */
export class ActorAgentRLM<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  private ai?: AxAIService;
  private judgeAI?: AxAIService;
  private program!: AxGen<IN, OUT>;
  private actorProgram!: AxGen<any, any>;
  /**
   * Child agents that arrived through `options.functions` and were inlined as
   * tools. Tracked here so the optimizer can still walk into them via
   * `getOptimizableComponents`.
   */
  private agents?: AxAnyAgentic[];
  private agentFunctions!: AxAgentFunction[];
  private agentFunctionModuleMetadata = new Map<
    string,
    AxAgentFunctionModuleMeta
  >();
  private debug?: boolean;
  private options?: Readonly<AxAgentOptions<IN>>;
  private rlmConfig!: AxRLMConfig;
  private runtime!: AxCodeRuntime;
  private executorDescription?: string;
  private executorModelPolicy?: AxResolvedExecutorModelPolicy;
  private judgeOptions?: AxAgentJudgeOptions;
  private recursionForwardOptions?: AxAgentRecursionOptions;
  private executorForwardOptions?: Partial<AxProgramForwardOptions<string>>;
  private inputUpdateCallback?: AxAgentInputUpdateCallback<IN>;
  private agentStatusCallback?: (
    message: string,
    status: 'success' | 'failed'
  ) => void | Promise<void>;
  private onFunctionCall?: import('./agentInternal/types.js').AxAgentOnFunctionCall;
  private onContextEvent?: import('./contextEvents.js').AxAgentOnContextEvent;
  private contextPromptConfigByField: Map<string, AxContextFieldPromptConfig> =
    new Map();
  private functionDiscoveryEnabled = false;
  private runtimeUsageInstructions = '';
  private enforceIncrementalConsoleTurns = false;
  private bubbleErrors?: ReadonlyArray<new (...args: any[]) => Error>;
  private agentIdentity?: AxAgentIdentity;

  private activeAbortControllers = new Set<AbortController>();
  private _stopRequested = false;
  public state: AxAgentState | undefined;
  public stateError: string | undefined;
  private runtimeBootstrapContext: unknown = undefined;
  private llmQueryBudgetState: AxLlmQueryBudgetState | undefined;
  private baseActorDefinition = '';
  private currentDiscoveryPromptState = createMutableDiscoveryPromptState();
  private actorDefinitionBaseDescription: string | undefined;
  private actorDefinitionContextFields: readonly AxIField[] = [];
  private actorDefinitionResponderOutputFields: readonly AxIField[] = [];
  private actorDefinitionBuildOptions:
    | AxStageDefinitionBuildOptions
    | undefined;
  private func: AxFunction | undefined;

  /** Per-instance overrides for shipped RLM template sources, keyed by TemplateId. */
  public _actorTemplateOverrides: Map<TemplateId, string> | undefined;
  /** Per-instance overrides for primitive bullet line(s), keyed by primitive id. */
  public _primitiveOverrides: Map<string, readonly string[]> | undefined;

  /** Returns the actor template id this agent's variant renders. */
  public _actorTemplateId(): TemplateId {
    const variant = (this as any).options?.stageVariant as
      | 'distiller'
      | 'executor'
      | undefined;
    if (variant === 'distiller') return 'rlm/distiller.md';
    return 'rlm/executor.md';
  }

  private _actorPrimitiveStage(): AxRuntimePrimitiveStage {
    const variant = (this as any).options?.stageVariant as
      | 'distiller'
      | 'executor'
      | undefined;
    return variant === 'distiller' ? 'distiller' : 'executor';
  }

  private _primitiveFlags(): Record<string, boolean | undefined> {
    const opts = this.actorDefinitionBuildOptions;
    return {
      hasInspectRuntime: Boolean(opts?.hasInspectRuntime),
      hasAgentStatusCallback: Boolean(opts?.hasAgentStatusCallback),
      discoveryMode: Boolean(opts?.discoveryMode),
      skillsMode: Boolean(opts?.skillsMode),
      memoriesMode: Boolean(opts?.memoriesMode),
      memoryUsageMode: Boolean(opts?.memoryUsageMode),
      skillUsageMode: Boolean(opts?.skillUsageMode),
      usageTrackingMode: Boolean(opts?.usageTrackingMode),
    };
  }

  /**
   * Components owned by this actor agent: the actor template plus each
   * runtime primitive that would be rendered for the current variant + flag
   * set. The Synthesizer stage owns the responder template separately.
   */
  private _localOptimizableComponents(): readonly AxOptimizableComponent[] {
    const id = this.getId();
    const out: AxOptimizableComponent[] = [];

    const actorTplId = this._actorTemplateId();
    const current =
      this._actorTemplateOverrides?.get(actorTplId) ??
      promptTemplates[actorTplId];
    const requiredVariables = requiredTemplateVariables(actorTplId);
    out.push({
      key: `${id}::actor-tpl:${actorTplId}`,
      kind: 'actor-tpl',
      current,
      description: `RLM template '${actorTplId}' rendered as the actor system prompt.`,
      constraints:
        'Preserve the full set of `{{var}}` placeholders the renderer expects; the result must be a valid template that parses cleanly.',
      validate: (value) =>
        validatePromptTemplateSyntax(
          value,
          `template-validate:${actorTplId}`,
          requiredVariables
        ),
    });

    const stage = this._actorPrimitiveStage();
    const flags = this._primitiveFlags();
    for (const p of visibleRuntimePrimitives(stage, flags)) {
      const current = renderRuntimePrimitive(
        p,
        flags,
        this._primitiveOverrides?.get(p.id)
      );
      out.push({
        key: `${id}::primitive:${p.id}`,
        kind: 'primitive',
        current,
        description: `Runtime primitive \`${p.id}\` advertised in the actor prompt. Each blank-line-separated entry is a description-then-signature block.`,
        constraints:
          'Blank-line-separated entries; each entry is a short purpose statement followed by a backtick-wrapped signature on the next line.',
        validate: axOptimizableValidators.nonEmpty(),
      });
    }

    return out;
  }

  /** Apply this agent's own override updates and return whether any changed. */
  private _applyLocalOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): boolean {
    const id = this.getId();
    const tplPrefix = `${id}::actor-tpl:`;
    const primPrefix = `${id}::primitive:`;
    let changed = false;

    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'string') continue;

      if (key.startsWith(tplPrefix)) {
        const tplId = key.slice(tplPrefix.length) as TemplateId;
        if (!(tplId in promptTemplates)) continue;
        if (
          validatePromptTemplateSyntax(
            value,
            `template-validate:${tplId}`,
            requiredTemplateVariables(tplId)
          ) !== true
        ) {
          continue;
        }
        if (!this._actorTemplateOverrides) {
          this._actorTemplateOverrides = new Map();
        }
        this._actorTemplateOverrides.set(tplId, value);
        changed = true;
        continue;
      }

      if (key.startsWith(primPrefix)) {
        const pid = key.slice(primPrefix.length);
        if (!this._primitiveOverrides) {
          this._primitiveOverrides = new Map();
        }
        const lines = value
          .split(/\n{2,}/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (lines.length === 0) continue;
        this._primitiveOverrides.set(pid, lines);
        changed = true;
      }
    }

    return changed;
  }

  private shouldBubbleUserError(err: unknown): boolean {
    if (!this.bubbleErrors || this.bubbleErrors.length === 0) return false;
    return this.bubbleErrors.some((ErrorClass) => err instanceof ErrorClass);
  }

  private _reservedAgentFunctionNamespaces(): Set<string> {
    return reservedAgentFunctionNamespaces(this);
  }

  private _mergeAgentFunctionModuleMetadata(
    newMetadata: readonly AxAgentFunctionModuleMeta[]
  ): boolean {
    return mergeAgentFunctionModuleMetadata(this, newMetadata);
  }

  private _validateConfiguredSignature(signature: Readonly<AxSignature>): void {
    validateConfiguredSignature(this, signature);
  }

  private _validateAgentFunctionNamespaces(
    functions: readonly AxAgentFunction[]
  ): void {
    validateAgentFunctionNamespaces(this, functions);
  }

  private _supportsRecursiveActorSlotOptimization(): boolean {
    return supportsRecursiveActorSlotOptimization(this);
  }

  private _renderActorDefinition(): string {
    return renderActorDefinition(this);
  }

  private _buildActorInstruction(): string {
    return buildActorInstruction(this);
  }

  constructor(
    init: Readonly<{
      ai?: Readonly<AxAIService>;
      judgeAI?: Readonly<AxAIService>;
      agentIdentity?: Readonly<AxAgentIdentity>;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
    }>,
    options: Readonly<AxAgentOptions<IN>>
  ) {
    initializeAgentInternal(this, init, options);
  }

  /** Builds (or rebuilds) the Actor program from the current base signature. */
  private _buildSplitPrograms(): void {
    buildSplitPrograms(this);
  }

  /**
   * Stops an in-flight forward call. Causes the call to throw
   * `AxAIServiceAbortedError`.
   */
  public stop(): void {
    this._stopRequested = true;
    for (const controller of this.activeAbortControllers) {
      controller.abort('Stopped by user');
    }
    this.program.stop();
    this.actorProgram.stop();
  }

  public getId(): string {
    return this.program.getId();
  }

  public setId(id: string) {
    this.program.setId(id);
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    return this.program.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    return this.program.namedProgramInstances();
  }

  public getTraces() {
    return this.program.getTraces();
  }

  public setDemos(
    demos: readonly (AxAgentDemos<IN, OUT> | AxProgramDemos<IN, OUT>)[],
    options?: { modelConfig?: Record<string, unknown> }
  ) {
    this.program.setDemos(demos as readonly AxProgramDemos<IN, OUT>[], options);
  }

  public getUsage(): readonly AxProgramUsage[] {
    return (this.actorProgram?.getUsage() as AxProgramUsage[]) ?? [];
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.actorProgram?.getChatLog() ?? [];
  }

  public resetUsage() {
    this.actorProgram?.resetUsage();
  }

  public getState(): AxAgentState | undefined {
    if (this.stateError) {
      throw new Error(this.stateError);
    }

    return this.state ? cloneAgentState(this.state) : undefined;
  }

  public setState(state?: AxAgentState): void {
    setStateImpl(this, state);
  }

  /**
   * Provided for the optimizer's `createOptimizationProgram` so the
   * pipeline can iterate every named program (actor + synthesizer) when
   * scoring component edits.
   */
  public _listOptimizationTargetDescriptors(): AxAgentOptimizationTargetDescriptor[] {
    return listOptimizationTargetDescriptors(this);
  }

  public getFunction(): AxFunction {
    return getFunctionImpl(this);
  }

  private _createRuntimeInputState(
    values: IN | Partial<IN>,
    options?: Readonly<{
      allowedFieldNames?: readonly string[];
      validateInputKeys?: boolean;
    }>
  ): AxAgentRuntimeInputState {
    return createRuntimeInputState(this, values, options);
  }

  private _ensureLlmQueryBudgetState(): boolean {
    return ensureLlmQueryBudgetState(this);
  }

  private _createRuntimeExecutionContext(
    args: Readonly<{
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
    return createRuntimeExecutionContext(this, args);
  }

  public getSignature(): AxSignature {
    return this.program.getSignature();
  }

  public async test(
    code: string,
    values?: Partial<IN>,
    options?: Readonly<{
      ai?: AxAIService;
      abortSignal?: AbortSignal;
      debug?: boolean;
    }>
  ): Promise<AxAgentTestResult> {
    return testAgent(this, code, values, options);
  }

  public setSignature(signature: AxSignatureInput) {
    const nextSignature = AxSignature.from(signature);
    this._validateConfiguredSignature(nextSignature);

    const previousSignature = this.program.getSignature();
    try {
      this.program.setSignature(nextSignature);
      this._buildSplitPrograms();
      if (this.func) {
        this.func.parameters = this._buildFuncParameters();
      }
    } catch (err) {
      this.program.setSignature(previousSignature);
      this._buildSplitPrograms();
      if (this.func) {
        this.func.parameters = this._buildFuncParameters();
      }
      throw err;
    }
  }

  public applyOptimization(optimizedProgram: any): void {
    applyOptimizationImpl(this, optimizedProgram);
  }

  public getOptimizableComponents(): readonly any[] {
    const out: any[] = [];
    if (this.program) out.push(...this.program.getOptimizableComponents());
    if (this.actorProgram)
      out.push(...this.actorProgram.getOptimizableComponents());
    if (this.agents) {
      for (const a of this.agents) {
        const fn = (a as any).getOptimizableComponents;
        if (typeof fn === 'function') out.push(...fn.call(a));
      }
    }
    out.push(...this._localOptimizableComponents());
    return out;
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    if (this.program) this.program.applyOptimizedComponents(updates);
    if (this.actorProgram) this.actorProgram.applyOptimizedComponents(updates);
    if (this.agents) {
      for (const a of this.agents) {
        const fn = (a as any).applyOptimizedComponents;
        if (typeof fn === 'function') fn.call(a, updates);
      }
    }
    const ownChanged = this._applyLocalOptimizedComponents(updates);
    if (ownChanged) {
      this._buildSplitPrograms();
    }
  }

  // ----- Actor loop -----

  /**
   * Runs the Actor loop: sets up the runtime session, executes code iteratively,
   * and returns the actor result + non-context input values + any actor-produced
   * field values. The pipeline (or external callers) feed this into a
   * `Synthesizer` stage to produce structured output.
   *
   * Closes the runtime session before returning.
   */
  public async _runActorLoop(
    parentAi: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions<string>>,
    effectiveAbortSignal?: AbortSignal,
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
  }> {
    const ai = this.ai ?? parentAi;
    const actorValues = this._withDefaultExecutorRequest(values);
    const stageVariant = (this as any).options?.stageVariant as
      | 'distiller'
      | 'executor'
      | undefined;
    const canTrackSkills = stageVariant !== 'distiller';
    const previousMemoryUsageTracking = (this as any)
      .memoryUsageTrackingEnabled;
    const previousSkillUsageTracking = (this as any).skillUsageTrackingEnabled;
    const previousUsageTracking = (this as any).usageTrackingEnabled;
    const nextMemoryUsageTracking =
      typeof (this as any).onMemoriesSearch === 'function' &&
      (typeof (this as any).onUsedMemories === 'function' ||
        typeof (options as any)?.onUsedMemories === 'function');
    const nextSkillUsageTracking =
      canTrackSkills &&
      (typeof (this as any).onUsedSkills === 'function' ||
        typeof (options as any)?.onUsedSkills === 'function');
    const nextUsageTracking = nextMemoryUsageTracking || nextSkillUsageTracking;
    if (
      previousMemoryUsageTracking !== nextMemoryUsageTracking ||
      previousSkillUsageTracking !== nextSkillUsageTracking ||
      previousUsageTracking !== nextUsageTracking
    ) {
      (this as any).memoryUsageTrackingEnabled = nextMemoryUsageTracking;
      (this as any).skillUsageTrackingEnabled = nextSkillUsageTracking;
      (this as any).usageTrackingEnabled = nextUsageTracking;
      this._buildSplitPrograms();
    }
    try {
      return await runActorLoop(
        this,
        ai,
        actorValues,
        options,
        effectiveAbortSignal,
        functionCallRecords
      );
    } finally {
      if (
        previousMemoryUsageTracking !== nextMemoryUsageTracking ||
        previousSkillUsageTracking !== nextSkillUsageTracking ||
        previousUsageTracking !== nextUsageTracking
      ) {
        (this as any).memoryUsageTrackingEnabled = previousMemoryUsageTracking;
        (this as any).skillUsageTrackingEnabled = previousSkillUsageTracking;
        (this as any).usageTrackingEnabled = previousUsageTracking;
        this._buildSplitPrograms();
      }
    }
  }

  private _withDefaultExecutorRequest(values: IN): IN {
    const variant = (this as any).options?.stageVariant;
    if (variant !== 'executor') return values;

    const addDefault = (raw: Record<string, unknown>) => {
      if (raw.executorRequest !== undefined) return raw;
      const query = raw.query;
      const executorRequest =
        typeof query === 'string' && query.trim()
          ? query
          : Object.entries(raw)
              .filter(([key]) => key !== 'distilledContext')
              .map(
                ([key, value]) =>
                  `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
              )
              .join('\n');
      return { ...raw, executorRequest };
    };

    return addDefault(values as Record<string, unknown>) as IN;
  }

  /**
   * Public alias for `_runActorLoop` — preferred name in new code.
   * Manages its own AbortController and budget state.
   */
  public async run<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN,
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<{
    nonContextValues: Record<string, unknown>;
    executorResult: AxAgentExecutorResultPayload;
    actorFieldValues: Record<string, unknown>;
    usedMemories: AxAgentUsedMemory[];
    usedSkills: AxAgentUsedSkill[];
    turnCount: number;
    guidanceLog: string | undefined;
    actionLog: string;
  }> {
    const { mergeAbortSignals } = await import('../util/abort.js');
    const abortController = new AbortController();
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );
    this.activeAbortControllers.add(abortController);
    const createdBudgetState = this._ensureLlmQueryBudgetState();
    try {
      return await this._runActorLoop(
        parentAi,
        values,
        options,
        effectiveAbortSignal
      );
    } finally {
      if (createdBudgetState) {
        this.llmQueryBudgetState = undefined;
      }
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  /**
   * Wraps an AxFunction as an async callable that handles both
   * named ({ key: val }) and positional (val1, val2) argument styles.
   */
  private static wrapFunction = wrapFunction;

  private buildRuntimeGlobals(
    abortSignal?: AbortSignal,
    ai?: AxAIService,
    protocolForTrigger?: (triggeredBy?: string) => AxAgentCompletionProtocol,
    functionCallRecorder?: AxAgentFunctionCallRecorder,
    onDiscoveredNamespaces?: (namespaces: readonly string[]) => void,
    onDiscoveredModules?: (
      modules: readonly string[],
      docs: Readonly<Record<string, string>>
    ) => void,
    onDiscoveredFunctions?: (
      qualifiedNames: readonly string[],
      docs: Readonly<Record<string, string>>
    ) => void,
    onLoadedSkills?: (
      results: readonly import('./agentInternal/skillsTypes.js').AxAgentSkillResult[]
    ) => void,
    onLoadedMemories?: (
      results: readonly import('./agentInternal/memoriesTypes.js').AxAgentMemoryResult[]
    ) => void,
    onUsed?: (id: unknown, reason?: unknown) => void,
    onFunctionCall?: import('./agentInternal/types.js').AxAgentOnFunctionCall,
    getCurrentMemories?: () => readonly import('./agentInternal/memoriesTypes.js').AxAgentMemoryResult[]
  ): Record<string, unknown> {
    return buildRuntimeGlobals(
      this,
      abortSignal,
      ai,
      protocolForTrigger,
      functionCallRecorder,
      onDiscoveredNamespaces,
      onDiscoveredModules,
      onDiscoveredFunctions,
      onLoadedSkills,
      onLoadedMemories,
      onUsed,
      onFunctionCall,
      getCurrentMemories
    );
  }

  /**
   * Returns options compatible with AxGen (strips agent-specific grouped options).
   */
  private get _genOptions(): Record<string, unknown> {
    if (!this.options) return {};
    const {
      functions: _fn,
      functionDiscovery: _fd,
      judgeOptions: _jo,
      inputUpdateCallback: _iuc,
      onSkillsSearch: _oss,
      onLoadedSkills: _ols,
      onUsedSkills: _ous,
      onMemoriesSearch: _oms,
      onLoadedMemories: _olm,
      onUsedMemories: _oum,
      contextMap: _cm,
      contextMapText: _cmt,
      ...rest
    } = this.options as typeof this.options & { contextMapText?: string };
    return rest;
  }

  /**
   * Builds the clean AxFunction parameters schema from input fields only.
   */
  private _buildFuncParameters(): AxFunctionJSONSchema {
    return buildFuncParameters(this);
  }
}

// Re-export the coordinator class and factory from coordinator.ts.
export {
  AxAgent,
  type AxAgentConfig,
  agent,
} from './agentInternal/coordinator.js';
