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
    ).slice(0, Math.max(10, Math.min(200, this.minibatchSize * 3)));

    // Helpers local to Pareto compile
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

    const dominatesEps = (
      a: Readonly<Record<string, number>>,
      b: Readonly<Record<string, number>>,
      eps = 0
    ): boolean => {
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
    };

    const buildFront = (
      items: ReadonlyArray<{
        idx: number;
        scores: Readonly<Record<string, number>>;
      }>
    ): Array<{
      idx: number;
      scores: Readonly<Record<string, number>>;
      dominated: number;
    }> => {
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
          const A = items[i]!.scores;
          const B = items[j]!.scores;
          // B dominates A?
          if (dominatesEps(B, A, 0)) {
            isDominated = true;
            break;
          }
          if (dominatesEps(A, B, 0)) dominatedCount++;
        }
        if (!isDominated)
          front.push({
            idx: items[i]!.idx,
            scores: items[i]!.scores,
            dominated: dominatedCount,
          });
      }
      return front;
    };

    const computeCrowding = (
      front: ReadonlyArray<{
        idx: number;
        scores: Readonly<Record<string, number>>;
      }>
    ): Map<number, number> => {
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
        if (sorted.length > 0)
          dist.set(sorted[0]!.idx, Number.POSITIVE_INFINITY);
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
    };

    const hypervolume2D = (
      front: ReadonlyArray<Readonly<Record<string, number>>>
    ): number | undefined => {
      if (front.length === 0) return undefined;
      const keys = Object.keys(front[0] ?? {});
      if (keys.length !== 2) return undefined;
      const [k1, k2] = keys;
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
    };

    const weightedPick = (
      items: readonly number[],
      weights: readonly number[]
    ): number => {
      const sum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
      if (sum <= 0) return items[Math.floor(Math.random() * items.length)]!;
      let r = Math.random() * sum;
      for (let i = 0; i < items.length; i++) {
        const w = Number.isFinite(weights[i]!) ? (weights[i] as number) : 0;
        if (r < w) return items[i]!;
        r -= w;
      }
      return items[items.length - 1]!;
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

    // Initialize archive
    let archive = buildFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores }))
    ).map((p) => p.idx);
    let stagnation = 0;

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

      // Parent selection from archive by crowding distance
      const frontForCD = archive.map((idx) => ({
        idx,
        scores: candidates[idx]!.scores,
      }));
      const crowd = computeCrowding(frontForCD);
      const weights = archive.map((idx) => {
        const w = crowd.get(idx) ?? 0;
        return Number.isFinite(w) ? Math.max(w, 1e-6) : 1e6;
      });
      const parentIdx = weightedPick(archive, weights);

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

      if (useCrossover) {
        let second = weightedPick(archive, weights);
        if (second === parentIdx) second = (parentIdx + 1) % candidates.length;
        proposedCfg = this.systemAwareMerge(
          candidates,
          parentIdx,
          second,
          (ia, ib) => {
            // prefer the one with higher avg scalar on paretoSet
            const sa =
              Object.values(candidates[ia]!.scores).reduce((a, b) => a + b, 0) /
              Math.max(Object.keys(candidates[ia]!.scores).length, 1);
            const sb =
              Object.values(candidates[ib]!.scores).reduce((a, b) => a + b, 0) /
              Math.max(Object.keys(candidates[ib]!.scores).length, 1);
            return sa >= sb ? ia : ib;
          }
        );
        strategy = 'system_merge';
      } else {
        const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
        const newInstr = await this.reflectModuleInstruction(
          module.name,
          currentInstr,
          flow,
          nodes,
          { ...candidates[parentIdx]!.cfg },
          mini,
          // Scalar for reflection only
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
        'GEPA-Flow-Pareto',
        { strategy, paretoSetSize: paretoSet.length },
        childMiniScalar,
        { idx: parentIdx },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );

      const accepted = dominatesEps(
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

      const beforeSize = archive.length;
      const hvBefore =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
      archive = buildFront(
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
    const pareto = buildFront(
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
    this.recordParetoMetrics(
      pareto.length,
      candidates.length,
      'GEPA-Flow-Pareto',
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
