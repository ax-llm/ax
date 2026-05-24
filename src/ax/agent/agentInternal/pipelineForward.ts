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
import type { AxAgentClarification } from './agentStateTypes.js';
import { AxAgentClarificationError } from './agentStateTypes.js';
import { transcribeAgentAudioInputs } from './audioInputs.js';
import type { AxAgent } from './coordinator.js';
import { mergeUsedMemoryResults } from './memoriesHelpers.js';
import type {
  AxAgentUsedMemoriesCallback,
  AxAgentUsedMemory,
} from './memoriesTypes.js';
import { mergeUsedSkillResults } from './skillsHelpers.js';
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
 * After the distiller runs, build the input record for the executor.
 * Merges non-context input values with the explorer's `(executorRequest,
 * distilledContext)` payload, drops `executorExcludeFields`, and preserves the
 * original non-context values so the responder can later restore actor-excluded
 * fields it still wants to see.
 */
function buildExecutorInputsFromDistiller(p: any, state: any) {
  const distillerRun = state.distillerResult;
  throwOnClarification(distillerRun.executorResult, p.distiller);
  const { nonCtxValues } = splitValuesByContext(
    state.agentValues,
    p.contextFieldNames
  );
  const distillerArgs = distillerRun.executorResult?.args ?? [];
  const executorRequest =
    distillerArgs[0] ?? defaultExecutorRequest(nonCtxValues);
  const rawExecutorInputs: Record<string, unknown> = {
    ...nonCtxValues,
    ...(distillerRun.nonContextValues as Record<string, unknown>),
    executorRequest,
    distilledContext: distillerArgs[1],
  };
  const executorExclude: Set<string> = p.executorExcludeFields;
  for (const key of executorExclude) delete rawExecutorInputs[key];
  return {
    ...state,
    executorInputs: rawExecutorInputs,
    originalNonCtxValues: nonCtxValues,
  };
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
    distilledContext: _ignoreC,
    memories: _ignoreM,
    ...nonCtxFromExecutor
  } = executorRun.nonContextValues as Record<string, unknown>;
  const originalNonCtxValues = state.originalNonCtxValues as Record<
    string,
    unknown
  >;
  const nonCtxForResponder: Record<string, unknown> = { ...nonCtxFromExecutor };
  const executorExclude: Set<string> = p.executorExcludeFields;
  for (const key of executorExclude) {
    if (key in originalNonCtxValues) {
      nonCtxForResponder[key] = originalNonCtxValues[key];
    }
  }
  const responderExclude: Set<string> = p.responderExcludeFields;
  for (const key of responderExclude) delete nonCtxForResponder[key];
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
  const agentValues = await transcribeAgentAudioInputs(
    p.distillerAi ?? ai,
    p.fullSignature ?? pipeline.getSignature(),
    values,
    options as any
  );
  if (typeof p._syncContextMapPrompt === 'function') {
    p._syncContextMapPrompt();
  }
  return (await p.pipelineFlow.forward(
    ai,
    { agentValues, ai, forwardOptions: options },
    options
  )) as OUT;
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
  const valuesForStages = await transcribeAgentAudioInputs(
    p.distillerAi ?? ai,
    p.fullSignature ?? pipeline.getSignature(),
    values,
    options as any
  );
  const contextFieldNames: Set<string> = p.contextFieldNames;
  // The explorer receives the full input so it can normalize the request while
  // treating declared contextFields as runtime-only context. The task stage
  // receives only non-context inputs plus executorRequest/distilledContext.
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

  const distillerRun = await p.distiller.run(
    distillerAi,
    valuesForStages,
    options
  );
  throwOnClarification(distillerRun.executorResult, p.distiller);

  const distillerArgs = (distillerRun.executorResult as any)?.args ?? [];
  const executorRequest =
    distillerArgs[0] ?? defaultExecutorRequest(nonCtxValues);
  const executorInputs: Record<string, unknown> = {
    ...nonCtxValues,
    ...(distillerRun.nonContextValues as Record<string, unknown>),
    executorRequest,
    distilledContext: distillerArgs[1],
  };
  const executorExclude: Set<string> = p.executorExcludeFields;
  for (const key of executorExclude) delete executorInputs[key];
  const executorRun = await p.executor.run(executorAi, executorInputs, options);
  throwOnClarification(executorRun.executorResult, p.executor);
  const usedMemories = mergeUsedMemoryResults(
    distillerRun.usedMemories,
    executorRun.usedMemories ?? []
  );
  const usedSkills = mergeUsedSkillResults(
    distillerRun.usedSkills,
    executorRun.usedSkills ?? []
  );
  notifyUsedMemories(p, options, usedMemories);
  notifyUsedSkills(p, options, usedSkills);
  const {
    executorRequest: _ignoreT,
    distilledContext: _ignoreC,
    memories: _ignoreM,
    ...nonCtxFromExecutor
  } = executorRun.nonContextValues as Record<string, unknown>;
  const nonCtxForResponder: Record<string, unknown> = { ...nonCtxFromExecutor };
  for (const key of executorExclude) {
    if (key in (nonCtxValues as Record<string, unknown>)) {
      nonCtxForResponder[key] = (nonCtxValues as Record<string, unknown>)[key];
    }
  }
  const responderExclude: Set<string> = p.responderExcludeFields;
  for (const key of responderExclude) delete nonCtxForResponder[key];
  yield* p.responder.streamingForward(responderAi, {
    nonContextValues: nonCtxForResponder,
    executorResult: executorRun.executorResult,
    options,
  });
  if (typeof p._updateContextMapFromPipelineState === 'function') {
    await p._updateContextMapFromPipelineState(ai, {
      agentValues: valuesForStages,
      executorInputs,
      distillerResult: distillerRun,
      executorResult: executorRun,
    });
  }
}
