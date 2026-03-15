/**
 * AxLearn - Self-improving agent that learns from traces and feedback.
 *
 * Combines AxGen with automatic trace logging, storage, and mode-based
 * optimization/update flows.
 */

import type { Meter } from '@opentelemetry/api';
import type { AxAIService } from '../ai/types.js';
import type {
  AxCheckpoint,
  AxLearnCheckpointMode,
  AxLearnCheckpointState,
  AxStorage,
  AxTrace,
} from '../mem/storage.js';
import { AxTraceLogger } from '../trace/logger.js';
import type { AxAssertion, AxStreamingAssertion } from './asserts.js';
import type {
  AxMetricFn,
  AxOptimizationProgress,
  AxTypedExample,
} from './common_types.js';
import type { AxGen } from './generate.js';
import { AxJudge, type AxJudgeOptions } from './judge.js';
import { AxACE } from './optimizers/ace.js';
import { renderPlaybook } from './optimizers/acePlaybook.js';
import type {
  AxACEOptimizationArtifact,
  AxACEOptions,
  AxACEPlaybook,
} from './optimizers/aceTypes.js';
import type { AxParetoResult } from './optimizer.js';
import { AxGEPA } from './optimizers/gepa.js';
import type { AxSignature } from './sig.js';
import { AxSynth, type AxSynthOptions } from './synth.js';
import type {
  AxForwardable,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramForwardOptions,
  AxProgramUsage,
  AxUsable,
} from './types.js';

const DEFAULT_MODE: AxLearnCheckpointMode = 'batch';
const DEFAULT_CONTINUOUS_OPTIONS = {
  feedbackWindowSize: 25,
  maxRecentTraces: 100,
  updateBudget: 4,
} as const;

export type AxLearnMode = AxLearnCheckpointMode;
export type AxLearnPlaybook = AxACEPlaybook;

export interface AxLearnContinuousOptions {
  feedbackWindowSize?: number;
  maxRecentTraces?: number;
  updateBudget?: number;
}

export type AxLearnPlaybookOptions = Partial<AxACEOptions>;

/**
 * Configuration for the AxLearn agent.
 */
export interface AxLearnOptions {
  /** Unique identifier/name for this agent */
  name: string;

  /** Storage backend (Required) */
  storage: AxStorage;

  /** Runtime model whose outputs should be improved */
  runtimeAI?: AxAIService;

  /** Learning mode (default: batch) */
  mode?: AxLearnMode;

  /** Whether to log traces (default: true) */
  enableTracing?: boolean;

  /** Custom metadata for all traces */
  metadata?: Record<string, unknown>;

  /** Callback when a trace is logged */
  onTrace?: (trace: AxTrace) => void;

  /** Teacher AI for synthetic data generation and judging (Required) */
  teacher: AxAIService;

  /** Maximum optimization rounds (default: 20) */
  budget?: number;

  /** Custom metric function (if not provided, auto-generates using AxJudge) */
  metric?: AxMetricFn;

  /** Judge options when auto-generating metric */
  judgeOptions?: Partial<AxJudgeOptions>;

  /** Custom evaluation criteria for judge */
  criteria?: string;

  /** Training examples (manual) */
  examples?: AxTypedExample<AxGenIn>[];

  /** Whether to use captured traces as training examples (default: true) */
  useTraces?: boolean;

  /** Whether to generate synthetic examples (default: true if no other data) */
  generateExamples?: boolean;

  /** Number of synthetic examples to generate */
  synthCount?: number;

  /** Synth options for data generation */
  synthOptions?: Partial<AxSynthOptions>;

  /** Validation split ratio (default: 0.2, clamped to keep train + validation non-empty) */
  validationSplit?: number;

  /** Mode-specific configuration for bounded continuous updates */
  continuousOptions?: AxLearnContinuousOptions;

  /** Mode-specific configuration for playbook learning */
  playbookOptions?: AxLearnPlaybookOptions;

  /** Progress callback */
  onProgress?: (progress: AxLearnProgress) => void;
}

export interface AxLearnOptimizeOptions {
  runtimeAI?: AxAIService;
  budget?: number;
  metric?: AxMetricFn;
  judgeOptions?: Partial<AxJudgeOptions>;
  criteria?: string;
  examples?: AxTypedExample<AxGenIn>[];
  useTraces?: boolean;
  generateExamples?: boolean;
  synthCount?: number;
  synthOptions?: Partial<AxSynthOptions>;
  validationSplit?: number;
  continuousOptions?: AxLearnContinuousOptions;
  playbookOptions?: AxLearnPlaybookOptions;
  onProgress?: (progress: AxLearnProgress) => void;
}

export type AxLearnUpdateFeedback = string | NonNullable<AxTrace['feedback']>;

export interface AxLearnUpdateInput<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  example: AxTypedExample<IN>;
  prediction: OUT;
  feedback?: AxLearnUpdateFeedback;
}

export interface AxLearnUpdateOptions {
  runtimeAI?: AxAIService;
  budget?: number;
  metric?: AxMetricFn;
  judgeOptions?: Partial<AxJudgeOptions>;
  criteria?: string;
  continuousOptions?: AxLearnContinuousOptions;
  playbookOptions?: AxLearnPlaybookOptions;
  onProgress?: (progress: AxLearnProgress) => void;
}

export interface AxLearnPlaybookSummary {
  feedbackEvents: number;
  historyBatches: number;
  bulletCount: number;
  updatedAt?: string;
}

