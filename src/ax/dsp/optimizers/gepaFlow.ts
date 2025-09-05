import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import {
  AxBaseOptimizer,
  AxOptimizedProgramImpl,
  type AxParetoResult,
} from '../optimizer.js';
import type { AxGenOut } from '../types.js';
import { ax } from '../template.js';
import type { AxFlow } from '../../flow/flow.js';
import {
  buildParetoFront,
  hypervolume2D,
  average,
  randomSubset,
  selectCandidatePareto,
  avgVec,
  dominatesVectorEps,
} from './paretoUtils.js';

/** Flow-aware GEPA (system-level reflective evolution with module selection + system-aware merge) */
export class AxGEPAFlow extends AxBaseOptimizer {
  private numTrials: number;
  private minibatch: boolean;
  private minibatchSize: number;
  private earlyStoppingTrials: number;
  private minImprovementThreshold: number;
  private sampleCount: number;
  private crossoverEvery: number;
  private tieEpsilon: number;
  private paretoSetSize: number;
  private mergeMax: number;
  private mergesUsed = 0;

  constructor(args: Readonly<AxOptimizerArgs>) {
    super(args);
    this.numTrials = args.numTrials ?? 24;
    this.minibatch = args.minibatch ?? true;
    this.minibatchSize = args.minibatchSize ?? 8;
    this.earlyStoppingTrials = args.earlyStoppingTrials ?? 5;
    this.minImprovementThreshold = args.minImprovementThreshold ?? 0.0;
    this.sampleCount = args.sampleCount ?? 1;
    this.crossoverEvery = Math.max(
      0,
      Math.floor(
        (args as any)?.crossoverEvery ??
          Math.max(3, Math.floor(this.numTrials / 3))
      )
    );
    this.tieEpsilon = Number.isFinite((args as any)?.tieEpsilon)
      ? Number((args as any)?.tieEpsilon)
      : 0;

    const argPareto = (args as any)?.paretoSetSize as number | undefined;
    this.paretoSetSize =
      argPareto && argPareto > 0
        ? Math.min(1000, Math.max(5, Math.floor(argPareto)))
        : Math.max(10, Math.min(200, this.minibatchSize * 3));

    const argMergeMax = (args as any)?.mergeMax as number | undefined;
    this.mergeMax = Math.max(0, Math.floor(argMergeMax ?? 5));
    this.mergesUsed = 0;

    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  public override reset(): void {
    super.reset();
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
    this.mergesUsed = 0;
  }

  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numTrials = 8;
        this.minibatch = true;
        this.minibatchSize = 6;
        break;
      case 'medium':
        this.numTrials = 16;
        this.minibatch = true;
        this.minibatchSize = 10;
        break;
      case 'heavy':
        this.numTrials = 28;
        this.minibatch = true;
        this.minibatchSize = 14;
        break;
    }
  }

  /**
   * Multi-objective GEPA-Flow: system-level reflective evolution with Pareto frontier
   */
  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<any>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>> {
    const startTime = Date.now();
    const flow = program as unknown as AxFlow<any, OUT>;
    this.validateExamples(examples);
    if (options?.auto) this.configureAuto(options.auto);

    // Discover modules
    const nodes = (flow as any).getNodePrograms?.() as
      | ReadonlyArray<{ name: string; program: any }>
      | undefined;
    if (!nodes || nodes.length === 0)
      throw new Error('AxGEPAFlow: flow has no nodes to optimize');

    // Validation/Pareto set
    const validationExamples = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;
    const paretoSet = (
      validationExamples && validationExamples.length > 0
        ? validationExamples
        : examples
    ).slice(0, this.paretoSetSize);

    const optLogger = this.getOptimizerLogger(options);
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA-Flow',
        exampleCount: examples.length,
        validationCount: paretoSet.length,
        config: { numTrials: this.numTrials, minibatch: this.minibatch },
      },
    });

    const evalOne = async (
      cfg: Readonly<Record<string, string>>,
      ex: Readonly<AxTypedExample<IN>>
    ): Promise<Record<string, number>> => {
      try {
        (flow as any).setAllNodeInstructions?.(cfg);
        const prediction = await (flow as any).forward(
          this.studentAI,
          ex as any,
          {
            sampleCount: this.sampleCount,
          }
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

    const evalOnSet = async (
      cfg: Readonly<Record<string, string>>,
      set: readonly AxTypedExample<IN>[]
    ): Promise<Record<string, number>> => {
      const vecs: Record<string, number>[] = [];
      for (const ex of set) vecs.push(await evalOne(cfg, ex));
      return avgVec(vecs);
    };

    // Initialize base candidate from current node instructions
    const baseInstrs: Record<string, string> = {};
    for (const n of nodes)
      baseInstrs[n.name] = await this.getBaseInstruction(n.program);

    const candidates: {
      cfg: Record<string, string>;
      parent?: number;
      scores: Record<string, number>;
    }[] = [
      {
        cfg: { ...baseInstrs },
        parent: undefined,
        scores: await evalOnSet(baseInstrs, paretoSet),
      },
    ];

    // Track per-instance scalar scores on validation set for Algorithm 2 selection
    const perInstanceScores: number[][] = [];
    const evalOnSetScalar = async (
      cfg: Readonly<Record<string, string>>,
      set: readonly AxTypedExample<IN>[]
    ): Promise<number[]> => {
      const out: number[] = [];
      for (const ex of set) {
        const vec = await evalOne(cfg, ex);
        const vals = Object.values(vec);
        out.push(
          vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
        );
      }
      return out;
    };
    perInstanceScores.push(await evalOnSetScalar(baseInstrs, paretoSet));

    // Initialize archive
    let archive = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores }))
    ).map((p) => p.idx);
    let stagnation = 0;
    const triedMerges = new Set<string>();

    const rolloutBudget = (options as any)?.budgetRollouts as
      | number
      | undefined;

    for (let t = 0; t < this.numTrials; t++) {
      if (
        rolloutBudget !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudget))
      ) {
        break;
      }

      // Parent selection via per-instance Pareto sampling (Algorithm 2)
      const parentIdx = selectCandidatePareto(perInstanceScores).index;

      const mini = this.minibatch
        ? randomSubset(examples, Math.min(this.minibatchSize, examples.length))
        : examples;

      // Decide strategy: reflective mutation or periodic system-aware merge
      const useCrossover =
        this.crossoverEvery > 0 &&
        (t + 1) % this.crossoverEvery === 0 &&
        candidates.length > 1;

      let proposedCfg: Record<string, string> = {
        ...candidates[parentIdx]!.cfg,
      };
      let strategy: 'reflective_mutation' | 'system_merge' =
        'reflective_mutation';

      const moduleIndex = t % nodes.length; // round-robin module selection
      const module = nodes[moduleIndex]!;

      if (useCrossover && this.mergesUsed < this.mergeMax) {
        let second = selectCandidatePareto(perInstanceScores).index;
        if (second === parentIdx) second = (parentIdx + 1) % candidates.length;

        const ancestors = (idx: number): number[] => {
          const path: number[] = [];
          let cur: number | undefined = idx;
          while (cur !== undefined) {
            path.push(cur);
            cur = candidates[cur]?.parent;
          }
          return path;
        };
        const Ai = ancestors(parentIdx);
        const Aj = ancestors(second);
        const common = Ai.find((x) => Aj.includes(x));

        let doMerge = true;
        if (!common) doMerge = false;
        if (Aj.includes(parentIdx) || Ai.includes(second)) doMerge = false;
        if (doMerge) {
          const cfgA = candidates[common!]!.cfg;
          const cfgI = candidates[parentIdx]!.cfg;
          const cfgJ = candidates[second]!.cfg;
          let desirable = false;
          const allKeys = new Set([
            ...Object.keys(cfgA),
            ...Object.keys(cfgI),
            ...Object.keys(cfgJ),
          ]);
          for (const k of allKeys) {
            const pa = cfgA[k];
            const pi = cfgI[k];
            const pj = cfgJ[k];
            if ((pi === pa && pj !== pi) || (pj === pa && pi !== pj)) {
              desirable = true;
              break;
            }
          }
          if (!desirable) doMerge = false;
        }

        if (doMerge) {
          proposedCfg = this.systemAwareMerge(
            candidates,
            parentIdx,
            second,
            (ia, ib) => {
              const sa =
                Object.values(candidates[ia]!.scores).reduce(
                  (a, b) => a + b,
                  0
                ) / Math.max(Object.keys(candidates[ia]!.scores).length, 1);
              const sb =
                Object.values(candidates[ib]!.scores).reduce(
                  (a, b) => a + b,
                  0
                ) / Math.max(Object.keys(candidates[ib]!.scores).length, 1);
              return sa >= sb ? ia : ib;
            }
          );
          strategy = 'system_merge';
          this.mergesUsed += 1;
        } else {
          const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
          const newInstr = await this.reflectModuleInstruction(
            module.name,
            currentInstr,
            flow,
            nodes,
            { ...candidates[parentIdx]!.cfg },
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
          proposedCfg[module.name] = newInstr;
        }
      } else {
        const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
        const newInstr = await this.reflectModuleInstruction(
          module.name,
          currentInstr,
          flow,
          nodes,
          { ...candidates[parentIdx]!.cfg },
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
        proposedCfg[module.name] = newInstr;
      }

      // Dominance-based acceptance on minibatch
      const parentMiniVec = await evalOnSet(
        candidates[parentIdx]!.cfg,
        mini as any
      );
      const childMiniVec = await evalOnSet(proposedCfg, mini as any);
      const childMiniScalar = (() => {
        const vals = Object.values(childMiniVec);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      })();

      this.currentRound = t + 1;
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniScalar,
        {
          modules: nodes.length,
          mutatedModule: module.name,
          totalRounds: this.numTrials,
        },
        'GEPA-Flow',
        { strategy, paretoSetSize: paretoSet.length },
        childMiniScalar,
        { idx: parentIdx },
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

      // Full evaluation on validation set and archive update
      const childVec = await evalOnSet(proposedCfg, paretoSet);
      candidates.push({
        cfg: proposedCfg,
        parent: parentIdx,
        scores: childVec,
      });
      // Store per-instance scalar scores for Algorithm 2 selection
      perInstanceScores.push(await evalOnSetScalar(proposedCfg, paretoSet));

      const beforeSize = archive.length;
      const hvBefore =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
      archive = buildParetoFront(
        candidates.map((c, idx) => ({ idx, scores: c.scores }))
      ).map((p) => p.idx);
      const hvAfter =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;

      if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
        stagnation = 0;
      } else {
        stagnation++;
        if (stagnation >= this.earlyStoppingTrials) break;
      }
    }

    // Build Pareto frontier and metrics
    const pareto = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores }))
    );
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
    const hv = hypervolume2D(pareto.map((p) => p.scores));

    this.stats.convergenceInfo.converged = true;
    this.recordParetoMetrics(pareto.length, candidates.length, 'GEPA-Flow', hv);

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
        strategy: 'gepa_flow_pareto',
        candidates: candidates.length,
      },
    } as AxParetoResult<OUT>;
  }

  // === Helpers ===
  private async getBaseInstruction(program: any): Promise<string> {
    try {
      const sig = program?.getSignature?.();
      if (
        sig &&
        typeof sig.instruction === 'string' &&
        sig.instruction.length > 0
      )
        return sig.instruction as string;
    } catch {}
    return 'Follow the task precisely. Be concise, correct, and consistent.';
  }

  private async evaluateOnSet<OUT extends AxGenOut>(
    flow: Readonly<AxFlow<any, OUT>>,
    cfg: Readonly<Record<string, string>>,
    set: readonly AxTypedExample<any>[],
    metricFn: AxMetricFn
  ): Promise<number[]> {
    const out: number[] = [];
    for (const ex of set) {
      const s = await this.evaluateOne(flow, cfg, ex, metricFn);
      out.push(s);
    }
    return out;
  }

  private async evaluateAvg<OUT extends AxGenOut>(
    flow: Readonly<AxFlow<any, OUT>>,
    cfg: Readonly<Record<string, string>>,
    set: readonly AxTypedExample<any>[],
    metricFn: AxMetricFn
  ): Promise<number> {
    const arr = await this.evaluateOnSet(flow, cfg, set, metricFn);
    return arr.length > 0 ? average(arr) : 0;
  }

  private async evaluateOne<OUT extends AxGenOut>(
    flow: Readonly<AxFlow<any, OUT>>,
    cfg: Readonly<Record<string, string>>,
    example: Readonly<AxTypedExample<any>>,
    metricFn: AxMetricFn
  ): Promise<number> {
    try {
      (flow as any).setAllNodeInstructions?.(cfg);
      const prediction = await (flow as any).forward(
        this.studentAI,
        example as any,
        {
          sampleCount: this.sampleCount,
        }
      );
      this.stats.totalCalls += 1;
      const score = await metricFn({
        prediction,
        example: example as AxExample,
      });
      if (typeof score === 'number' && !Number.isNaN(score)) {
        if (
          typeof this.targetScore === 'number'
            ? score >= this.targetScore
            : score >= 0.5
        )
          this.stats.successfulDemos += 1;
        return score;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async reflectModuleInstruction<OUT extends AxGenOut>(
    moduleName: string,
    currentInstruction: string,
    flow: Readonly<AxFlow<any, OUT>>,
    _nodes: ReadonlyArray<{ name: string; program: any }>,
    cfg: Record<string, string>,
    minibatch: readonly AxTypedExample<any>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<string> {
    // tuples unused but left for parity with single-module version
    const tuples: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }>[] = [] as any;
    const local: Array<{
      input: AxExample;
      prediction: unknown;
      score: number;
    }> = [];

    for (const ex of minibatch) {
      try {
        cfg[moduleName] = currentInstruction;
        (flow as any).setAllNodeInstructions?.(cfg);
        const pred = await (flow as any).forward(this.studentAI, ex as any, {
          sampleCount: this.sampleCount,
        });
        this.stats.totalCalls += 1;
        const score = await metricFn({
          prediction: pred,
          example: ex as AxExample,
        });
        local.push({
          input: ex as AxExample,
          prediction: pred,
          score: typeof score === 'number' ? score : 0,
        });
      } catch {
        local.push({ input: ex as AxExample, prediction: {}, score: 0 });
      }
    }

    const aiToUse: AxAIService =
      options?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI;

    const critic = ax(
      `moduleName:string "Target module", minibatch:json "Array of {input,prediction,score}", evalFeedback?:string[] "Evaluator feedback when available" -> feedbackSummary:string "Concise module-focused feedback"`
    );

    // Optional external feedback
    const external: string[] = [];
    const feedbackFn = (options as any)?.feedbackFn as
      | ((
          arg: Readonly<{ prediction: any; example: AxExample }>
        ) => string | string[] | undefined)
      | undefined;
    if (typeof feedbackFn === 'function') {
      for (const t of local) {
        const fb = feedbackFn({ prediction: t.prediction, example: t.input });
        if (fb) Array.isArray(fb) ? external.push(...fb) : external.push(fb);
      }
    }

    let feedbackSummary = '';
    try {
      const out = (await critic.forward(aiToUse, {
        moduleName,
        minibatch: local,
        evalFeedback: external,
      } as any)) as any;
      feedbackSummary =
        (out?.feedbackSummary as string | undefined)?.trim() || '';
    } catch {}

    const refl = ax(
      `moduleName:string "Target module", currentInstruction:string "Current instruction", feedbackSummary?:string "Summarized feedback", minibatch:json "Array of {input,prediction,score}" -> newInstruction:string "Improved instruction (1-6 sentences) for the module"`
    );

    try {
      const out = (await refl.forward(aiToUse, {
        moduleName,
        currentInstruction,
        feedbackSummary,
        minibatch: local,
      } as any)) as any;
      const instr = (out?.newInstruction as string | undefined)?.trim();
      if (instr && instr.length > 16) return instr;
    } catch {}

    return `${currentInstruction.trim()} Focus on step-by-step, module-specific reasoning and factual grounding.`.slice(
      0,
      2000
    );
  }

  private systemAwareMerge(
    candidates: ReadonlyArray<{ cfg: Record<string, string>; parent?: number }>,
    i: number,
    j: number,
    pickBetter: (idxA: number, idxB: number) => number
  ): Record<string, string> {
    // Trace ancestors
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
    const a = common ?? i; // fallback

    const cfgA = candidates[a]!.cfg;
    const cfgI = candidates[i]!.cfg;
    const cfgJ = candidates[j]!.cfg;

    const merged: Record<string, string> = {};
    const allKeys = new Set([
      ...Object.keys(cfgA),
      ...Object.keys(cfgI),
      ...Object.keys(cfgJ),
    ]);
    for (const k of allKeys) {
      const pa = cfgA[k];
      const pi = cfgI[k];
      const pj = cfgJ[k];
      if (pi === pa && pj !== pi) {
        merged[k] = pj!;
      } else if (pj === pa && pi !== pj) {
        merged[k] = pi!;
      } else if (pi !== pj && pi !== pa && pj !== pa) {
        const pick = pickBetter(i, j);
        merged[k] = pick === i ? pi! : pj!;
      } else {
        merged[k] = pi ?? pj ?? pa!;
      }
    }
    return merged;
  }
}
