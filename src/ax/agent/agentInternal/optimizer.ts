import type { AxAIService } from '../../ai/types.js';
import type { AxMetricFn, AxTypedExample } from '../../dsp/common_types.js';
import { AxGen } from '../../dsp/generate.js';
import type { AxOptimizedProgram } from '../../dsp/optimizer.js';
import { AxGEPA } from '../../dsp/optimizers/gepa.js';
import type {
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxProgramTrace,
} from '../../dsp/types.js';
import {
  AX_AGENT_OPTIMIZE_JUDGE_EVAL_SIGNATURE,
  AX_AGENT_OPTIMIZE_PROGRAM_SIGNATURE,
  adjustEvalScoreForActions,
  buildAgentJudgeCriteria,
  buildAgentJudgeForwardOptions,
  DEFAULT_AGENT_OPTIMIZE_MAX_METRIC_CALLS,
  mapAgentJudgeQualityToScore,
  normalizeAgentEvalDataset,
  resolveAgentOptimizeTargetIds,
  serializeForEval,
} from '../optimize.js';
import type {
  AxAgentEvalDataset,
  AxAgentEvalPrediction,
  AxAgentEvalTask,
  AxAgentJudgeEvalInput,
  AxAgentJudgeEvalOutput,
  AxAgentJudgeInput,
  AxAgentJudgeOptions,
  AxAgentJudgeOutput,
  AxAgentOptimizationTargetDescriptor,
  AxAgentOptimizeOptions,
  AxAgentOptimizeResult,
} from './types.js';

export async function optimizeAgent<IN extends AxGenIn, OUT extends AxGenOut>(
  self: any,
  dataset: Readonly<AxAgentEvalDataset<IN>>,
  options?: Readonly<AxAgentOptimizeOptions<IN, OUT>>
): Promise<AxAgentOptimizeResult<OUT>> {
  const s = self as any;
  const normalizedDataset = normalizeAgentEvalDataset(dataset);
  if (normalizedDataset.train.length === 0) {
    throw new Error(
      'AxAgent.optimize(): at least one training task is required.'
    );
  }

  const studentAI = options?.studentAI ?? s.ai;
  if (!studentAI) {
    throw new Error(
      'AxAgent.optimize(): studentAI is required when the agent has no default ai.'
    );
  }

  const resolvedJudgeAI =
    options?.judgeAI ?? s.judgeAI ?? options?.teacherAI ?? s.ai ?? studentAI;
  const mergedJudgeOptions: AxAgentJudgeOptions = {
    ...(s.judgeOptions ?? {}),
    ...(options?.judgeOptions ?? {}),
  };
  const optimizationTargets = s._listOptimizationTargetDescriptors();
  const targetIds = resolveAgentOptimizeTargetIds(
    optimizationTargets,
    options?.target ?? 'actor'
  );
  const metric =
    options?.metric ??
    s._createAgentOptimizeMetric(resolvedJudgeAI, mergedJudgeOptions);
  const optimizationProgram = s._createOptimizationProgram(
    targetIds,
    optimizationTargets
  );
  const maxMetricCalls = Math.max(
    1,
    Math.floor(
      options?.maxMetricCalls ??
        Math.max(
          DEFAULT_AGENT_OPTIMIZE_MAX_METRIC_CALLS,
          normalizedDataset.train.length * 4
        )
    )
  );

  const optimizer = new AxGEPA({
    studentAI,
    teacherAI: options?.teacherAI ?? resolvedJudgeAI,
    numTrials: options?.numTrials,
    minibatch: options?.minibatch,
    minibatchSize: options?.minibatchSize,
    earlyStoppingTrials: options?.earlyStoppingTrials,
    minImprovementThreshold: options?.minImprovementThreshold,
    sampleCount: options?.sampleCount,
    seed: options?.seed,
    verbose: options?.verbose,
    debugOptimizer: options?.debugOptimizer,
    optimizerLogger: options?.optimizerLogger,
    onProgress: options?.onProgress,
    onEarlyStop: options?.onEarlyStop,
  });

  const result = await optimizer.compile(
    optimizationProgram as AxProgrammable<
      AxAgentEvalTask<IN>,
      AxAgentEvalPrediction<OUT>
    >,
    normalizedDataset.train as readonly AxTypedExample<AxAgentEvalTask<IN>>[],
    metric,
    {
      bootstrap: options?.bootstrap,
      validationExamples: normalizedDataset.validation as
        | readonly AxTypedExample<AxAgentEvalTask<IN>>[]
        | undefined,
      maxMetricCalls,
      verbose: options?.verbose,
    }
  );

  const wrappedOptimizedProgram = result.optimizedProgram as
    | AxOptimizedProgram<OUT>
    | undefined;

  if (options?.apply !== false && wrappedOptimizedProgram) {
    s.applyOptimization(wrappedOptimizedProgram);
  }

  return result as unknown as AxAgentOptimizeResult<OUT>;
}

export function createOptimizationProgram<
  IN extends AxGenIn,
  OUT extends AxGenOut,