export interface AxLearnArtifact {
  playbook?: AxLearnPlaybook;
  playbookSummary?: AxLearnPlaybookSummary;
  lastUpdateAt?: string;
  feedbackExamples?: number;
}

/**
 * Progress callback for monitoring optimization.
 */
export interface AxLearnProgress {
  round: number;
  totalRounds: number;
  score: number;
  improvement: number;
}

/**
 * Result from optimize/applyUpdate operations.
 */
export interface AxLearnResult<_IN extends AxGenIn, _OUT extends AxGenOut> {
  mode: AxLearnMode;
  score: number;
  improvement: number;
  checkpointVersion: number;
  stats: {
    trainingExamples: number;
    validationExamples: number;
    feedbackExamples: number;
    durationMs: number;
    mode: AxLearnMode;
  };
  state?: AxLearnCheckpointState;
  artifact?: AxLearnArtifact;
}

type AxLearnMergedConfig = {
  runtimeAI?: AxAIService;
  mode: AxLearnMode;
  teacher: AxAIService;
  budget: number;
  metric?: AxMetricFn;
  judgeOptions?: Partial<AxJudgeOptions>;
  criteria?: string;
  examples?: AxTypedExample<AxGenIn>[];
  useTraces: boolean;
  generateExamples: boolean;
  synthCount?: number;
  synthOptions?: Partial<AxSynthOptions>;
  validationSplit: number;
  continuousOptions: Required<AxLearnContinuousOptions>;
  playbookOptions?: AxLearnPlaybookOptions;
  onProgress?: (progress: AxLearnProgress) => void;
};

type AxPreparedDataset<IN extends AxGenIn> = {
  examples: AxTypedExample<IN>[];
  feedbackExamples: AxTypedExample<IN>[];
  feedbackScoredExamples: AxTypedExample<IN>[];
  feedbackTextByKey: Map<string, string>;
  feedbackNotes: string[];
};

type AxNormalizedTrace<IN extends AxGenIn> = {
  example: AxTypedExample<IN>;
  feedback?: string;
};

type AxRunStats = {
  trainingExamples: number;
  validationExamples: number;
  feedbackExamples: number;
  durationMs: number;
};

type AxPromptOptimizationResult<IN extends AxGenIn, OUT extends AxGenOut> = {
  result: AxLearnResult<IN, OUT>;
  optimizedProgram: NonNullable<AxParetoResult<OUT>['optimizedProgram']>;
};

/**
 * AxLearn wraps an AxGen with automatic trace logging and self-improvement capabilities.
 */
export class AxLearn<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxForwardable<IN, OUT, string>, AxUsable
{
  private gen: AxGen<IN, OUT>;
  private options: AxLearnOptions & {
    enableTracing: boolean;
    mode: AxLearnMode;
    continuousOptions: Required<AxLearnContinuousOptions>;
  };
  private tracer: AxTraceLogger<IN, OUT>;
  private currentScore?: number;
  private currentState?: AxLearnCheckpointState;
  private readyPromise: Promise<void>;
  private playbookOptimizer?: AxACE;

  constructor(gen: AxGen<IN, OUT>, options: AxLearnOptions) {
    this.gen = gen;
    this.options = {
      ...options,
      enableTracing: options.enableTracing ?? true,
      mode: options.mode ?? DEFAULT_MODE,
      continuousOptions: {
        feedbackWindowSize:
          options.continuousOptions?.feedbackWindowSize ??
          DEFAULT_CONTINUOUS_OPTIONS.feedbackWindowSize,
        maxRecentTraces:
          options.continuousOptions?.maxRecentTraces ??
          DEFAULT_CONTINUOUS_OPTIONS.maxRecentTraces,
        updateBudget:
          options.continuousOptions?.updateBudget ??
          DEFAULT_CONTINUOUS_OPTIONS.updateBudget,
      },
    };

    this.tracer = new AxTraceLogger(gen, {
      name: this.options.name,
      storage: this.options.storage,
      metadata: this.options.metadata,
      onTrace: this.options.onTrace,
    });

    this.readyPromise = this.loadLatestCheckpoint();
  }

