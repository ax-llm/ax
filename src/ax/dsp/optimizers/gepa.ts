import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import type { AxGen } from '../generate.js';
import {
  AxBaseOptimizer,
  AxOptimizedProgramImpl,
  type AxParetoResult,
} from '../optimizer.js';
import { ax } from '../template.js';
import type {
  AxGenOut,
  AxNamedProgramInstance,
  AxProgrammable,
} from '../types.js';
import type { AxGEPAAdapter } from './gepaAdapter.js';
import {
  average,
  avgVec,
  buildParetoFront,
  hypervolume2D,
  removeDominatedProgramsByInstanceFronts,
  selectProgramCandidateFromInstanceFronts,
} from './paretoUtils.js';

/** Structured optimization report */
export interface AxGEPAOptimizationReport {
  summary: string;
  bestSolution: {
    overallScore: number;
    objectives: Record<string, { value: number; percentage: number }>;
  };
  paretoFrontier: {
    solutionCount: number;
    objectiveSpaceCoverage: number;
    hypervolume: number;
    tradeoffs?: Array<Record<string, number>>;
  };
  statistics: {
    totalEvaluations: number;
    candidatesExplored: number;
    converged: boolean;
  };
  recommendations: {
    status: 'good' | 'limited' | 'single';
    suggestions: string[];
  };
}

/** Helper to display optimization report in a nice format */
export function displayGEPAReport(report: AxGEPAOptimizationReport): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎉 ${report.summary}`);
  console.log(`${'═'.repeat(60)}\n`);

  console.log('📊 Best Solution Found:');
  console.log(
    `   Overall Score: ${report.bestSolution.overallScore.toFixed(3)}`
  );
  console.log('   Individual Objectives:');
  for (const [key, obj] of Object.entries(report.bestSolution.objectives)) {
    const bar = '█'.repeat(Math.round(obj.value * 20));
    console.log(
      `   • ${key}: ${obj.value.toFixed(3)} (${obj.percentage.toFixed(1)}%) ${bar}`
    );
  }
  console.log();

  console.log('🎯 Pareto Frontier:');
  console.log(
    `   • Found ${report.paretoFrontier.solutionCount} optimal trade-off${report.paretoFrontier.solutionCount === 1 ? '' : 's'}`
  );
  console.log(
    `   • Objective space coverage: ${report.paretoFrontier.objectiveSpaceCoverage.toFixed(1)}%`
  );
  console.log(
    `     (Hypervolume: ${report.paretoFrontier.hypervolume.toFixed(3)})`
  );

  if (
    report.paretoFrontier.tradeoffs &&
    report.paretoFrontier.tradeoffs.length > 0
  ) {
    console.log('\n   Trade-off points discovered:');
    for (let i = 0; i < report.paretoFrontier.tradeoffs.length; i++) {
      const tradeoff = report.paretoFrontier.tradeoffs[i]!;
      const objectives = Object.entries(tradeoff)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(', ');
      console.log(`   ${i + 1}. ${objectives}`);
    }
  }
  console.log();

  console.log('📈 Optimization Statistics:');
  console.log(`   • Total evaluations: ${report.statistics.totalEvaluations}`);
  console.log(
    `   • Candidates explored: ${report.statistics.candidatesExplored}`
  );
  console.log(`   • Converged: ${report.statistics.converged ? '✅' : '❌'}`);
  console.log();

  console.log('💡 Recommendations:');
  const statusEmoji = report.recommendations.status === 'good' ? '✅' : '⚠️';
  console.log(`   ${statusEmoji} Status: ${report.recommendations.status}`);
  for (const suggestion of report.recommendations.suggestions) {
    console.log(`   • ${suggestion}`);
  }

  console.log(`\n${'═'.repeat(60)}\n`);
}

type AxGEPAInstructionTarget = AxNamedProgramInstance<any, any> & {
  program: AxNamedProgramInstance<any, any>['program'] & {
    getInstruction?: () => string | undefined;
    setInstruction?: (instruction: string) => void;
    getSignature?: () => { getDescription?: () => string | undefined };
  };
};

type AxGEPABatchRow = {
  input: AxExample;
  prediction: unknown;
  scores: Record<string, number>;
  scalar: number;
};

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
  private mergesDue = 0;
  private totalMergesTested = 0;
  private lastIterFoundNewProgram = false;
  private mergeAttemptKeys = new Set<string>();
  private mergeCompositionKeys = new Set<string>();

  // GEPA reflection prompt template (aligned with reference implementation)
  private static readonly REFLECTION_PROMPT_TEMPLATE =
    `I provided an assistant with the following instructions to perform a task for me:
