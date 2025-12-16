/**
 * AxLearn - Self-improving agent that learns from traces and feedback.
 *
 * Combines AxGen with automatic trace logging, storage, and an optimization loop.
 * This is the high-level API for creating agents that get better over time.
 */

import type { Meter } from '@opentelemetry/api';
import type { AxAIService } from '../ai/types.js';
import type { AxCheckpoint, AxStorage, AxTrace } from '../mem/storage.js';
import { AxTraceLogger } from '../trace/logger.js';
import type { AxAssertion, AxStreamingAssertion } from './asserts.js';
import type { AxMetricFn, AxTypedExample } from './common_types.js';
import type { AxGen } from './generate.js';
import { AxJudge, type AxJudgeOptions } from './judge.js';
import type { AxOptimizerResult, AxParetoResult } from './optimizer.js';
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

/**
 * Configuration for the AxLearn agent.
 * Combines agent configuration (name, storage) with learning configuration (teacher, budget).
 */
export interface AxLearnOptions {
  /** Unique identifier/name for this agent */
  name: string;

  /** Storage backend (Required) */
  storage: AxStorage;

  /** Whether to log traces (default: true) */
  enableTracing?: boolean;

  /** Custom metadata for all traces */
  metadata?: Record<string, unknown>;

  /** Callback when a trace is logged */
  onTrace?: (trace: AxTrace) => void;

  // --- Optimization Configuration ---

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

  /** Whether to use capture traces as training examples (default: true) */
  useTraces?: boolean;

  /** Whether to generate synthetic examples (default: true if no other data) */
  generateExamples?: boolean;

  /** Number of synthetic examples to generate */
  synthCount?: number;

  /** Synth options for data generation */
  synthOptions?: Partial<AxSynthOptions>;

  /** Validation split ratio (default: 0.2) */
  validationSplit?: number;

  /** Progress callback */
  onProgress?: (progress: AxLearnProgress) => void;
}

/**
 * Progress callback for monitoring optimization.
 */
export interface AxLearnProgress {
  /** Current round number */
  round: number;
  /** Total rounds */
  totalRounds: number;
  /** Current best score */
  score: number;
  /** Score improvement from previous round */
  improvement: number;
}

/**
 * Result from an optimize operation.
 */
export interface AxLearnResult<_IN extends AxGenIn, _OUT extends AxGenOut> {
  /** Final score achieved */
  score: number;

  /** Score improvement from original */
  improvement: number;

  /** Checkpoint version saved */
  checkpointVersion: number;

  /** Statistics */
  stats: {
    trainingExamples: number;
    validationExamples: number;
    durationMs: number;
  };
}

/**
 * AxLearn wraps an AxGen with automatic trace logging and self-improvement capabilities.
 *
 * @example
 * ```typescript
 * const gen = ax(`question -> answer`);
 *
 * // Create the learner with all configuration
 * const learner = new AxLearn(gen, {
 *   name: 'math-bot',
 *   teacher: gpt4o,
 *   storage: new AxMemoryStorage(),
 *   budget: 20
 * });
 *
 * // Use in production
 * await learner.forward(ai, { question: 'What is 2+2?' });
 *
 * // Run optimization (uses config from constructor)
 * await learner.optimize();
 * ```
 */
export class AxLearn<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxForwardable<IN, OUT, string>, AxUsable
{
  private gen: AxGen<IN, OUT>;
  private options: AxLearnOptions;
  private tracer: AxTraceLogger<IN, OUT>;
  private currentScore?: number;

  constructor(gen: AxGen<IN, OUT>, options: AxLearnOptions) {
    this.gen = gen;
    this.options = { ...options, enableTracing: options.enableTracing ?? true };

    // Initialize trace logger
    this.tracer = new AxTraceLogger(gen, {
      name: this.options.name,
      storage: this.options.storage,
      metadata: this.options.metadata,
      onTrace: this.options.onTrace,
    });

    // Try to load the latest checkpoint
    this.loadLatestCheckpoint();
  }

  /**
   * Forward call - behaves exactly like AxGen.forward() but logs traces.
   */
  async forward(
    ai: AxAIService,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions<string>>
  ): Promise<OUT> {
    if (this.options.enableTracing) {
      return this.tracer.forward(ai, values, options);
    }
    return this.gen.forward(ai, values, options);
  }

  /**
   * Streaming forward call - behaves exactly like AxGen.streamingForward() but logs traces.
   */
  async *streamingForward(
    ai: AxAIService,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions<string>>
  ): AxGenStreamingOut<OUT> {
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
    // Return a new AxLearn with cloned gen and same options
    // Note: this shares the same storage reference!
    return new AxLearn(this.gen.clone(), this.options);
  }