  public async ready(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Forward call - behaves like AxGen.forward() but waits for restore and logs traces.
   */
  async forward(
    ai: AxAIService,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<OUT> {
    await this.ready();
    if (this.options.enableTracing) {
      return this.tracer.forward(ai, values, options);
    }
    return this.gen.forward(ai, values, options);
  }

  /**
   * Streaming forward call - behaves like AxGen.streamingForward() but waits for restore and logs traces.
   */
  async *streamingForward(
    ai: AxAIService,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions<string>>
  ): AxGenStreamingOut<OUT> {
    await this.ready();
    if (this.options.enableTracing) {
      yield* this.tracer.streamingForward(ai, values, options);
    } else {
      yield* this.gen.streamingForward(ai, values, options);
    }
  }

  getUsage(): AxProgramUsage[] {
    return this.gen.getUsage();
  }

  resetUsage(): void {
    this.gen.resetUsage();
  }

  getSignature(): AxSignature {
    return this.gen.getSignature();
  }

  setInstruction(instruction: string): void {
    this.gen.setInstruction(instruction);
  }

  getInstruction(): string | undefined {
    if (
      this.currentState?.mode === 'playbook' ||
      this.options.mode === 'playbook'
    ) {
      return (
        this.currentState?.instruction ??
        this.gen.getSignature().getDescription() ??
        this.gen.getInstruction()
      );
    }

    return this.gen.getInstruction();
  }

  updateMeter(meter?: Meter): void {
    this.gen.updateMeter(meter);
  }

  addAssert(fn: AxAssertion<OUT>['fn'], message?: string): void {
    this.gen.addAssert(fn, message);
  }

  addStreamingAssert(
    fieldName: keyof OUT,
    fn: AxStreamingAssertion['fn'],
    message?: string
  ): void {
    this.gen.addStreamingAssert(fieldName, fn, message);
  }

  addFieldProcessor(
    fieldName: keyof OUT,
    fn: (
      value: OUT[keyof OUT],
      context?: { values?: OUT; sessionId?: string; done?: boolean }
    ) => unknown | Promise<unknown>
  ): void {
    this.gen.addFieldProcessor(fieldName, fn);
  }

  addStreamingFieldProcessor(
    fieldName: keyof OUT,
    fn: (
      value: string,
      context?: { values?: OUT; sessionId?: string; done?: boolean }
    ) => unknown | Promise<unknown>
  ): void {
    this.gen.addStreamingFieldProcessor(fieldName, fn);
  }

  clone(): AxLearn<IN, OUT> {
    return new AxLearn(this.gen.clone(), this.options);
  }

  /**
   * Run the configured learning flow for the current mode.
   */
  async optimize(
    overrides: AxLearnOptimizeOptions = {}
  ): Promise<AxLearnResult<IN, OUT>> {
    await this.ready();
    const config = this.mergeConfig(overrides);

    if (config.mode === 'playbook') {
      return this.optimizePlaybook(config);
    }

    return (
      await this.runPromptOptimization(
        config as AxLearnMergedConfig & { mode: 'batch' | 'continuous' }
      )
    ).result;
  }

  /**
   * Apply a bounded online update for continuous/playbook modes.
   */
  async applyUpdate(
    input: Readonly<AxLearnUpdateInput<IN, OUT>>,
    overrides: AxLearnUpdateOptions = {}
  ): Promise<AxLearnResult<IN, OUT>> {
    await this.ready();
    const mergedConfig = this.mergeConfig(overrides);
    const config =
      mergedConfig.mode === 'continuous'
        ? {
            ...mergedConfig,
            budget:
              overrides.budget ?? mergedConfig.continuousOptions.updateBudget,
          }
        : mergedConfig;

    if (config.mode === 'batch') {
      throw new Error(
        'AxLearn: applyUpdate() is only available in continuous or playbook modes'
      );
    }

    if (config.mode === 'playbook') {
      return this.applyPlaybookUpdate(config, input);
    }

    return (
      await this.runPromptOptimization(
        config as AxLearnMergedConfig & { mode: 'batch' | 'continuous' },
        input
      )
    ).result;
  }

  /**
   * Get the underlying AxGen instance.
   */
  getGen(): AxGen<IN, OUT> {
    return this.gen;
  }

  /**
   * Get the storage backend.
   */
  getStorage(): AxStorage {
    return this.options.storage;
  }

  /**
   * Get recent traces for this agent.
   */
  async getTraces(options?: {
    limit?: number;
    since?: Date;
  }): Promise<AxTrace[]> {
    await this.ready();
    return this.options.storage.load(this.options.name, {
      type: 'trace',
      ...options,
    }) as Promise<AxTrace[]>;
  }

  /**
   * Add feedback to a specific trace.
   */
  async addFeedback(
    traceId: string,
    feedback: NonNullable<AxTrace['feedback']>
  ): Promise<void> {
    await this.ready();
    const traces = (await this.options.storage.load(this.options.name, {
      type: 'trace',
    })) as AxTrace[];
    const trace = traces.find((item) => item.id === traceId);

    if (trace) {
      trace.feedback = { ...trace.feedback, ...feedback };
      await this.options.storage.save(this.options.name, trace);
    }
  }

  protected createPromptOptimizer(
    config: Readonly<AxLearnMergedConfig>,
    baselineScore: number
  ): AxGEPA {
    return new AxGEPA({
      studentAI: this.requireRuntimeAI(config.runtimeAI),
      teacherAI: config.teacher,
      numTrials: config.budget,
      minibatch: true,
      minibatchSize: 10,
      onProgress: this.createOptimizerProgressHandler(
        baselineScore,
        config.onProgress
      ),
    });
  }

  protected createPlaybookOptimizer(
    config: Readonly<AxLearnMergedConfig>,
    baselineScore: number
  ): AxACE {
    return new AxACE(
      {
        studentAI: this.requireRuntimeAI(config.runtimeAI),
        teacherAI: config.teacher,
        onProgress: this.createOptimizerProgressHandler(
          baselineScore,
          config.onProgress
        ),
      },
      config.playbookOptions
    );
  }

  private mergeConfig(
    overrides: Partial<AxLearnOptimizeOptions & AxLearnUpdateOptions>
  ): AxLearnMergedConfig {
    return {
      runtimeAI: overrides.runtimeAI ?? this.options.runtimeAI,
      mode: this.options.mode,
      teacher: this.options.teacher,
      budget: overrides.budget ?? this.options.budget ?? 20,
      metric: overrides.metric ?? this.options.metric,
      judgeOptions: overrides.judgeOptions ?? this.options.judgeOptions,
      criteria: overrides.criteria ?? this.options.criteria,
      examples: overrides.examples ?? this.options.examples,
      useTraces: overrides.useTraces ?? this.options.useTraces ?? true,
      generateExamples:
        overrides.generateExamples ?? this.options.generateExamples ?? false,
      synthCount: overrides.synthCount ?? this.options.synthCount,
      synthOptions: overrides.synthOptions ?? this.options.synthOptions,
      validationSplit:
        overrides.validationSplit ?? this.options.validationSplit ?? 0.2,
      continuousOptions: {
        feedbackWindowSize:
          overrides.continuousOptions?.feedbackWindowSize ??
          this.options.continuousOptions.feedbackWindowSize,
        maxRecentTraces:
          overrides.continuousOptions?.maxRecentTraces ??
          this.options.continuousOptions.maxRecentTraces,
        updateBudget:
          overrides.continuousOptions?.updateBudget ??
          this.options.continuousOptions.updateBudget,
      },
      playbookOptions:
        overrides.playbookOptions ?? this.options.playbookOptions,
      onProgress: overrides.onProgress ?? this.options.onProgress,
    };
  }

  private requireRuntimeAI(ai?: AxAIService): AxAIService {
    if (ai) {
      return ai;
    }
    throw new Error(
      'AxLearn: runtimeAI is required for optimize()/applyUpdate(). Provide it in the constructor or per-call overrides.'
    );
  }

  private createOptimizerProgressHandler(
    baselineScore: number,
    onProgress?: (progress: AxLearnProgress) => void
  ): ((progress: Readonly<AxOptimizationProgress>) => void) | undefined {
    if (!onProgress) {
      return undefined;
    }

    return (progress) => {
      onProgress({
        round: progress.round,
        totalRounds: progress.totalRounds,
        score: progress.bestScore,
        improvement: progress.bestScore - baselineScore,
      });
    };
  }

  private async resolveMetric(
    config: Readonly<AxLearnMergedConfig>
  ): Promise<AxMetricFn> {
    if (config.metric) {
      return config.metric;
    }

    const judgeOptions: AxJudgeOptions = {
      ai: config.teacher,
      criteria: config.criteria,
      ...config.judgeOptions,
    };

    const judge = new AxJudge(this.gen.getSignature(), judgeOptions);
    return judge.toMetricFn();
  }

  private async runPromptOptimization(
    config: Readonly<AxLearnMergedConfig & { mode: 'batch' | 'continuous' }>,
    updateInput?: Readonly<AxLearnUpdateInput<IN, OUT>>
  ): Promise<AxPromptOptimizationResult<IN, OUT>> {
    const startTime = Date.now();
    const baselineScore = this.currentScore ?? 0;
    const budget = config.budget;

    const metric = await this.resolveMetric(config);
    const dataset = await this.prepareDataset(config, updateInput);
    if (dataset.examples.length < 2) {
      throw new Error(
        'AxLearn: at least 2 usable examples are required after filtering traces/examples.'
      );
    }

    if (
      updateInput !== undefined &&
      config.mode === 'continuous' &&
      dataset.feedbackExamples.length === 0
    ) {
      throw new Error(
        'AxLearn: continuous updates require explicit feedback or stored feedback-bearing traces.'
      );
    }

    const { trainingExamples, validationExamples } = this.splitExamples(
      dataset.examples,
      dataset.feedbackScoredExamples,
      config.validationSplit,
      config.mode
    );

    const optimizer = this.createPromptOptimizer(
      { ...config, budget },
      baselineScore
    );
    const result = (await optimizer.compile(
      this.gen,
      trainingExamples as AxTypedExample<IN>[],
      metric,
      {
        validationExamples,
        feedbackExamples:
          dataset.feedbackExamples.length > 0
            ? dataset.feedbackExamples
            : undefined,
        feedbackFn:
          dataset.feedbackTextByKey.size > 0
            ? ({ example }: Readonly<{ prediction: unknown; example: any }>) =>
                dataset.feedbackTextByKey.get(
                  this.exampleKey(example as Record<string, unknown>)
                )
            : undefined,
        feedbackNotes:
          dataset.feedbackNotes.length > 0 ? dataset.feedbackNotes : undefined,
        maxMetricCalls: this.computeMetricBudget(
          budget,
          validationExamples.length
        ),
      } as any
    )) as AxParetoResult<OUT>;

    if (!result.optimizedProgram) {
      throw new Error('AxLearn: prompt optimization failed with no result');
    }

    (this.gen as any).applyOptimization?.(result.optimizedProgram);
    this.currentScore = result.optimizedProgram.bestScore;
    this.tracer = this.tracer.clone(this.gen);

    const state = this.createPromptState(
      config.mode,
      this.currentScore,
      dataset.feedbackExamples.length
    );
    const artifact: AxLearnArtifact = {
      feedbackExamples: dataset.feedbackExamples.length,
      lastUpdateAt: state.continuous?.lastUpdateAt,
    };

    const stats: AxRunStats = {
      trainingExamples: trainingExamples.length,
      validationExamples: validationExamples.length,
      feedbackExamples: dataset.feedbackExamples.length,
      durationMs: Date.now() - startTime,
    };

    const checkpointVersion = await this.saveCheckpoint({
      mode: config.mode,
      score: this.currentScore,
      state,
      stats,
      budget,
    });

    const learnResult: AxLearnResult<IN, OUT> = {
      mode: config.mode,
      score: this.currentScore,
      improvement: this.currentScore - baselineScore,
      checkpointVersion,
      stats: {
        ...stats,
        mode: config.mode,
      },
      state,
      artifact,
    };

    return {
      result: learnResult,
      optimizedProgram: result.optimizedProgram,
    };
  }

  private async optimizePlaybook(
    config: Readonly<AxLearnMergedConfig>
  ): Promise<AxLearnResult<IN, OUT>> {
    const startTime = Date.now();
    this.requireRuntimeAI(config.runtimeAI);
    const baselineScore = this.currentScore ?? 0;
    const metric = await this.resolveMetric(config);
    const dataset = await this.prepareDataset(config);

    if (dataset.examples.length < 2) {
      throw new Error(
        'AxLearn: at least 2 usable examples are required for playbook mode.'
      );
    }

    const { trainingExamples, validationExamples } = this.splitExamples(
      dataset.examples,
      dataset.feedbackExamples,
      config.validationSplit,
      config.mode
    );

    const optimizer = this.createPlaybookOptimizer(config, baselineScore);
    const result = await optimizer.compile(
      this.gen,
      trainingExamples as AxTypedExample<IN>[],
      metric,
      {
        aceOptions: config.playbookOptions,
      } as any
    );

    result.optimizedProgram?.applyTo(this.gen);
    this.playbookOptimizer = optimizer;
    this.currentScore = result.bestScore;
    this.tracer = this.tracer.clone(this.gen);

    const playbook = result.playbook;
    const artifact = result.artifact;
    const playbookSummary = this.summarizePlaybookArtifact(artifact);
    const state = this.createPlaybookState(
      playbook,
      playbookSummary,
      optimizer.getBaseInstruction()
    );

    const stats: AxRunStats = {
      trainingExamples: trainingExamples.length,
      validationExamples: validationExamples.length,
      feedbackExamples: dataset.feedbackExamples.length,
      durationMs: Date.now() - startTime,
    };

    const checkpointVersion = await this.saveCheckpoint({
      mode: 'playbook',
      score: this.currentScore,
      state,
      stats,
      budget: config.budget,
    });

    return {
      mode: 'playbook',
      score: this.currentScore,
      improvement: this.currentScore - baselineScore,
      checkpointVersion,
      stats: {
        ...stats,
        mode: 'playbook',
      },
      state,
      artifact: {
        playbook,
        playbookSummary,
        feedbackExamples: dataset.feedbackExamples.length,
      },
    };
  }

  private async applyPlaybookUpdate(
    config: Readonly<AxLearnMergedConfig>,
    input: Readonly<AxLearnUpdateInput<IN, OUT>>
  ): Promise<AxLearnResult<IN, OUT>> {
    const startTime = Date.now();
    this.requireRuntimeAI(config.runtimeAI);
    const baselineScore = this.currentScore ?? 0;
    const optimizer = this.getOrCreatePlaybookOptimizer(config, baselineScore);

    await optimizer.applyOnlineUpdate({
      example: input.example,
      prediction: input.prediction,
      feedback: this.feedbackToText(input.feedback),
    });

    optimizer.applyCurrentState(this.gen);
    this.tracer = this.tracer.clone(this.gen);

    const artifact = optimizer.getArtifact();
    const playbook = optimizer.getPlaybook();
    const playbookSummary = this.summarizePlaybookArtifact(artifact);
    const state = this.createPlaybookState(
      playbook,
      playbookSummary,
      optimizer.getBaseInstruction()
    );
    const score = this.currentScore ?? baselineScore;

    const stats: AxRunStats = {
      trainingExamples: 1,
      validationExamples: 1,
      feedbackExamples: 1,
      durationMs: Date.now() - startTime,
    };

    const checkpointVersion = await this.saveCheckpoint({
      mode: 'playbook',
      score,
      state,
      stats,
      budget: config.playbookOptions?.maxEpochs,
    });

    config.onProgress?.({
      round: 1,
      totalRounds: 1,
      score,
      improvement: score - baselineScore,
    });

    return {
      mode: 'playbook',
      score,
      improvement: score - baselineScore,
      checkpointVersion,
      stats: {
        ...stats,
        mode: 'playbook',
      },
      state,
      artifact: {
        playbook,
        playbookSummary,
        feedbackExamples: 1,
      },
    };
  }

  private getOrCreatePlaybookOptimizer(
    config: Readonly<AxLearnMergedConfig>,
    baselineScore: number
  ): AxACE {
    if (!this.playbookOptimizer) {
      this.playbookOptimizer = this.createPlaybookOptimizer(
        config,
        baselineScore
      );
      this.playbookOptimizer.hydrate(this.gen, {
        baseInstruction:
          this.currentState?.baseInstruction ??
          this.gen.getSignature().getDescription() ??
          undefined,
        playbook: this.currentState?.playbook as AxACEPlaybook | undefined,
      });
    }
    return this.playbookOptimizer;
  }

  private async prepareDataset(
    config: Readonly<AxLearnMergedConfig>,
    updateInput?: Readonly<AxLearnUpdateInput<IN, OUT>>
  ): Promise<AxPreparedDataset<IN>> {
    const examples: AxTypedExample<IN>[] = [];
    const feedbackExamples: AxTypedExample<IN>[] = [];
    const feedbackScoredExamples: AxTypedExample<IN>[] = [];
    const feedbackTextByKey = new Map<string, string>();
    const feedbackNotes: string[] = [];
    const seen = new Set<string>();
    const seenFeedback = new Set<string>();
    const seenFeedbackScored = new Set<string>();

    const addExample = (
      example: Record<string, unknown>,
      options?: {
        feedback?: string;
        requireOutput?: boolean;
        includeInExamples?: boolean;
        includeInFeedbackSet?: boolean;
        feedbackEligibleForScoring?: boolean;
      }
    ): AxTypedExample<IN> | undefined => {
      const normalized = this.normalizeExample(example);
      if (!normalized) {
        return undefined;
      }
      const hasInput = this.hasInputFields(normalized);
      const hasOutput = this.hasOutputFields(normalized);
      if (!hasInput) {
        return undefined;
      }
      if (options?.requireOutput && !hasOutput) {
        return undefined;
      }

      const key = this.exampleKey(normalized);
      const includeInExamples = options?.includeInExamples !== false;
      if (includeInExamples && !seen.has(key)) {
        seen.add(key);
        examples.push(normalized as AxTypedExample<IN>);
      }

      const feedback = options?.feedback?.trim();
      if (feedback) {
        const previousFeedback = feedbackTextByKey.get(key);
        if (!previousFeedback) {
          feedbackTextByKey.set(key, feedback);
        } else if (previousFeedback !== feedback) {
          feedbackTextByKey.set(key, `${previousFeedback}\n${feedback}`);
        }
        if (options?.includeInFeedbackSet !== false && !seenFeedback.has(key)) {
          feedbackExamples.push(normalized as AxTypedExample<IN>);
          seenFeedback.add(key);
        }
        if (
          options?.feedbackEligibleForScoring &&
          !seenFeedbackScored.has(key)
        ) {
          feedbackScoredExamples.push(normalized as AxTypedExample<IN>);
          seenFeedbackScored.add(key);
        }
      }

      return normalized as AxTypedExample<IN>;
    };

    for (const example of config.examples ?? []) {
      addExample(example as Record<string, unknown>);
    }

    if (config.useTraces) {
      const traces = await this.loadRelevantTraces(config);
      for (const trace of traces) {
        addExample(trace.example as Record<string, unknown>, {
          feedback: trace.feedback,
          requireOutput: true,
          feedbackEligibleForScoring: true,
        });
      }
    }

    if (updateInput) {
      const feedback = this.feedbackToText(updateInput.feedback);
      const updateExample = updateInput.example as Record<string, unknown>;
      const hasExpectedOutput = this.hasOutputFields(updateExample);
      const observedUpdateExample = this.buildObservedUpdateExample(
        updateExample,
        updateInput.prediction as Record<string, unknown>
      );
      if (feedback && observedUpdateExample) {
        addExample(observedUpdateExample, {
          feedback,
          requireOutput: true,
          includeInExamples: false,
          feedbackEligibleForScoring: false,
        });

        const note = this.formatObservedUpdateFeedback(
          updateExample,
          updateInput.prediction as Record<string, unknown>,
          feedback
        );
        if (note) {
          feedbackNotes.push(note);
        }
      }

      if (hasExpectedOutput) {
        addExample(updateExample, {
          feedback,
          feedbackEligibleForScoring: true,
        });
      }
    }

    if (config.generateExamples || examples.length === 0) {
      const synthCount = config.synthCount ?? 20;
      const synth = new AxSynth(this.gen.getSignature(), {
        teacher: config.teacher,
        ...config.synthOptions,
      });
      const synthResult = await synth.generate(synthCount);
      for (const ex of synthResult.examples) {
        addExample({
          ...ex.input,
          ...ex.expected,
        });
      }
    }

    if (config.mode === 'continuous' && feedbackScoredExamples.length > 0) {
      const ordered = [
        ...feedbackScoredExamples,
        ...examples.filter(
          (example) =>
            !feedbackScoredExamples.some(
              (feedbackExample) =>
                this.exampleKey(feedbackExample) === this.exampleKey(example)
            )
        ),
      ];
      return {
        examples: ordered,
        feedbackExamples: feedbackExamples.slice(
          0,
          config.continuousOptions.feedbackWindowSize
        ),
        feedbackScoredExamples: feedbackScoredExamples.slice(
          0,
          config.continuousOptions.feedbackWindowSize
        ),
        feedbackTextByKey,
        feedbackNotes,
      };
    }

    return {
      examples,
      feedbackExamples: feedbackExamples.slice(
        0,
        config.continuousOptions.feedbackWindowSize
      ),
      feedbackScoredExamples: feedbackScoredExamples.slice(
        0,
        config.continuousOptions.feedbackWindowSize
      ),
      feedbackTextByKey,
      feedbackNotes,
    };
  }

  private async loadRelevantTraces(
    config: Readonly<AxLearnMergedConfig>
  ): Promise<AxNormalizedTrace<IN>[]> {
    const traces = (await this.options.storage.load(this.options.name, {
      type: 'trace',
    })) as AxTrace[];

    const sortedTraces = [...traces].sort((left, right) => {
      const leftTime = new Date(left.endTime ?? left.startTime).getTime();
      const rightTime = new Date(right.endTime ?? right.startTime).getTime();
      return rightTime - leftTime;
    });

    const traceWindow =
      config.mode === 'continuous'
        ? sortedTraces.slice(0, config.continuousOptions.maxRecentTraces)
        : sortedTraces;

    const normalizedByKey = new Map<string, AxNormalizedTrace<IN>>();
    for (const trace of traceWindow) {
      if (trace.error) {
        continue;
      }
      const example = this.normalizeExample({
        ...(trace.input ?? {}),
        ...(trace.output ?? {}),
      });
      if (!example || !this.hasOutputFields(example)) {
        continue;
      }

      const key = this.exampleKey(example);
      const feedback = this.feedbackToText(trace.feedback);
      const existing = normalizedByKey.get(key);
      if (!existing) {
        normalizedByKey.set(key, {
          example: example as AxTypedExample<IN>,
          feedback,
        });
        continue;
      }

      if (!existing.feedback && feedback) {
        existing.feedback = feedback;
      }
    }

    return [...normalizedByKey.values()];
  }

  private normalizeExample(
    example: Record<string, unknown>
  ): AxTypedExample<IN> | undefined {
    const normalized: Record<string, unknown> = {};
    const signature = this.gen.getSignature();
    const fields = [
      ...signature.getInputFields(),
      ...signature.getOutputFields(),
    ];

    for (const field of fields) {
      if (field.name in example && example[field.name] !== undefined) {
        normalized[field.name] = example[field.name];
      }
    }

    if (Object.keys(normalized).length === 0) {
      return undefined;
    }

    return normalized as AxTypedExample<IN>;
  }

  private buildObservedUpdateExample(
    example: Record<string, unknown>,
    prediction: Record<string, unknown>
  ): AxTypedExample<IN> | undefined {
    return this.normalizeExample({
      ...this.pickInputFields(example),
      ...this.pickOutputFields(prediction),
    });
  }

  private pickInputFields(
    values: Record<string, unknown>
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    for (const field of this.gen.getSignature().getInputFields()) {
      if (values[field.name] !== undefined) {
        input[field.name] = values[field.name];
      }
    }
    return input;
  }

  private pickOutputFields(
    values: Record<string, unknown>
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const field of this.gen.getSignature().getOutputFields()) {
      if (values[field.name] !== undefined) {
        output[field.name] = values[field.name];
      }
    }
    return output;
  }

  private hasInputFields(example: Record<string, unknown>): boolean {
    return this.gen
      .getSignature()
      .getInputFields()
      .some((field) => example[field.name] !== undefined);
  }

  private hasOutputFields(example: Record<string, unknown>): boolean {
    return this.gen
      .getSignature()
      .getOutputFields()
      .some((field) => example[field.name] !== undefined);
  }

  private exampleKey(example: Record<string, unknown>): string {
    const signature = this.gen.getSignature();
    const fields = [
      ...signature.getInputFields(),
      ...signature.getOutputFields(),
    ].map((field) => field.name);
    const ordered = fields.reduce<Record<string, unknown>>((acc, fieldName) => {
      if (example[fieldName] !== undefined) {
        acc[fieldName] = example[fieldName];
      }
      return acc;
    }, {});

    return JSON.stringify(ordered);
  }

  private feedbackToText(feedback?: AxLearnUpdateFeedback): string | undefined {
    if (!feedback) {
      return undefined;
    }

    if (typeof feedback === 'string') {
      return feedback.trim() || undefined;
    }

    const parts: string[] = [];
    if (typeof feedback.score === 'number') {
      parts.push(`User score: ${feedback.score}.`);
    }
    if (feedback.label) {
      parts.push(`User label: ${feedback.label}.`);
    }
    if (feedback.comment) {
      parts.push(feedback.comment.trim());
    }

    const text = parts.join(' ').trim();
    return text || undefined;
  }

  private formatObservedUpdateFeedback(
    example: Record<string, unknown>,
    prediction: Record<string, unknown>,
    feedback: string
  ): string {
    const input = this.pickInputFields(example);
    const output = this.pickOutputFields(prediction);

    return [
      'Observed continuous update event.',
      `Inputs: ${JSON.stringify(input)}`,
      `Observed output: ${JSON.stringify(output)}`,
      `User feedback: ${feedback}`,
    ].join('\n');
  }

  private splitExamples(
    examples: readonly AxTypedExample<IN>[],
    feedbackExamples: readonly AxTypedExample<IN>[],
    requestedValidationSplit: number,
    mode: AxLearnMode
  ): {
    trainingExamples: AxTypedExample<IN>[];
    validationExamples: AxTypedExample<IN>[];
  } {
    const shuffled = this.shuffleExamples(examples);
    const clampedSplit = Number.isFinite(requestedValidationSplit)
      ? Math.min(Math.max(requestedValidationSplit, 0.05), 0.5)
      : 0.2;
    const validationCount = Math.min(
      shuffled.length - 1,
      Math.max(1, Math.round(shuffled.length * clampedSplit))
    );

    if (mode === 'continuous' && feedbackExamples.length > 0) {
      const feedbackKeys = new Set(
        feedbackExamples.map((example) => this.exampleKey(example))
      );
      const validationExamples: AxTypedExample<IN>[] = [];
      for (const example of shuffled) {
        if (
          !feedbackKeys.has(this.exampleKey(example)) &&
          validationExamples.length < validationCount
        ) {
          validationExamples.push(example);
        }
      }
      for (const example of shuffled) {
        if (validationExamples.length >= validationCount) {
          break;
        }
        if (
          !validationExamples.some(
            (selected) => this.exampleKey(selected) === this.exampleKey(example)
          )
        ) {
          validationExamples.push(example);
        }
      }
      const validationKeys = new Set(
        validationExamples.map((example) => this.exampleKey(example))
      );
      return {
        trainingExamples: shuffled.filter(
          (example) => !validationKeys.has(this.exampleKey(example))
        ),
        validationExamples,
      };
    }

    return {
      trainingExamples: shuffled.slice(0, shuffled.length - validationCount),
      validationExamples: shuffled.slice(shuffled.length - validationCount),
    };
  }

  private shuffleExamples<T>(examples: readonly T[]): T[] {
    const items = [...examples];
    for (let index = items.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [items[index], items[swapIndex]] = [items[swapIndex]!, items[index]!];
    }
    return items;
  }

  private computeMetricBudget(budget: number, validationSize: number): number {
    const rounds = Math.max(budget, 1);
    const validationCalls = Math.max(validationSize, 1);
    return Math.max(validationCalls * (rounds + 2), 20);
  }

  private createPromptState(
    mode: Extract<AxLearnMode, 'batch' | 'continuous'>,
    score: number,
    feedbackTraceCount: number
  ): AxLearnCheckpointState {
    const instruction = this.gen.getInstruction();
    const state: AxLearnCheckpointState = {
      mode,
      instruction,
      baseInstruction: instruction,
      score,
    };

    if (mode === 'continuous') {
      state.continuous = {
        feedbackTraceCount,
        lastUpdateAt: new Date().toISOString(),
      };
    }

    this.currentState = state;
    return state;
  }

  private createPlaybookState(
    playbook: AxLearnPlaybook,
    summary: AxLearnPlaybookSummary,
    baseInstruction?: string
  ): AxLearnCheckpointState {
    const instruction =
      this.gen.getSignature().getDescription() ?? this.gen.getInstruction();
    const state: AxLearnCheckpointState = {
      mode: 'playbook',
      instruction,
      baseInstruction:
        baseInstruction ?? this.currentState?.baseInstruction ?? instruction,
      score: this.currentScore,
      playbook: playbook as unknown as Record<string, unknown>,
      artifactSummary: summary as unknown as Record<string, unknown>,
    };

    this.currentState = state;
    return state;
  }

  private summarizePlaybookArtifact(
    artifact: AxACEOptimizationArtifact
  ): AxLearnPlaybookSummary {
    return {
      feedbackEvents: artifact.feedback.length,
      historyBatches: artifact.history.length,
      bulletCount: artifact.playbook.stats.bulletCount,
      updatedAt: artifact.playbook.updatedAt,
    };
  }

  private async saveCheckpoint(args: {
    mode: AxLearnMode;
    score: number;
    state: AxLearnCheckpointState;
    stats: AxRunStats;
    budget?: number;
  }): Promise<number> {
    const checkpoints = (await this.options.storage.load(this.options.name, {
      type: 'checkpoint',
    })) as AxCheckpoint[];

    const latestVersion = checkpoints.reduce(
      (maxVersion, checkpoint) => Math.max(maxVersion, checkpoint.version ?? 0),
      0
    );
    const checkpointVersion = latestVersion + 1;

    const checkpoint: AxCheckpoint = {
      type: 'checkpoint',
      name: this.options.name,
      version: checkpointVersion,
      createdAt: new Date(),
      instruction: args.state.instruction ?? this.gen.getInstruction(),
      score: args.score,
      optimizerType: 'learn',
      learnState: args.state,
      metadata: {
        mode: args.mode,
        budget: args.budget,
        trainingExamples: args.stats.trainingExamples,
        validationExamples: args.stats.validationExamples,
        feedbackExamples: args.stats.feedbackExamples,
        durationMs: args.stats.durationMs,
      },
    };

    await this.options.storage.save(this.options.name, checkpoint);
    this.currentScore = args.score;
    this.currentState = args.state;
    return checkpointVersion;
  }

  private async loadLatestCheckpoint(): Promise<void> {
    try {
      const checkpoints = (await this.options.storage.load(this.options.name, {
        type: 'checkpoint',
      })) as AxCheckpoint[];

      if (checkpoints.length === 0) {
        return;
      }

      const latest = [...checkpoints].sort((left, right) => {
        const versionDiff = (right.version ?? 0) - (left.version ?? 0);
        if (versionDiff !== 0) {
          return versionDiff;
        }
        return (
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime()
        );
      })[0];

      if (!latest) {
        return;
      }

      const instruction =
        latest.learnState?.instruction ?? latest.instruction ?? undefined;
      if (
        latest.learnState?.mode === 'playbook' &&
        latest.learnState.playbook
      ) {
        this.applyRestoredPlaybook(
          latest.learnState.playbook as unknown as AxACEPlaybook,
          latest.learnState.baseInstruction,
          instruction
        );
      } else if (instruction) {
        this.gen.setInstruction(instruction);
      }
      this.currentScore = latest.learnState?.score ?? latest.score;
      this.currentState = latest.learnState;

      if (latest.learnState?.mode === 'playbook') {
        this.playbookOptimizer = undefined;
      }

      this.tracer = this.tracer.clone(this.gen);
    } catch {
      // Ignore load errors on initialization
    }
  }

  private applyRestoredPlaybook(
    playbook: AxACEPlaybook,
    baseInstruction?: string,
    fallbackInstruction?: string
  ): void {
    const originalDescription =
      baseInstruction ??
      this.gen.getSignature().getDescription() ??
      fallbackInstruction ??
      '';
    const combinedInstruction = [
      originalDescription.trim(),
      '',
      renderPlaybook(playbook),
    ]
      .filter((block) => block && block.trim().length > 0)
      .join('\n\n');

    if (typeof (this.gen as any).setDescription === 'function') {
      (this.gen as any).setDescription(combinedInstruction);
      return;
    }

    if (combinedInstruction) {
      this.gen.setInstruction(combinedInstruction);
    }
  }
}

/**
 * Factory function to create an AxLearn instance.
 */
export function learn<IN extends AxGenIn, OUT extends AxGenOut>(
  gen: AxGen<IN, OUT>,
  options: AxLearnOptions
): AxLearn<IN, OUT> {
  return new AxLearn(gen, options);
}