>(
  self: any,
  targetIds: readonly string[],
  descriptors: readonly AxAgentOptimizationTargetDescriptor[]
): AxProgrammable<AxAgentEvalTask<IN>, AxAgentEvalPrediction<OUT>> {
  const s = self as any;
  const selectedDescriptors = descriptors.filter((entry) =>
    targetIds.includes(entry.id)
  );
  const allDescriptorIds = new Set(descriptors.map((entry) => entry.id));
  const targetsAllDescriptors =
    targetIds.length === allDescriptorIds.size &&
    targetIds.every((id) => allDescriptorIds.has(id));

  return {
    getId: () => s.getId(),
    setId: (id: string) => s.setId(id),
    getSignature: () => AX_AGENT_OPTIMIZE_PROGRAM_SIGNATURE,
    forward: async (
      ai: Readonly<AxAIService>,
      task: AxAgentEvalTask<IN>,
      options?: Readonly<AxProgramForwardOptions<string>>
    ) => s._forwardForEvaluation(ai, task, options),
    streamingForward: async function* (
      ai: Readonly<AxAIService>,
      task: AxAgentEvalTask<IN>,
      options?: Readonly<
        AxProgramStreamingForwardOptionsWithModels<AxAIService>
      >
    ): AxGenStreamingOut<AxAgentEvalPrediction<OUT>> {
      yield {
        version: 1,
        index: 0,
        delta: await this.forward(
          ai,
          task,
          options as Readonly<AxProgramForwardOptions<string>> | undefined
        ),
      };
    },
    getTraces: () =>
      (targetsAllDescriptors
        ? s.getTraces()
        : s
            .getTraces()
            .filter((trace: AxProgramTrace<any, any>) =>
              targetIds.includes(trace.programId)
            )) as unknown as AxProgramTrace<
        AxAgentEvalTask<IN>,
        AxAgentEvalPrediction<OUT>
      >[],
    namedProgramInstances: () =>
      selectedDescriptors as AxNamedProgramInstance<any, any>[] | any,
    setDemos: (demos, demoOptions) =>
      s.setDemos(
        demos as unknown as readonly AxProgramDemos<IN, OUT>[],
        demoOptions
      ),
    applyOptimization: (optimizedProgram) =>
      s.applyOptimization(optimizedProgram as any),
    getOptimizableComponents: () =>
      targetsAllDescriptors && typeof s.getOptimizableComponents === 'function'
        ? s.getOptimizableComponents()
        : selectedDescriptors.flatMap((entry) => {
            const fn = (entry.program as any).getOptimizableComponents;
            return typeof fn === 'function' ? fn.call(entry.program) : [];
          }),
    applyOptimizedComponents: (updates: Readonly<Record<string, string>>) => {
      if (typeof s.applyOptimizedComponents === 'function') {
        s.applyOptimizedComponents(updates);
      }
    },
    getUsage: () => s.getUsage(),
    resetUsage: () => s.resetUsage(),
  };
}

export function createAgentOptimizeMetric<
  IN extends AxGenIn,
  OUT extends AxGenOut,
>(
  _self: any,
  judgeAI: Readonly<AxAIService>,
  judgeOptions: Readonly<AxAgentJudgeOptions>
): AxMetricFn {
  const mergedJudgeCriteria = buildAgentJudgeCriteria(judgeOptions.criteria);
  const judgeGen = new AxGen<AxAgentJudgeEvalInput, AxAgentJudgeEvalOutput>(
    AX_AGENT_OPTIMIZE_JUDGE_EVAL_SIGNATURE
  );
  const judgeDescription = judgeOptions.description?.trim();
  judgeGen.setInstruction(
    judgeDescription
      ? `${mergedJudgeCriteria}\n\nAdditional Judge Guidance:\n${judgeDescription}`
      : mergedJudgeCriteria
  );
  const judgeForwardOptions = buildAgentJudgeForwardOptions(judgeOptions);

  return async ({ example, prediction }) => {
    const task = example as AxAgentEvalTask<IN>;
    const evalPrediction = prediction as AxAgentEvalPrediction<OUT>;
    const judgeInput: AxAgentJudgeInput = {
      taskInput: serializeForEval(task.input),
      criteria: task.criteria,
      expectedOutput: task.expectedOutput,
      expectedActions: task.expectedActions,
      forbiddenActions: task.forbiddenActions,
      metadata: task.metadata,
    };
    const judgeOutput: AxAgentJudgeOutput = {
      completionType: evalPrediction.completionType,
      clarification: serializeForEval(evalPrediction.clarification),
      finalOutput: serializeForEval(evalPrediction.output),
      actionLog: evalPrediction.actionLog,
      guidanceLog: evalPrediction.guidanceLog,
      functionCalls: serializeForEval(evalPrediction.functionCalls),
      toolErrors: evalPrediction.toolErrors,
      turnCount: evalPrediction.turnCount,
      usage: serializeForEval(evalPrediction.usage ?? []),
    };
    const result = await judgeGen.forward(
      judgeAI,
      {
        ...judgeInput,
        ...judgeOutput,
      },
      judgeForwardOptions
    );
    return adjustEvalScoreForActions(
      mapAgentJudgeQualityToScore(result.quality),
      task,
      evalPrediction
    );
  };
}

/**
 * Legacy single-stage `forwardForEvaluation` is gone — `ActorAgentRLM` no
 * longer owns a responder, so it can't synthesize a prediction by itself.
 * Pipeline evaluation lives in `pipelineForwardForEvaluation.ts`. The
 * `_listOptimizationTargetDescriptors` helper and friends still live on
 * `ActorAgentRLM`; they're shared with the pipeline coordinator.
 */
export { forwardPipelineForEvaluation as forwardForEvaluation } from './pipelineForwardForEvaluation.js';
