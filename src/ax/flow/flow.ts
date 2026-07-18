/* eslint-disable @typescript-eslint/no-explicit-any, functional/prefer-immutable-types */

import type { Meter, Tracer } from '@opentelemetry/api';
import {
  context,
  type Context as OtelContext,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import type {
  AxAIService,
  AxFunction,
  AxFunctionHandler,
} from '../ai/types.js';
import type { AxGen } from '../dsp/generate.js';
import { axGlobals } from '../dsp/globals.js';
import type { AxOptimizableComponent } from '../dsp/optimizable.js';
import type { AxOptimizedProgram } from '../dsp/optimizer.js';
import { AxProgram } from '../dsp/program.js';
import type { AxFieldType } from '../dsp/sig.js';
import { type AxField, AxSignature, f } from '../dsp/sig.js';
import { ax } from '../dsp/template.js';
import type {
  AxChatLogEntry,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxProgramTrace,
  AxProgramUsage,
} from '../dsp/types.js';
import { mergeProgramUsage } from '../dsp/util.js';
import {
  type AxMCPExecutionContext,
  axResolveMCPExecutionContext,
} from '../mcp/execution.js';
import { mergeAbortSignals } from '../util/abort.js';
import { createHash } from '../util/crypto.js';
import { processBatches } from './batchUtil.js';
import { analyzeStateDependencyMetadata } from './dependencyAnalyzer.js';
import { AxFlowExecutionPlanner } from './executionPlanner.js';
import {
  type AxFlowNodeExecutionRecorder,
  checkAbortSignal,
  executeFlowSteps,
  executeNodeProgram,
} from './executor.js';
import {
  type AxFlowLoggerFunction,
  axCreateFlowColorLogger,
  createTimingLogger,
} from './logger.js';
import {
  type AxFlowMermaidRenderOptions,
  renderFlowMermaid,
} from './mermaid.js';
import {
  type AxFlowBlockLabel,
  type AxFlowExecutionContext,
  type AxFlowStep,
  createFlowStep,
} from './steps.js';
import { AxFlowSubContextImpl } from './subContext.js';
import type {
  AddNodeResult,
  AxFlowable,
  AxFlowDynamicContext,
  AxFlowExecutionPlanGroup,
  AxFlowExecutionPlanStep,
  AxFlowForwardOptions,
  AxFlowOptions,
  AxFlowState,
  AxFlowTypedParallelBranch,
  AxFlowTypedSubContext,
  GetGenIn,
  GetGenOut,
  InferAxGen,
} from './types.js';

type BranchBuildContext = {
  predicate: (state: AxFlowState) => unknown;
  // The user's unwrapped predicate — step meta keeps this one so
  // introspection (toMermaid) can read its source.
  sourcePredicate: (state: AxFlowState) => unknown;
  parentSteps: AxFlowStep[];
  branches: Map<unknown, AxFlowStep[]>;
  currentBranchValue?: unknown;
};

type LoopBuildContext<TState extends AxFlowState> = {
  parentSteps: AxFlowStep[];
  bodySteps: AxFlowStep[];
  condition: (state: TState) => boolean;
  maxIterations: number;
};

export class AxFlow<
  IN extends Record<string, any>,
  OUT,
  TNodes extends Record<string, AxProgrammable<any, any>> = Record<
    string,
    never
  >,
  TState extends AxFlowState = IN,
> implements AxFlowable<IN, OUT>, AxFlowNodeExecutionRecorder
{
  private readonly steps: AxFlowStep[] = [];
  private currentSteps: AxFlowStep[] = this.steps;
  private readonly nodeGenerators: Map<
    string,
    AxProgrammable<any, any, unknown>
  > = new Map();
  private readonly stepLabels = new Map<string, AxFlowBlockLabel>();
  private readonly loopStack: LoopBuildContext<any>[] = [];
  private branchContext: BranchBuildContext | null = null;
  private program?: AxProgram<IN, OUT>;
  private flowName?: string;
  private readonly autoParallelConfig: { enabled: boolean; batchSize: number };
  private readonly flowLogger?: AxFlowLoggerFunction;
  private readonly timingLogger?: ReturnType<typeof createTimingLogger>;
  private readonly defaultAIOptions?: Readonly<
    Pick<
      AxProgramForwardOptions<string>,
      | 'mcp'
      | 'ucp'
      | 'mcpContext'
      | 'mcpInheritance'
      | 'eventContext'
      | 'eventInheritance'
    > & {
      tracer?: Tracer;
      meter?: Meter;
    }
  >;
  private nodeUsage: Map<string, AxProgramUsage[]> = new Map();
  private nodeTraces: Map<string, AxProgramTrace<any, any>[]> = new Map();
  private nodeChatLog: AxChatLogEntry[] = [];
  private activeAbortControllers = new Set<AbortController>();
  private _stopRequested = false;

  private constructor(options?: AxFlowOptions) {
    this.autoParallelConfig = {
      enabled: options?.autoParallel !== false,
      batchSize: options?.batchSize || 10,
    };

    if (options?.logger) {
      this.flowLogger = options.logger;
    } else if (options?.debug === true) {
      this.flowLogger = axCreateFlowColorLogger();
    }

    this.timingLogger = this.flowLogger
      ? createTimingLogger(this.flowLogger)
      : undefined;

    if (
      options?.tracer ||
      options?.meter ||
      options?.mcp ||
      options?.ucp ||
      options?.mcpContext ||
      options?.mcpInheritance ||
      options?.eventContext ||
      options?.eventInheritance
    ) {
      this.defaultAIOptions = {
        tracer: options.tracer,
        meter: options.meter,
        mcp: options.mcp,
        ucp: options.ucp,
        mcpContext: options.mcpContext,
        mcpInheritance: options.mcpInheritance,
        eventContext: options.eventContext,
        eventInheritance: options.eventInheritance,
      };
    }
  }

  public static create<
    IN extends Record<string, any> = Record<string, unknown>,
    OUT = {},
    TNodes extends Record<string, AxProgrammable<any, any>> = Record<
      string,
      never
    >,
    TState extends AxFlowState = IN,
  >(options?: AxFlowOptions): AxFlow<IN, OUT, TNodes, TState> {
    return new AxFlow<IN, OUT, TNodes, TState>(options);
  }

  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  public stop(): void {
    this._stopRequested = true;
    for (const controller of this.activeAbortControllers) {
      controller.abort('Stopped by user');
    }
  }

  private addStep(step: AxFlowStep): void {
    this.currentSteps.push(step);
    if (this.nodeGenerators.size > 0) {
      this.ensureProgram();
    }
  }

  private getCacheKey(
    values: IN,
    cachingFunction?: ((key: string, value?: AxGenOut) => unknown) | undefined
  ): string | undefined {
    if (!cachingFunction) return undefined;
    const hasher = createHash('sha256');
    hasher.update(this.program?.getSignature().hash() ?? 'axflow');

    const updateWithValue = (value: unknown): void => {
      const type = typeof value;
      hasher.update(`|${type}|`);
      if (value === null || value === undefined) {
        hasher.update('null');
        return;
      }
      if (type === 'string' || type === 'number' || type === 'boolean') {
        hasher.update(String(value));
        return;
      }
      if (Array.isArray(value)) {
        hasher.update('[');
        for (const item of value) updateWithValue(item);
        hasher.update(']');
        return;
      }
      if (
        type === 'object' &&
        'mimeType' in (value as Record<string, unknown>) &&
        'data' in (value as Record<string, unknown>)
      ) {
        const media = value as { mimeType?: string; data?: string };
        hasher.update(media.mimeType ?? '');
        hasher.update(
          createHash('sha256')
            .update(media.data ?? '')
            .digest('hex')
        );
        return;
      }
      if (type === 'object') {
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record).sort()) {
          hasher.update(`{${key}}`);
          updateWithValue(record[key]);
        }
        return;
      }
      hasher.update(String(value));
    };

    updateWithValue(values);
    return hasher.digest('hex');
  }

  private inferSignatureFromFlow(): AxSignature {
    const executionPlan = new AxFlowExecutionPlanner(
      this.steps
    ).getExecutionPlan();

    if (this.nodeGenerators.size === 0 && executionPlan.steps.length === 0) {
      return f()
        .input('userInput', f.string('User input to the flow'))
        .output('flowOutput', f.string('Output from the flow'))
        .build();
    }

    const produced = new Set<string>();
    const consumed = new Set<string>();
    for (const step of executionPlan.steps) {
      step.produces.forEach((field) => produced.add(field));
      step.dependencies.forEach((field) => consumed.add(field));
    }

    const inputNames = [...consumed].filter((field) => !produced.has(field));
    const outputNames = new Set<string>();
    for (const field of produced) {
      const consumedLater = executionPlan.steps.some((step) =>
        step.dependencies.includes(field)
      );
      if (!consumedLater && !field.startsWith('_')) {
        outputNames.add(field);
      }
    }

    const inferredSignature = AxSignature.from();

    if (inputNames.length > 0) {
      inferredSignature.setInputFields(
        inputNames.map((name) => ({
          name,
          type: { name: 'string' },
          description: `Input field: ${name}`,
        }))
      );
    } else if (
      this.nodeGenerators.size > 0 &&
      executionPlan.steps.length === 0
    ) {
      const inputFields: AxField[] = [];
      for (const [nodeName, nodeGen] of this.nodeGenerators) {
        for (const field of nodeGen.getSignature().getInputFields()) {
          inputFields.push({
            ...field,
            name: this.toCamelCase(`${nodeName}_${field.name}`),
          });
        }
      }
      inferredSignature.setInputFields(
        inputFields.length > 0
          ? inputFields
          : [
              {
                name: 'userInput',
                type: { name: 'string' },
                description: 'User input to the flow',
              },
            ]
      );
    } else {
      inferredSignature.addInputField({
        name: 'userInput',
        type: { name: 'string' },
        description: 'User input to the flow',
      });
    }

    const outputFields: AxField[] = [];
    for (const outputName of outputNames) {
      if (outputName.endsWith('Result')) {
        const nodeName = outputName.slice(0, -'Result'.length);
        const nodeGen = this.nodeGenerators.get(nodeName);
        if (nodeGen) {
          outputFields.push(
            ...nodeGen
              .getSignature()
              .getOutputFields()
              .map((field) => ({
                ...field,
                name: this.toCamelCase(`${nodeName}_${field.name}`),
              }))
          );
          continue;
        }
      }
      outputFields.push({
        name: outputName,
        type: { name: 'string' },
        description: `Output field: ${outputName}`,
      });
    }

    if (outputFields.length === 0 && this.nodeGenerators.size > 0) {
      for (const [nodeName, nodeGen] of this.nodeGenerators) {
        for (const field of nodeGen.getSignature().getOutputFields()) {
          outputFields.push({
            ...field,
            name: this.toCamelCase(`${nodeName}_${field.name}`),
          });
        }
      }
    }

    inferredSignature.setOutputFields(
      outputFields.length > 0
        ? outputFields
        : [
            {
              name: 'flowOutput',
              type: { name: 'string' },
              description: 'Output from the flow',
            },
          ]
    );

    return inferredSignature;
  }

  private ensureProgram(): void {
    const signature = this.inferSignatureFromFlow();
    if (!this.program) {
      this.program = new AxProgram<IN, OUT>(signature);
      for (const [nodeName, nodeProgram] of this.nodeGenerators) {
        this.program.register(nodeProgram as any, nodeName);
      }
      return;
    }
    this.program.setSignature(signature);
  }

  public getId(): string {
    this.ensureProgram();
    return this.program!.getId();
  }

  public setId(id: string): void {
    this.ensureProgram();
    this.program!.setId(id);
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    this.ensureProgram();
    return this.program!.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    this.ensureProgram();
    return this.program!.namedProgramInstances();
  }

  public getTraces(): AxProgramTrace<IN, OUT>[] {
    const allTraces: AxProgramTrace<IN, OUT>[] = [];
    for (const traces of this.nodeTraces.values()) {
      allTraces.push(...(traces as AxProgramTrace<IN, OUT>[]));
    }
    return allTraces;
  }

  public setDemos(
    demos: readonly AxProgramDemos<
      IN,
      OUT,
      keyof TNodes extends never ? string : `${string}.${string & keyof TNodes}`
    >[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void {
    this.ensureProgram();
    this.program!.setDemos(demos, options);
  }

  public description(name: string, description: string): this {
    this.ensureProgram();
    this.flowName = name;
    this.program!.setDescription(description);
    return this;
  }

  public toFunction(): AxFunction {
    this.ensureProgram();
    const sig = this.program!.getSignature();
    const baseName =
      this.flowName ??
      (sig.getDescription()?.trim().split('\n')[0] || 'axFlow');
    const name = this.toCamelCase(baseName.replace(/\s+/g, '_'));

    const handler: AxFunctionHandler = async (args?: any, extra?) => {
      const ai = extra?.ai;
      if (!ai) throw new Error('AI service is required to run the flow');

      const ret = await this.forward(ai, (args ?? {}) as IN);
      const outFields = sig.getOutputFields();
      const resultObj = (ret ?? {}) as Record<string, unknown>;
      return Object.keys(resultObj)
        .map((key) => {
          const field = outFields.find((of) => of.name === key);
          const title = (field as any)?.title;
          return title
            ? `${title}: ${resultObj[key]}`
            : `${key}: ${resultObj[key]}`;
        })
        .join('\n');
    };

    return {
      name,
      description: sig.getDescription() ?? 'Execute this AxFlow',
      parameters: sig.toJSONSchema(),
      func: handler,
    };
  }

  public getUsage(): AxProgramUsage[] {
    return mergeProgramUsage([...this.nodeUsage.values()].flat());
  }

  public getChatLog(): readonly AxChatLogEntry[] {
    return this.nodeChatLog;
  }

  public resetUsage(): void {
    this.nodeUsage.clear();
    for (const nodeProgram of this.nodeGenerators.values()) {
      if (
        'resetUsage' in nodeProgram &&
        typeof nodeProgram.resetUsage === 'function'
      ) {
        nodeProgram.resetUsage();
      }
    }
  }

  public resetTraces(): void {
    this.nodeTraces.clear();
  }

  public resetChatLog(): void {
    this.nodeChatLog = [];
  }

  public getUsageReport(): Record<string, AxProgramUsage[]> {
    const report: Record<string, AxProgramUsage[]> = {};
    for (const [nodeName, usage] of this.nodeUsage) {
      report[nodeName] = mergeProgramUsage(usage);
    }
    return report;
  }

  public getNodePrograms(): ReadonlyArray<{
    name: string;
    program: AxProgrammable<any, any>;
  }> {
    return [...this.nodeGenerators].map(([name, program]) => ({
      name,
      program,
    }));
  }

  public setNodeInstruction(name: string, instruction: string): boolean {
    const prog = this.nodeGenerators.get(name);
    if (!prog) return false;
    const setInstruction = (prog as any).setInstruction;
    if (typeof setInstruction !== 'function') return false;
    try {
      setInstruction.call(prog, instruction);
      return true;
    } catch {
      return false;
    }
  }

  public setAllNodeInstructions(map: Readonly<Record<string, string>>): void {
    for (const [name, instruction] of Object.entries(map)) {
      this.setNodeInstruction(name, instruction);
    }
  }

  public getTracesReport(): Record<string, AxProgramTrace<any, any>[]> {
    const report: Record<string, AxProgramTrace<any, any>[]> = {};
    for (const [nodeName, traces] of this.nodeTraces) {
      report[nodeName] = traces;
    }
    return report;
  }

  recordUsage(nodeName: string, usage: AxProgramUsage[]): void {
    const existingUsage = this.nodeUsage.get(nodeName) || [];
    this.nodeUsage.set(nodeName, [...existingUsage, ...usage]);
  }

  recordTraces(nodeName: string, traces: AxProgramTrace<any, any>[]): void {
    const existingTraces = this.nodeTraces.get(nodeName) || [];
    this.nodeTraces.set(nodeName, [...existingTraces, ...traces]);
  }

  recordChatLog(_nodeName: string, entries: AxChatLogEntry[]): void {
    this.nodeChatLog.push(...entries);
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN,
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    const result = await this.forward(ai, values, options as any);
    yield { version: 1, index: 0, delta: result };
  }

  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN,
    options?: Readonly<AxFlowForwardOptions<T>>
  ): Promise<OUT> {
    const cachingFunction =
      (options as any)?.cachingFunction ?? axGlobals.cachingFunction;
    const cacheKey = this.getCacheKey(values, cachingFunction as any);
    if (cachingFunction && cacheKey) {
      try {
        const cached = await cachingFunction(cacheKey);
        if (cached !== undefined) return cached as OUT;
      } catch {}
    }

    const flowStartTime = Date.now();
    this.timingLogger?.startTiming('flow-execution');
    let state: AxFlowState = {};
    let parentSpan: ReturnType<Tracer['startSpan']> | undefined;
    let runAbortController: AbortController | undefined;

    try {
      this.resetUsage();
      this.resetTraces();
      this.resetChatLog();
      this.ensureProgram();

      state = { ...values };

      const tracer: Tracer | undefined =
        (options as any)?.tracer ??
        this.defaultAIOptions?.tracer ??
        axGlobals.tracer;
      const meter: Meter | undefined =
        (options as any)?.meter ??
        this.defaultAIOptions?.meter ??
        axGlobals.meter;
      const providedCtx: OtelContext | undefined = (options as any)
        ?.traceContext;

      const executionPlan = this.getExecutionPlan();
      this.flowLogger?.({
        name: 'FlowStart',
        timestamp: flowStartTime,
        inputFields: Object.keys(values),
        totalSteps: executionPlan.totalSteps,
        parallelGroups: executionPlan.parallelGroups,
        maxParallelism: executionPlan.maxParallelism,
        autoParallelEnabled: executionPlan.autoParallelEnabled,
      });

      let parentCtx: OtelContext | undefined = providedCtx;
      if (tracer) {
        const spanName = (options as any)?.traceLabel
          ? `AxFlow > ${(options as any).traceLabel}`
          : 'AxFlow';
        parentSpan = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          attributes: {
            total_steps: executionPlan.totalSteps,
            parallel_groups: executionPlan.parallelGroups,
            max_parallelism: executionPlan.maxParallelism,
            auto_parallel_enabled: executionPlan.autoParallelEnabled,
          },
        });
        parentCtx = trace.setSpan(providedCtx ?? context.active(), parentSpan);
      }

      runAbortController = new AbortController();
      this.activeAbortControllers.add(runAbortController);
      if (this._stopRequested) {
        runAbortController.abort('Stopped by user (pre-forward)');
      }
      const callerAbortSignal = mergeAbortSignals(
        (options as any)?.abortSignal,
        (options as any)?.abortController?.signal
      );
      const effectiveAbortSignal = mergeAbortSignals(
        runAbortController.signal,
        mergeAbortSignals(callerAbortSignal, axGlobals.abortSignal)
      );

      const useAutoParallel =
        options?.autoParallel !== false && this.autoParallelConfig.enabled;

      const executeNestedSteps = async (
        steps: readonly AxFlowStep[],
        initialState: AxFlowState
      ) => {
        const result = await executeFlowSteps(
          steps,
          initialState,
          execContext,
          {
            autoParallel: useAutoParallel,
            batchSize: this.autoParallelConfig.batchSize,
            logger: this.flowLogger,
          }
        );
        return result.finalState;
      };

      const mcpExecutionContext = await axResolveMCPExecutionContext(
        options ?? {},
        this.defaultAIOptions ?? {}
      );
      const childMCPExecutionContext: AxMCPExecutionContext | undefined =
        mcpExecutionContext?.forChild();
      const mainOptions: AxProgramForwardOptions<string> = {
        ...(this.defaultAIOptions ?? {}),
        ...(options as any),
        ...(childMCPExecutionContext
          ? { _mcpExecutionContext: childMCPExecutionContext }
          : {}),
      };
      delete mainOptions.mcp;
      delete mainOptions.ucp;
      if (mainOptions.eventInheritance === 'none') {
        delete mainOptions.eventContext;
      }
      if ((options as any)?.model) {
        mainOptions.model = String((options as any).model);
      }
      if (tracer) mainOptions.tracer = tracer;
      if (meter) mainOptions.meter = meter;
      if (parentCtx) (mainOptions as any).traceContext = parentCtx;
      if (effectiveAbortSignal) mainOptions.abortSignal = effectiveAbortSignal;

      const execContext: AxFlowExecutionContext = {
        mainAi: ai,
        mainOptions:
          Object.keys(mainOptions).length > 0 ? mainOptions : undefined,
        autoParallel: useAutoParallel,
        batchSize: this.autoParallelConfig.batchSize,
        executeSteps: executeNestedSteps,
        checkAbort: (location) =>
          checkAbortSignal(effectiveAbortSignal, location),
        captureRemoteTasks: () => mcpExecutionContext?.getTaskSnapshot(),
        cancelRemoteTasksSince: async (snapshot) => {
          if (mcpExecutionContext && snapshot) {
            await mcpExecutionContext.cancelTasksCreatedSince(
              snapshot as import('../mcp/execution.js').AxMCPTaskSnapshot
            );
          }
        },
      };

      const result = await executeFlowSteps(this.steps, state, execContext, {
        autoParallel: useAutoParallel,
        batchSize: this.autoParallelConfig.batchSize,
        logger: this.flowLogger,
      });
      state = result.finalState;

      this.flowLogger?.({
        name: 'FlowComplete',
        timestamp: Date.now(),
        totalExecutionTime:
          this.timingLogger?.endTiming('flow-execution') ??
          Date.now() - flowStartTime,
        finalState: state,
        outputFields: Object.keys(state),
        stepsExecuted: result.stepsExecuted,
      });

      if (cachingFunction && cacheKey) {
        try {
          await cachingFunction(cacheKey, state as unknown as AxGenOut);
        } catch {}
      }

      return state as OUT;
    } catch (error) {
      this.flowLogger?.({
        name: 'FlowError',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
        state,
      });
      throw error;
    } finally {
      parentSpan?.end();
      if (runAbortController) {
        this.activeAbortControllers.delete(runAbortController);
      }
      this._stopRequested = false;
    }
  }

  public node<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InferAxGen<TSig> }, TState>;

  public node<TName extends string>(
    name: TName,
    signature: AxSignature
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  >;

  public node<
    TName extends string,
    TProgram extends new () => AxProgrammable<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InstanceType<TProgram> }, TState>;

  public node<TName extends string, TProgram extends AxProgrammable<any, any>>(
    name: TName,
    programInstance: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: TProgram }, TState>;

  public node<TName extends string>(
    name: TName,
    nodeValue:
      | string
      | AxSignature
      | AxProgrammable<any, any>
      | (new () => AxProgrammable<any, any>)
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: any }, TState> {
    if (this.nodeGenerators.has(name)) {
      throw new Error(
        `Node '${name}' is already defined. Use a unique node name in this flow.`
      );
    }

    let nodeGenerator: AxProgrammable<any, any, unknown>;
    if (typeof nodeValue === 'string' || nodeValue instanceof AxSignature) {
      if (!nodeValue) {
        throw new Error(
          `Invalid signature for node '${name}': signature cannot be empty`
        );
      }
      nodeGenerator = ax(nodeValue as any);
    } else if (typeof nodeValue === 'function') {
      nodeGenerator = new nodeValue() as AxProgrammable<any, any, unknown>;
    } else if (
      nodeValue &&
      typeof nodeValue === 'object' &&
      'forward' in nodeValue
    ) {
      nodeGenerator = nodeValue as AxProgrammable<any, any, unknown>;
    } else {
      throw new Error(
        `Invalid second argument for node '${name}': expected string, AxSignature, AxProgrammable instance, or constructor function`
      );
    }

    const hadProgram = !!this.program;
    this.nodeGenerators.set(name, nodeGenerator);
    this.ensureProgram();
    if (hadProgram) {
      this.program!.register(nodeGenerator as any, name);
    }
    return this as any;
  }

  public n<TName extends string, TSig extends string>(
    name: TName,
    signature: TSig
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InferAxGen<TSig> }, TState>;
  public n<TName extends string>(
    name: TName,
    signature: AxSignature
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  >;
  public n<
    TName extends string,
    TProgram extends new () => AxProgrammable<any, any>,
  >(
    name: TName,
    programClass: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: InstanceType<TProgram> }, TState>;
  public n<TName extends string, TProgram extends AxProgrammable<any, any>>(
    name: TName,
    programInstance: TProgram
  ): AxFlow<IN, OUT, TNodes & { [K in TName]: TProgram }, TState>;
  public n<TName extends string>(
    name: TName,
    signatureOrAxGenOrClass:
      | string
      | AxSignature
      | AxProgrammable<any, any>
      | (new () => AxProgrammable<any, any>)
  ): any {
    return this.node(name, signatureOrAxGenOrClass as any);
  }

  public map<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public map<TNewState extends AxFlowState>(
    transform: (_state: TState) => Promise<TNewState>
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public map<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => TNewState>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public map<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => Promise<TNewState>>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public map<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState | Promise<TNewState>,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public map<TNewState extends AxFlowState>(
    transformOrTransforms: any,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    const step = createFlowStep({
      kind: 'map',
      isBarrier: true,
      meta: { kind: 'map' },
      run: async (state) => {
        if (options?.parallel) {
          const transforms = Array.isArray(transformOrTransforms)
            ? transformOrTransforms
            : [transformOrTransforms];
          const results = await processBatches(
            transforms,
            async (transform) => await transform(state as TState),
            this.autoParallelConfig.batchSize
          );
          return results.reduce<AxFlowState>(
            (acc, result) => ({ ...acc, ...result }),
            state
          );
        }
        if (Array.isArray(transformOrTransforms)) {
          throw new Error('Array of transforms requires parallel: true option');
        }
        return await transformOrTransforms(state as TState);
      },
    });
    this.addStep(step);
    return this as unknown as AxFlow<IN, OUT, TNodes, TNewState>;
  }

  public m<TNewState extends AxFlowState>(
    transform: (_state: TState) => TNewState
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public m<TNewState extends AxFlowState>(
    transform: (_state: TState) => Promise<TNewState>
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public m<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => TNewState>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public m<TNewState extends AxFlowState>(
    transforms: Array<(_state: TState) => Promise<TNewState>>,
    options: { parallel: true }
  ): AxFlow<IN, OUT, TNodes, TNewState>;
  public m<TNewState extends AxFlowState>(
    transformOrTransforms:
      | ((_state: TState) => TNewState | Promise<TNewState>)
      | Array<(_state: TState) => TNewState | Promise<TNewState>>,
    options?: { parallel?: boolean }
  ): AxFlow<IN, OUT, TNodes, TNewState> {
    return this.map(transformOrTransforms as any, options);
  }

  public returns<TNewOut extends Record<string, unknown>>(
    transform: (_state: TState) => TNewOut
  ): AxFlow<IN, TNewOut, TNodes, TState> {
    this.addStep(
      createFlowStep({
        kind: 'returns',
        isBarrier: true,
        meta: { kind: 'returns' },
        run: (state) => transform(state as TState) as AxFlowState,
      })
    );
    return this as unknown as AxFlow<IN, TNewOut, TNodes, TState>;
  }

  public r<TNewOut extends Record<string, unknown>>(
    transform: (_state: TState) => TNewOut
  ): AxFlow<IN, TNewOut, TNodes, TState> {
    return this.returns(transform);
  }

  public label(label: string): this {
    if (this.branchContext?.currentBranchValue !== undefined) {
      throw new Error('Cannot create labels inside branch blocks');
    }
    this.stepLabels.set(label, {
      steps: this.currentSteps,
      index: this.currentSteps.length,
    });
    return this;
  }

  public l(label: string): this {
    return this.label(label);
  }

  private createExecuteStep<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (_state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
  ): AxFlowStep {
    const nodeProgram = this.nodeGenerators.get(nodeName);
    if (!nodeProgram) {
      throw new Error(
        `Node '${nodeName}' not found. Make sure to define it with .node() first.`
      );
    }

    const dependencyMetadata = analyzeStateDependencyMetadata(mapping as any);

    return createFlowStep({
      kind: 'execute',
      nodeName,
      reads: dependencyMetadata.dependencies,
      writes: [`${nodeName}Result`],
      isBarrier: !dependencyMetadata.isSafe,
      run: async (state, context) => {
        context.checkAbort(`flow-node-${nodeName}`);
        const ai = dynamicContext?.ai ?? context.mainAi;
        const options = {
          ...(context.mainOptions ?? {}),
          ...(dynamicContext?.options ?? {}),
        } as AxProgramForwardOptions<string>;
        const nodeInputs = mapping(state as TState);
        const result = await executeNodeProgram({
          nodeName,
          nodeProgram,
          ai,
          inputs: nodeInputs as AxFlowState,
          options,
          recorder: this,
        });
        return {
          ...state,
          [`${nodeName}Result`]: result,
        };
      },
    });
  }

  public execute<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (_state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    this.addStep(this.createExecuteStep(nodeName, mapping, dynamicContext));
    return this as AxFlow<
      IN,
      OUT,
      TNodes,
      AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
    >;
  }

  public e<
    TNodeName extends keyof TNodes & string,
    TAI extends Readonly<AxAIService>,
  >(
    nodeName: TNodeName,
    mapping: (_state: TState) => GetGenIn<TNodes[TNodeName]>,
    dynamicContext?: AxFlowDynamicContext<TAI>
  ): AxFlow<
    IN,
    OUT,
    TNodes,
    AddNodeResult<TState, TNodeName, GetGenOut<TNodes[TNodeName]>>
  > {
    return this.execute(nodeName, mapping, dynamicContext);
  }

  public applyOptimization(optimizedProgram: AxOptimizedProgram<any>): void {
    if (this.program && 'applyOptimization' in this.program) {
      (this.program as any).applyOptimization(optimizedProgram);
    }
    for (const node of this.nodeGenerators.values()) {
      if (typeof (node as any).applyOptimization === 'function') {
        (node as any).applyOptimization(optimizedProgram);
      }
    }
  }

  public getOptimizableComponents(): readonly AxOptimizableComponent[] {
    const out: AxOptimizableComponent[] = [];
    if (
      this.program &&
      typeof (this.program as any).getOptimizableComponents === 'function'
    ) {
      out.push(...(this.program as any).getOptimizableComponents());
    }
    for (const node of this.nodeGenerators.values()) {
      if (typeof (node as any).getOptimizableComponents === 'function') {
        out.push(...(node as any).getOptimizableComponents());
      }
    }
    return out;
  }

  public applyOptimizedComponents(
    updates: Readonly<Record<string, string>>
  ): void {
    if (
      this.program &&
      typeof (this.program as any).applyOptimizedComponents === 'function'
    ) {
      (this.program as any).applyOptimizedComponents(updates);
    }
    for (const node of this.nodeGenerators.values()) {
      if (typeof (node as any).applyOptimizedComponents === 'function') {
        (node as any).applyOptimizedComponents(updates);
      }
    }
  }

  public branch(predicate: (_state: TState) => unknown): this {
    if (this.branchContext) {
      throw new Error('Nested branches are not supported');
    }
    this.branchContext = {
      predicate: (state) => predicate(state as TState),
      sourcePredicate: predicate as (state: AxFlowState) => unknown,
      parentSteps: this.currentSteps,
      branches: new Map(),
    };
    return this;
  }

  public b(predicate: (_state: TState) => unknown): this {
    return this.branch(predicate);
  }

  public when(value: unknown): this {
    if (!this.branchContext) {
      throw new Error('when() called without matching branch()');
    }
    const branchSteps: AxFlowStep[] = [];
    this.branchContext.currentBranchValue = value;
    this.branchContext.branches.set(value, branchSteps);
    this.currentSteps = branchSteps;
    return this;
  }

  public w(value: unknown): this {
    return this.when(value);
  }

  public merge<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    if (!this.branchContext) {
      throw new Error('merge() called without matching branch()');
    }
    const branchContext = this.branchContext;
    this.branchContext = null;
    this.currentSteps = branchContext.parentSteps;
    this.addStep(
      createFlowStep({
        kind: 'branch',
        isBarrier: true,
        meta: {
          kind: 'branch',
          predicate: branchContext.sourcePredicate,
          branches: [...branchContext.branches.entries()].map(
            ([value, steps]) => [value, steps] as const
          ),
        },
        run: async (state, context) => {
          const branchValue = branchContext.predicate(state);
          const branchSteps = branchContext.branches.get(branchValue);
          this.flowLogger?.({
            name: 'BranchEvaluation',
            timestamp: Date.now(),
            branchValue,
            hasMatchingBranch: !!branchSteps,
            branchStepsCount: branchSteps?.length ?? 0,
          } as any);
          if (!branchSteps) return state;
          return await context.executeSteps(branchSteps, state);
        },
      })
    );
    return this as unknown as AxFlow<IN, OUT, TNodes, TMergedState>;
  }

  public mg<TMergedState extends AxFlowState = TState>(): AxFlow<
    IN,
    OUT,
    TNodes,
    TMergedState
  > {
    return this.merge<TMergedState>();
  }

  public parallel(branches: AxFlowTypedParallelBranch<TNodes, TState>[]): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (..._results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>;
  } {
    this.addStep(
      createFlowStep({
        kind: 'parallel',
        isBarrier: true,
        writes: ['_parallelResults'],
        meta: {
          kind: 'parallel',
          branchFns: branches as ReadonlyArray<
            (subContext: unknown) => unknown
          >,
        },
        run: async (state, context) => {
          const branchAbort = new AbortController();
          const taskSnapshot = context.captureRemoteTasks?.();
          const branchContext: AxFlowExecutionContext = {
            ...context,
            mainOptions: {
              ...context.mainOptions,
              abortSignal: mergeAbortSignals(
                context.mainOptions?.abortSignal,
                branchAbort.signal
              ),
            },
          };
          let results: AxFlowState[];
          try {
            results = await processBatches(
              branches,
              async (branchFn) => {
                const subContext = new AxFlowSubContextImpl<TNodes, TState>(
                  this.createExecuteStep.bind(this) as any
                );
                const populatedSubContext = branchFn(
                  subContext as AxFlowTypedSubContext<TNodes, TState>
                );
                return await populatedSubContext.executeSteps(state as TState, {
                  ...branchContext,
                  executeSteps: branchContext.executeSteps as any,
                });
              },
              this.autoParallelConfig.batchSize
            );
          } catch (error) {
            branchAbort.abort(error);
            if (taskSnapshot !== undefined) {
              await context.cancelRemoteTasksSince?.(taskSnapshot);
            }
            throw error;
          }
          return {
            ...state,
            _parallelResults: results,
          };
        },
      })
    );

    return {
      merge: <T, TResultKey extends string>(
        resultKey: TResultKey,
        mergeFunction: (...results: unknown[]) => T
      ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }> => {
        this.addStep(
          createFlowStep({
            kind: 'parallelMerge',
            isBarrier: true,
            reads: ['_parallelResults'],
            writes: [resultKey],
            meta: { kind: 'parallelMerge', resultKey },
            run: (state) => {
              const results = state._parallelResults;
              if (!Array.isArray(results)) {
                throw new Error('No parallel results found for merge');
              }
              const newState = { ...state };
              delete newState._parallelResults;
              newState[resultKey] = mergeFunction(...results);
              return newState;
            },
          })
        );
        return this as AxFlow<
          IN,
          OUT,
          TNodes,
          TState & { [K in TResultKey]: T }
        >;
      },
    };
  }

  public p(branches: AxFlowTypedParallelBranch<TNodes, TState>[]): {
    merge<T, TResultKey extends string>(
      resultKey: TResultKey,
      mergeFunction: (..._results: unknown[]) => T
    ): AxFlow<IN, OUT, TNodes, TState & { [K in TResultKey]: T }>;
  } {
    return this.parallel(branches);
  }

  public feedback(
    condition: (_state: TState) => boolean,
    targetLabel: string,
    maxIterations = 10
  ): this {
    const label = this.stepLabels.get(targetLabel);
    if (!label) {
      throw new Error(
        `Label '${targetLabel}' not found. Make sure to define it with .label() before the feedback point.`
      );
    }
    if (label.steps !== this.currentSteps) {
      throw new Error(
        `Label '${targetLabel}' belongs to a different flow block`
      );
    }

    const bodySteps = this.currentSteps.slice(label.index);
    this.addStep(
      createFlowStep({
        kind: 'feedback',
        isBarrier: true,
        meta: {
          kind: 'feedback',
          bodySteps,
          targetLabel,
          condition: condition as (state: AxFlowState) => boolean,
          maxIterations,
        },
        run: async (state, context) => {
          let currentState = state;
          let iterations = 1;
          const iterationKey = `_feedback_${targetLabel}_iterations`;
          if (typeof currentState[iterationKey] !== 'number') {
            currentState = { ...currentState, [iterationKey]: 1 };
          }
          while (
            condition(currentState as TState) &&
            iterations < maxIterations
          ) {
            context.checkAbort(`flow-feedback-${targetLabel}`);
            iterations++;
            currentState = { ...currentState, [iterationKey]: iterations };
            currentState = await context.executeSteps(bodySteps, currentState);
          }
          return currentState;
        },
      })
    );
    return this;
  }

  public fb(
    condition: (_state: TState) => boolean,
    targetLabel: string,
    maxIterations = 10
  ): this {
    return this.feedback(condition, targetLabel, maxIterations);
  }

  public while(
    condition: (state: TState) => boolean,
    maxIterations = 100
  ): this {
    const bodySteps: AxFlowStep[] = [];
    this.loopStack.push({
      parentSteps: this.currentSteps,
      bodySteps,
      condition,
      maxIterations,
    });
    this.currentSteps = bodySteps;
    return this;
  }

  public wh(condition: (_state: TState) => boolean, maxIterations = 100): this {
    return this.while(condition, maxIterations);
  }

  public endWhile(): this {
    const loop = this.loopStack.pop();
    if (!loop) {
      throw new Error('endWhile() called without matching while()');
    }
    this.currentSteps = loop.parentSteps;
    this.addStep(
      createFlowStep({
        kind: 'while',
        isBarrier: true,
        meta: {
          kind: 'while',
          bodySteps: loop.bodySteps,
          condition: loop.condition as (state: AxFlowState) => boolean,
          maxIterations: loop.maxIterations,
        },
        run: async (state, context) => {
          let currentState = state;
          let iterations = 0;
          while (
            loop.condition(currentState as TState) &&
            iterations < loop.maxIterations
          ) {
            context.checkAbort('flow-while');
            iterations++;
            currentState = await context.executeSteps(
              loop.bodySteps,
              currentState
            );
          }
          if (
            iterations >= loop.maxIterations &&
            loop.condition(currentState as TState)
          ) {
            throw new Error(
              `While loop exceeded maximum iterations (${loop.maxIterations}). Consider increasing maxIterations or ensuring the loop condition eventually becomes false.`
            );
          }
          return currentState;
        },
      })
    );
    return this;
  }

  public end(): this {
    return this.endWhile();
  }

  public derive<T>(
    outputFieldName: string,
    inputFieldName: string,
    transformFn: (value: any, index?: number, state?: TState) => T,
    options?: { batchSize?: number }
  ): this {
    this.addStep(
      createFlowStep({
        kind: 'derive',
        reads: [inputFieldName],
        writes: [outputFieldName],
        run: async (state, context) => {
          const inputValue = state[inputFieldName];
          if (inputValue === undefined) {
            throw new Error(
              `Input field '${inputFieldName}' not found in state`
            );
          }
          const batchSize = options?.batchSize || context.batchSize;
          const result = Array.isArray(inputValue)
            ? context.autoParallel
              ? await processBatches(
                  inputValue,
                  async (item, index) =>
                    transformFn(item, index, state as TState),
                  batchSize
                )
              : inputValue.map((item, index) =>
                  transformFn(item, index, state as TState)
                )
            : transformFn(inputValue, undefined, state as TState);
          return {
            ...state,
            [outputFieldName]: result,
          };
        },
      })
    );
    return this;
  }

  public getExecutionPlan(): {
    totalSteps: number;
    parallelGroups: number;
    maxParallelism: number;
    autoParallelEnabled: boolean;
    steps?: AxFlowExecutionPlanStep[];
    groups?: AxFlowExecutionPlanGroup[];
  } {
    const plan = new AxFlowExecutionPlanner(this.steps).getExecutionPlan();
    return {
      ...plan,
      autoParallelEnabled: this.autoParallelConfig.enabled,
    };
  }

  /**
   * Renders this flow as a mermaid flowchart in the AxFlow mermaid dialect:
   * node contracts are emitted as `%%ax nodeId: <signature>` comment
   * directives (invisible to mermaid renderers) and control flow becomes
   * nodes and edges — branch decisions render as diamonds with labeled
   * out-edges, feedback loops as back-edges with `max N` caps.
   *
   * Flows built from `flow.fromMermaid()` round-trip exactly. Flows built
   * with opaque closures (map/derive/returns/custom conditions) render with
   * placeholder nodes plus `%% bind ...` comments naming what must be
   * supplied via bindings to re-import the diagram. A `while` loop renders
   * with its body inlined once and a back-edge (the zero-iteration exit is
   * not drawable).
   */
  public toMermaid(options?: AxFlowMermaidRenderOptions): string {
    return renderFlowMermaid({
      steps: this.steps,
      nodePrograms: this.nodeGenerators,
      materializeParallelBranch: (branchFn) => {
        const subContext = new AxFlowSubContextImpl<TNodes, TState>(
          this.createExecuteStep.bind(this) as any
        );
        (branchFn as (sub: unknown) => unknown)(subContext);
        return subContext.getSteps();
      },
      options,
    });
  }

  public getSignature(): AxSignature {
    this.ensureProgram();
    return this.program!.getSignature();
  }

  public nodeExtended<TName extends string>(
    name: TName,
    baseSignature: string | AxSignature,
    extensions: {
      prependInputs?: Array<{ name: string; type: AxFieldType }>;
      appendInputs?: Array<{ name: string; type: AxFieldType }>;
      prependOutputs?: Array<{ name: string; type: AxFieldType }>;
      appendOutputs?: Array<{ name: string; type: AxFieldType }>;
    }
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  > {
    const sig =
      typeof baseSignature === 'string'
        ? AxSignature.create(baseSignature)
        : baseSignature;
    let extendedSig = sig;
    for (const input of extensions.prependInputs ?? []) {
      extendedSig = extendedSig.prependInputField(input.name, input.type);
    }
    for (const input of extensions.appendInputs ?? []) {
      extendedSig = extendedSig.appendInputField(input.name, input.type);
    }
    for (const output of extensions.prependOutputs ?? []) {
      extendedSig = extendedSig.prependOutputField(output.name, output.type);
    }
    for (const output of extensions.appendOutputs ?? []) {
      extendedSig = extendedSig.appendOutputField(output.name, output.type);
    }
    return this.node(name, extendedSig);
  }

  public nx<TName extends string>(
    name: TName,
    baseSignature: string | AxSignature,
    extensions: {
      prependInputs?: Array<{ name: string; type: AxFieldType }>;
      appendInputs?: Array<{ name: string; type: AxFieldType }>;
      prependOutputs?: Array<{ name: string; type: AxFieldType }>;
      appendOutputs?: Array<{ name: string; type: AxFieldType }>;
    }
  ): AxFlow<
    IN,
    OUT,
    TNodes & { [K in TName]: AxGen<AxGenIn, AxGenOut> },
    TState
  > {
    return this.nodeExtended(name, baseSignature, extensions);
  }
}

export function flow<
  TInput extends Record<string, any> = Record<string, unknown>,
  TOutput = {},
>(options?: AxFlowOptions): AxFlow<TInput, TOutput, {}, TInput> {
  return AxFlow.create<TInput, TOutput, {}, TInput>(options);
}
