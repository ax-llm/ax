import type { AxAIService, AxFunction } from '../../ai/types.js';
import { AxPlaybook } from '../../dsp/playbook.js';
import type { AxSignatureConfig, AxSignatureInput } from '../../dsp/sig.js';
import { AxSignature, f } from '../../dsp/sig.js';
import type { ParseSignature } from '../../dsp/sigtypes.js';
import type {
  AxAgentUsage,
  AxChatLogEntry,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptionsWithModels,
  AxProgramTrace,
} from '../../dsp/types.js';
import { ActorAgentRLM } from '../AxAgent.js';
import {
  type AxResolvedAutoUpgrade,
  type AxResolvedCitations,
  resolveAutoUpgrade,
  resolveCitations,
} from '../config.js';
import {
  AxAgentContextMap,
  type AxAgentContextMapConfig,
  type AxAgentContextMapSnapshot,
  formatContextMapTrajectory,
  normalizeAgentContextMap,
} from '../contextMap.js';
import {
  type AxAgentPlaybookSkipReason,
  type AxAgentPlaybookUpdateResult,
  type AxResolvedAgentPlaybookConfig,
  collectCoveredFailureSignatures,
  isPlaybookSnapshotSeed,
  resolveAgentPlaybookConfig,
} from '../playbookConfig.js';
import { toCamelCase } from '../runtimeDiscovery.js';
import { Synthesizer } from '../synthesizer.js';
import { AxAgentPlaybook } from './agentPlaybook.js';
import type {
  AxAgentDemos,
  AxAgentEvalDataset,
  AxAgentEvalPrediction,
  AxAgentEvalTask,
  AxAgentForwardOptions,
  AxAgentIdentity,
  AxAgentic,
  AxAgentJudgeOptions,
  AxAgentOptimizeOptions,
  AxAgentOptimizeResult,
  AxAgentOptions,
  AxAgentPlaybookOptions,
  AxAgentState,
  AxAgentStreamingForwardOptions,
  AxAgentTestResult,
  AxAnyAgentic,
  AxContextFieldInput,
} from './agentPublicTypes.js';
import { transcribedAgentInputFields } from './audioInputs.js';
import {
  type AxAgentFailureReport,
  type AxAgentFailureSignal,
  formatFailureFeedback,
  MAX_FEEDBACK_SIGNALS,
  mergeFailureSignals,
} from './failureReport.js';
import {
  createAgentOptimizeMetric,
  createOptimizationProgram,
  optimizeAgent,
} from './optimizer.js';
import {
  buildPipelineFlow,
  forwardPipeline,
  streamingForwardPipeline,
} from './pipelineForward.js';
import { forwardPipelineForEvaluation } from './pipelineForwardForEvaluation.js';
import {
  appendCitationsOutputField,
  buildFinalResponderSignature,
} from './synthesizerSignature.js';
import type { AxAgentOptimizationTargetDescriptor } from './types.js';

/**
 * Knobs the coordinator passes from top-level `AxAgentOptions` down to
 * BOTH internal actor agents. These are the LLM-call defaults and stage-agnostic
 * infrastructure that should apply identically to the distiller and executor.
 *
 * `functions`/`functionDiscovery`/skills knobs are shared because the
 * distiller is the pipeline's reconnaissance phase: it sees the executor's
 * capability surface (schemas, module catalog, skills index, discovery) so
 * evidence extraction targets what the tools will consume — but its
 * callables are throwing stubs; execution authority stays with the executor.
 *
 * All other top-level options reach ONLY the executor; callers who need
 * distiller-specific overrides must opt in explicitly via `options.contextOptions`.
 */
const SHARED_KNOB_KEYS = [
  'runtime',
  'maxRuntimeChars',
  'maxEvidenceChars',
  'contextPolicy',
  'summarizerOptions',
  'promptLevel',
  'maxTurns',
  'maxSubAgentCalls',
  'maxBatchedLlmQueryConcurrency',
  'debug',
  'bubbleErrors',
  'onFunctionCall',
  'onContextEvent',
  'onMemoriesSearch',
  'memoriesCatalog',
  'onLoadedMemories',
  'onUsedMemories',
  'functions',
  'functionDiscovery',
  'autoUpgrade',
  'directResponse',
  'onSkillsSearch',
  'skillsCatalog',
  'onLoadedSkills',
  'onUsedSkills',
  'contextCache',
] as const;

/**
 * Memories are enabled by a host `onMemoriesSearch` callback OR a static
 * `memoriesCatalog` (which synthesizes a built-in searcher at init). Both
 * declaration sites for the cached `memories` input field must agree with
 * the instance-level resolution in `initializeAgentInternal`.
 */
function memoriesEnabledFromOptions(options: unknown): boolean {
  const o = options as
    | { onMemoriesSearch?: unknown; memoriesCatalog?: unknown }
    | undefined;
  return (
    typeof o?.onMemoriesSearch === 'function' ||
    (Array.isArray(o?.memoriesCatalog) && o.memoriesCatalog.length > 0)
  );
}

