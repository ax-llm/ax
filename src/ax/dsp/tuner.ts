/**
 * AxTuner - High-level tuning orchestrator for self-improving agents.
 *
 * Coordinates the optimization loop: gathering data, judging outputs,
 * and running optimizers to improve prompts.
 */

import type { AxAIService } from '../ai/types.js';
import type { AxCheckpoint, AxStorage } from '../mem/storage.js';
import type { AxMetricFn, AxTypedExample } from './common_types.js';
import type { AxGen } from './generate.js';
import { AxJudge, type AxJudgeOptions } from './judge.js';
import { AxBootstrapFewShot } from './optimizers/bootstrapFewshot.js';
import { AxSynth, type AxSynthOptions } from './synth.js';
import type { AxGenIn, AxGenOut } from './types.js';

/**
 * Supported optimization methods.
 */
export type AxTuneMethod = 'bootstrap';

/**
 * Progress callback for monitoring optimization.
 */
export interface AxTuneProgress {
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
 * Configuration for the tune operation.
 */
export interface AxTuneOptions {
  /** Optimization method to use (default: 'bootstrap') */
  method?: AxTuneMethod;

  /** Maximum optimization rounds */
  budget?: number;

  /** Teacher AI for synthetic data generation and judging */
  teacher?: AxAIService;

  /** Custom metric function (if not provided, auto-generates using AxJudge) */
  metric?: AxMetricFn;

  /** Judge options when auto-generating metric */
  judgeOptions?: Partial<AxJudgeOptions>;

  /** Custom evaluation criteria for judge */
  criteria?: string;

  /** Training examples (if not provided, generates synthetic data) */
  examples?: AxTypedExample<AxGenIn>[];

  /** Number of synthetic examples to generate if examples not provided */
  synthCount?: number;

  /** Synth options for data generation */
  synthOptions?: Partial<AxSynthOptions>;

  /** Storage for checkpointing (optional) */
  storage?: AxStorage;

  /** Agent ID for checkpointing (required if storage is provided) */
  agentId?: string;

  /** Progress callback */
  onProgress?: (progress: AxTuneProgress) => void;

  /** Validation split ratio (default: 0.2) */
  validationSplit?: number;
}

/**
 * Result from a tune operation.
 */
export interface AxTuneResult<IN extends AxGenIn, OUT extends AxGenOut> {
  /** The improved generator */
  improvedGen: AxGen<IN, OUT>;

  /** Final score achieved */
  score: number;

  /** Score improvement from original */
  improvement: number;

  /** Number of rounds executed */
  rounds: number;

  /** Statistics */
  stats: {
    trainingExamples: number;
    validationExamples: number;
    durationMs: number;
    method: AxTuneMethod;
  };

  /** Checkpoint version if saved */
  checkpointVersion?: number;
}

/**
 * AxTuner orchestrates the self-improvement loop for AxGen instances.
 *
 * @example
 * ```typescript
 * const tuner = new AxTuner({ teacher: gpt4o });
 *
 * const result = await tuner.tune(myGen, {
 *   budget: 20,
 *   rubric: 'helpfulness',
 * });
 *
 * console.log(`Improved score: ${result.score}`);
 * ```
 */
export class AxTuner {
  private teacher: AxAIService;
  private storage?: AxStorage;

  constructor(options: { teacher: AxAIService; storage?: AxStorage }) {
    this.teacher = options.teacher;
    this.storage = options.storage;
  }

  /**
   * Tune an AxGen instance to improve its performance.
   */
  async tune<IN extends AxGenIn, OUT extends AxGenOut>(
    gen: AxGen<IN, OUT>,
    options: AxTuneOptions = {}
  ): Promise<AxTuneResult<IN, OUT>> {
    const startTime = Date.now();
    const method = options.method ?? 'bootstrap';
    const budget = options.budget ?? 20;
    const teacher = options.teacher ?? this.teacher;
    const storage = options.storage ?? this.storage;

    // Step 1: Prepare training data
    let examples = options.examples ?? [];

    if (examples.length === 0) {
      // Generate synthetic data
      const synthCount = options.synthCount ?? 50;
      const synthOptions: AxSynthOptions = {
        teacher,
        ...options.synthOptions,
      };

      const synth = new AxSynth(gen.getSignature(), synthOptions);
      const synthResult = await synth.generate(synthCount);
      examples = synthResult.examples.map((ex) => ({
        ...ex.input,
        ...ex.expected,
      })) as AxTypedExample<AxGenIn>[];
    }

    // Split into training and validation
    const splitRatio = options.validationSplit ?? 0.2;
    const splitIndex = Math.floor(examples.length * (1 - splitRatio));
    const trainingExamples = examples.slice(0, splitIndex);
    const validationExamples = examples.slice(splitIndex);

    // Step 2: Prepare metric function
    let metric = options.metric;

    if (!metric) {
      const judgeOptions: AxJudgeOptions = {
        ai: teacher,
        criteria: options.criteria,
        ...options.judgeOptions,
      };

      const judge = new AxJudge(gen.getSignature(), judgeOptions);
      metric = judge.toMetricFn();
    }

    // Step 3: Run optimizer
    const optimizer = new AxBootstrapFewShot({
      studentAI: teacher,
      options: { maxRounds: budget },
    });

    const result = await optimizer.compile(
      gen,
      trainingExamples as AxTypedExample<IN>[],
      metric
    );

    const improvedGen = gen.clone();
    if (result.demos && result.demos.length > 0) {
      improvedGen.setDemos(result.demos);
    }

    const finalScore = result.bestScore ?? 0;

    // Step 4: Checkpoint if storage is available
    let checkpointVersion: number | undefined;

    if (storage && options.agentId) {
      const existingCheckpoints = await storage.listCheckpoints(
        options.agentId
      );
      checkpointVersion = (existingCheckpoints[0]?.version ?? 0) + 1;

      const checkpoint: AxCheckpoint = {
        agentId: options.agentId,
        version: checkpointVersion,
        createdAt: new Date(),
        instruction: improvedGen.getInstruction(),
        score: finalScore,
        optimizerType: method,
        metadata: {
          budget,
          trainingExamples: trainingExamples.length,
          durationMs: Date.now() - startTime,
        },
      };

      await storage.saveCheckpoint(checkpoint);
    }

    return {
      improvedGen,
      score: finalScore,
      improvement: 0,
      rounds: budget,
      stats: {
        trainingExamples: trainingExamples.length,
        validationExamples: validationExamples.length,
        durationMs: Date.now() - startTime,
        method,
      },
      checkpointVersion,
    };
  }

  /**
   * Load a checkpoint and apply it to a generator.
   */
  async loadCheckpoint<IN extends AxGenIn, OUT extends AxGenOut>(
    gen: AxGen<IN, OUT>,
    agentId: string,
    version?: number
  ): Promise<AxGen<IN, OUT> | null> {
    if (!this.storage) {
      return null;
    }

    const checkpoint =
      version !== undefined
        ? await this.storage.loadCheckpointVersion(agentId, version)
        : await this.storage.loadCheckpoint(agentId);

    if (!checkpoint) {
      return null;
    }

    const loadedGen = gen.clone();
    if (checkpoint.instruction) {
      loadedGen.setInstruction(checkpoint.instruction);
    }

    return loadedGen;
  }
}

/**
 * Factory function to create an AxTuner instance.
 */
export function tuner(options: {
  teacher: AxAIService;
  storage?: AxStorage;
}): AxTuner {
  return new AxTuner(options);
}
