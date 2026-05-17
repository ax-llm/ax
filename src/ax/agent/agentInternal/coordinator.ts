import type { AxAIService, AxFunction } from '../../ai/types.js';
import type { AxSignatureConfig } from '../../dsp/sig.js';
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
import { toCamelCase } from '../runtimeDiscovery.js';
import { Synthesizer } from '../synthesizer.js';
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
  AxAgentState,
  AxAgentStreamingForwardOptions,
  AxAgentTestResult,
  AxAnyAgentic,
  AxContextFieldInput,
} from './agentPublicTypes.js';
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
import { buildFinalResponderSignature } from './synthesizerSignature.js';
import type { AxAgentOptimizationTargetDescriptor } from './types.js';

/**
 * Knobs the coordinator passes from top-level `AxAgentOptions` down to
 * BOTH internal actor agents. These are the LLM-call defaults and stage-agnostic
 * infrastructure that should apply identically to the distiller and executor.
 *
 * All other top-level options reach ONLY the executor; callers who need
 * distiller-specific overrides must opt in explicitly via `options.contextOptions`.
 */
const SHARED_KNOB_KEYS = [
  'runtime',
  'maxRuntimeChars',
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
  'onLoadedMemories',
  'onUsedMemories',
] as const;

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
    this.fullSignature =
      typeof init.signature === 'string'
        ? (AxSignature.create(init.signature) as AxSignature<IN, OUT>)
        : init.signature instanceof AxSignature
          ? (init.signature as AxSignature<IN, OUT>)
          : (new AxSignature(init.signature) as AxSignature<IN, OUT>);
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

    const allInputFields = this.fullSignature.getInputFields();
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
    const responderOutputFields = allOutputFields;

    const {
      description: finalResponderDescription,
      ...finalResponderForwardOptionsFromUser
    } = options.responderOptions ?? {};
    // Propagate construction-time debug to synthesizer stages so that
    // `new AxAgent(..., { debug: true })` reaches both actor and synthesizer
    // .forward() calls — not just call-time debug (which flows via options).
    const debugOverride =
      options.debug !== undefined ? { debug: options.debug } : {};
    const finalResponderForwardOptions = {
      ...debugOverride,
      ...finalResponderForwardOptionsFromUser,
    };

    // ----- Static flow: distiller → executor → responder
    // The distiller's *base* signature carries `distilledContext` as a
    // placeholder output so the actor template can hint at what the downstream
    // executor stage will be asked for. The actor program built inside
    // ActorAgentRLM swaps this for `javascriptCode` at runtime.
    const memoriesEnabled = typeof options.onMemoriesSearch === 'function';
    let distillerSigBuilder = f().addInputFields(allInputFields);
    if (memoriesEnabled) {
      distillerSigBuilder = distillerSigBuilder.input(
        'memories',
        f
          .string(
            'Memories already loaded for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]`. Call `recall(...)` to load more.'
          )
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
        'distilledContext',
        f
          .json('Pre-distilled context evidence from the distiller stage.')
          .optional()
      );
    if (memoriesEnabled) {
      executorSigBuilder = executorSigBuilder.input(
        'memories',
        f
          .string(
            'Memories loaded so far for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]` (carried over from the distiller and any prior executor turns). Call `recall(...)` to load more.'
          )
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
   * The explorer is reported under `ctx.*` and the executor / responder
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
    // Route by `ctx.*` / `task.*` prefix. The ctx side has only the explorer
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
    // The ctx stage has only the explorer actor (no responder LLM call).
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

  public setSignature(
    signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>
  ): void {
    const nextSig = new AxSignature(signature);
    const allInputFields = nextSig.getInputFields();
    const allOutputFields = nextSig.getOutputFields();
    const ctxNames = this.contextFieldNames;
    const responderOutputFields = allOutputFields;

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

    const memoriesEnabled =
      typeof (this.options as any)?.onMemoriesSearch === 'function';
    let distillerSigBuilder = f().addInputFields(allInputFields);
    if (memoriesEnabled) {
      distillerSigBuilder = distillerSigBuilder.input(
        'memories',
        f
          .string(
            'Memories already loaded for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]`. Call `recall(...)` to load more.'
          )
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
        'distilledContext',
        f
          .json('Pre-distilled context evidence from the distiller stage.')
          .optional()
      );
    if (memoriesEnabled) {
      executorSigBuilder = executorSigBuilder.input(
        'memories',
        f
          .string(
            'Memories loaded so far for this run, rendered as markdown blocks with `ID:` lines. In JS, read `inputs.memories` as `[{ id, content }]` (carried over from the distiller and any prior executor turns). Call `recall(...)` to load more.'
          )
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
    // field snippets use the explorer; ordinary tool/function snippets use the
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
        : new AxSignature(signature);
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
