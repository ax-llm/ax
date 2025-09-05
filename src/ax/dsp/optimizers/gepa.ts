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
import {
  buildParetoFront,
  hypervolume2D,
  dominatesVectorEps,
  average,
  randomSubset,
  selectCandidatePareto,
  avgVec,
} from './paretoUtils.js';

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
  private mergeMax: number;
  private mergesUsed = 0;

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
    const argMergeMax = (args as any)?.mergeMax as number | undefined;
    this.mergeMax = Math.max(0, Math.floor(argMergeMax ?? 5));
    this.mergesUsed = 0;

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
    this.mergesUsed = 0;
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

    // Track per-instance scalar scores on the validation/Pareto set for Algorithm 2 selection
    const perInstanceScores: number[][] = [];
    const evalOnSetScalar = async (
      instruction: string,
      set: readonly AxTypedExample<IN>[]
    ): Promise<number[]> => {
      const out: number[] = [];
      for (const ex of set) {
        const vec = await evalOne(instruction, ex);
        const vals = Object.values(vec);
        out.push(
          vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
        );
      }
      return out;
    };
    perInstanceScores.push(await evalOnSetScalar(baseInstruction, paretoSet));

    const optLogger = this.getOptimizerLogger(options);
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA',
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
      // Parent selection via per-instance Pareto sampling (Algorithm 2)
      const parentIdx = selectCandidatePareto(perInstanceScores).index;

      const mini = this.minibatch
        ? randomSubset(examples, Math.min(this.minibatchSize, examples.length))
        : examples;

      const useMerge =
        this.crossoverEvery > 0 &&
        (t + 1) % this.crossoverEvery === 0 &&
        candidates.length > 1 &&
        this.mergesUsed < this.mergeMax;

      let childInstr = candidates[parentIdx]!.instruction;
      let strategy: 'reflective_mutation' | 'merge' = 'reflective_mutation';

      if (useMerge) {
        let second = selectCandidatePareto(perInstanceScores).index;
        if (second === parentIdx) second = (parentIdx + 1) % candidates.length;
        childInstr = await this.mergeInstructions(
          candidates[parentIdx]!.instruction,
          candidates[second]!.instruction,
          options
        );
        strategy = 'merge';
        this.mergesUsed += 1;
      } else {
        childInstr = await this.reflectInstruction(
          candidates[parentIdx]!.instruction,
          program,
          mini,
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
      }

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
        'GEPA',
        { strategy, paretoSetSize: paretoSet.length },
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
      // Store per-instance scalar scores for Algorithm 2 selection
      perInstanceScores.push(await evalOnSetScalar(childInstr, paretoSet));

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
    this.recordParetoMetrics(pareto.length, candidates.length, 'GEPA', hv);

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
        strategy: 'gepa',
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