\`\`\`
<curr_instructions>
\`\`\`

The following are examples of different task inputs provided to the assistant along with the assistant's response for each of them, and some feedback on how the assistant's response could be better:
\`\`\`
<inputs_outputs_feedback>
\`\`\`

Your task is to write a new instruction for the assistant. Read the inputs carefully and identify the input format and infer detailed task description about the task I wish to solve with the assistant. Read all the assistant responses and the corresponding feedback. Identify all niche and domain specific factual information about the task and include it in the instruction, as a lot of it may not be available to the assistant in the future. The assistant may have utilized a generalizable strategy to solve the task, if so, include that in the instruction as well. Provide the new instructions within \`\`\` blocks.`;

  private rngState: number = 123456789;
  private samplerState: {
    epoch: number;
    shuffled: number[];
    freq: Map<number, number>;
  } = {
    epoch: -1,
    shuffled: [],
    freq: new Map(),
  };

  // Local histories for result object
  private localScoreHistory: number[] = [];
  private localConfigurationHistory: Record<string, unknown>[] = [];

  constructor(args: Readonly<AxOptimizerArgs>) {
    super(args);

    const seedRaw = (args as any)?.seed;
    const seedNum = Number.isFinite(seedRaw) ? Math.floor(Number(seedRaw)) : 0;
    this.rngState = seedNum && seedNum !== 0 ? seedNum : 123456789;

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
    // Default mergeMax to 5 (aligned with reference DSPy GEPA: use_merge=True, max_merge_invocations=5)
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
    this.mergesDue = 0;
    this.totalMergesTested = 0;
    this.lastIterFoundNewProgram = false;
    this.mergeAttemptKeys.clear();
    this.mergeCompositionKeys.clear();
    this.samplerState.epoch = -1;
    this.samplerState.shuffled = [];
    this.samplerState.freq.clear();
  }

  /**
   * Multi-objective GEPA: reflective evolution with Pareto frontier
   */
  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxProgrammable<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn | AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>> {
    const _startTime = Date.now();
    this.validateExamples(examples);
    if (options?.auto) this.configureAuto(options.auto);

    const rolloutBudgetParetoRaw = (options as any)?.maxMetricCalls as number;
    if (
      !Number.isFinite(rolloutBudgetParetoRaw) ||
      rolloutBudgetParetoRaw <= 0
    ) {
      throw new Error(
        'AxGEPA: options.maxMetricCalls must be set to a positive integer'
      );
    }
    const rolloutBudgetPareto = Math.floor(rolloutBudgetParetoRaw);

    const validationExamples = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;
    const feedbackExamples = (options as any)?.feedbackExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;

    const paretoSet = (
      validationExamples && validationExamples.length > 0
        ? validationExamples
        : examples
    ).slice(0, this.paretoSetSize);

    const exampleKey = (example: Readonly<Record<string, unknown>>): string => {
      const ordered = Object.keys(example)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = example[key];
          return acc;
        }, {});
      return JSON.stringify(ordered);
    };

    const scoredExampleKeys = new Set(
      examples.map((example) =>
        exampleKey(example as unknown as Record<string, unknown>)
      )
    );

    const feedbackSet =
      feedbackExamples && feedbackExamples.length > 0
        ? feedbackExamples.filter((example) =>
            scoredExampleKeys.has(
              exampleKey(example as unknown as Record<string, unknown>)
            )
          )
        : examples;
    const effectiveFeedbackSet =
      feedbackSet.length > 0 ? feedbackSet : examples;
    const targets = this.getInstructionTargets(program);
    if (targets.length === 0) {
      throw new Error(
        'AxGEPA: program has no instruction-bearing nodes to optimize'
      );
    }
    const targetIds = targets.map((target) => target.id);

    const applyConfig = (cfg: Readonly<Record<string, string>>): void => {
      for (const target of targets) {
        const instruction = cfg[target.id];
        if (typeof instruction === 'string') {
          target.program.setInstruction?.(instruction);
        }
      }
    };

    const normalizeScores = async (
      prediction: unknown,
      example: AxExample
    ): Promise<Record<string, number>> => {
      const raw = await (metricFn as any)({ prediction, example });
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { score: raw } : {};
      }
      if (!raw || typeof raw !== 'object') {
        return {};
      }
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          out[key] = value;
        }
      }
      return out;
    };

    const scalarize = (v: Readonly<Record<string, number>>): number => {
      const key = (options as any)?.paretoMetricKey as string | undefined;
      const fn = (options as any)?.paretoScalarize as
        | ((scores: Readonly<Record<string, number>>) => number)
        | undefined;
      if (typeof fn === 'function') return fn(v);
      if (key)
        return Number.isFinite(v[key] as number) ? (v[key] as number) : 0;
      const vals = Object.values(v);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    const evalBatch = async (
      cfg: Readonly<Record<string, string>>,
      set: readonly AxTypedExample<IN>[],
      _phase: string,
      throwIfInsufficient = false
    ): Promise<
      | {
          rows: AxGEPABatchRow[];
          avg: Record<string, number>;
          scalars: number[];
          sum: number;
        }
      | undefined
    > => {
      const requiredCalls = set.length;
      if (this.stats.totalCalls + requiredCalls > rolloutBudgetPareto) {
        if (throwIfInsufficient) {
          throw new Error(
            `AxGEPA: options.maxMetricCalls=${rolloutBudgetPareto} is too small to evaluate the initial Pareto set; need at least ${requiredCalls} metric calls`
          );
        }
        return undefined;
      }

      const rows: AxGEPABatchRow[] = [];
      for (const ex of set) {
        applyConfig(cfg);
        const prediction = await program.forward(
          this.studentAI,
          ex as IN,
          {
            sampleCount: this.sampleCount,
          } as any
        );
        this.stats.totalCalls += 1;
        const scores = await normalizeScores(prediction, ex as AxExample);
        rows.push({
          input: ex as AxExample,
          prediction,
          scores,
          scalar: scalarize(scores),
        });
      }

      return {
        rows,
        avg: avgVec(rows.map((row) => row.scores)),
        scalars: rows.map((row) => row.scalar),
        sum: rows.reduce((total, row) => total + row.scalar, 0),
      };
    };

    const baseCfg: Record<string, string> = {};
    for (const target of targets) {
      baseCfg[target.id] = await this.getBaseInstruction(target.program as any);
    }

    const baseEval = await evalBatch(
      baseCfg,
      paretoSet,
      'initial Pareto evaluation',
      true
    );
    const candidates: {
      cfg: Record<string, string>;
      parent?: number;
      scores: Record<string, number>;
    }[] = [
      {
        cfg: { ...baseCfg },
        parent: undefined,
        scores: baseEval!.avg,
      },
    ];

    const perInstanceScores: number[][] = [baseEval!.scalars];

    const optLogger = this.getOptimizerLogger(options);
    const verboseLog =
      ((options as any)?.verbose ?? this.verbose)
        ? (msg: string) => console.log(`[GEPA] ${msg}`)
        : (_msg: string) => {};

    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA',
        exampleCount: examples.length,
        validationCount: paretoSet.length,
        config: {
          numTrials: this.numTrials,
          minibatch: this.minibatch,
          mergeMax: this.mergeMax,
          tunableCount: targets.length,
        },
      },
    });

    verboseLog(
      `Starting GEPA optimization: ${examples.length} train, ${paretoSet.length} validation, maxCalls=${rolloutBudgetPareto}`
    );

    let stagnation = 0;
    const triedMerges = new Set<string>();

    // Initialize Pareto archive (indices into candidates)
    let archive = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores })),
      this.tieEpsilon
    ).map((p) => p.idx);

    let _prevHypervolume: number | undefined;

    for (let t = 0; t < this.numTrials; t++) {
      if (
        rolloutBudgetPareto !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudgetPareto))
      ) {
        break;
      }
      // Parent selection via per-instance fronts (frequency sampling)
      const nInst = perInstanceScores[0]?.length ?? 0;
      const instanceFronts: Array<Set<number>> = [];
      for (let i = 0; i < nInst; i++) {
        let best = Number.NEGATIVE_INFINITY;
        const front = new Set<number>();
        for (let k = 0; k < perInstanceScores.length; k++) {
          const v = perInstanceScores[k]![i]!;
          if (v > best + this.tieEpsilon) {
            best = v;
            front.clear();
            front.add(k);
          } else if (Math.abs(v - best) <= this.tieEpsilon) {
            front.add(k);
          }
        }
        instanceFronts.push(front);
      }
      const perProgScores = perInstanceScores.map((arr) => average(arr));

      // Scheduled merge attempt before reflective mutation.
      if (
        this.mergeMax > 0 &&
        this.mergesDue > 0 &&
        this.lastIterFoundNewProgram
      ) {
        const ancestors = (idx: number): number[] => {
          const path: number[] = [];
          let cur: number | undefined = idx;
          while (cur !== undefined) {
            path.push(cur);
            cur = candidates[cur]?.parent;
          }
          return path;
        };
        const rngPick = <T>(arr: readonly T[]): T | undefined =>
          arr.length ? arr[Math.floor(this.rand() * arr.length)]! : undefined;
        // Merge candidates = union of reduced instance fronts
        const reducedFronts = removeDominatedProgramsByInstanceFronts(
          instanceFronts,
          perProgScores
        );
        const mergeCandidatesSet = new Set<number>();
        for (const f of reducedFronts)
          for (const p of f) mergeCandidatesSet.add(p);
        const mergeCandidates = Array.from(mergeCandidatesSet);

        let picked: { i: number; j: number; a: number } | undefined;
        for (let attempts = 0; attempts < 10 && !picked; attempts++) {
          if (mergeCandidates.length < 2) break;
          let i = rngPick(mergeCandidates)!;
          let j = rngPick(mergeCandidates)!;
          if (i === j) continue;
          if (j < i) [i, j] = [j, i];
          const Ai = new Set(ancestors(i));
          const Aj = new Set(ancestors(j));
          if (Ai.has(j) || Aj.has(i)) continue;
          const commons = [...Ai].filter((x) => Aj.has(x));
          if (commons.length === 0) continue;

          const desirables: number[] = [];
          for (const ancestor of commons) {
            const cfgA = candidates[ancestor]!.cfg;
            const cfgI = candidates[i]!.cfg;
            const cfgJ = candidates[j]!.cfg;
            let ok = false;
            const allKeys = new Set([
              ...Object.keys(cfgA),
              ...Object.keys(cfgI),
              ...Object.keys(cfgJ),
            ]);
            for (const key of allKeys) {
              const pa = cfgA[key];
              const pi = cfgI[key];
              const pj = cfgJ[key];
              if ((pi === pa && pj !== pi) || (pj === pa && pi !== pj)) {
                ok = true;
                break;
              }
            }
            if (ok) desirables.push(ancestor);
          }
          if (desirables.length === 0) continue;

          const weights = desirables.map((ancestor) =>
            Math.max(1e-9, perProgScores[ancestor]!)
          );
          let r = this.rand() * weights.reduce((s, w) => s + w, 0);
          let a = desirables[desirables.length - 1]!;
          for (let idx = 0; idx < desirables.length; idx++) {
            if (r < weights[idx]!) {
              a = desirables[idx]!;
              break;
            }
            r -= weights[idx]!;
          }
          picked = { i, j, a };
        }

        // Clear scheduling flag before reflective attempt (parity)
        this.lastIterFoundNewProgram = false;

        if (picked) {
          let mergeAccepted = false;
          const { i, j, a } = picked;
          // Ancestor guard + desirability filter for single-component merge
          const Sa = perProgScores[a]!;
          const Si = perProgScores[i]!;
          const Sj = perProgScores[j]!;
          if (Sa > Math.min(Si, Sj)) continue;
          const triKey = `${i}|${j}|${a}`;
          if (this.mergeAttemptKeys.has(triKey)) continue;
          this.mergeAttemptKeys.add(triKey);
          if (triedMerges.has(triKey)) continue;

          const { cfg: mergedCfg, descSig } = this.systemAwareMergeWithSig(
            candidates,
            i,
            j,
            (ia, ib) => (perProgScores[ia]! >= perProgScores[ib]! ? ia : ib)
          );
          const compKey = `${Math.min(i, j)}|${Math.max(i, j)}|${descSig}`;
          if (this.mergeCompositionKeys.has(compKey)) continue;
          this.mergeCompositionKeys.add(compKey);

          const s1 = perInstanceScores[i]!;
          const s2 = perInstanceScores[j]!;
          const allIdx = Array.from({ length: s1.length }, (_, z) => z);
          const p1 = allIdx.filter((z) => (s1[z] ?? 0) > (s2[z] ?? 0));
          const p2 = allIdx.filter((z) => (s2[z] ?? 0) > (s1[z] ?? 0));
          const p3 = allIdx.filter((z) => !(p1.includes(z) || p2.includes(z)));
          const K = 5;
          const nEach = Math.ceil(K / 3);
          const pickSome = (arr: number[], k: number): number[] => {
            if (k <= 0 || arr.length === 0) return [];
            if (arr.length <= k) return [...arr];
            const out: number[] = [];
            const used = new Set<number>();
            while (out.length < k) {
              const idx = Math.floor(this.rand() * arr.length);
              if (!used.has(idx)) {
                used.add(idx);
                out.push(arr[idx]!);
              }
            }
            return out;
          };
          const chosen: number[] = [];
          chosen.push(...pickSome(p1, Math.min(nEach, p1.length)));
          chosen.push(...pickSome(p2, Math.min(nEach, p2.length)));
          const rem = K - chosen.length;
          chosen.push(...pickSome(p3, Math.max(0, rem)));
          const remaining = K - chosen.length;
          if (remaining > 0) {
            const unused = allIdx.filter((z) => !chosen.includes(z));
            chosen.push(
              ...pickSome(unused, Math.min(remaining, unused.length))
            );
          }
          const idxs = chosen.slice(0, Math.min(K, allIdx.length));
          const subsample = idxs.map((z) => paretoSet[z]!);
          const mergeEval = await evalBatch(
            mergedCfg,
            subsample as readonly AxTypedExample<IN>[],
            'merge subsample'
          );
          if (!mergeEval) break;

          const newSum = mergeEval.sum;
          const id1Sum = idxs.reduce((sum, z) => sum + (s1[z] ?? 0), 0);
          const id2Sum = idxs.reduce((sum, z) => sum + (s2[z] ?? 0), 0);

          if (
            newSum >=
            Math.max(id1Sum, id2Sum) + this.minImprovementThreshold
          ) {
            verboseLog(
              `Iteration ${t + 1}: Merge accepted (programs ${i} + ${j} via ancestor ${a})`
            );
            const childEval = await evalBatch(
              mergedCfg,
              paretoSet,
              'merge validation'
            );
            if (!childEval) break;
            candidates.push({
              cfg: { ...mergedCfg },
              parent: a,
              scores: childEval.avg,
            });
            perInstanceScores.push(childEval.scalars);
            const beforeSize = archive.length;
            const hvBefore =
              hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
            archive = buildParetoFront(
              candidates.map((c, idx) => ({ idx, scores: c.scores })),
              this.tieEpsilon
            ).map((p) => p.idx);
            const hvAfter =
              hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
            if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
              stagnation = 0;
            }
            this.mergesDue -= 1;
            this.totalMergesTested += 1;
            triedMerges.add(triKey);
            mergeAccepted = true;
          }
          if (mergeAccepted) {
            continue;
          }
        }
      }

      const parentIdx = selectProgramCandidateFromInstanceFronts(
        instanceFronts,
        perProgScores,
        () => this.rand()
      );

      this.lastIterFoundNewProgram = false;

      const mini = this.minibatch
        ? this.nextMinibatchIndices(effectiveFeedbackSet.length, t).map(
            (z: number) => effectiveFeedbackSet[z]!
          )
        : effectiveFeedbackSet;

      const parentMiniEval = await evalBatch(
        candidates[parentIdx]!.cfg,
        mini as readonly AxTypedExample<IN>[],
        'parent minibatch'
      );
      if (!parentMiniEval) break;

      if ((options as any)?.skipPerfectScore ?? true) {
        const perfect = Number((options as any)?.perfectScore ?? 1);
        if (
          parentMiniEval.scalars.length > 0 &&
          parentMiniEval.scalars.every((score) => score >= perfect)
        ) {
          continue;
        }
      }

      const proposedCfg: Record<string, string> = {
        ...candidates[parentIdx]!.cfg,
      };
      const strategy: 'reflective_mutation' | 'system_merge' =
        'reflective_mutation';
      // For adapter-based strict acceptance
      let adapterParentSum: number | undefined;
      let adapterChildSum: number | undefined;
      const target = targets[t % targets.length]!;
      const currentInstruction = candidates[parentIdx]!.cfg[target.id]!;
      const adapter = (options as any)?.gepaAdapter as
        | AxGEPAAdapter
        | undefined;
      let newInstruction: string | undefined;

      const parentTuples = parentMiniEval.rows.map((row) => ({
        input: row.input,
        prediction: row.prediction,
        score: row.scalar,
      }));

      if (adapter) {
        try {
          const evalParent = await adapter.evaluate(
            mini as any,
            { ...candidates[parentIdx]!.cfg },
            true
          );
          adapterParentSum = Array.isArray(evalParent?.scores)
            ? evalParent.scores.reduce(
                (sum, score) => sum + (Number(score) || 0),
                0
              )
            : undefined;
          const reflDs = adapter.make_reflective_dataset(
            { ...candidates[parentIdx]!.cfg },
            evalParent as any,
            [target.id]
          );
          const proposedMap = await (adapter.propose_new_texts?.(
            { ...candidates[parentIdx]!.cfg },
            reflDs,
            [target.id]
          ) as any);
          const proposedText =
            proposedMap?.[target.id] ??
            (proposedMap ? (Object.values(proposedMap)[0] as any) : undefined);
          if (typeof proposedText === 'string' && proposedText.length > 0) {
            newInstruction = proposedText;
          }
        } catch {}
      }

      if (!newInstruction) {
        newInstruction = await this.reflectTargetInstruction(
          target.id,
          currentInstruction,
          program,
          applyConfig,
          { ...candidates[parentIdx]!.cfg },
          mini,
          async ({ prediction, example }) =>
            scalarize(await normalizeScores(prediction, example)),
          options,
          parentTuples
        );
      }
      proposedCfg[target.id] = newInstruction;

      if (adapter && adapterParentSum !== undefined) {
        try {
          const evalChild = await adapter.evaluate(
            mini as any,
            proposedCfg,
            false
          );
          adapterChildSum = Array.isArray(evalChild?.scores)
            ? evalChild.scores.reduce(
                (sum, score) => sum + (Number(score) || 0),
                0
              )
            : undefined;
        } catch {}
      }

      const childMiniEval = await evalBatch(
        proposedCfg,
        mini as readonly AxTypedExample<IN>[],
        'child minibatch'
      );
      if (!childMiniEval) break;

      this.currentRound = t + 1;
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniEval.sum,
        {
          instructionLen: newInstruction.length,
          target: target.id,
          parent: parentIdx,
          totalRounds: this.numTrials,
        },
        'GEPA',
        {
          strategy,
          paretoSetSize: paretoSet.length,
          tunableCount: targets.length,
        },
        childMiniEval.sum,
        {
          instructionLen: currentInstruction.length,
          idx: parentIdx,
        },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );

      const accepted =
        childMiniEval.sum > parentMiniEval.sum + this.minImprovementThreshold &&
        (adapterParentSum === undefined ||
          adapterChildSum === undefined ||
          adapterChildSum > adapterParentSum + this.minImprovementThreshold);

      if (!accepted) {
        verboseLog(
          `Iteration ${t + 1}: Rejected (child=${childMiniEval.sum.toFixed(3)} <= parent=${parentMiniEval.sum.toFixed(3)})`
        );
        if (++stagnation >= this.earlyStoppingTrials) {
          verboseLog(
            `Early stopping: ${stagnation} iterations without improvement`
          );
          break;
        }
        continue;
      }

      verboseLog(
        `Iteration ${t + 1}: Accepted (child=${childMiniEval.sum.toFixed(3)} > parent=${parentMiniEval.sum.toFixed(3)})`
      );

      // Full evaluation on validation set (vector) and archive update
      const childEval = await evalBatch(
        proposedCfg,
        paretoSet,
        'validation evaluation'
      );
      if (!childEval) break;
      candidates.push({
        cfg: { ...proposedCfg },
        parent: parentIdx,
        scores: childEval.avg,
      });
      perInstanceScores.push(childEval.scalars);

      const beforeSize = archive.length;
      const hvBefore =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
      archive = buildParetoFront(
        candidates.map((c, idx) => ({ idx, scores: c.scores })),
        this.tieEpsilon
      ).map((p) => p.idx);
      const hvAfter =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;

      // Reset stagnation if archive improved (hypervolume or size)
      if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
        stagnation = 0;
        verboseLog(
          `Iteration ${t + 1}: Archive improved (size=${archive.length}, hv=${hvAfter.toFixed(4)})`
        );
      } else {
        stagnation++;
        verboseLog(
          `Iteration ${t + 1}: Archive unchanged (stagnation=${stagnation}/${this.earlyStoppingTrials})`
        );
        if (stagnation >= this.earlyStoppingTrials) {
          verboseLog(
            `Early stopping: ${stagnation} iterations without archive improvement`
          );
          break;
        }
      }
      // Schedule merge attempt for next iteration (aligned with reference behavior)
      this.lastIterFoundNewProgram = true;
      if (this.mergeMax > 0 && this.totalMergesTested < this.mergeMax) {
        this.mergesDue += 1;
      }
    }

    // Build Pareto frontier of candidate average vectors
    const pareto = buildParetoFront(
      candidates.map((c, idx) => ({
        idx,
        scores: c.scores,
      })),
      this.tieEpsilon
    );

    // Pick bestScore as max scalarized score on frontier
    const bestScore =
      pareto.length > 0
        ? Math.max(...pareto.map((p) => scalarize(p.scores)))
        : 0;

    // Identify best candidate on the front (by scalarized score)
    let bestCandidateIdx: number | undefined;
    if (pareto.length > 0) {
      let maxS = Number.NEGATIVE_INFINITY;
      for (const p of pareto) {
        const s = scalarize(p.scores);
        if (s > maxS) {
          maxS = s;
          bestCandidateIdx = p.idx;
        }
      }
    }

    // Compute hypervolume (2D only)
    const hv = hypervolume2D(pareto.map((p) => p.scores));

    this.stats.convergenceInfo.converged = true;

    // Record metrics for monitoring
    const customLabels = this.getMergedCustomLabels(options);
    this.recordParetoMetrics(
      pareto.length,
      candidates.length,
      'GEPA',
      hv,
      customLabels
    );

    // Build a unified optimized program (mirrors MiPRO) for the selected best candidate
    const optimizationTime = Date.now() - _startTime;
    const optimizedProgram =
      typeof bestCandidateIdx === 'number'
        ? new AxOptimizedProgramImpl<OUT>({
            bestScore,
            stats: this.stats,
            instruction:
              targets.length === 1
                ? candidates[bestCandidateIdx]!.cfg[targetIds[0]!]
                : undefined,
            instructionMap: { ...candidates[bestCandidateIdx]!.cfg },
            demos: [],
            examples: examples as unknown as any[],
            modelConfig: undefined,
            optimizerType: 'GEPA',
            optimizationTime,
            totalRounds: this.numTrials,
            converged: this.stats.convergenceInfo.converged,
          })
        : undefined;

    // Generate optimization insights report
    const report = this.generateOptimizationReport(
      pareto,
      hv,
      bestScore,
      candidates.length
    );

    return {
      demos: [],
      stats: this.stats,
      bestScore,
      paretoFront: pareto.map((p) => ({
        demos: [],
        scores: p.scores,
        configuration: {
          candidate: p.idx,
          instructionMap: { ...candidates[p.idx]!.cfg },
          ...(targets.length === 1
            ? { instruction: candidates[p.idx]!.cfg[targetIds[0]!] }
            : {}),
        },
        dominatedSolutions: p.dominated,
      })),
      paretoFrontSize: pareto.length,
      hypervolume: hv,
      finalConfiguration: {
        strategy: 'gepa',
        candidates: candidates.length,
        tunables: targets.length,
      },
      // Extra field (not part of AxParetoResult): unified optimized program for easy save/apply
      optimizedProgram,
      // Structured optimization report
      report,
    } as AxParetoResult<OUT> & { report: AxGEPAOptimizationReport };
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
    // First check for custom instruction set via setInstruction()
    const customInstruction = program.getInstruction?.();
    if (customInstruction && customInstruction.length > 0) {
      return customInstruction;
    }

    // Fall back to signature description
    const sig = program.getSignature?.();
    const description = sig?.getDescription?.();
    if (description && description.length > 0) {
      return description;
    }

    return 'Follow the task precisely. Be concise, correct, and consistent.';
  }

  private getInstructionTargets<IN, OUT extends AxGenOut>(
    program: Readonly<AxProgrammable<IN, OUT>>
  ): AxGEPAInstructionTarget[] {
    const seen = new Set<string>();
    const out: AxGEPAInstructionTarget[] = [];
    const maybeAdd = (id: string | undefined, prog: unknown): void => {
      const instructionProgram = prog as AxGEPAInstructionTarget['program'];
      if (
        !id ||
        seen.has(id) ||
        typeof instructionProgram?.setInstruction !== 'function'
      ) {
        return;
      }
      seen.add(id);
      out.push({
        id,
        program: instructionProgram,
        signature: instructionProgram.getSignature?.()?.toString?.(),
      });
    };

    if (
      'namedProgramInstances' in program &&
      typeof (program as any).namedProgramInstances === 'function'
    ) {
      const namedProgramInstances =
        ((program as any).namedProgramInstances() as
          | AxNamedProgramInstance[]
          | undefined
          | null) ?? [];
      for (const entry of namedProgramInstances) {
        maybeAdd(entry?.id, entry?.program);
      }
    }

    maybeAdd((program as any).getId?.(), program);
    return out;
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

  private async reflectTargetInstruction<IN, OUT extends AxGenOut>(
    targetId: string,
    currentInstruction: string,
    program: Readonly<AxProgrammable<IN, OUT>>,
    applyConfig: (cfg: Readonly<Record<string, string>>) => void,
    cfg: Record<string, string>,
    minibatch: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions,
    preEvaluatedTuples?: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }>
  ): Promise<string> {
    const tuples: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }> = preEvaluatedTuples ? [...preEvaluatedTuples] : [];

    if (tuples.length === 0) {
      for (const ex of minibatch) {
        try {
          cfg[targetId] = currentInstruction;
          applyConfig(cfg);
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
    }

    const aiToUse: AxAIService =
      options?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI;
    const critic = ax(
      `targetId:string "Target program ID", minibatch:json "Array of {input,prediction,score}", evalFeedback?:string[] "Evaluator feedback when available" -> feedbackSummary:string "Concise program-focused feedback"`
    );

    const feedbackNotes = (
      ((options as any)?.feedbackNotes as string[] | undefined) ?? []
    ).filter((note) => typeof note === 'string' && note.trim().length > 0);
    const external: string[] = [...feedbackNotes];
    const feedbackFn = (options as any)?.feedbackFn as
      | ((
          arg: Readonly<{ prediction: any; example: AxExample }>
        ) => string | string[] | undefined)
      | undefined;
    if (typeof feedbackFn === 'function') {
      for (const tuple of tuples) {
        const fb = feedbackFn({
          prediction: tuple.prediction,
          example: tuple.input,
        });
        if (fb) Array.isArray(fb) ? external.push(...fb) : external.push(fb);
      }
    }

    let feedbackSummary = '';
    try {
      const out = (await critic.forward(aiToUse, {
        targetId,
        minibatch: tuples,
        evalFeedback: external,
      } as any)) as any;
      feedbackSummary =
        (out?.feedbackSummary as string | undefined)?.trim() || '';
    } catch {}

    const refl = ax(
      `targetId:string "Target program ID", currentInstruction:string "Current instruction", feedbackSummary?:string "Summarized feedback", minibatch:json "Array of {input,prediction,score}" -> newInstruction:string "Improved instruction (1-6 sentences) for the target program"`
    );

    try {
      const out = (await refl.forward(aiToUse, {
        targetId,
        currentInstruction,
        feedbackSummary,
        minibatch: tuples,
      } as any)) as any;
      const instr = (out?.newInstruction as string | undefined)?.trim();
      if (instr && instr.length > 16) return instr;
    } catch {}

    return `${currentInstruction.trim()} Focus on step-by-step, target-specific reasoning and factual grounding.`.slice(
      0,
      2000
    );
  }

  private async reflectInstruction<IN, OUT extends AxGenOut>(
    currentInstruction: string,
    program: Readonly<AxGen<IN, OUT>>,
    minibatch: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions,
    // Optional: pre-evaluated tuples to avoid duplicate evaluation
    preEvaluatedTuples?: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }>
  ): Promise<string> {
    // Collect quick feedback tuples from minibatch (or use pre-evaluated)
    const tuples: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }> = preEvaluatedTuples ?? [];

    if (tuples.length === 0) {
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
    }

    const aiToUse: AxAIService =
      (options as any)?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI;

    // Optional: external feedback function
    const feedbackFn:
      | ((
          arg: Readonly<{ prediction: any; example: AxExample }>
        ) => string | string[] | undefined)
      | undefined = (options as any)?.feedbackFn;
    const feedbackNotes = (
      ((options as any)?.feedbackNotes as string[] | undefined) ?? []
    ).filter((note) => typeof note === 'string' && note.trim().length > 0);

    // Build reflective dataset in GEPA format (aligned with reference)
    const formatReflectiveDataset = (): string => {
      const examples: string[] = [];
      for (let i = 0; i < tuples.length; i++) {
        const t = tuples[i]!;
        let exampleStr = `# Example ${i + 1}\n`;
        exampleStr += `## Inputs\n`;
        if (typeof t.input === 'object' && t.input !== null) {
          for (const [k, v] of Object.entries(t.input)) {
            exampleStr += `### ${k}\n${String(v).trim()}\n\n`;
          }
        } else {
          exampleStr += `${String(t.input).trim()}\n\n`;
        }
        exampleStr += `## Generated Outputs\n`;
        if (typeof t.prediction === 'object' && t.prediction !== null) {
          for (const [k, v] of Object.entries(t.prediction)) {
            exampleStr += `### ${k}\n${String(v).trim()}\n\n`;
          }
        } else {
          exampleStr += `${String(t.prediction).trim()}\n\n`;
        }
        exampleStr += `## Feedback\n`;
        // Get feedback from feedbackFn if available
        let fb = `This trajectory got a score of ${t.score.toFixed(3)}.`;
        if (typeof feedbackFn === 'function') {
          try {
            const customFb = feedbackFn({
              prediction: t.prediction,
              example: t.input,
            });
            if (customFb) {
              fb = Array.isArray(customFb) ? customFb.join('\n') : customFb;
            }
          } catch {}
        }
        exampleStr += `${fb}\n`;
        examples.push(exampleStr);
      }
      const extraNotes = feedbackNotes.map(
        (note, index) => `# Additional Feedback ${index + 1}\n${note}`
      );
      return [...extraNotes, ...examples].join('\n\n');
    };

    // Use the GEPA-style reflection prompt (aligned with reference)
    const prompt = AxGEPA.REFLECTION_PROMPT_TEMPLATE.replace(
      '<curr_instructions>',
      currentInstruction
    ).replace('<inputs_outputs_feedback>', formatReflectiveDataset());

    try {
      // Direct LLM call for reflection (more aligned with reference approach)
      const response = await aiToUse.chat(
        {
          chatPrompt: [{ role: 'user', content: prompt }],
          model: (options as any)?.reflectionModel,
        },
        { stream: false }
      );
      // Handle both streaming and non-streaming responses
      if (typeof (response as any).getReader === 'function') {
        throw new Error('Streaming response not expected for reflection');
      }
      const typedResponse =
        response as import('../../ai/types.js').AxChatResponse;
      const content = typedResponse.results?.[0]?.content;
      if (typeof content === 'string') {
        // Extract instruction from backticks (aligned with reference extractor)
        const extracted = this.extractInstructionFromBackticks(content);
        if (extracted && extracted.length > 16) {
          // Maintain feedback memory for cross-iteration learning
          const feedbackSummary = `Iteration feedback: ${tuples.map((t) => `score=${t.score.toFixed(2)}`).join(', ')}`;
          this.feedbackMemory.unshift(feedbackSummary);
          if (this.feedbackMemory.length > this.feedbackMemorySize) {
            this.feedbackMemory.pop();
          }
          return extracted;
        }
      }
    } catch {}

    // Fallback to signature-based approach
    const refl = ax(
      `currentInstruction:string "Current instruction", feedbackSummary?:string "Summarized feedback", recentFeedback?:string[] "Past feedback memory", minibatch:json "Array of {input,prediction,score}" -> newInstruction:string "Improved instruction within 1-6 sentences."`
    );

    try {
      const out = (await refl.forward(aiToUse, {
        currentInstruction,
        feedbackSummary: this.feedbackMemory[0] || '',
        recentFeedback: this.feedbackMemory,
        minibatch: tuples,
      } as any)) as any;
      const instr = (out?.newInstruction as string | undefined)?.trim();
      if (instr && instr.length > 16) return instr;
    } catch {}

    // Final fallback: tweak the instruction minimally
    return `${currentInstruction.trim()} Focus on step-by-step evidence-based reasoning. Avoid hallucinations.`.slice(
      0,
      2000
    );
  }

  /**
   * Extract instruction text from LLM output enclosed in backticks (aligned with reference)
   */
  private extractInstructionFromBackticks(lmOut: string): string {
    const start = lmOut.indexOf('```') + 3;
    const end = lmOut.lastIndexOf('```');

    // Handle if the first and last backticks are the same or overlap
    if (start >= end) {
      const stripped = lmOut.trim();
      if (stripped.startsWith('```')) {
        // Remove opening ``` and optional language specifier
        const match = stripped.match(/^```\S*\n?/);
        if (match) {
          return stripped.slice(match[0].length).trim();
        }
      } else if (stripped.endsWith('```')) {
        // Remove closing ```
        return stripped.slice(0, -3).trim();
      }
      return stripped;
    }

    // Extract content between backticks
    let content = lmOut.slice(start, end);
    // Skip optional language specifier (e.g., ```markdown\n)
    const langMatch = content.match(/^\S*\n/);
    if (langMatch) {
      content = content.slice(langMatch[0].length);
    }
    return content.trim();
  }

  private updateSamplerShuffled(trainSize: number): void {
    const ids = Array.from({ length: trainSize }, (_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    for (const i of ids)
      this.samplerState.freq.set(i, (this.samplerState.freq.get(i) ?? 0) + 1);
    const mb = this.minibatchSize;
    const mod = trainSize % mb;
    const numToPad = mod === 0 ? 0 : mb - mod;
    const candidates = Array.from({ length: trainSize }, (_, i) => i).sort(
      (a, b) =>
        (this.samplerState.freq.get(a) ?? 0) -
        (this.samplerState.freq.get(b) ?? 0)
    );
    const padded = [...ids];
    for (let k = 0; k < numToPad; k++) {
      const id = candidates[k % candidates.length]!;
      padded.push(id);
      this.samplerState.freq.set(id, (this.samplerState.freq.get(id) ?? 0) + 1);
    }
    this.samplerState.shuffled = padded;
    this.samplerState.epoch += 1;
  }

  private nextMinibatchIndices(trainSize: number, iteration: number): number[] {
    if (this.samplerState.epoch === -1) {
      this.samplerState.epoch = 0;
      this.updateSamplerShuffled(trainSize);
    }
    const mb = this.minibatchSize;
    const blocksPerEpoch = Math.max(
      1,
      Math.floor(this.samplerState.shuffled.length / mb)
    );
    const currEpoch = Math.floor(iteration / blocksPerEpoch);
    while (currEpoch >= this.samplerState.epoch)
      this.updateSamplerShuffled(trainSize);
    const base = (iteration * mb) % this.samplerState.shuffled.length;
    return this.samplerState.shuffled.slice(base, base + mb);
  }

  private rand(): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;
    return ((this.rngState >>> 0) as number) / 4294967296;
  }

  private systemAwareMergeWithSig(
    candidates: ReadonlyArray<{ cfg: Record<string, string>; parent?: number }>,
    i: number,
    j: number,
    pickBetter: (idxA: number, idxB: number) => number
  ): { cfg: Record<string, string>; descSig: string } {
    const ancestors = (idx: number): number[] => {
      const path: number[] = [];
      let cur: number | undefined = idx;
      while (cur !== undefined) {
        path.push(cur);
        cur = candidates[cur]?.parent;
      }
      return path;
    };
    const Ai = ancestors(i);
    const Aj = ancestors(j);
    const common = Ai.find((x) => Aj.includes(x));
    const a = common ?? i;

    const cfgA = candidates[a]!.cfg;
    const cfgI = candidates[i]!.cfg;
    const cfgJ = candidates[j]!.cfg;

    const merged: Record<string, string> = {};
    const picks: ('i' | 'j')[] = [];
    const allKeys = Array.from(
      new Set([
        ...Object.keys(cfgA),
        ...Object.keys(cfgI),
        ...Object.keys(cfgJ),
      ])
    ).sort();
    for (const key of allKeys) {
      const pa = cfgA[key];
      const pi = cfgI[key];
      const pj = cfgJ[key];
      if (pi === pa && pj !== pi) {
        merged[key] = pj!;
        picks.push('j');
      } else if (pj === pa && pi !== pj) {
        merged[key] = pi!;
        picks.push('i');
      } else if (pi !== pj && pi !== pa && pj !== pa) {
        const pick = pickBetter(i, j);
        merged[key] = pick === i ? pi! : pj!;
        picks.push(pick === i ? 'i' : 'j');
      } else {
        merged[key] = pi ?? pj ?? pa!;
        picks.push('i');
      }
    }
    return { cfg: merged, descSig: picks.join('|') };
  }

  private generateOptimizationReport(
    paretoFront: Array<{ scores: Record<string, number>; dominated: number }>,
    hypervolume: number | undefined,
    bestScore: number | undefined,
    candidateCount: number
  ): AxGEPAOptimizationReport {
    // Build best solution data
    const best =
      paretoFront.length > 0
        ? paretoFront.reduce((prev, curr) => {
            const prevSum = Object.values(prev.scores).reduce(
              (a, b) => a + b,
              0
            );
            const currSum = Object.values(curr.scores).reduce(
              (a, b) => a + b,
              0
            );
            return currSum > prevSum ? curr : prev;
          })
        : undefined;

    const objectives: Record<string, { value: number; percentage: number }> =
      {};
    if (best) {
      for (const [key, value] of Object.entries(best.scores)) {
        objectives[key] = {
          value,
          percentage: value * 100,
        };
      }
    }

    // Build tradeoffs list
    const tradeoffs: Array<Record<string, number>> = [];
    if (paretoFront.length > 1) {
      const sorted = [...paretoFront]
        .sort((a, b) => b.dominated - a.dominated)
        .slice(0, 3);
      for (const p of sorted) {
        tradeoffs.push({ ...p.scores });
      }
    }

    // Build recommendations
    let status: 'good' | 'limited' | 'single' = 'good';
    const suggestions: string[] = [];

    if (paretoFront.length === 1) {
      status = 'single';
      suggestions.push('Increase numTrials (current seems low)');
      suggestions.push('Add more training examples');
      suggestions.push('Adjust earlyStoppingTrials');
    } else if (paretoFront.length < 3) {
      status = 'limited';
      suggestions.push('More optimization trials');
      suggestions.push('Larger validation set');
    } else {
      status = 'good';
      const objs = Object.keys(paretoFront[0]?.scores || {});
      for (const obj of objs) {
        suggestions.push(`High ${obj}: Choose solution with best ${obj} score`);
      }
      suggestions.push('Balanced: Use provided bestScore (average)');
    }

    if (this.stats.totalCalls < 50) {
      suggestions.push(
        'Quick run detected - use numTrials: 30+ for production'
      );
      suggestions.push('Provide 50+ training examples');
      suggestions.push('Use 20+ validation examples');
    }

    return {
      summary: 'GEPA Multi-Objective Optimization Complete',
      bestSolution: {
        overallScore: bestScore ?? 0,
        objectives,
      },
      paretoFrontier: {
        solutionCount: paretoFront.length,
        objectiveSpaceCoverage: (hypervolume ?? 0) * 100,
        hypervolume: hypervolume ?? 0,
        tradeoffs: tradeoffs.length > 0 ? tradeoffs : undefined,
      },
      statistics: {
        totalEvaluations: this.stats.totalCalls,
        candidatesExplored: candidateCount,
        converged: this.stats.convergenceInfo?.converged ?? false,
      },
      recommendations: {
        status,
        suggestions,
      },
    };
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