  /**
   * Optimize the agent using the configuration provided in constructor.
   * Can optionally override options.
   */
  async optimize(
    overrides: Partial<Omit<AxLearnOptions, 'id' | 'storage' | 'teacher'>> = {}
  ): Promise<AxLearnResult<IN, OUT>> {
    const startTime = Date.now();

    // Merge constructor options with overrides
    // We don't allow overriding teacher as it's a core component of the learner
    const config = { ...this.options, ...overrides };

    const teacher = config.teacher;
    const budget = config.budget ?? 20;

    // Step 1: Prepare training data
    let examples: AxTypedExample<AxGenIn>[] = [...(config.examples ?? [])];

    // Add captured traces if requested (default: true)
    if (config.useTraces !== false) {
      const traces = await this.getTraces();
      // Filter traces that have input/output match
      const traceExamples = traces
        .filter((t) => t.input && t.output)
        .map((t) => ({ ...(t.input as any), ...(t.output as any) }));

      examples = [...examples, ...traceExamples] as AxTypedExample<AxGenIn>[];
    }

    // Generate synthetic data if requested or if we have no data
    if (config.generateExamples || examples.length === 0) {
      const synthCount = config.synthCount ?? 20;
      const synthOptions: AxSynthOptions = {
        teacher,
        ...config.synthOptions,
      };

      const synth = new AxSynth(this.gen.getSignature(), synthOptions);
      const synthResult = await synth.generate(synthCount);
      const synthExamples = synthResult.examples.map((ex) => ({
        ...ex.input,
        ...ex.expected,
      })) as AxTypedExample<AxGenIn>[];

      examples = [...examples, ...synthExamples];
    }

    if (examples.length === 0) {
      throw new Error(
        'No training examples available. Provide examples, enable trace usage, or enable example generation.'
      );
    }

    // Split into training and validation
    const splitRatio = config.validationSplit ?? 0.2;
    // Shuffle examples before splitting
    const shuffled = [...examples].sort(() => Math.random() - 0.5);
    const splitIndex = Math.floor(shuffled.length * (1 - splitRatio));
    const trainingExamples = shuffled.slice(0, splitIndex);
    const validationExamples = shuffled.slice(splitIndex);

    // Step 2: Prepare metric function
    let metric = config.metric;

    if (!metric) {
      const judgeOptions: AxJudgeOptions = {
        ai: teacher,
        criteria: config.criteria,
        ...config.judgeOptions,
      };

      const judge = new AxJudge(this.gen.getSignature(), judgeOptions);
      metric = judge.toMetricFn();
    }

    // Step 3: Run optimizer (GEPA)
    const optimizer = new AxGEPA({
      studentAI: teacher,
      numTrials: budget,
      minibatch: true,
      minibatchSize: 10,
    });

    // Provide validation set explicitly to GEPA if supported via options
    // GEPA uses 'validationExamples' option
    // maxMetricCalls: budget * training examples provides reasonable exploration
    const maxMetricCalls = budget * Math.max(trainingExamples.length, 10);
    const result = (await optimizer.compile(
      this.gen,
      trainingExamples as AxTypedExample<IN>[],
      metric,
      // @ts-ignore - GEPA supports validationExamples but types might be strict
      { validationExamples, maxMetricCalls }
    )) as AxParetoResult<OUT> | AxOptimizerResult<OUT>; // Cast to handle both potential result types

    // Check if result is AxParetoResult (has paretoFront)
    if ('paretoFront' in result) {
      const paretoResult = result as AxParetoResult<OUT>;
      // Use the best instruction from the result.
      // paretoFront items have { scores: Record<string,number>, configuration: ... }
      // We assume a single metric 'score' or similar, or just sum of scores.
      const bestCandidate = paretoResult.paretoFront.reduce((prev, curr) => {
        const prevScore = Object.values(prev.scores).reduce((a, b) => a + b, 0);
        const currScore = Object.values(curr.scores).reduce((a, b) => a + b, 0);
        return currScore > prevScore ? curr : prev;
      }, paretoResult.paretoFront[0]);

      if (bestCandidate) {
        const config = bestCandidate.configuration as { instruction?: string };
        if (config.instruction) {
          this.gen.setInstruction(config.instruction);
          // Update internal score
          this.currentScore = Object.values(bestCandidate.scores).reduce(
            (a, b) => a + b,
            0
          );
          // Refresh tracer
          this.tracer = this.tracer.clone(this.gen);
        }
      }
    }

    const finalScore = this.currentScore ?? 0;
    const improvement = finalScore; // vs initial

    // Step 5: Save Checkpoint
    const existingCheckpoints = await (this.options.storage.load(
      this.options.name,
      {
        type: 'checkpoint',
        limit: 1,
      }
    ) as Promise<AxCheckpoint[]>);

    const checkpointVersion = (existingCheckpoints[0]?.version ?? 0) + 1;

    const checkpoint: AxCheckpoint = {
      type: 'checkpoint',
      name: this.options.name,
      version: checkpointVersion,
      createdAt: new Date(),
      instruction: this.gen.getInstruction(),
      score: finalScore,
      optimizerType: 'gepa',
      metadata: {
        budget,
        trainingExamples: trainingExamples.length,
        durationMs: Date.now() - startTime,
      },
    };

    await this.options.storage.save(this.options.name, checkpoint);

    return {
      score: finalScore,
      improvement,
      checkpointVersion,
      stats: {
        trainingExamples: trainingExamples.length,
        validationExamples: validationExamples.length,
        durationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Load the latest checkpoint from storage.
   */
  private async loadLatestCheckpoint(): Promise<void> {
    try {
      const checkpoints = (await this.options.storage.load(this.options.name, {
        type: 'checkpoint',
        limit: 1,
      })) as AxCheckpoint[];

      const checkpoint = checkpoints[0];

      if (checkpoint?.instruction) {
        this.gen.setInstruction(checkpoint.instruction);
        this.currentScore = checkpoint.score;
        // Update tracer to reflect new instruction
        this.tracer = this.tracer.clone(this.gen);
      }
    } catch {
      // Ignore load errors on initialization
    }
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
    const traces = (await this.options.storage.load(this.options.name, {
      id: traceId,
      type: 'trace',
      limit: 1,
    })) as AxTrace[];

    if (traces.length > 0) {
      const trace = traces[0];
      trace.feedback = { ...trace.feedback, ...feedback };
      await this.options.storage.save(this.options.name, trace);
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
