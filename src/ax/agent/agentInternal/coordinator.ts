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
  AxMessage,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptionsWithModels,
  AxProgramStreamingForwardOptionsWithModels,
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
  AxAgentIdentity,
  AxAgentic,
  AxAgentJudgeOptions,
  AxAgentOptimizeOptions,
  AxAgentOptimizeResult,
  AxAgentOptions,
  AxAgentState,
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
  forwardPipeline,
  streamingForwardPipeline,
} from './pipelineForward.js';
import { forwardPipelineForEvaluation } from './pipelineForwardForEvaluation.js';
import { buildFinalResponderSignature } from './synthesizerSignature.js';
import type { AxAgentOptimizationTargetDescriptor } from './types.js';

/**
 * Knobs the coordinator passes from top-level `AxAgentOptions` down to
 * BOTH internal actor agents. These are the LLM-call defaults and stage-agnostic
 * infrastructure that should apply identically to ctx and task stages.
 *
 * All other top-level options reach ONLY the taskExecutor; callers who need
 * ctx-specific overrides must opt in explicitly via `options.contextOptions`.
 */
const SHARED_KNOB_KEYS = [
  'runtime',
  'maxRuntimeChars',
  'contextPolicy',
  'summarizerOptions',
  'promptLevel',
  'maxTurns',
  'maxSubAgentCalls',
  'maxSubAgentCallsPerChild',
  'maxBatchedLlmQueryConcurrency',
  'debug',
  'bubbleErrors',
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
 * Pipeline-based coordinator. Wires stages based on whether the user declared
 * `contextFields`:
 *
 *   contextExplorer (RLM actor, optional)  →  taskExecutor (RLM actor)
 *                                          ↓
 *                                  finalResponder (Synthesizer)
 *
 * - **Context staged flow** (`contextFields` present): explorer → executor →
 *   responder. The explorer's `final(request, evidence)` payload feeds the
 *   executor as `{executorRequest, distilledContext}`. The executor owns
 *   completion and any tool use, even when no tools are configured.
 * - **Task-only flow** (no `contextFields`): taskExecutor →
 *   finalResponder; behaviorally equivalent to the pre-pipeline single-stage
 *   agent.
 *
 * This is the primary user-facing class. `ActorAgentRLM` and `Synthesizer`
 * are exported for callers that need direct per-instance control.
 */
export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic<IN, OUT>
{
  /** RLM actor that distils long-context inputs into evidence. Present when contextFields are configured. */
  public readonly contextExplorer?: ActorAgentRLM<any, any>;
  /** RLM actor that runs tools / discovery with the pre-distilled context. Always present. */
  public readonly taskExecutor?: ActorAgentRLM<any, any>;
  /** Synthesizer that produces the user's output signature. Always present. */
  public readonly finalResponder!: Synthesizer<OUT>;

  /**
   * Backward-compat handle used by legacy access patterns: returns the actor
   * stage that "owns" the run-time forward — always the `taskExecutor` in
   * current pipeline shapes. Tests reach in via
   * `agent.primaryAgent.actorProgram` etc.
   */
  public get primaryAgent(): ActorAgentRLM<any, any> {
    return (this.taskExecutor ?? this.contextExplorer) as ActorAgentRLM<
      any,
      any
    >;
  }

  private readonly contextFieldNames: Set<string>;
  private readonly fullSignature: AxSignature<IN, OUT>;
  private readonly init: Readonly<{
    ai?: Readonly<AxAIService>;
    judgeAI?: Readonly<AxAIService>;
    agentIdentity?: Readonly<AxAgentIdentity>;
    agentModuleNamespace?: string;
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

    const ctxFieldInputs = options.contextFields ?? [];
    this.contextFieldNames = new Set(
      ctxFieldInputs.map((cf) => (typeof cf === 'string' ? cf : cf.field))
    );

    const hasContextFields = this.contextFieldNames.size > 0;

    const allInputFields = this.fullSignature.getInputFields();
    const allOutputFields = this.fullSignature.getOutputFields();
    const ctxInputFields = allInputFields.filter((fld) =>
      this.contextFieldNames.has(fld.name)
    );
    const nonCtxInputFields = allInputFields.filter(
      (fld) => !this.contextFieldNames.has(fld.name)
    );
    // The synthesizer never emits fields the actor produces directly
    // (set via `actorFields`) — the pipeline merges actor field values into
    // the result *after* the synthesizer responds.
    const actorFieldNames = new Set(options.actorFields ?? []);
    const responderOutputFields = allOutputFields.filter(
      (fld) => !actorFieldNames.has(fld.name)
    );

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

    if (hasContextFields) {
      // ----- Staged context flow: contextExplorer → taskExecutor → finalResponder
      // The explorer's *base* signature carries `distilledContext` as a
      // placeholder output so the actor template can hint at what the
      // downstream task stage will be asked for. The actor program built
      // inside ActorAgentRLM swaps this for `javascriptCode` at runtime.
      const ctxSig = f()
        .addInputFields(allInputFields)
        .output(
          'distilledContext',
          f
            .json('Pre-distilled context evidence for the task stage.')
            .optional()
        )
        .build();

      const shared = pickShared(options);
      const ctxOverrides = options.contextOptions ?? {};
      this.contextExplorer = new ActorAgentRLM<any, any>(
        { ...init, signature: ctxSig },
        {
          ...shared,
          ...ctxOverrides,
          contextFields: [...ctxFieldInputs],
          actorTemplateVariant: 'context',
        } as any
      );

      // The task executor's *base* signature carries the user's output
      // fields as a placeholder so the actor template can hint at what the
      // downstream finalResponder will be asked for. The actor program
      // built inside ActorAgentRLM swaps these for `javascriptCode` at
      // runtime.
      //
      const taskSig = f()
        .addInputFields(nonCtxInputFields)
        .input(
          'executorRequest',
          f.string(
            'Expanded executor request from the context-understanding stage — what the task stage should complete, enriched with relevant context evidence.'
          )
        )
        .input(
          'distilledContext',
          f
            .json(
              'Pre-distilled context evidence from the context-understanding stage.'
            )
            .optional()
        )
        .addOutputFields(allOutputFields)
        .build();

      const taskOptions = {
        ...options,
        contextFields: [],
        actorTemplateVariant: 'task' as const,
        hasDistilledContext: true,
      };

      this.taskExecutor = new ActorAgentRLM<any, any>(
        { ...init, signature: taskSig },
        taskOptions as any
      );

      this.finalResponder = new Synthesizer<OUT>(
        {
          signature: buildFinalResponderSignature(
            nonCtxInputFields,
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
    } else {
      // ----- Task-only flow: taskExecutor → finalResponder
      this.taskExecutor = new ActorAgentRLM<any, any>(init, options);
      this.finalResponder = new Synthesizer<OUT>(
        {
          signature: buildFinalResponderSignature(
            allInputFields,
            responderOutputFields
          ),
          contextFieldMeta: [],
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
    }

    if (init.agentIdentity) {
      const coordForward = this.forward.bind(this);
      const coordSig = this.fullSignature;
      const coordFuncName = init.agentIdentity.namespace
        ? `${init.agentIdentity.namespace}.${toCamelCase(init.agentIdentity.name)}`
        : toCamelCase(init.agentIdentity.name);
      this.func = {
        name: coordFuncName,
        description: init.agentIdentity.description,
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
  }

  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    return forwardPipeline<IN, OUT, T>(this, ai, values, options);
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
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
    this.contextExplorer?.stop();
    this.taskExecutor?.stop();
    this.finalResponder.stop();
  }

  public getId(): string {
    return this.primaryAgent.getId();
  }

  public setId(id: string): void {
    this.primaryAgent.setId(id);
  }

  /**
   * In staged context flows the explorer is reported under `ctx.*` and the executor /
   * finalResponder pair under `task.*` — matching the legacy coordinator's
   * prefixing so optimizer demo IDs and template-overrides keep their stable
   * names. Task-only flows have a single actor + a single synthesizer, so no
   * prefix is added.
   */
  public namedPrograms(): Array<{ id: string; signature?: string }> {
    const isStaged = Boolean(this.contextExplorer && this.taskExecutor);
    const out: Array<{ id: string; signature?: string }> = [];
    const tagAll = (
      entries: Array<{ id: string; signature?: string }>,
      prefix: string | undefined
    ) =>
      prefix
        ? entries.map((p) => ({ ...p, id: `${prefix}.${p.id}` }))
        : entries;
    if (this.contextExplorer)
      out.push(
        ...tagAll(
          this.contextExplorer.namedPrograms(),
          isStaged ? 'ctx' : undefined
        )
      );
    if (this.taskExecutor)
      out.push(
        ...tagAll(
          this.taskExecutor.namedPrograms(),
          isStaged ? 'task' : undefined
        )
      );
    out.push(
      ...tagAll(
        this.finalResponder.namedPrograms(),
        isStaged ? 'task' : undefined
      )
    );
    return out;
  }

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    const isStaged = Boolean(this.contextExplorer && this.taskExecutor);
    const out: any[] = [];
    const tagAll = (entries: any[], prefix: string | undefined) =>
      prefix
        ? entries.map((p) => ({ ...p, id: `${prefix}.${(p as any).id}` }))
        : entries;
    if (this.contextExplorer)
      out.push(
        ...tagAll(
          this.contextExplorer.namedProgramInstances(),
          isStaged ? 'ctx' : undefined
        )
      );
    if (this.taskExecutor)
      out.push(
        ...tagAll(
          this.taskExecutor.namedProgramInstances(),
          isStaged ? 'task' : undefined
        )
      );
    out.push(
      ...tagAll(
        this.finalResponder.namedProgramInstances(),
        isStaged ? 'task' : undefined
      )
    );
    return out as AxNamedProgramInstance<IN, OUT>[];
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    const out: any[] = [];
    if (this.contextExplorer) out.push(...this.contextExplorer.getTraces());
    if (this.taskExecutor) out.push(...this.taskExecutor.getTraces());
    out.push(...this.finalResponder.getTraces());
    return out as AxProgramTrace<IN, OUT>[];
  }

  public setDemos(
    demos: readonly (AxAgentDemos<IN, OUT> | AxProgramDemos<IN, OUT>)[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    const isStaged = Boolean(this.contextExplorer && this.taskExecutor);
    const programIdOf = (d: any): string | undefined => d.programId ?? d.id;
    const isResponderId = (id: string | undefined) =>
      Boolean(id?.endsWith('.responder'));
    if (!isStaged) {
      // Task-only flow: send actor demos to the actor stage and
      // responder demos to the synthesizer.
      const actorDemos: any[] = [];
      const responderDemos: any[] = [];
      for (const demo of demos) {
        if (isResponderId(programIdOf(demo))) {
          responderDemos.push(demo);
        } else {
          actorDemos.push(demo);
        }
      }
      if (actorDemos.length > 0)
        this.primaryAgent.setDemos(actorDemos as any, options);
      if (responderDemos.length > 0)
        this.finalResponder.setDemos(responderDemos as any, options);
      return;
    }

    // Staged context flow: route by `ctx.*` / `task.*` prefix. The ctx side
    // has only the explorer actor; the task side has the executor actor +
    // finalResponder.
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
    if (ctxDemos.length > 0) this.contextExplorer?.setDemos(ctxDemos, options);
    if (taskDemos.length > 0) {
      const actor: any[] = [];
      const responder: any[] = [];
      for (const d of taskDemos) {
        if (isResponderId(programIdOf(d))) responder.push(d);
        else actor.push(d);
      }
      if (actor.length > 0) this.taskExecutor?.setDemos(actor, options);
      if (responder.length > 0)
        this.finalResponder.setDemos(responder as any, options);
    }
  }

  public getUsage(): AxAgentUsage {
    const actor: any[] = [];
    const responder: any[] = [];
    if (this.contextExplorer) actor.push(...this.contextExplorer.getUsage());
    if (this.taskExecutor) actor.push(...this.taskExecutor.getUsage());
    responder.push(...this.finalResponder.getUsage());
    return { actor, responder };
  }

  public getStagedUsage(): {
    ctx?: AxAgentUsage;
    task: AxAgentUsage;
  } {
    const isStaged = Boolean(this.contextExplorer && this.taskExecutor);
    if (!isStaged) {
      // Task-only flow: a single actor + a single synthesizer.
      const actorStage = this.taskExecutor ?? this.contextExplorer;
      return {
        task: {
          actor: actorStage ? [...actorStage.getUsage()] : [],
          responder: [...this.finalResponder.getUsage()],
        },
      };
    }
    // The ctx stage has only the explorer actor (no responder LLM call).
    return {
      ctx: {
        actor: [...this.contextExplorer!.getUsage()],
        responder: [],
      },
      task: {
        actor: [...this.taskExecutor!.getUsage()],
        responder: [...this.finalResponder.getUsage()],
      },
    };
  }

  public getChatLog(): {
    actor: readonly AxChatLogEntry[];
    responder: readonly AxChatLogEntry[];
  } {
    const isStaged = Boolean(this.contextExplorer && this.taskExecutor);
    // Task-only flows leave entries untagged. In staged context flows every
    // entry is tagged 'ctx' or 'task' so callers can split the log by pipeline side.
    const tag = (
      entries: readonly AxChatLogEntry[],
      stage: 'ctx' | 'task'
    ): AxChatLogEntry[] => entries.map((e) => ({ ...e, stage }));
    const passthrough = (entries: readonly AxChatLogEntry[]) => [...entries];
    const actor = [
      ...(this.contextExplorer
        ? isStaged
          ? tag(this.contextExplorer.getChatLog(), 'ctx')
          : passthrough(this.contextExplorer.getChatLog())
        : []),
      ...(this.taskExecutor
        ? isStaged
          ? tag(this.taskExecutor.getChatLog(), 'task')
          : passthrough(this.taskExecutor.getChatLog())
        : []),
    ];
    const responder = isStaged
      ? tag(this.finalResponder.getChatLog(), 'task')
      : passthrough(this.finalResponder.getChatLog());
    return { actor, responder };
  }

  public resetUsage(): void {
    this.contextExplorer?.resetUsage();
    this.taskExecutor?.resetUsage();
    this.finalResponder.resetUsage();
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
    const actorFieldNames = new Set(this.options.actorFields ?? []);
    const responderOutputFields = allOutputFields.filter(
      (fld) => !actorFieldNames.has(fld.name)
    );

    const inputFieldNames = new Set(allInputFields.map((fld) => fld.name));
    for (const field of ctxNames) {
      if (!inputFieldNames.has(field)) {
        throw new Error(`RLM contextField "${field}" not found in signature`);
      }
    }

    const outputFieldNames = new Set(allOutputFields.map((fld) => fld.name));
    for (const field of this.options.actorFields ?? []) {
      if (!outputFieldNames.has(field)) {
        throw new Error(
          `RLM actorField "${field}" not found in output signature`
        );
      }
    }

    const nonCtxInputFields = allInputFields.filter(
      (fld) => !ctxNames.has(fld.name)
    );
    const ctxInputFields = allInputFields.filter((fld) =>
      ctxNames.has(fld.name)
    );

    const hasContextFields = ctxNames.size > 0;
    if (hasContextFields) {
      const ctxSig = f()
        .addInputFields(allInputFields)
        .output(
          'distilledContext',
          f
            .json('Pre-distilled context evidence for the task stage.')
            .optional()
        )
        .build();

      const taskSig = f()
        .addInputFields(nonCtxInputFields)
        .input(
          'executorRequest',
          f.string(
            'Expanded executor request from the context-understanding stage — what the task stage should complete, enriched with relevant context evidence.'
          )
        )
        .input(
          'distilledContext',
          f
            .json(
              'Pre-distilled context evidence from the context-understanding stage.'
            )
            .optional()
        )
        .addOutputFields(allOutputFields)
        .build();

      this.contextExplorer?.setSignature(ctxSig);
      this.taskExecutor?.setSignature(taskSig);
    } else {
      this.primaryAgent.setSignature(nextSig);
    }

    // The finalResponder's signature is `{ ...nonContextInputs, contextData } ->
    // outputFields`. After actor signatures change we need to rebuild the
    // synthesizer's underlying program to match the new fields.
    const nextResponderSig = buildFinalResponderSignature(
      hasContextFields
        ? nonCtxInputFields
        : nonCtxInputFields.length
          ? nonCtxInputFields
          : allInputFields,
      responderOutputFields
    );
    (this.finalResponder as any).program?.setSignature?.(nextResponderSig);
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
    if (this.contextExplorer)
      out.push(...this.contextExplorer.getOptimizableComponents());
    if (this.taskExecutor)
      out.push(...this.taskExecutor.getOptimizableComponents());
    out.push(...this.finalResponder.getOptimizableComponents());
    return out;
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    this.contextExplorer?.applyOptimizedComponents(updates);
    this.taskExecutor?.applyOptimizedComponents(updates);
    this.finalResponder.applyOptimizedComponents(updates);
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
    // Route to the stage that owns the context fields. In staged flows the context
    // fields live on contextExplorer; values passed to test() are context-field
    // values. In task-only flows, taskExecutor holds everything.
    if (this.contextExplorer) {
      return this.contextExplorer.test(code, values as any, options);
    }
    return this.primaryAgent.test(code, values, options);
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