function pickShared<IN extends import('../../dsp/types.js').AxGenIn>(
  opts: Readonly<AxAgentOptions<IN>>
): Partial<AxAgentOptions<IN>> {
  const out: Record<string, unknown> = {};
  for (const k of SHARED_KNOB_KEYS) {
    const v = (opts as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<AxAgentOptions<IN>>;
}

/**
 * Unwrap a coordinator (`AxAgent`) to its underlying primary `ActorAgentRLM`.
 * Returns undefined if the agent is neither an actor stage nor a coordinator.
 * Used in propagation loops so shared fields/agents/functions reach
 * coordinator-wrapped children.
 */
export function resolveToInternal(
  agent: AxAnyAgentic
): ActorAgentRLM<any, any> | undefined {
  if (agent instanceof ActorAgentRLM) return agent;
  const maybeCoord = agent as any;
  if (maybeCoord?.primaryAgent instanceof ActorAgentRLM) {
    return maybeCoord.primaryAgent as ActorAgentRLM<any, any>;
  }
  return undefined;
}

/**
 * Pipeline-based coordinator. Every run walks the same static sequence:
 *
 *   distiller (RLM actor)  →  executor (RLM actor)
 *                          ↓
 *                    responder (Synthesizer)
 *
 * The distiller's `final(request, evidence)` payload feeds the executor as
 * `{executorRequest, distilledContext}`. When no `contextFields` are declared,
 * the distiller still acts as the context-understanding/request-normalization
 * stage over the original inputs.
 *
 * This is the primary user-facing class. `ActorAgentRLM` and `Synthesizer`
 * are exported for callers that need direct per-instance control.
 */
export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic<IN, OUT>
{
  /** RLM actor that normalizes the request and distils context evidence. */
  public readonly distiller: ActorAgentRLM<any, any>;
  /** RLM actor that runs tools / discovery with the pre-distilled context. */
  public readonly executor: ActorAgentRLM<any, any>;
  /** Synthesizer that produces the user's output signature. Always present. */
  public readonly responder!: Synthesizer<OUT>;

  /**
   * Backward-compat handle used by legacy access patterns: returns the actor
   * stage that "owns" the run-time forward — always the `executor` in
   * current pipeline shapes. Tests reach in via
   * `agent.primaryAgent.actorProgram` etc.
   */
  public get primaryAgent(): ActorAgentRLM<any, any> {
    return this.executor as ActorAgentRLM<any, any>;
  }

  private readonly contextFieldNames: Set<string>;
  /** Resolved auto-upgrade config; also read by the responder-input helpers. */
  public readonly autoUpgradeResolved: AxResolvedAutoUpgrade;
  /** Field names stripped from executor inputs (from executorOptions.excludeFields). */
  public readonly executorExcludeFields: Set<string>;
  /** Field names stripped from responder inputs (from responderOptions.excludeFields). */
  public readonly responderExcludeFields: Set<string>;
  /**
   * Per-stage AI service overrides. When set, the corresponding stage uses
   * this AI service instead of the one passed positionally to `forward()`.
   * `forward(ai, ...)` is the fallback when the stage-specific override is
   * not defined.
   */
  public readonly distillerAi?: Readonly<AxAIService>;
  public readonly executorAi?: Readonly<AxAIService>;
  public readonly responderAi?: Readonly<AxAIService>;
  private readonly fullSignature: AxSignature<IN, OUT>;
  private readonly pipelineFlow: any;
  private readonly init: Readonly<{
    ai?: Readonly<AxAIService>;
    judgeAI?: Readonly<AxAIService>;
    agentIdentity?: Readonly<AxAgentIdentity>;
    signature:
      | string
      | Readonly<AxSignatureConfig>
      | Readonly<AxSignature<IN, OUT>>;
  }>;
  private readonly options: Readonly<AxAgentOptions<IN>>;
  private readonly contextMapConfig?: AxAgentContextMapConfig;
  private contextMap?: AxAgentContextMap;
  private readonly playbookConfigResolved?: AxResolvedAgentPlaybookConfig;
  private playbookHandle?: AxPlaybook<any, any>;
  private _agentPlaybook?: AxAgentPlaybook<any, any>;
  private readonly citationsResolved: AxResolvedCitations;
  private func?: AxFunction;

  constructor(
    init: Readonly<{
      ai?: Readonly<AxAIService>;
      judgeAI?: Readonly<AxAIService>;
      agentIdentity?: Readonly<AxAgentIdentity>;
      agentModuleNamespace?: string;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
    }>,
    options: Readonly<AxAgentOptions<IN>>
  ) {
    this.init = init;
    this.options = options;
    this.autoUpgradeResolved = resolveAutoUpgrade(options.autoUpgrade);
    this.contextMapConfig = options.contextMap;
    this.contextMap = normalizeAgentContextMap(options.contextMap);
    this.playbookConfigResolved = resolveAgentPlaybookConfig(options.playbook);
    this.citationsResolved = resolveCitations(options.citations);
    this.fullSignature =
      typeof init.signature === 'string'
        ? (AxSignature.create(init.signature) as AxSignature<IN, OUT>)
        : init.signature instanceof AxSignature
          ? (init.signature as AxSignature<IN, OUT>)
          : (AxSignature.from(init.signature) as AxSignature<IN, OUT>);
    if (this.fullSignature.getDescription()?.trim()) {
      throw new Error(
        'AxAgent does not support signature-level descriptions; use contextOptions.description, executorOptions.description, or responderOptions.description instead'
      );
    }

    this.executorExcludeFields = new Set(
      options.executorOptions?.excludeFields ?? []
    );
    this.responderExcludeFields = new Set(
      options.responderOptions?.excludeFields ?? []
    );
    this.distillerAi = options.contextOptions?.ai;
    this.executorAi = options.executorOptions?.ai;
    this.responderAi = options.responderOptions?.ai;

    const ctxFieldInputs = options.contextFields ?? [];
    this.contextFieldNames = new Set(
      ctxFieldInputs.map((cf) => (typeof cf === 'string' ? cf : cf.field))
    );

    const allInputFields = transcribedAgentInputFields(
      this.fullSignature.getInputFields()
    );
    const allOutputFields = this.fullSignature.getOutputFields();
    const ctxInputFields = allInputFields.filter((fld) =>
      this.contextFieldNames.has(fld.name)
    );
    const nonCtxInputFields = allInputFields.filter(
      (fld) => !this.contextFieldNames.has(fld.name)
    );
    // Fields excluded from the executor signature only.
    const executorNonCtxInputFields = nonCtxInputFields.filter(
      (fld) => !this.executorExcludeFields.has(fld.name)
    );
    // The responder receives original non-context values (pre-executor), so its
    // signature only needs to omit responderOptions.excludeFields, not executorExcludeFields.
    const responderNonCtxInputFields = nonCtxInputFields.filter(
      (fld) => !this.responderExcludeFields.has(fld.name)
    );
    const responderOutputFields = this.citationsResolved.enabled
      ? appendCitationsOutputField(
          allOutputFields,
          this.citationsResolved.field,
          this.citationsResolved.includeMemoryIds
        )
      : allOutputFields;

    const {
      description: finalResponderDescription,
      ...finalResponderForwardOptionsFromUser
    } = options.responderOptions ?? {};
    // Propagate construction-time debug to synthesizer stages so that
    // `new AxAgent(..., { debug: true })` reaches both actor and synthesizer
    // .forward() calls — not just call-time debug (which flows via options).
    const debugOverride =
      options.debug !== undefined ? { debug: options.debug } : {};
    const contextCacheOverride =
      options.contextCache !== undefined
        ? { contextCache: options.contextCache }
        : {};
    const finalResponderForwardOptions = {
      ...debugOverride,
      ...contextCacheOverride,
      ...finalResponderForwardOptionsFromUser,
    };

    // ----- Static flow: distiller → executor → responder
    // The distiller's *base* signature carries `distilledContext` as a
    // placeholder output so the actor template can hint at what the downstream
    // executor stage will be asked for. The actor program built inside
    // ActorAgentRLM swaps this for `javascriptCode` at runtime.
    const memoriesEnabled = memoriesEnabledFromOptions(options);
    let distillerSigBuilder = f().addInputFields(allInputFields);
    if (memoriesEnabled) {
      distillerSigBuilder = distillerSigBuilder.input(
        'memories',
        f
          .string(
            'Memories already loaded for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]`. Call `recall(...)` to load more.'
          )
          .cache()
          .optional()
      );
    }
    const distillerSig = distillerSigBuilder
      .output(
        'distilledContext',
        f
          .json('Pre-distilled context evidence for the executor stage.')
          .optional()
      )
      .build();

    const shared = pickShared(options);
    const distillerOverrides = options.contextOptions ?? {};
    this.distiller = new ActorAgentRLM<any, any>(
      { ...init, signature: distillerSig },
      {
        ...shared,
        ...distillerOverrides,
        contextFields: [...ctxFieldInputs],
        contextMapText: this.contextMap?.text,
        stageVariant: 'distiller',
      } as any
    );

    // The executor's *base* signature carries the user's output
    // fields as a placeholder so the actor template can hint at what the
    // downstream responder will be asked for. The actor program
    // built inside ActorAgentRLM swaps these for `javascriptCode` at
    // runtime.
    let executorSigBuilder = f()
      .addInputFields(executorNonCtxInputFields)
      .input(
        'executorRequest',
        f.string(
          'Expanded executor request from the distiller stage — what the executor should complete, enriched with relevant context evidence.'
        )
      )
      .input(
        'distilledContextSummary',
        f
          .string(
            'Shape summary of the distiller-stage evidence. The evidence data itself lives in the runtime as `inputs.distilledContext` — read it there; it is never materialized into this prompt.'
          )
          .cache()
          .optional()
      );
    // Declared context fields imply runtime-resident raw context for the
    // executor phase to fall back on; auto-upgrade can additionally keep
    // oversized executor inputs runtime-only on the fly.
    if (
      ctxFieldInputs.length > 0 ||
      this.autoUpgradeResolved.contextFields.enabled
    ) {
      executorSigBuilder = executorSigBuilder.input(
        'contextMetadata',
        f
          .string(
            'Metadata about raw context variables (type and size) available in this stage runtime — carried from the context phase when the runtime session is shared, plus any oversized inputs auto-kept runtime-only for this stage.'
          )
          .cache()
          .optional()
      );
    }
    if (memoriesEnabled) {
      executorSigBuilder = executorSigBuilder.input(
        'memories',
        f
          .string(
            'Memories loaded so far for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]` (carried over from the distiller and any prior executor turns). Call `recall(...)` to load more.'
          )
          .cache()
          .optional()
      );
    }
    const executorSig = executorSigBuilder
      .addOutputFields(allOutputFields)
      .build();

    const executorInitOptions = {
      ...options,
      contextFields: [],
      stageVariant: 'executor' as const,
    };

    this.executor = new ActorAgentRLM<any, any>(
      { ...init, signature: executorSig },
      executorInitOptions as any
    );

    this.responder = new Synthesizer<OUT>(
      {
        signature: buildFinalResponderSignature(
          responderNonCtxInputFields,
          responderOutputFields
        ),
        contextFieldMeta: ctxInputFields,
        role: 'final',
        description: finalResponderDescription,
        agentIdentity: init.agentIdentity,
        ...(this.citationsResolved.enabled
          ? { citations: this.citationsResolved }
          : {}),
      },
      {
        forwardOptions: finalResponderForwardOptions as Partial<
          import('../../dsp/types.js').AxProgramForwardOptions<string>
        >,
        // The aggregator adds the pipeline-stage prefix when reporting
        // `namedPrograms()`.
        id: 'root.responder',
      }
    );

    if (init.agentIdentity) {
      const coordForward = this.forward.bind(this);
      const coordSig = this.fullSignature;
      this.func = {
        name: toCamelCase(init.agentIdentity.name),
        description: init.agentIdentity.description,
        ...(init.agentIdentity.namespace
          ? { namespace: init.agentIdentity.namespace }
          : {}),
        parameters: this.fullSignature.toInputJSONSchema(),
        func: async (funcValues: any, funcOptions?: any): Promise<string> => {
          const ai = funcOptions?.ai;
          if (!ai) {
            throw new Error('AI service is required to run the agent');
          }
          const ret = await coordForward(ai, funcValues, funcOptions);
          const outFields = coordSig.getOutputFields();
          return Object.keys(ret as Record<string, unknown>)
            .map((k) => {
              const field = outFields.find((fld) => fld.name === k);
              return field
                ? `${field.title}: ${(ret as Record<string, unknown>)[k]}`
                : `${k}: ${(ret as Record<string, unknown>)[k]}`;
            })
            .join('\n');
        },
      };
    }

    if (this.playbookConfigResolved) {
      this.playbookHandle = this._createPlaybookHandle(
        this.playbookConfigResolved
      );
    }

    this.pipelineFlow = buildPipelineFlow(this);
  }

  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN,
    options?: Readonly<AxAgentForwardOptions<T>>
  ): Promise<OUT> {
    return forwardPipeline<IN, OUT, T>(this, ai, values, options);
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN,
    options?: Readonly<AxAgentStreamingForwardOptions<T>>
  ): AxGenStreamingOut<OUT> {
    yield* streamingForwardPipeline<IN, OUT, T>(this, ai, values, options);
  }

  public getFunction(): AxFunction {
    if (!this.func) {
      throw new Error(
        'getFunction() requires agentIdentity to be set in the constructor'
      );
    }
    return this.func;
  }

  public getSignature(): AxSignature {
    return this.fullSignature as AxSignature;
  }

  public stop(): void {
    this.pipelineFlow.stop();
    this.distiller.stop();
    this.executor.stop();
    this.responder.stop();
  }

  public getId(): string {
    return this.primaryAgent.getId();
  }

  public setId(id: string): void {
    this.primaryAgent.setId(id);
  }

  /**
   * The distiller is reported under `ctx.*` and the executor / responder
   * pair under `task.*` so optimizer demo IDs and template-overrides keep
   * stable stage ownership.
   */
  public namedPrograms(): Array<{ id: string; signature?: string }> {
    const out: Array<{ id: string; signature?: string }> = [];
    const tagAll = (
      entries: Array<{ id: string; signature?: string }>,
      prefix: 'ctx' | 'task'
    ) => entries.map((p) => ({ ...p, id: `${prefix}.${p.id}` }));
    out.push(...tagAll(this.distiller.namedPrograms(), 'ctx'));
    out.push(...tagAll(this.executor.namedPrograms(), 'task'));
    out.push(...tagAll(this.responder.namedPrograms(), 'task'));
    return out;
  }

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    const out: any[] = [];
    const tagAll = (entries: any[], prefix: 'ctx' | 'task') =>
      entries.map((p) => ({ ...p, id: `${prefix}.${(p as any).id}` }));
    out.push(...tagAll(this.distiller.namedProgramInstances(), 'ctx'));
    out.push(...tagAll(this.executor.namedProgramInstances(), 'task'));
    out.push(...tagAll(this.responder.namedProgramInstances(), 'task'));
    return out as AxNamedProgramInstance<IN, OUT>[];
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    const fromFlow = this.pipelineFlow.getTraces() as AxProgramTrace<IN, OUT>[];
    if (fromFlow.length > 0) {
      return fromFlow;
    }
    const out: any[] = [];
    out.push(...this.distiller.getTraces());
    out.push(...this.executor.getTraces());
    out.push(...this.responder.getTraces());
    return out as AxProgramTrace<IN, OUT>[];
  }

  public setDemos(
    demos: readonly (AxAgentDemos<IN, OUT> | AxProgramDemos<IN, OUT>)[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    const programIdOf = (d: any): string | undefined => d.programId ?? d.id;
    const isResponderId = (id: string | undefined) =>
      Boolean(id?.endsWith('.responder'));
    // Route by `ctx.*` / `task.*` prefix. The ctx side has only the distiller
    // actor; the task side has the executor actor + responder. Unprefixed
    // demos default to the task side for compatibility with older callers.
    const ctxDemos: any[] = [];
    const taskDemos: any[] = [];
    for (const demo of demos) {
      const id = programIdOf(demo);
      if (id?.startsWith('ctx.')) {
        ctxDemos.push({ ...(demo as any), programId: id.slice(4) });
      } else if (id?.startsWith('task.')) {
        taskDemos.push({ ...(demo as any), programId: id.slice(5) });
      } else {
        taskDemos.push(demo);
      }
    }
    if (ctxDemos.length > 0) this.distiller.setDemos(ctxDemos, options);
    if (taskDemos.length > 0) {
      const actor: any[] = [];
      const responder: any[] = [];
      for (const d of taskDemos) {
        if (isResponderId(programIdOf(d))) responder.push(d);
        else actor.push(d);
      }
      if (actor.length > 0) this.executor.setDemos(actor, options);
      if (responder.length > 0)
        this.responder.setDemos(responder as any, options);
    }
  }

  public getUsage(): AxAgentUsage {
    const usage = this.pipelineFlow.getUsageReport();
    const actor = [...(usage.distiller ?? []), ...(usage.executor ?? [])];
    const responder = [...(usage.responder ?? [])];
    if (actor.length === 0 && responder.length === 0) {
      actor.push(...this.distiller.getUsage());
      actor.push(...this.executor.getUsage());
      responder.push(...this.responder.getUsage());
    }
    return { actor, responder };
  }

  public getStagedUsage(): {
    ctx?: AxAgentUsage;
    task: AxAgentUsage;
  } {
    const usage = this.pipelineFlow.getUsageReport();
    // The ctx stage has only the distiller actor (no responder LLM call).
    return {
      ctx: {
        actor:
          (usage.distiller?.length ?? 0) > 0
            ? [...usage.distiller!]
            : [...this.distiller.getUsage()],
        responder: [],
      },
      task: {
        actor:
          (usage.executor?.length ?? 0) > 0
            ? [...usage.executor!]
            : [...this.executor.getUsage()],
        responder:
          (usage.responder?.length ?? 0) > 0
            ? [...usage.responder!]
            : [...this.responder.getUsage()],
      },
    };
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    const fromFlow = this.pipelineFlow.getChatLog();
    if (fromFlow.length > 0) {
      return fromFlow;
    }
    // streamingForward() still streams the final responder manually so it can
    // yield true responder deltas. Reconstruct the same flat shape from stage
    // programs when a caller asks for logs after a streaming run.
    const tag = (
      entries: readonly AxChatLogEntry[],
      name: 'distiller' | 'executor' | 'responder',
      stage: 'ctx' | 'task'
    ): AxChatLogEntry[] =>
      entries.map((entry) => ({
        ...entry,
        name: entry.name ? `${name}.${entry.name}` : name,
        ...(stage ? { stage } : {}),
      }));
    return [
      ...tag(this.distiller.getChatLog(), 'distiller', 'ctx'),
      ...tag(this.executor.getChatLog(), 'executor', 'task'),
      ...tag(this.responder.getChatLog(), 'responder', 'task'),
    ];
  }

  public resetUsage(): void {
    this.pipelineFlow.resetUsage();
  }

  public getState(): AxAgentState | undefined {
    return this.primaryAgent.getState();
  }

  public setState(state?: AxAgentState): void {
    this.primaryAgent.setState(state);
  }

  public getContextMap(): AxAgentContextMap | undefined {
    return this.contextMap;
  }

  public setContextMap(
    map?: AxAgentContextMap | AxAgentContextMapSnapshot | string
  ): void {
    this.contextMap =
      map === undefined
        ? undefined
        : map instanceof AxAgentContextMap
          ? map
          : new AxAgentContextMap(map);
    this._syncContextMapPrompt();
  }

  public _syncContextMapPrompt(): void {
    const text = this.contextMap?.text.trim();
    (this.distiller as any).contextMapText = text
      ? this.contextMap?.text
      : undefined;
    (this.distiller as any)._buildSplitPrograms?.();
  }

  public async _updateContextMapFromPipelineState(
    ai: Readonly<AxAIService>,
    state: Readonly<Record<string, any>>,
    finalOutput?: unknown
  ): Promise<void> {
    if (!this.contextMap) {
      return;
    }

    const task =
      typeof state.executorInputs?.executorRequest === 'string'
        ? state.executorInputs.executorRequest
        : JSON.stringify(state.agentValues ?? {});
    const trajectory = formatContextMapTrajectory({
      values: state.agentValues,
      distillerActionLog: state.distillerResult?.actionLog,
      executorActionLog: state.executorResult?.actionLog,
      executorResult: state.executorResult?.executorResult,
      finalOutput,
    });

    try {
      const result = await this.contextMap.update(ai, { task, trajectory });
      this._syncContextMapPrompt();
      if (result.status !== 'skipped' && this.contextMapConfig?.onUpdate) {
        await this.contextMapConfig.onUpdate(result);
      }
    } catch {
      // Context-map upkeep must not break the completed user-facing run.
    }
  }

  public setSignature(signature: AxSignatureInput): void {
    const nextSig = AxSignature.from(signature);
    const allInputFields = nextSig.getInputFields();
    const allOutputFields = nextSig.getOutputFields();
    const ctxNames = this.contextFieldNames;
    const responderOutputFields = this.citationsResolved.enabled
      ? appendCitationsOutputField(
          allOutputFields,
          this.citationsResolved.field,
          this.citationsResolved.includeMemoryIds
        )
      : allOutputFields;

    const inputFieldNames = new Set(allInputFields.map((fld) => fld.name));
    for (const field of ctxNames) {
      if (!inputFieldNames.has(field)) {
        throw new Error(`RLM contextField "${field}" not found in signature`);
      }
    }

    const nonCtxInputFields = allInputFields.filter(
      (fld) => !ctxNames.has(fld.name)
    );
    const ctxInputFields = allInputFields.filter((fld) =>
      ctxNames.has(fld.name)
    );
    const executorNonCtxInputFields = nonCtxInputFields.filter(
      (fld) => !this.executorExcludeFields.has(fld.name)
    );
    const responderNonCtxInputFields = nonCtxInputFields.filter(
      (fld) => !this.responderExcludeFields.has(fld.name)
    );

    const memoriesEnabled = memoriesEnabledFromOptions(this.options);
    let distillerSigBuilder = f().addInputFields(allInputFields);
    if (memoriesEnabled) {
      distillerSigBuilder = distillerSigBuilder.input(
        'memories',
        f
          .string(
            'Memories already loaded for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]`. Call `recall(...)` to load more.'
          )
          // Keep the cache breakpoint — must match the constructor path.
          .cache()
          .optional()
      );
    }
    const distillerSig = distillerSigBuilder
      .output(
        'distilledContext',
        f
          .json('Pre-distilled context evidence for the executor stage.')
          .optional()
      )
      .build();

    let executorSigBuilder = f()
      .addInputFields(executorNonCtxInputFields)
      .input(
        'executorRequest',
        f.string(
          'Expanded executor request from the distiller stage — what the executor should complete, enriched with relevant context evidence.'
        )
      )
      .input(
        'distilledContextSummary',
        f
          .string(
            'Shape summary of the distiller-stage evidence. The evidence data itself lives in the runtime as `inputs.distilledContext` — read it there; it is never materialized into this prompt.'
          )
          .cache()
          .optional()
      );
    // Declared context fields imply runtime-resident raw context for the
    // executor phase to fall back on; auto-upgrade can additionally keep
    // oversized executor inputs runtime-only on the fly. Keep this gate and
    // description in lockstep with the constructor path.
    if (ctxNames.size > 0 || this.autoUpgradeResolved.contextFields.enabled) {
      executorSigBuilder = executorSigBuilder.input(
        'contextMetadata',
        f
          .string(
            'Metadata about raw context variables (type and size) available in this stage runtime — carried from the context phase when the runtime session is shared, plus any oversized inputs auto-kept runtime-only for this stage.'
          )
          .cache()
          .optional()
      );
    }
    if (memoriesEnabled) {
      executorSigBuilder = executorSigBuilder.input(
        'memories',
        f
          .string(
            'Memories loaded so far for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]` (carried over from the distiller and any prior executor turns). Call `recall(...)` to load more.'
          )
          // Keep the cache breakpoint — must match the constructor path.
          .cache()
          .optional()
      );
    }
    const executorSig = executorSigBuilder
      .addOutputFields(allOutputFields)
      .build();

    this.distiller.setSignature(distillerSig);
    this.executor.setSignature(executorSig);

    // The responder's signature is `{ ...nonContextInputs, contextData } ->
    // outputFields`. After actor signatures change we need to rebuild the
    // synthesizer's underlying program to match the new fields.
    const nextResponderSig = buildFinalResponderSignature(
      responderNonCtxInputFields,
      responderOutputFields
    );
    (this.responder as any).program?.setSignature?.(nextResponderSig);
    (this as any).fullSignature = nextSig;
    void ctxInputFields;
    if (this.func) {
      this.func.parameters = nextSig.toInputJSONSchema();
    }
  }

  public applyOptimization(optimizedProgram: any): void {
    this.applyOptimizedComponents(optimizedProgram?.componentMap ?? {});
    if (!optimizedProgram?.componentMap) {
      this.primaryAgent.applyOptimization(optimizedProgram);
    }
  }

  public getOptimizableComponents(): readonly any[] {
    const out: any[] = [];
    out.push(...this.distiller.getOptimizableComponents());
    out.push(...this.executor.getOptimizableComponents());
    out.push(...this.responder.getOptimizableComponents());
    return out;
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.distiller.applyOptimizedComponents(updates);
    this.executor.applyOptimizedComponents(updates);
    this.responder.applyOptimizedComponents(updates);
  }

  public async optimize(
    dataset: Readonly<AxAgentEvalDataset<IN>>,
    options?: Readonly<AxAgentOptimizeOptions<IN, OUT>>
  ): Promise<AxAgentOptimizeResult<OUT>> {
    const result = await optimizeAgent<IN, OUT>(this, dataset, {
      ...options,
      studentAI: options?.studentAI ?? (this.primaryAgent as any).ai,
      judgeAI: options?.judgeAI ?? (this.primaryAgent as any).judgeAI,
      teacherAI: options?.teacherAI ?? (this.primaryAgent as any).judgeAI,
      apply: false,
    });
    if (options?.apply !== false && result.optimizedProgram) {
      this.applyOptimization(result.optimizedProgram);
    }
    return result;
  }

  /**
   * Append a standing instruction addendum to the executor actor's prompt.
   * A separate additive channel from `executorOptions.description` and the
   * playbook injection, so the three never clobber each other. Process-local —
   * not serialized into `AxAgentState`.
   */
  public addActorInstruction(addendum: string): void {
    const trimmed = addendum.trim();
    if (!trimmed) {
      return;
    }
    const stage: any = this.executor;
    stage.instructionAddenda = [
      ...((stage.instructionAddenda as string[] | undefined) ?? []),
      trimmed,
    ];
    stage._buildSplitPrograms?.();
  }

  /**
   * The agent's learned playbook — one evolving body of task knowledge bound
   * to an agent stage (the actor/task stage by default). It grows three ways:
   * continuously from each run (the `playbook` construction config),
   * on demand via `.update(...)`, or from a task set via
   * `.evolve(dataset, options)` (verified by default). Unless `apply` is
   * `false`, the rendered playbook is injected into the live stage prompt.
   * Memoized — one playbook per agent. The evolution engine (ACE) is an
   * implementation detail.
   */
  public playbook(
    options?: Readonly<AxAgentPlaybookOptions>
  ): AxAgentPlaybook<any, any> {
    if (!this.playbookHandle) {
      this.playbookHandle = this._buildStagePlaybook(options);
    } else if (options && Object.keys(options).length > 0) {
      throw new Error(
        'AxAgent.playbook(): this agent already has a playbook; call playbook() / getPlaybook() without options to use it.'
      );
    }
    return this._agentPlaybookWrapper();
  }

  /** The agent's playbook handle, or `undefined` if none has been created. */
  public getPlaybook(): AxAgentPlaybook<any, any> | undefined {
    return this.playbookHandle ? this._agentPlaybookWrapper() : undefined;
  }

  private _agentPlaybookWrapper(): AxAgentPlaybook<any, any> {
    if (
      !this._agentPlaybook ||
      this._agentPlaybook.inner !== this.playbookHandle
    ) {
      this._agentPlaybook = new AxAgentPlaybook(this, this.playbookHandle!);
    }
    return this._agentPlaybook;
  }

  private _buildStagePlaybook(
    options?: Readonly<AxAgentPlaybookOptions>
  ): AxPlaybook<any, any> {
    const target = options?.target ?? 'actor';
    const studentAI = options?.studentAI ?? (this.primaryAgent as any).ai;
    if (!studentAI) {
      throw new Error(
        'AxAgent.playbook(): studentAI is required when the agent has no default ai.'
      );
    }

    const stage: any = target === 'responder' ? this.responder : this.executor;
    const stageGen = stage.namedProgramInstances()[0]?.program;
    if (!stageGen) {
      throw new Error(
        `AxAgent.playbook(): could not resolve the ${target} stage program.`
      );
    }

    const handle = new AxPlaybook(stageGen, {
      studentAI,
      teacherAI: options?.teacherAI ?? (this.primaryAgent as any).judgeAI,
      verbose: options?.verbose,
      seed: options?.seed,
      maxEpochs: options?.maxEpochs,
      maxReflectorRounds: options?.maxReflectorRounds,
      maxSectionSize: options?.maxSectionSize,
      allowDynamicSections: options?.allowDynamicSections,
      initialPlaybook: options?.initialPlaybook,
      auto: options?.auto,
    });

    // Live injection must go through the stage's description channel and a
    // rebuild, not the bare program's signature (the live actor prompt is
    // composed from `executorDescription`). Mirror the contextMap precedent.
    if (options?.apply === false) {
      handle._setApplyHook(() => {});
      return handle;
    }

    const compose = (base: string | undefined, rendered: string): string =>
      [base?.trim(), '', rendered]
        .filter((block) => block && block.trim().length > 0)
        .join('\n\n');

    if (target === 'responder') {
      const base: string | undefined = stage.init?.description;
      handle._setApplyHook((rendered) => {
        stage.init.description = compose(base, rendered);
        stage._buildProgram?.();
      });
    } else {
      const base: string | undefined = stage.executorDescription;
      handle._setApplyHook((rendered) => {
        stage.executorDescription = compose(base, rendered);
        stage._buildSplitPrograms?.();
      });
    }

    return handle;
  }

  /**
   * Build and seed the construction-time playbook handle (`options.playbook`).
   * Reuses the `playbook()` stage-binding path; a snapshot seed is restored
   * via `load()`, a bare playbook seeds the engine directly. Either way the
   * seeded content is rendered into the live stage prompt (unless
   * `apply: false`).
   */
  private _createPlaybookHandle(
    resolved: Readonly<AxResolvedAgentPlaybookConfig>
  ): AxPlaybook<any, any> {
    const studentAI = resolved.studentAI ?? (this.primaryAgent as any).ai;
    if (!studentAI) {
      throw new Error(
        'AxAgent: the `playbook` config option requires studentAI when the agent has no default ai.'
      );
    }
    const seed = resolved.seedPlaybook;
    const initialPlaybook =
      seed && !isPlaybookSnapshotSeed(seed) ? seed : undefined;
    const handle = this._buildStagePlaybook({
      target: resolved.target,
      studentAI,
      teacherAI: resolved.teacherAI,
      apply: resolved.apply,
      ...resolved.playbookOptions,
      ...(initialPlaybook ? { initialPlaybook } : {}),
    });
    if (seed && isPlaybookSnapshotSeed(seed)) {
      handle.load(seed);
    } else if (initialPlaybook) {
      handle.applyTo();
    }
    return handle;
  }

  /**
   * Run-end failure learning for the attached playbook (see
   * `AxAgentPlaybookConfig.learn`): merge the stages' deterministic failure
   * reports, gate on volume and signature novelty, then feed one bounded
   * playbook update whose curated rules land in the `failures_to_avoid`
   * section. Non-fatal by construction — playbook upkeep must never break the
   * completed user-facing run.
   *
   * @internal Public for the pipeline flow node and tests.
   */
  public async _updatePlaybookFromPipelineState(
    state: Readonly<Record<string, any>>
  ): Promise<AxAgentPlaybookUpdateResult | undefined> {
    const resolved = this.playbookConfigResolved;
    const handle = this.playbookHandle;
    if (!resolved || !handle) {
      return undefined;
    }
    try {
      const skip = (
        skipReason: AxAgentPlaybookSkipReason,
        signals: readonly AxAgentFailureSignal[]
      ): AxAgentPlaybookUpdateResult => ({
        snapshot: handle.getState(),
        status: 'skipped',
        skipReason,
        signals,
      });
      if (!resolved.learn.enabled) {
        return skip('learning_disabled', []);
      }

      const reports: (AxAgentFailureReport | undefined)[] = [
        state.distillerResult?.failureReport,
        state.executorResult?.failureReport,
      ];
      const signals = mergeFailureSignals(reports);
      if (signals.length === 0) {
        return skip('no_failures', signals);
      }
      if (signals.length < resolved.learn.minSignals) {
        return skip('below_min_signals', signals);
      }

      let fresh = signals;
      if (resolved.learn.dedupe) {
        // Signatures already curated into this playbook are recorded on the
        // update events we feed the engine (`example.failureSignatures`), so
        // the skip decision is deterministic regardless of how the curator
        // phrased or filed the resulting bullets — and it survives snapshot
        // save/restore because the events ride the artifact. Coverage lapses
        // when the curated bullets have since been pruned, so lost lessons
        // re-learn (see `collectCoveredFailureSignatures`).
        const curated = collectCoveredFailureSignatures(handle.getState());
        fresh = signals.filter((signal) => !curated.has(signal.signature));
        if (fresh.length === 0) {
          return skip('all_duplicates', signals);
        }
      }

      // Only the signals actually shown to the curator can produce a bullet,
      // so record coverage for exactly that set — recording the uncapped set
      // would mark overflow signatures covered without ever presenting them.
      fresh = fresh.slice(0, MAX_FEEDBACK_SIGNALS);

      const task =
        typeof state.executorInputs?.executorRequest === 'string'
          ? state.executorInputs.executorRequest
          : JSON.stringify(state.agentValues ?? {});
      const feedback = formatFailureFeedback(fresh, task);
      const before = JSON.stringify(handle.getState().playbook);
      await handle.update({
        example: {
          task,
          failureSignatures: fresh.map((signal) => signal.signature),
        },
        prediction: state.responderResult ?? {},
        feedback,
      });
      const snapshot = handle.getState();
      const result: AxAgentPlaybookUpdateResult = {
        snapshot,
        status:
          JSON.stringify(snapshot.playbook) === before
            ? 'unchanged'
            : 'updated',
        signals: fresh,
        feedback,
      };
      if (resolved.onUpdate) {
        await resolved.onUpdate(result);
      }
      return result;
    } catch {
      // Playbook upkeep must not break the completed user-facing run.
      return undefined;
    }
  }

  private _listOptimizationTargetDescriptors(): AxAgentOptimizationTargetDescriptor[] {
    return this.namedProgramInstances().map((entry: any) => ({
      id: entry.id,
      signature: entry.signature,
      program: entry.program,
    }));
  }

  private _createOptimizationProgram(
    targetIds: readonly string[],
    descriptors: readonly AxAgentOptimizationTargetDescriptor[]
  ) {
    return createOptimizationProgram<IN, OUT>(this, targetIds, descriptors);
  }

  private _createAgentOptimizeMetric(
    judgeAI: Readonly<AxAIService>,
    judgeOptions: Readonly<AxAgentJudgeOptions>
  ) {
    return createAgentOptimizeMetric<IN, OUT>(this, judgeAI, judgeOptions);
  }

  /** @internal Used by the optimizer to evaluate a single dataset task end-to-end. */
  public async _forwardForEvaluation<T extends Readonly<AxAIService>>(
    parentAi: T,
    task: Readonly<AxAgentEvalTask<IN>>,
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<AxAgentEvalPrediction<OUT>> {
    return forwardPipelineForEvaluation<IN, OUT, T>(
      this,
      parentAi,
      task,
      options
    );
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
    // Test code runs where its declared runtime values and tools live. Context
    // field snippets use the distiller; ordinary tool/function snippets use the
    // executor, where task-only knobs are intentionally routed.
    return this.contextFieldNames.size > 0
      ? this.distiller.test(code, values as any, options)
      : this.executor.test(code, values, options);
  }
}

// ----- Factory Function -----

export interface AxAgentConfig<_IN extends AxGenIn, _OUT extends AxGenOut>
  extends AxAgentOptions<_IN> {
  ai?: AxAIService;
  judgeAI?: AxAIService;
  agentIdentity?: AxAgentIdentity;
}

export function agent<
  const T extends string,
  const CF extends readonly AxContextFieldInput[] = [],
>(
  signature: T,
  config: Omit<
    AxAgentConfig<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>,
    'contextFields'
  > & {
    contextFields?: CF;
  }
): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>;

export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  const CF extends readonly AxContextFieldInput[] = [],
>(
  signature: AxSignature<TInput, TOutput>,
  config: Omit<AxAgentConfig<TInput, TOutput>, 'contextFields'> & {
    contextFields?: CF;
  }
): AxAgent<TInput, TOutput>;

export function agent(
  signature: Readonly<AxSignatureConfig>,
  config: AxAgentConfig<AxGenIn, AxGenOut>
): AxAgent<AxGenIn, AxGenOut>;
export function agent(
  signature: string | AxSignature<any, any> | Readonly<AxSignatureConfig>,
  config: AxAgentConfig<any, any>
): AxAgent<any, any> {
  const typedSignature =
    typeof signature === 'string'
      ? AxSignature.create(signature)
      : signature instanceof AxSignature
        ? signature
        : AxSignature.from(signature);
  const { ai, judgeAI, agentIdentity, ...options } = config;

  return new AxAgent(
    {
      ai,
      judgeAI,
      agentIdentity,
      signature: typedSignature,
    },
    {
      contextFields: [],
      ...options,
    }
  );
}
