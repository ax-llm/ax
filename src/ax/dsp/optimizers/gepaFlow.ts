import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import { AxBaseOptimizer, AxOptimizedProgramImpl } from '../optimizer.js';
import type { AxGenOut } from '../types.js';
import { ax } from '../template.js';
import type { AxFlow } from '../../flow/flow.js';

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

    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  public override reset(): void {
    super.reset();
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold;
  }

  /**
   * Optimize an AxFlow by evolving per-node instructions
   */
  public async compile<IN, OUT extends AxGenOut>(
    program: Readonly<any>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<{
    bestScore: number;
    stats: ReturnType<AxGEPAFlow['getStats']>;
    optimizedProgram?: AxOptimizedProgramImpl<OUT>;
  }> {
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

    // Initialize base candidate from current node instructions
    const baseInstrs: Record<string, string> = {};
    for (const n of nodes)
      baseInstrs[n.name] = await this.getBaseInstruction(n.program);

    const candidates: {
      cfg: Record<string, string>;
      parent?: number;
      parent2?: number;
    }[] = [{ cfg: { ...baseInstrs } }];

    const valSet = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined;
    const paretoSet = (valSet && valSet.length > 0 ? valSet : examples).slice(
      0,
      Math.max(10, Math.min(200, this.minibatchSize * 3))
    );

    // Scores matrix (candidates x paretoSet)
    const S: number[][] = [];
    S.push(
      await this.evaluateOnSet(flow, candidates[0]!.cfg, paretoSet, metricFn)
    );

    let bestIdx = 0;
    let bestAvg = average(S[0]!);
    let stagnationRounds = 0;

    const rolloutBudget = (options as any)?.budgetRollouts as
      | number
      | undefined;

    for (let t = 0; t < this.numTrials; t++) {
      const parent = selectCandidatePareto(S);
      const parentIdx = parent.index;
      const moduleIndex = t % nodes.length; // round-robin
      const module = nodes[moduleIndex]!;

      const mini = this.minibatch
        ? randomSubset(examples, Math.min(this.minibatchSize, examples.length))
        : examples;

      const useCrossover =
        this.crossoverEvery > 0 &&
        (t + 1) % this.crossoverEvery === 0 &&
        candidates.length > 1;

      let proposedCfg: Record<string, string> = {
        ...candidates[parentIdx]!.cfg,
      };
      let strategy: 'reflective_mutation' | 'system_merge' =
        'reflective_mutation';

      // Baseline minibatch score for parent
      const parentMiniScore = await this.evaluateAvg(
        flow,
        candidates[parentIdx]!.cfg,
        mini,
        metricFn
      );

      if (useCrossover) {
        // Pick second parent and perform system-aware merge
        let second = selectCandidatePareto(S).index;
        if (second === parentIdx) second = (parentIdx + 1) % candidates.length;

        const merged = this.systemAwareMerge(
          candidates,
          parentIdx,
          second,
          // If both changed a module away from common ancestor, keep the one with higher validation avg
          (idxA, idxB) => {
            const avgA = average(S[idxA]!);
            const avgB = average(S[idxB]!);
            return avgA >= avgB ? idxA : idxB;
          }
        );
        proposedCfg = merged;
        strategy = 'system_merge';
      } else {
        // Reflectively mutate only the selected module
        const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
        const newInstr = await this.reflectModuleInstruction(
          module.name,
          currentInstr,
          flow,
          nodes,
          { ...candidates[parentIdx]!.cfg },
          mini,
          metricFn,
          options
        );
        proposedCfg[module.name] = newInstr;
      }

      const childMiniScore = await this.evaluateAvg(
        flow,
        proposedCfg,
        mini,
        metricFn
      );
      const accepted =
        childMiniScore > parentMiniScore + this.minImprovementThreshold ||
        Math.abs(childMiniScore - parentMiniScore) <= this.tieEpsilon;

      this.currentRound = t + 1;
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniScore,
        {
          modules: nodes.length,
          mutatedModule: module.name,
          totalRounds: this.numTrials,
        },
        'GEPA-Flow',
        { strategy },
        bestAvg,
        { idx: bestIdx },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );

      if (
        rolloutBudget !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudget))
      ) {
        this.onEarlyStop?.('Rollout budget exhausted', this.stats);
        break;
      }

      if (!accepted) {
        stagnationRounds++;
        if (
          this.earlyStoppingTrials > 0 &&
          stagnationRounds >= this.earlyStoppingTrials
        ) {
          this.onEarlyStop?.('No minibatch improvement', this.stats);
          break;
        }
        continue;
      }

      // Accept → add candidate and evaluate on full pareto set
      candidates.push({ cfg: proposedCfg, parent: parentIdx });
      const childIdx = candidates.length - 1;
      const childVec = await this.evaluateOnSet(
        flow,
        proposedCfg,
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
        if (
          this.earlyStoppingTrials > 0 &&
          stagnationRounds >= this.earlyStoppingTrials
        )
          break;
      }
    }

    const bestCfg = candidates[bestIdx]!.cfg;

    // Build optimized program placeholder; instruction carries JSON of per-node instructions for transparency
    const optimizedProgram = new AxOptimizedProgramImpl<OUT>({
      bestScore: bestAvg,
      stats: this.stats,
      instruction: JSON.stringify(bestCfg),
      demos: [],
      examples: [],
      optimizerType: 'GEPA-Flow',
      modelConfig: undefined,
      optimizationTime: Date.now() - startTime,
      totalRounds: this.currentRound,
      converged: this.stats.convergenceInfo.converged,
    });

    return { bestScore: bestAvg, stats: this.stats, optimizedProgram };
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
  const nCand = S.length;
  const nInst = S[0]?.length ?? 0;
  if (nCand <= 1 || nInst === 0) return { index: 0 };

  const bestPerInst: number[] = new Array(nInst).fill(-Infinity);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      bestPerInst[i] = Math.max(bestPerInst[i], S[k]![i]!);
  }

  const appears: number[] = new Array(nCand).fill(0);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      if (S[k]![i]! === bestPerInst[i]) appears[k]! += 1;
  }

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
