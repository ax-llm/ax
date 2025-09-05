import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  AxOptimizedProgramImpl,
  type AxOptimizedProgram,
  type AxParetoResult,
} from '../optimizer.js';
import type { AxGenOut } from '../types.js';
import { ax } from '../template.js';

/** Single-module GEPA (reflective prompt evolution with Pareto sampling) */
export class AxGEPA extends AxBaseOptimizer {
  // Core knobs
  private numTrials: number;
  private minibatch: boolean;
  private minibatchSize: number;
  private earlyStoppingTrials: number;
  private minImprovementThreshold: number;
  private sampleCount: number;
  private paretoSetSize: number;

  // GEPA+ enhancements
  private crossoverEvery: number;
  private tieEpsilon: number;
  private feedbackMemorySize: number;
  private feedbackMemory: string[] = [];

  // Local histories for result object
  private localScoreHistory: number[] = [];
  private localConfigurationHistory: Record<string, unknown>[] = [];

  constructor(args: Readonly<AxOptimizerArgs>) {
    super(args);

    this.numTrials = args.numTrials ?? 30;
    this.minibatch = args.minibatch ?? true;
    this.minibatchSize = args.minibatchSize ?? 20;
    this.earlyStoppingTrials = args.earlyStoppingTrials ?? 5;
    this.minImprovementThreshold = args.minImprovementThreshold ?? 0.0;
    this.sampleCount = args.sampleCount ?? 1;
    // How many validation instances to track for Pareto set (cap cost)
    const argPareto = (args as any)?.paretoSetSize as number | undefined;
    this.paretoSetSize =
      argPareto && argPareto > 0
        ? Math.min(1000, Math.max(5, Math.floor(argPareto)))
        : Math.max(10, Math.min(200, this.minibatchSize * 3));

    // GEPA+ defaults
    const argCrossoverEvery = (args as any)?.crossoverEvery as
      | number
      | undefined;
    this.crossoverEvery = Math.max(
      0,
      Math.floor(
        argCrossoverEvery ?? Math.max(3, Math.floor(this.numTrials / 4))
      )
    );
    const argTieEps = (args as any)?.tieEpsilon as number | undefined;
    this.tieEpsilon = Number.isFinite(argTieEps!) ? (argTieEps as number) : 0;
    const argFbMem = (args as any)?.feedbackMemorySize as number | undefined;
    this.feedbackMemorySize = Math.max(0, Math.floor(argFbMem ?? 4));

    // Hook convergence threshold to base stats
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  public override reset(): void {
    super.reset();
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
    this.localScoreHistory = [];
    this.localConfigurationHistory = [];
    this.feedbackMemory = [];
  }

  /**
   * Main compile: reflective instruction optimization for a single AxGen program
   */
  private async compileLegacy<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<{
    bestScore: number;
    stats: ReturnType<AxGEPA['getStats']>;
    optimizedProgram?: AxOptimizedProgram<OUT>;
  }> {
    const startTime = Date.now();

    // Validate examples
    this.validateExamples(examples);
    // Auto presets
    if (options?.auto) this.configureAuto(options.auto);

    // Partition feedback vs pareto validation sets
    const feedbackSet = examples;
    const validationExamples = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;
    const paretoSet = (
      validationExamples && validationExamples.length > 0
        ? validationExamples
        : examples
    ).slice(0, this.paretoSetSize);

    // Initialize candidate pool with base instruction
    const baseInstruction = await this.getBaseInstruction(program);
    const candidates: {
      instruction: string;
      parent?: number;
      parent2?: number;
    }[] = [{ instruction: baseInstruction }];

    // Scores matrix: candidates x paretoSet
    const S: number[][] = [];
    S.push(
      await this.evaluateOnSet(
        program,
        candidates[0]!.instruction,
        paretoSet,
        metricFn
      )
    );

    // Book-keeping
    let bestIdx = 0;
    let bestAvg = average(S[0]!);
    let stagnationRounds = 0;

    const optLogger = this.getOptimizerLogger();
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA',
        exampleCount: examples.length,
        validationCount: paretoSet.length,
        config: { numTrials: this.numTrials, minibatch: this.minibatch },
      },
    });

    // Trials loop: propose → minibatch check → full val → accept
    const rolloutBudget = (options as any)?.budgetRollouts as
      | number
      | undefined;
    for (let t = 0; t < this.numTrials; t++) {
      // Select parent via Pareto-based sampling
      const parent = selectCandidatePareto(S);
      const parentIdx = parent.index;

      // Build minibatch from feedback set
      const mini = this.minibatch
        ? randomSubset(
            feedbackSet,
            Math.min(this.minibatchSize, feedbackSet.length)
          )
        : feedbackSet;

      // Decide strategy: reflective mutation or periodic crossover
      const useCrossover =
        this.crossoverEvery > 0 &&
        (t + 1) % this.crossoverEvery === 0 &&
        candidates.length > 1;

      let proposedInstruction: string;
      let parentMiniScore: number;
      let strategy: 'reflective_mutation' | 'crossover' = 'reflective_mutation';
      let parent2Idx: number | undefined;

      if (useCrossover) {
        // Select a second parent (different from first)
        let second = selectCandidatePareto(S).index;
        if (second === parentIdx) second = (parentIdx + 1) % candidates.length;
        parent2Idx = second;

        // Evaluate both parents on minibatch and take the better as baseline
        const p1 = await this.evaluateAvg(
          program,
          candidates[parentIdx]!.instruction,
          mini,
          metricFn
        );
        const p2 = await this.evaluateAvg(
          program,
          candidates[second]!.instruction,
          mini,
          metricFn
        );
        parentMiniScore = Math.max(p1, p2);

        proposedInstruction = await this.mergeInstructions(
          candidates[parentIdx]!.instruction,
          candidates[second]!.instruction,
          options
        );
        strategy = 'crossover';
      } else {
        // Reflectively mutate instruction from minibatch signals
        proposedInstruction = await this.reflectInstruction(
          candidates[parentIdx]!.instruction,
          program,
          mini,
          metricFn,
          options
        );
        // Minibatch acceptance baseline from the selected parent
        parentMiniScore = await this.evaluateAvg(
          program,
          candidates[parentIdx]!.instruction,
          mini,
          metricFn
        );
      }

      const childMiniScore = await this.evaluateAvg(
        program,
        proposedInstruction,
        mini,
        metricFn
      );

      const accepted =
        childMiniScore > parentMiniScore + this.minImprovementThreshold ||
        Math.abs(childMiniScore - parentMiniScore) <= this.tieEpsilon;

      // Update round stats & progress regardless
      this.currentRound = t + 1;
      this.localScoreHistory.push(childMiniScore);
      this.localConfigurationHistory.push({
        instructionLen: proposedInstruction.length,
        parent: parentIdx,
      });
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniScore,
        {
          instructionLen: proposedInstruction.length,
          parent: parentIdx,
          ...(parent2Idx !== undefined ? { parent2: parent2Idx } : {}),
          totalRounds: this.numTrials,
        },
        'GEPA',
        { strategy, paretoSetSize: paretoSet.length },
        bestAvg,
        {
          instructionLen: candidates[bestIdx]!.instruction.length,
          idx: bestIdx,
        },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );
      this.onProgress?.({
        round: t + 1,
        totalRounds: this.numTrials,
        currentScore: childMiniScore,
        bestScore: bestAvg,
        tokensUsed: this.stats.estimatedTokenUsage,
        timeElapsed: Date.now() - startTime,
        successfulExamples: this.stats.successfulDemos,
        totalExamples: examples.length,
      });

      // Budget check
      if (
        rolloutBudget !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudget))
      ) {
        optLogger?.({
          name: 'EarlyStopping',
          value: {
            reason: `Rollout budget exhausted (${rolloutBudget})`,
            finalScore: bestAvg,
            round: this.currentRound,
          },
        });
        this.onEarlyStop?.(`Rollout budget exhausted`, this.stats);
        break;
      }

      if (!accepted) {
        stagnationRounds++;
        if (
          this.earlyStoppingTrials > 0 &&
          stagnationRounds >= this.earlyStoppingTrials
        ) {
          optLogger?.({
            name: 'EarlyStopping',
            value: {
              reason: `No minibatch improvement ≥ ${this.minImprovementThreshold} for ${this.earlyStoppingTrials} trials`,
              finalScore: bestAvg,
              round: this.currentRound,
            },
          });
          this.onEarlyStop?.(
            `No improvement for ${this.earlyStoppingTrials} trials`,
            this.stats
          );
          break;
        }
        continue;
      }

      // Accept: add candidate, evaluate on full pareto set
      candidates.push({
        instruction: proposedInstruction,
        parent: parentIdx,
        ...(parent2Idx !== undefined ? { parent2: parent2Idx } : {}),
      });
      const childIdx = candidates.length - 1;
      const childVec = await this.evaluateOnSet(
        program,
        proposedInstruction,
        paretoSet,
        metricFn
      );
      S.push(childVec);

      const childAvg = average(childVec);
      if (childAvg > bestAvg + this.minImprovementThreshold) {
        bestAvg = childAvg;
        bestIdx = childIdx;
        stagnationRounds = 0;
      } else {
        stagnationRounds++;
      }

      if (
        this.earlyStoppingTrials > 0 &&
        stagnationRounds >= this.earlyStoppingTrials
      ) {
        optLogger?.({
          name: 'EarlyStopping',
          value: {
            reason: `No validation improvement ≥ ${this.minImprovementThreshold} for ${this.earlyStoppingTrials} accepted candidates`,
            finalScore: bestAvg,
            round: this.currentRound,
          },
        });
        this.onEarlyStop?.(
          `No improvement for ${this.earlyStoppingTrials} accepted candidates`,
          this.stats
        );
        break;
      }
    }

    // Build optimized program output
    const bestInstruction = candidates[bestIdx]!.instruction;
    const optimizedProgram = new AxOptimizedProgramImpl<OUT>({
      bestScore: bestAvg,
      stats: this.stats,
      instruction: bestInstruction,
      demos: [],
      examples: [],
      modelConfig: undefined,
      optimizerType: 'GEPA',
      optimizationTime: Date.now() - startTime,
      totalRounds: this.currentRound,
      converged: this.stats.convergenceInfo.converged,
      scoreHistory: [...this.localScoreHistory],
      configurationHistory: [...this.localConfigurationHistory],
    });

    // Log completion
    await this.logOptimizationComplete(
      'GEPA',
      bestAvg,
      { instructionLen: bestInstruction.length },
      options
    );

    return {
      bestScore: bestAvg,
      stats: this.stats,
      optimizedProgram,
    };
  }

  /**
   * Multi-objective GEPA: reflective evolution with Pareto frontier
   */
  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>> {
    const startTime = Date.now();
    this.validateExamples(examples);
    if (options?.auto) this.configureAuto(options.auto);

    const validationExamples = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;
    const paretoSet = (
      validationExamples && validationExamples.length > 0
        ? validationExamples
        : examples
    ).slice(0, this.paretoSetSize);

    // Helper to average objective vectors
    const avgVec = (
      arrs: ReadonlyArray<Record<string, number>>
    ): Record<string, number> => {
      const sums: Record<string, number> = {};
      const counts: Record<string, number> = {};
      for (const r of arrs) {
        for (const [k, v] of Object.entries(r)) {
          sums[k] = (sums[k] || 0) + (typeof v === 'number' ? v : 0);
          counts[k] = (counts[k] || 0) + 1;
        }
      }
      const out: Record<string, number> = {};
      for (const [k, s] of Object.entries(sums))
        out[k] = s / Math.max(counts[k] || 1, 1);
      return out;
    };

    // Evaluate one example -> objective vector
    const evalOne = async (
      instruction: string,
      ex: Readonly<AxTypedExample<IN>>
    ): Promise<Record<string, number>> => {
      try {
        (program as any).setInstruction?.(instruction);
        const prediction = await program.forward(
          this.studentAI,
          ex as IN,
          {
            sampleCount: this.sampleCount,
          } as any
        );
        this.stats.totalCalls += 1;
        const scores = await (metricFn as unknown as AxMultiMetricFn)({
          prediction,
          example: ex as any,
        });
        return scores || {};
      } catch {
        return {};
      }
    };

    // Evaluate on set -> average vector
    const evalOnSet = async (
      instruction: string,
      set: readonly AxTypedExample<IN>[]
    ): Promise<Record<string, number>> => {
      const vecs: Record<string, number>[] = [];
      for (const ex of set) vecs.push(await evalOne(instruction, ex));
      return avgVec(vecs);
    };

    // Start with base instruction
    const baseInstruction = await this.getBaseInstruction(program);
    const candidates: {
      instruction: string;
      parent?: number;
      scores: Record<string, number>;
    }[] = [
      {
        instruction: baseInstruction,
        parent: undefined,
        scores: await evalOnSet(baseInstruction, paretoSet),
      },
    ];

    const optLogger = this.getOptimizerLogger(options);
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA-Pareto',
        exampleCount: examples.length,
        validationCount: paretoSet.length,
        config: { numTrials: this.numTrials, minibatch: this.minibatch },
      },
    });

    let stagnation = 0;

    // Initialize Pareto archive (indices into candidates)
    let archive = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores }))
    ).map((p) => p.idx);

    let prevHypervolume: number | undefined;
    const rolloutBudgetPareto = (options as any)?.budgetRollouts as
      | number
      | undefined;

    for (let t = 0; t < this.numTrials; t++) {
      if (
        rolloutBudgetPareto !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudgetPareto))
      ) {
        break;
      }
      // Parent selection from archive using crowding-distance weights
      const frontForCD = archive.map((idx) => ({
        idx,
        scores: candidates[idx]!.scores,
      }));
      const crowd = computeCrowdingDistances(frontForCD);
      const weights = archive.map((idx) => {
        const w = crowd.get(idx) ?? 0;
        return Number.isFinite(w) ? Math.max(w, 1e-6) : 1e6;
      });
      const parentIdx = weightedPick(archive, weights);

      const mini = this.minibatch
        ? randomSubset(examples, Math.min(this.minibatchSize, examples.length))
        : examples;

      // Propose child via reflection
      const childInstr = await this.reflectInstruction(
        candidates[parentIdx]!.instruction,
        program,
        mini,
        // Provide a scalar metric for reflection only; not used for acceptance
        async ({ prediction, example }) => {
          const scores = await (metricFn as unknown as AxMultiMetricFn)({
            prediction,
            example,
          });
          const vals = Object.values(scores || {});
          return vals.length
            ? vals.reduce((a, b) => a + b, 0) / vals.length
            : 0;
        },
        options
      );

      // Dominance-based acceptance on minibatch (vector)
      const parentMiniVec = await evalOnSet(
        candidates[parentIdx]!.instruction,
        mini
      );
      const childMiniVec = await evalOnSet(childInstr, mini);
      const childMiniScalar = (() => {
        const vals = Object.values(childMiniVec);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      })();

      this.currentRound = t + 1;
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniScalar,
        {
          instructionLen: childInstr.length,
          parent: parentIdx,
          totalRounds: this.numTrials,
        },
        'GEPA-Pareto',
        { strategy: 'reflective_mutation', paretoSetSize: paretoSet.length },
        childMiniScalar,
        {
          instructionLen: candidates[parentIdx]!.instruction.length,
          idx: parentIdx,
        },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );

      const accepted = dominatesVectorEps(
        childMiniVec,
        parentMiniVec,
        this.tieEpsilon
      );
      if (!accepted) {
        if (++stagnation >= this.earlyStoppingTrials) break;
        continue;
      }

      // Full evaluation on validation set (vector) and archive update
      const childVec = await evalOnSet(childInstr, paretoSet);
      candidates.push({
        instruction: childInstr,
        parent: parentIdx,
        scores: childVec,
      });

      const beforeSize = archive.length;
      const hvBefore =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
      archive = buildParetoFront(
        candidates.map((c, idx) => ({ idx, scores: c.scores }))
      ).map((p) => p.idx);
      const hvAfter =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;

      // Reset stagnation if archive improved (hypervolume or size)
      if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
        stagnation = 0;
      } else {
        stagnation++;
        if (stagnation >= this.earlyStoppingTrials) break;
      }
    }

    // Build Pareto frontier of candidate average vectors
    const pareto = buildParetoFront(
      candidates.map((c, idx) => ({
        idx,
        scores: c.scores,
      }))
    );

    // Pick bestScore as max scalarized score on frontier
    const bestScore =
      pareto.length > 0
        ? Math.max(
            ...pareto.map((p) => {
              const vals = Object.values(p.scores);
              return vals.length
                ? vals.reduce((a, b) => a + b, 0) / vals.length
                : 0;
            })
          )
        : 0;

    // Compute hypervolume (2D only)
    const hv = hypervolume2D(pareto.map((p) => p.scores));

    this.stats.convergenceInfo.converged = true;

    // Record metrics for monitoring
    this.recordParetoMetrics(
      pareto.length,
      candidates.length,
      'GEPA-Pareto',
      hv
    );

    return {
      demos: [],
      stats: this.stats,
      bestScore,
      paretoFront: pareto.map((p) => ({
        demos: [],
        scores: p.scores,
        configuration: { candidate: p.idx },
        dominatedSolutions: p.dominated,
      })),
      paretoFrontSize: pareto.length,
      hypervolume: hv,
      finalConfiguration: {
        strategy: 'gepa_pareto',
        candidates: candidates.length,
      },
    } as AxParetoResult<OUT>;
  }

  /** Lightweight auto presets */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numTrials = 10;
        this.minibatch = true;
        this.minibatchSize = 15;
        break;
      case 'medium':
        this.numTrials = 20;
        this.minibatch = true;
        this.minibatchSize = 25;
        break;
      case 'heavy':
        this.numTrials = 35;
        this.minibatch = true;
        this.minibatchSize = 35;
        break;
    }
  }

  // --- Helpers ---

  private async getBaseInstruction<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>
  ): Promise<string> {
    try {
      // If program exposes instruction via signature, prefer it
      const sig: any = program.getSignature?.();
      if (
        sig &&
        typeof sig.instruction === 'string' &&
        sig.instruction.length > 0
      ) {
        return sig.instruction as string;
      }
    } catch {}
    return 'Follow the task precisely. Be concise, correct, and consistent.';
  }

  private async evaluateOnSet<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    set: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn
  ): Promise<number[]> {
    const out: number[] = [];
    for (const ex of set) {
      const s = await this.evaluateOne(program, instruction, ex, metricFn);
      out.push(s);
    }
    return out;
  }

  private async evaluateAvg<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    set: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn
  ): Promise<number> {
    const arr = await this.evaluateOnSet(program, instruction, set, metricFn);
    return arr.length > 0 ? average(arr) : 0;
  }

  private async evaluateOne<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    example: Readonly<AxTypedExample<IN>>,
    metricFn: AxMetricFn
  ): Promise<number> {
    try {
      // Apply instruction (best-effort) before calling forward
      (program as any).setInstruction?.(instruction);

      const prediction = await program.forward(
        this.studentAI,
        example as IN,
        {
          sampleCount: this.sampleCount,
          // Use the base default majority-picker from MiPRO if available via AxBaseOptimizer
          // leave undefined to use program/model defaults when sampleCount===1
        } as any
      );

      this.stats.totalCalls += 1;
      const score = await metricFn({
        prediction,
        example: example as AxExample,
      });
      if (typeof score === 'number' && !Number.isNaN(score)) {
        const threshold =
          typeof this.targetScore === 'number' ? this.targetScore : 0.5;
        if (score >= threshold) this.stats.successfulDemos += 1;
        return score;
      }
      return 0;
    } catch (err) {
      const logger = this.getLogger();
      logger?.({ name: 'Notification', id: 'gepa_eval', value: String(err) });
      return 0;
    }
  }

  private async reflectInstruction<IN, OUT extends AxGenOut>(
    currentInstruction: string,
    program: Readonly<AxGen<IN, OUT>>,
    minibatch: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<string> {
    // Collect quick feedback tuples from minibatch
    const tuples: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }> = [];
    for (const ex of minibatch) {
      try {
        (program as any).setInstruction?.(currentInstruction);
        const pred = await program.forward(
          this.studentAI,
          ex as IN,
          {
            sampleCount: this.sampleCount,
          } as any
        );
        this.stats.totalCalls += 1;
        const score = await metricFn({
          prediction: pred,
          example: ex as AxExample,
        });
        tuples.push({
          input: ex as AxExample,
          prediction: pred,
          score: typeof score === 'number' ? score : 0,
        });
      } catch {
        tuples.push({ input: ex as AxExample, prediction: {}, score: 0 });
      }
    }

    const aiToUse: AxAIService =
      (options as any)?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI;

    // Summarize feedback and maintain short memory
    const critic = ax(
      `minibatch:json "Array of {input,prediction,score}", evalFeedback?:string[] "Evaluator feedback per case if available" -> feedbackSummary:string "Concise feedback: common errors, missing constraints, desired changes"`
    );

    // Optional: external feedback μf
    const externalFeedback: string[] = [];
    const feedbackFn:
      | ((
          arg: Readonly<{ prediction: any; example: AxExample }>
        ) => string | string[] | undefined)
      | undefined = (options as any)?.feedbackFn;
    if (typeof feedbackFn === 'function') {
      for (let i = 0; i < tuples.length; i++) {
        try {
          const fb = feedbackFn({
            prediction: tuples[i]!.prediction,
            example: tuples[i]!.input,
          });
          if (fb) {
            if (Array.isArray(fb)) externalFeedback.push(...fb);
            else externalFeedback.push(fb);
          }
        } catch {}
      }
    }

    let feedbackSummary = '';
    try {
      const out = (await critic.forward(aiToUse, {
        minibatch: tuples,
        evalFeedback: externalFeedback,
      } as any)) as any;
      feedbackSummary =
        (out?.feedbackSummary as string | undefined)?.trim() || '';
      if (feedbackSummary) {
        this.feedbackMemory.unshift(feedbackSummary);
        if (this.feedbackMemory.length > this.feedbackMemorySize)
          this.feedbackMemory.pop();
      }
    } catch {}

    // Use a small reflective update program to produce an improved instruction
    const refl = ax(
      `currentInstruction:string "Current instruction", feedbackSummary?:string "Summarized feedback", recentFeedback?:string[] "Past feedback memory", minibatch:json "Array of {input,prediction,score}" -> newInstruction:string "Improved instruction within 1-6 sentences."`
    );

    try {
      const out = (await refl.forward(aiToUse, {
        currentInstruction,
        feedbackSummary,
        recentFeedback: this.feedbackMemory,
        minibatch: tuples,
      } as any)) as any;
      const instr = (out?.newInstruction as string | undefined)?.trim();
      if (instr && instr.length > 16) return instr;
    } catch {}

    // Fallback: tweak the instruction minimally
    return `${currentInstruction.trim()} Focus on step-by-step evidence-based reasoning. Avoid hallucinations.`.slice(
      0,
      2000
    );
  }
  private async mergeInstructions(
    instructionA: string,
    instructionB: string,
    options?: AxCompileOptions
  ): Promise<string> {
    const aiToUse: AxAIService =
      (options as any)?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI;

    // Merge via meta-prompt
    const merger = ax(
      `instructionA:string "Parent A instruction",
       instructionB:string "Parent B instruction",
       recentFeedback?:string[] "Past feedback memory"
       -> mergedInstruction:string "Merged instruction (1-6 sentences) combining strengths, fixing weaknesses"`
    );

    try {
      const out = (await merger.forward(aiToUse, {
        instructionA,
        instructionB,
        recentFeedback: this.feedbackMemory,
      } as any)) as any;
      const instr = (out?.mergedInstruction as string | undefined)?.trim();
      if (instr && instr.length > 16) return instr;
    } catch {}

    // Fallback: prefer the longer instruction (richer constraints)
    return (
      instructionA.length >= instructionB.length ? instructionA : instructionB
    ).slice(0, 2000);
  }
}

