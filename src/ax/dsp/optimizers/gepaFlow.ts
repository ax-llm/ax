import type { AxAIService } from '../../ai/types.js';
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js';
import { AxBaseOptimizer, type AxParetoResult } from '../optimizer.js';
import type { AxGenOut } from '../types.js';
import { ax } from '../template.js';
import type { AxFlow } from '../../flow/flow.js';
import {
  buildParetoFront,
  hypervolume2D,
  average,
  avgVec,
  selectProgramCandidateFromInstanceFronts,
  removeDominatedProgramsByInstanceFronts,
} from './paretoUtils.js';
import type { AxGEPAAdapter } from './gepaAdapter.js';

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
  private mergesDue = 0;
  private totalMergesTested = 0;
  private lastIterFoundNewProgram = false;
  private rngState: number;
  private mergeAttemptKeys = new Set<string>();
  private mergeCompositionKeys = new Set<string>();
  private samplerState: {
    epoch: number;
    shuffled: number[];
    freq: Map<number, number>;
  } = {
    epoch: -1,
    shuffled: [],
    freq: new Map(),
  };

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

    // Seeded RNG for deterministic sampling/merges
    const seedRaw = (args as any)?.seed;
    const seedNum = Number.isFinite(seedRaw) ? Math.floor(Number(seedRaw)) : 0;
    this.rngState = seedNum && seedNum !== 0 ? seedNum : 123456789;

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
    this.mergesDue = 0;
    this.totalMergesTested = 0;
    this.lastIterFoundNewProgram = false;
    this.mergeAttemptKeys.clear();
    this.mergeCompositionKeys.clear();
    this.samplerState.epoch = -1;
    this.samplerState.shuffled = [];
    this.samplerState.freq.clear();
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
    const _startTime = Date.now();
    const flow = program as unknown as AxFlow<any, OUT>;
    this.validateExamples(examples);
    if (options?.auto) this.configureAuto(options.auto);

    // Discover modules
    const nodes = (flow as any).getNodePrograms?.() as
      | ReadonlyArray<{ name: string; program: any }>
      | undefined;
    if (!nodes || nodes.length === 0)
      throw new Error('AxGEPAFlow: flow has no nodes to optimize');

    // Validation/Pareto set and Feedback/Training set
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
    const feedbackSet =
      feedbackExamples && feedbackExamples.length > 0
        ? feedbackExamples
        : examples;

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

    // Scalarizer for multi-metric vectors
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

    // Track per-instance scalar scores on validation set for Algorithm 2 selection
    const perInstanceScores: number[][] = [];
    const evalOnSetScalar = async (
      cfg: Readonly<Record<string, string>>,
      set: readonly AxTypedExample<IN>[]
    ): Promise<number[]> => {
      const out: number[] = [];
      for (const ex of set) {
        const vec = await evalOne(cfg, ex);
        out.push(scalarize(vec));
      }
      return out;
    };
    perInstanceScores.push(await evalOnSetScalar(baseInstrs, paretoSet));

    // Initialize archive
    let archive = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores })),
      this.tieEpsilon
    ).map((p) => p.idx);
    let stagnation = 0;
    const triedMerges = new Set<string>();

    const rolloutBudgetRaw = (options as any)?.maxMetricCalls as number;
    if (!Number.isFinite(rolloutBudgetRaw) || rolloutBudgetRaw <= 0) {
      throw new Error(
        'AxGEPA-Flow: options.maxMetricCalls must be set to a positive integer'
      );
    }
    const rolloutBudget = Math.floor(rolloutBudgetRaw);

    for (let t = 0; t < this.numTrials; t++) {
      if (
        rolloutBudget !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudget))
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

      // Scheduled merge attempt (parity with source): only when mergesDue>0 and lastIterFoundNewProgram
      if (
        this.mergeMax > 0 &&
        this.mergesDue > 0 &&
        this.lastIterFoundNewProgram
      ) {
        // Build dominator merge candidates from reduced instance fronts
        const reducedFronts = removeDominatedProgramsByInstanceFronts(
          instanceFronts,
          perProgScores
        );
        const mergeCandidatesSet = new Set<number>();
        for (const f of reducedFronts)
          for (const p of f) mergeCandidatesSet.add(p);
        const mergeCandidates = Array.from(mergeCandidatesSet);

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

        // Try up to 10 random pairs to find a viable (i, j, ancestor)
        let picked: { i: number; j: number; a: number } | undefined;
        for (let attempts = 0; attempts < 10 && !picked; attempts++) {
          if (mergeCandidates.length < 2) break;
          let i = rngPick(mergeCandidates)!;
          let j = rngPick(mergeCandidates)!;
          if (i === j) continue;
          if (j < i) [i, j] = [j, i];
          const Ai = new Set(ancestors(i));
          const Aj = new Set(ancestors(j));
          if (Ai.has(j) || Aj.has(i)) continue; // cannot merge ancestor with descendant
          const commons = [...Ai].filter((x) => Aj.has(x));
          if (commons.length === 0) continue;

          // Filter ancestors using desirability (at least one module where ancestor matches one child but differs from the other)
          const desirables: number[] = [];
          for (const a of commons) {
            const cfgA = candidates[a]!.cfg;
            const cfgI = candidates[i]!.cfg;
            const cfgJ = candidates[j]!.cfg;
            let ok = false;
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
                ok = true;
                break;
              }
            }
            if (ok) desirables.push(a);
          }
          if (desirables.length === 0) continue;

          // Weight ancestors by aggregate score
          const weights = desirables.map((a) =>
            Math.max(1e-9, perProgScores[a]!)
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

          // Ancestor guard: Sa <= min(Si, Sj)
          const Sa = perProgScores[a]!;
          const Si = perProgScores[i]!;
          const Sj = perProgScores[j]!;
          if (Sa > Math.min(Si, Sj)) continue;
          const triKey = `${i}|${j}|${a}`;
          if (this.mergeAttemptKeys.has(triKey)) continue;
          this.mergeAttemptKeys.add(triKey);
          const key = `${i}|${j}|${a}`;
          if (triedMerges.has(key)) continue;
          picked = { i, j, a };
        }

        // Clear scheduling flag before reflective (parity)
        this.lastIterFoundNewProgram = false;

        if (picked) {
          const { i, j, a } = picked;
          // Build merged candidate (system-aware)
          const { cfg: mergedCfg, descSig } = this.systemAwareMergeWithSig(
            candidates,
            i,
            j,
            (ia, ib) => (perProgScores[ia]! >= perProgScores[ib]! ? ia : ib)
          );
          const compKey = `${Math.min(i, j)}|${Math.max(i, j)}|${descSig}`;
          if (this.mergeCompositionKeys.has(compKey)) continue;
          this.mergeCompositionKeys.add(compKey);

          // Targeted subsample selection on validation set (parents' per-instance subscores)
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
          // Fill remaining from rest
          const remaining = K - chosen.length;
          if (remaining > 0) {
            const unused = allIdx.filter((z) => !chosen.includes(z));
            chosen.push(
              ...pickSome(unused, Math.min(remaining, unused.length))
            );
          }
          const idxs = chosen.slice(0, Math.min(K, allIdx.length));

          const subsample = idxs.map((z) => paretoSet[z]!);
          const newSubScoresArr = await evalOnSetScalar(
            mergedCfg,
            subsample as any
          );
          const newSum = newSubScoresArr.reduce((a, b) => a + b, 0);
          const id1Sum = idxs.reduce((a, z) => a + (s1[z] ?? 0), 0);
          const id2Sum = idxs.reduce((a, z) => a + (s2[z] ?? 0), 0);

          if (newSum >= Math.max(id1Sum, id2Sum) + this.tieEpsilon) {
            // ACCEPT: full eval and add
            const childVec = await evalOnSet(mergedCfg, paretoSet);
            candidates.push({ cfg: mergedCfg, parent: a, scores: childVec });
            perInstanceScores.push(await evalOnSetScalar(mergedCfg, paretoSet));
            const beforeSize = archive.length;
            const hvBefore =
              hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
            archive = buildParetoFront(
              candidates.map((c, idx) => ({ idx, scores: c.scores })),
              this.tieEpsilon
            ).map((p) => p.idx);
            const hvAfter =
              hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;
            if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6)
              stagnation = 0;
            this.mergesDue -= 1;
            this.totalMergesTested += 1;
            triedMerges.add(`${Math.min(i, j)}|${Math.max(i, j)}|${a}`);
          }
          // Skip reflective this iteration
          continue;
        } else {
          // No merge attempted; fall through to reflective (flag cleared above)
        }
      }

      const parentIdx = selectProgramCandidateFromInstanceFronts(
        instanceFronts,
        perProgScores,
        () => this.rand()
      );

      // Clear merge flag before reflective
      this.lastIterFoundNewProgram = false;

      const mini = this.minibatch
        ? this.nextMinibatchIndices(feedbackSet.length, t).map(
            (z) => feedbackSet[z]!
          )
        : feedbackSet;

      // Skip reflective mutation if minibatch is already perfect
      if ((options as any)?.skipPerfectScore ?? true) {
        const perfect = Number((options as any)?.perfectScore ?? 1);
        const parentMiniScores = await evalOnSetScalar(
          candidates[parentIdx]!.cfg,
          mini as any
        );
        if (
          parentMiniScores.length > 0 &&
          parentMiniScores.every((s) => s >= perfect)
        ) {
          continue;
        }
      }

      // Scheduled merges are handled above; disable periodic merges
      const useCrossover = false as const;

      let proposedCfg: Record<string, string> = {
        ...candidates[parentIdx]!.cfg,
      };
      let strategy: 'reflective_mutation' | 'system_merge' =
        'reflective_mutation';

      const moduleIndex = t % nodes.length; // round-robin module selection
      const module = nodes[moduleIndex]!;

      // For adapter-based strict acceptance
      let adapterParentSum: number | undefined;
      let adapterChildSum: number | undefined;

      if (useCrossover && this.mergesUsed < this.mergeMax) {
        const second = (parentIdx + 1) % candidates.length;

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
          // Guard: skip if (i,j,a) tried before
          const i0 = Math.min(parentIdx, second);
          const j0 = Math.max(parentIdx, second);
          const key = `${i0}|${j0}|${common}`;
          if (!triedMerges.has(key)) {
            // Guard: S[a] > min(S[i], S[j])
            const Sa = scalarize(candidates[common!]!.scores);
            const Si = scalarize(candidates[parentIdx]!.scores);
            const Sj = scalarize(candidates[second]!.scores);
            if (Sa <= Math.min(Si, Sj)) {
              proposedCfg = this.systemAwareMerge(
                candidates,
                parentIdx,
                second,
                (ia, ib) => {
                  const sa = scalarize(candidates[ia]!.scores);
                  const sb = scalarize(candidates[ib]!.scores);
                  return sa >= sb ? ia : ib;
                }
              );
              strategy = 'system_merge';
              this.mergesUsed += 1;
              triedMerges.add(key);
            }
          }
        } else {
          const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
          const adapter = (options as any)?.gepaAdapter as
            | AxGEPAAdapter
            | undefined;
          let newInstr: string | undefined;
          if (adapter) {
            try {
              const evalParent = await adapter.evaluate(
                mini as any,
                { ...candidates[parentIdx]!.cfg },
                true
              );
              adapterParentSum = Array.isArray(evalParent?.scores)
                ? evalParent.scores.reduce((a, b) => a + (Number(b) || 0), 0)
                : undefined;
              const reflDs = adapter.make_reflective_dataset(
                { ...candidates[parentIdx]!.cfg },
                evalParent as any,
                [module.name]
              );
              const proposedMap = await (adapter.propose_new_texts?.(
                { ...candidates[parentIdx]!.cfg },
                reflDs,
                [module.name]
              ) as any);
              const proposedText = proposedMap?.[module.name];
              if (typeof proposedText === 'string' && proposedText.length > 0) {
                newInstr = proposedText;
              }
            } catch {}
          }
          if (!newInstr) {
            newInstr = await this.reflectModuleInstruction(
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
          }
          proposedCfg[module.name] = newInstr!;
          if (adapter && adapterParentSum !== undefined) {
            try {
              const evalChild = await adapter.evaluate(
                mini as any,
                proposedCfg,
                false
              );
              adapterChildSum = Array.isArray(evalChild?.scores)
                ? evalChild.scores.reduce((a, b) => a + (Number(b) || 0), 0)
                : undefined;
            } catch {}
          }
        }
      } else {
        const currentInstr = candidates[parentIdx]!.cfg[module.name]!;
        const adapter = (options as any)?.gepaAdapter as
          | AxGEPAAdapter
          | undefined;
        let newInstr: string | undefined;
        if (adapter) {
          try {
            const evalParent = await adapter.evaluate(
              mini as any,
              { ...candidates[parentIdx]!.cfg },
              true
            );
            adapterParentSum = Array.isArray(evalParent?.scores)
              ? evalParent.scores.reduce((a, b) => a + (Number(b) || 0), 0)
              : undefined;
            const reflDs = adapter.make_reflective_dataset(
              { ...candidates[parentIdx]!.cfg },
              evalParent as any,
              [module.name]
            );
            const proposedMap = await (adapter.propose_new_texts?.(
              { ...candidates[parentIdx]!.cfg },
              reflDs,
              [module.name]
            ) as any);
            const proposedText = proposedMap?.[module.name];
            if (typeof proposedText === 'string' && proposedText.length > 0) {
              newInstr = proposedText;
            }
          } catch {}
        }
        if (!newInstr) {
          newInstr = await this.reflectModuleInstruction(
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
        }
        proposedCfg[module.name] = newInstr!;
        if (adapter && adapterParentSum !== undefined) {
          try {
            const evalChild = await adapter.evaluate(
              mini as any,
              proposedCfg,
              false
            );
            adapterChildSum = Array.isArray(evalChild?.scores)
              ? evalChild.scores.reduce((a, b) => a + (Number(b) || 0), 0)
              : undefined;
          } catch {}
        }
      }

      // Strict acceptance on minibatch sum (parity with source)
      const parentMiniArr = await evalOnSetScalar(
        candidates[parentIdx]!.cfg,
        mini as any
      );
      const childMiniArr = await evalOnSetScalar(proposedCfg, mini as any);
      const parentMiniSum = parentMiniArr.reduce((a, b) => a + b, 0);
      const childMiniSum = childMiniArr.reduce((a, b) => a + b, 0);

      this.currentRound = t + 1;
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniSum,
        {
          modules: nodes.length,
          mutatedModule: module.name,
          totalRounds: this.numTrials,
        },
        'GEPA-Flow',
        { strategy, paretoSetSize: paretoSet.length },
        childMiniSum,
        { idx: parentIdx },
        { ...(options ?? {}), maxIterations: this.numTrials }
      );

      const accepted =
        childMiniSum > parentMiniSum + this.tieEpsilon &&
        (adapterParentSum === undefined ||
          adapterChildSum === undefined ||
          adapterChildSum > adapterParentSum + this.tieEpsilon);
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
        candidates.map((c, idx) => ({ idx, scores: c.scores })),
        this.tieEpsilon
      ).map((p) => p.idx);
      const hvAfter =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0;

      if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
        stagnation = 0;
      } else {
        stagnation++;
        if (stagnation >= this.earlyStoppingTrials) break;
      }
      // Schedule merge attempt for next iteration (parity)
      this.lastIterFoundNewProgram = true;
      if (this.mergeMax > 0 && this.totalMergesTested < this.mergeMax) {
        this.mergesDue += 1;
      }
    }

    // Build Pareto frontier and metrics
    const pareto = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores })),
      this.tieEpsilon
    );
    const bestScore =
      pareto.length > 0
        ? Math.max(...pareto.map((p) => scalarize(p.scores)))
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
    const _tuples: Array<{
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
    while (currEpoch >= this.samplerState.epoch) {
      this.updateSamplerShuffled(trainSize);
    }
    const base = (iteration * mb) % this.samplerState.shuffled.length;
    return this.samplerState.shuffled.slice(base, base + mb);
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
    for (const k of allKeys) {
      const pa = cfgA[k];
      const pi = cfgI[k];
      const pj = cfgJ[k];
      if (pi === pa && pj !== pi) {
        merged[k] = pj!;
        picks.push('j');
      } else if (pj === pa && pi !== pj) {
        merged[k] = pi!;
        picks.push('i');
      } else if (pi !== pj && pi !== pa && pj !== pa) {
        const pick = pickBetter(i, j);
        merged[k] = pick === i ? pi! : pj!;
        picks.push(pick === i ? 'i' : 'j');
      } else {
        merged[k] = pi ?? pj ?? pa!;
        picks.push('i');
      }
    }
    return { cfg: merged, descSig: picks.join('|') };
  }

  private rand(): number {
    // xorshift32
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;
    return ((this.rngState >>> 0) as number) / 4294967296;
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