// --- Utilities ---

function dominatesVector(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let atLeastAsGood = true;
  let strictlyBetter = false;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (va < vb) {
      atLeastAsGood = false;
      break;
    }
    if (va > vb) strictlyBetter = true;
  }
  return atLeastAsGood && strictlyBetter;
}

function buildParetoFront(
  items: ReadonlyArray<{
    idx: number;
    scores: Readonly<Record<string, number>>;
  }>
): Array<{
  idx: number;
  scores: Readonly<Record<string, number>>;
  dominated: number;
}> {
  const front: Array<{
    idx: number;
    scores: Readonly<Record<string, number>>;
    dominated: number;
  }> = [];
  for (let i = 0; i < items.length; i++) {
    let dominatedCount = 0;
    let isDominated = false;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (dominatesVector(items[j]!.scores, items[i]!.scores)) {
        isDominated = true;
        break;
      }
      if (dominatesVector(items[i]!.scores, items[j]!.scores)) dominatedCount++;
    }
    if (!isDominated)
      front.push({
        idx: items[i]!.idx,
        scores: items[i]!.scores,
        dominated: dominatedCount,
      });
  }
  return front;
}

function computeCrowdingDistances(
  front: ReadonlyArray<{
    idx: number;
    scores: Readonly<Record<string, number>>;
  }>
): Map<number, number> {
  const dist = new Map<number, number>();
  if (front.length === 0) return dist;
  const keys = new Set<string>();
  for (const f of front) for (const k of Object.keys(f.scores)) keys.add(k);
  for (const f of front) dist.set(f.idx, 0);
  for (const key of keys) {
    const sorted = [...front].sort(
      (a, b) => (a.scores[key] ?? 0) - (b.scores[key] ?? 0)
    );
    const min = sorted[0] ? (sorted[0].scores[key] ?? 0) : 0;
    const max = sorted[sorted.length - 1]
      ? (sorted[sorted.length - 1].scores[key] ?? 0)
      : 0;
    const range = Math.max(max - min, 1e-9);
    if (sorted.length > 0) dist.set(sorted[0]!.idx, Number.POSITIVE_INFINITY);
    if (sorted.length > 1)
      dist.set(sorted[sorted.length - 1]!.idx, Number.POSITIVE_INFINITY);
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1]!.scores[key] ?? 0;
      const next = sorted[i + 1]!.scores[key] ?? 0;
      const inc = (next - prev) / range;
      dist.set(sorted[i]!.idx, (dist.get(sorted[i]!.idx) ?? 0) + inc);
    }
  }
  return dist;
}

function hypervolume2D(
  front: ReadonlyArray<Readonly<Record<string, number>>>
): number | undefined {
  if (front.length === 0) return undefined;
  // Detect objectives (use first vector)
  const keys = Object.keys(front[0] ?? {});
  if (keys.length !== 2) return undefined;
  const [k1, k2] = keys;
  // Sort by k1 descending
  const sorted = [...front].sort((a, b) => (b[k1!] ?? 0) - (a[k1!] ?? 0));
  let hv = 0;
  let prevY = 0;
  for (const p of sorted) {
    const x = p[k1!] ?? 0;
    const y = p[k2!] ?? 0;
    const dy = Math.max(y - prevY, 0);
    hv += x * dy;
    prevY = Math.max(prevY, y);
  }
  return hv;
}

function weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
  const sum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (sum <= 0) return items[Math.floor(Math.random() * items.length)]!;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    const w = Number.isFinite(weights[i]!) ? weights[i]! : 0;
    if (r < w) return items[i]!;
    r -= w;
  }
  return items[items.length - 1]!;
}

function dominatesVectorEps(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
  eps = 0
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let atLeastAsGood = true;
  let strictlyBetter = false;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (va + eps < vb) {
      atLeastAsGood = false;
      break;
    }
    if (va > vb + eps) strictlyBetter = true;
  }
  return atLeastAsGood && strictlyBetter;
}

function average(a: readonly number[]): number {
  if (a.length === 0) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

function randomSubset<T>(arr: readonly T[], k: number): T[] {
  if (k >= arr.length) return [...arr];
  const picked = new Set<number>();
  while (picked.size < k) picked.add(Math.floor(Math.random() * arr.length));
  return Array.from(picked).map((i) => arr[i]!);
}

function selectCandidatePareto(S: number[][]): { index: number } {
  // Build per-instance bests
  const nCand = S.length;
  const nInst = S[0]?.length ?? 0;
  if (nCand <= 1 || nInst === 0) return { index: 0 };

  // Best score per instance
  const bestPerInst: number[] = new Array(nInst).fill(-Infinity);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      bestPerInst[i] = Math.max(bestPerInst[i], S[k]![i]!);
  }

  // Candidates that achieve best on at least one instance
  const appears: number[] = new Array(nCand).fill(0);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      if (S[k]![i]! === bestPerInst[i]) appears[k]! += 1;
  }

  // Remove dominated candidates: if A is <= B for all i and < for at least one
  const dominated = new Array(nCand).fill(false);
  for (let a = 0; a < nCand; a++) {
    for (let b = 0; b < nCand; b++) {
      if (a === b) continue;
      let allLe = true;
      let strictlyLt = false;
      for (let i = 0; i < nInst; i++) {
        if (S[a]![i]! > S[b]![i]!) allLe = false;
        if (S[b]![i]! > S[a]![i]!) strictlyLt = true;
        if (!allLe) break;
      }
      if (allLe && strictlyLt) {
        dominated[a] = true;
        break;
      }
    }
  }

  // Build sampling weights from non-dominated set
  const weights: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < nCand; k++) {
    if (!dominated[k] && appears[k] > 0) {
      indices.push(k);
      weights.push(appears[k]);
    }
  }
  if (indices.length === 0) return { index: Math.floor(Math.random() * nCand) };

  const sumW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sumW;
  for (let j = 0; j < indices.length; j++) {
    if (r < weights[j]!) return { index: indices[j]! };
    r -= weights[j]!;
  }
  return { index: indices[indices.length - 1]! };
}
