import type { AxAIService } from '../../ai/types.js'
import type {
  AxCompileOptions,
  AxExample,
  AxMetricFn,
  AxMultiMetricFn,
  AxOptimizerArgs,
  AxTypedExample,
} from '../common_types.js'
import type { AxGen } from '../generate.js'
import {
  AxBaseOptimizer,
  type AxParetoResult,
  AxOptimizedProgramImpl,
} from '../optimizer.js'
import type { AxGenOut } from '../types.js'
import { ax } from '../template.js'
import {
  buildParetoFront,
  hypervolume2D,
  average,
  avgVec,
  selectProgramCandidateFromInstanceFronts,
  removeDominatedProgramsByInstanceFronts,
} from './paretoUtils.js'
import type { AxGEPAAdapter } from './gepaAdapter.js'

/** Single-module GEPA (reflective prompt evolution with Pareto sampling) */
export class AxGEPA extends AxBaseOptimizer {
  // Core knobs
  private numTrials: number
  private minibatch: boolean
  private minibatchSize: number
  private earlyStoppingTrials: number
  private minImprovementThreshold: number
  private sampleCount: number
  private paretoSetSize: number

  // GEPA+ enhancements
  private crossoverEvery: number
  private tieEpsilon: number
  private feedbackMemorySize: number
  private feedbackMemory: string[] = []
  private mergeMax: number
  private mergesUsed = 0
  private mergesDue = 0
  private totalMergesTested = 0
  private lastIterFoundNewProgram = false
  private mergeAttemptKeys = new Set<string>()
  private mergeCompositionKeys = new Set<string>()

  private rngState: number = 123456789
  private samplerState: {
    epoch: number
    shuffled: number[]
    freq: Map<number, number>
  } = {
    epoch: -1,
    shuffled: [],
    freq: new Map(),
  }

  // Local histories for result object
  private localScoreHistory: number[] = []
  private localConfigurationHistory: Record<string, unknown>[] = []

  constructor(args: Readonly<AxOptimizerArgs>) {
    super(args)

    const seedRaw = (args as any)?.seed
    const seedNum = Number.isFinite(seedRaw) ? Math.floor(Number(seedRaw)) : 0
    this.rngState = seedNum && seedNum !== 0 ? seedNum : 123456789

    this.numTrials = args.numTrials ?? 30
    this.minibatch = args.minibatch ?? true
    this.minibatchSize = args.minibatchSize ?? 20
    this.earlyStoppingTrials = args.earlyStoppingTrials ?? 5
    this.minImprovementThreshold = args.minImprovementThreshold ?? 0.0
    this.sampleCount = args.sampleCount ?? 1
    // How many validation instances to track for Pareto set (cap cost)
    const argPareto = (args as any)?.paretoSetSize as number | undefined
    this.paretoSetSize =
      argPareto && argPareto > 0
        ? Math.min(1000, Math.max(5, Math.floor(argPareto)))
        : Math.max(10, Math.min(200, this.minibatchSize * 3))

    // GEPA+ defaults
    const argCrossoverEvery = (args as any)?.crossoverEvery as
      | number
      | undefined
    this.crossoverEvery = Math.max(
      0,
      Math.floor(
        argCrossoverEvery ?? Math.max(3, Math.floor(this.numTrials / 4))
      )
    )
    const argTieEps = (args as any)?.tieEpsilon as number | undefined
    this.tieEpsilon = Number.isFinite(argTieEps!) ? (argTieEps as number) : 0
    const argFbMem = (args as any)?.feedbackMemorySize as number | undefined
    this.feedbackMemorySize = Math.max(0, Math.floor(argFbMem ?? 4))
    const argMergeMax = (args as any)?.mergeMax as number | undefined
    this.mergeMax = Math.max(0, Math.floor(argMergeMax ?? 0))
    this.mergesUsed = 0

    // Hook convergence threshold to base stats
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold
  }

  public override reset(): void {
    super.reset()
    this.stats.convergenceInfo.convergenceThreshold =
      this.minImprovementThreshold
    this.localScoreHistory = []
    this.localConfigurationHistory = []
    this.feedbackMemory = []
    this.mergesUsed = 0
    this.mergesDue = 0
    this.totalMergesTested = 0
    this.lastIterFoundNewProgram = false
    this.mergeAttemptKeys.clear()
    this.mergeCompositionKeys.clear()
    this.samplerState.epoch = -1
    this.samplerState.shuffled = []
    this.samplerState.freq.clear()
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
    const _startTime = Date.now()
    this.validateExamples(examples)
    if (options?.auto) this.configureAuto(options.auto)

    const validationExamples = (options as any)?.validationExamples as
      | readonly AxTypedExample<IN>[]
      | undefined
    const feedbackExamples = (options as any)?.feedbackExamples as
      | readonly AxTypedExample<IN>[]
      | undefined

    const paretoSet = (
      validationExamples && validationExamples.length > 0
        ? validationExamples
        : examples
    ).slice(0, this.paretoSetSize)

    const feedbackSet =
      feedbackExamples && feedbackExamples.length > 0
        ? feedbackExamples
        : examples

    // Evaluate one example -> objective vector
    const evalOne = async (
      instruction: string,
      ex: Readonly<AxTypedExample<IN>>
    ): Promise<Record<string, number>> => {
      try {
        ;(program as any).setInstruction?.(instruction)
        const prediction = await program.forward(
          this.studentAI,
          ex as IN,
          {
            sampleCount: this.sampleCount,
          } as any
        )
        this.stats.totalCalls += 1
        const scores = await (metricFn as unknown as AxMultiMetricFn)({
          prediction,
          example: ex as any,
        })
        return scores || {}
      } catch {
        return {}
      }
    }

    // Evaluate on set -> average vector
    const evalOnSet = async (
      instruction: string,
      set: readonly AxTypedExample<IN>[]
    ): Promise<Record<string, number>> => {
      const vecs: Record<string, number>[] = []
      for (const ex of set) vecs.push(await evalOne(instruction, ex))
      return avgVec(vecs)
    }

    // Start with base instruction
    const baseInstruction = await this.getBaseInstruction(program)
    const candidates: {
      instruction: string
      parent?: number
      scores: Record<string, number>
    }[] = [
      {
        instruction: baseInstruction,
        parent: undefined,
        scores: await evalOnSet(baseInstruction, paretoSet),
      },
    ]

    // Scalarizer for multi-metric vectors
    const scalarize = (v: Readonly<Record<string, number>>): number => {
      const key = (options as any)?.paretoMetricKey as string | undefined
      const fn = (options as any)?.paretoScalarize as
        | ((scores: Readonly<Record<string, number>>) => number)
        | undefined
      if (typeof fn === 'function') return fn(v)
      if (key) return Number.isFinite(v[key] as number) ? (v[key] as number) : 0
      const vals = Object.values(v)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    }

    // Track per-instance scalar scores on the validation/Pareto set for Algorithm 2 selection
    const perInstanceScores: number[][] = []
    const evalOnSetScalar = async (
      instruction: string,
      set: readonly AxTypedExample<IN>[]
    ): Promise<number[]> => {
      const out: number[] = []
      for (const ex of set) {
        const vec = await evalOne(instruction, ex)
        out.push(scalarize(vec))
      }
      return out
    }
    perInstanceScores.push(await evalOnSetScalar(baseInstruction, paretoSet))

    // Parent selection helper via instance-front frequency (source-style)
    const _selectParentIdx = (): number => {
      const nInst = perInstanceScores[0]?.length ?? 0
      const instanceFronts: Array<Set<number>> = []
      for (let i = 0; i < nInst; i++) {
        let best = Number.NEGATIVE_INFINITY
        const front = new Set<number>()
        for (let k = 0; k < perInstanceScores.length; k++) {
          const v = perInstanceScores[k]![i]!
          if (v > best + this.tieEpsilon) {
            best = v
            front.clear()
            front.add(k)
          } else if (Math.abs(v - best) <= this.tieEpsilon) {
            front.add(k)
          }
        }
        instanceFronts.push(front)
      }
      const perProgScores = perInstanceScores.map((arr) => average(arr))
      return selectProgramCandidateFromInstanceFronts(
        instanceFronts,
        perProgScores
      )
    }

    const optLogger = this.getOptimizerLogger(options)
    optLogger?.({
      name: 'OptimizationStart',
      value: {
        optimizerType: 'GEPA',
        exampleCount: examples.length,
        validationCount: paretoSet.length,
        config: { numTrials: this.numTrials, minibatch: this.minibatch },
      },
    })

    let stagnation = 0

    // Initialize Pareto archive (indices into candidates)
    let archive = buildParetoFront(
      candidates.map((c, idx) => ({ idx, scores: c.scores })),
      this.tieEpsilon
    ).map((p) => p.idx)

    let _prevHypervolume: number | undefined
    const rolloutBudgetParetoRaw = (options as any)?.maxMetricCalls as number
    if (
      !Number.isFinite(rolloutBudgetParetoRaw) ||
      rolloutBudgetParetoRaw <= 0
    ) {
      throw new Error(
        'AxGEPA: options.maxMetricCalls must be set to a positive integer'
      )
    }
    const rolloutBudgetPareto = Math.floor(rolloutBudgetParetoRaw)

    for (let t = 0; t < this.numTrials; t++) {
      if (
        rolloutBudgetPareto !== undefined &&
        this.stats.totalCalls >= Math.max(1, Math.floor(rolloutBudgetPareto))
      ) {
        break
      }
      // Parent selection via per-instance fronts (frequency sampling)
      const nInst = perInstanceScores[0]?.length ?? 0
      const instanceFronts: Array<Set<number>> = []
      for (let i = 0; i < nInst; i++) {
        let best = Number.NEGATIVE_INFINITY
        const front = new Set<number>()
        for (let k = 0; k < perInstanceScores.length; k++) {
          const v = perInstanceScores[k]![i]!
          if (v > best + this.tieEpsilon) {
            best = v
            front.clear()
            front.add(k)
          } else if (Math.abs(v - best) <= this.tieEpsilon) {
            front.add(k)
          }
        }
        instanceFronts.push(front)
      }
      const perProgScores = perInstanceScores.map((arr) => average(arr))

      // Scheduled merge attempt (parity with source) before reflective
      if (
        this.mergeMax > 0 &&
        this.mergesDue > 0 &&
        this.lastIterFoundNewProgram
      ) {
        const ancestors = (idx: number): number[] => {
          const path: number[] = []
          let cur: number | undefined = idx
          while (cur !== undefined) {
            path.push(cur)
            cur = candidates[cur]?.parent
          }
          return path
        }
        const rngPick = <T>(arr: readonly T[]): T | undefined =>
          arr.length ? arr[Math.floor(this.rand() * arr.length)]! : undefined
        // Merge candidates = union of reduced instance fronts
        const reducedFronts = removeDominatedProgramsByInstanceFronts(
          instanceFronts,
          perProgScores
        )
        const mergeCandidatesSet = new Set<number>()
        for (const f of reducedFronts)
          for (const p of f) mergeCandidatesSet.add(p)
        const mergeCandidates = Array.from(mergeCandidatesSet)

        let picked: { i: number; j: number; a: number } | undefined
        for (let attempts = 0; attempts < 10 && !picked; attempts++) {
          if (mergeCandidates.length < 2) break
          let i = rngPick(mergeCandidates)!
          let j = rngPick(mergeCandidates)!
          if (i === j) continue
          if (j < i) [i, j] = [j, i]
          const Ai = new Set(ancestors(i))
          const Aj = new Set(ancestors(j))
          if (Ai.has(j) || Aj.has(i)) continue
          const commons = [...Ai].filter((x) => Aj.has(x))
          if (commons.length === 0) continue
          // Choose ancestor weighted by valset agg score
          const weights = commons.map((a) => Math.max(1e-9, perProgScores[a]!))
          let r = this.rand() * weights.reduce((s, w) => s + w, 0)
          let a = commons[commons.length - 1]!
          for (let idx = 0; idx < commons.length; idx++) {
            if (r < weights[idx]!) {
              a = commons[idx]!
              break
            }
            r -= weights[idx]!
          }
          picked = { i, j, a }
        }

        // Clear scheduling flag before reflective attempt (parity)
        this.lastIterFoundNewProgram = false

        if (picked) {
          const { i, j, a } = picked
          // Ancestor guard + desirability filter for single-component merge
          const Sa = perProgScores[a]!
          const Si = perProgScores[i]!
          const Sj = perProgScores[j]!
          const instrA = candidates[a]!.instruction
          const instrI = candidates[i]!.instruction
          const instrJ = candidates[j]!.instruction
          const desirable =
            (instrI === instrA && instrJ !== instrI) ||
            (instrJ === instrA && instrI !== instrJ)
          let allowed = Sa <= Math.min(Si, Sj) && desirable
          let childInstrMerged = ''
          let descSig: 'i' | 'j' = 'i'
          let attempted = false
          if (allowed) {
            const triKey = `${i}|${j}|${a}`
            if (this.mergeAttemptKeys.has(triKey)) {
              allowed = false
            } else {
              if (instrI === instrA && instrJ !== instrI) {
                childInstrMerged = instrJ
                descSig = 'j'
              } else if (instrJ === instrA && instrI !== instrJ) {
                childInstrMerged = instrI
                descSig = 'i'
              } else if (
                instrI !== instrA &&
                instrJ !== instrA &&
                instrI !== instrJ
              ) {
                if (Si > Sj || (Si === Sj && this.rand() < 0.5)) {
                  childInstrMerged = instrI
                  descSig = 'i'
                } else {
                  childInstrMerged = instrJ
                  descSig = 'j'
                }
              } else {
                childInstrMerged = instrI
                descSig = 'i'
              }
              const compKey = `${Math.min(i, j)}|${Math.max(i, j)}|${descSig}`
              if (this.mergeCompositionKeys.has(compKey)) {
                allowed = false
              } else {
                this.mergeAttemptKeys.add(triKey)
                this.mergeCompositionKeys.add(compKey)
                // Targeted subsample selection on validation set
                const s1 = perInstanceScores[i]!
                const s2 = perInstanceScores[j]!
                const allIdx = Array.from({ length: s1.length }, (_, z) => z)
                const p1 = allIdx.filter((z) => (s1[z] ?? 0) > (s2[z] ?? 0))
                const p2 = allIdx.filter((z) => (s2[z] ?? 0) > (s1[z] ?? 0))
                const p3 = allIdx.filter(
                  (z) => !(p1.includes(z) || p2.includes(z))
                )
                const K = 5
                const nEach = Math.ceil(K / 3)
                const pickSome = (arr: number[], k: number): number[] => {
                  if (k <= 0 || arr.length === 0) return []
                  if (arr.length <= k) return [...arr]
                  const out: number[] = []
                  const used = new Set<number>()
                  while (out.length < k) {
                    const idx = Math.floor(this.rand() * arr.length)
                    if (!used.has(idx)) {
                      used.add(idx)
                      out.push(arr[idx]!)
                    }
                  }
                  return out
                }
                const chosen: number[] = []
                chosen.push(...pickSome(p1, Math.min(nEach, p1.length)))
                chosen.push(...pickSome(p2, Math.min(nEach, p2.length)))
                const rem = K - chosen.length
                chosen.push(...pickSome(p3, Math.max(0, rem)))
                const remaining = K - chosen.length
                if (remaining > 0) {
                  const unused = allIdx.filter((z) => !chosen.includes(z))
                  chosen.push(
                    ...pickSome(unused, Math.min(remaining, unused.length))
                  )
                }
                const idxs = chosen.slice(0, Math.min(K, allIdx.length))

                const subsample = idxs.map((z) => paretoSet[z]!)
                attempted = true
                const newSubArr = await evalOnSetScalar(
                  childInstrMerged,
                  subsample
                )
                const newSum = newSubArr.reduce((a, b) => a + b, 0)
                const id1Sum = idxs.reduce((a, z) => a + (s1[z] ?? 0), 0)
                const id2Sum = idxs.reduce((a, z) => a + (s2[z] ?? 0), 0)

                if (newSum >= Math.max(id1Sum, id2Sum) + this.tieEpsilon) {
                  const childVec = await evalOnSet(childInstrMerged, paretoSet)
                  candidates.push({
                    instruction: childInstrMerged,
                    parent: a,
                    scores: childVec,
                  })
                  perInstanceScores.push(
                    await evalOnSetScalar(childInstrMerged, paretoSet)
                  )
                  const beforeSize = archive.length
                  const hvBefore =
                    hypervolume2D(
                      archive.map((idx) => candidates[idx]!.scores)
                    ) ?? 0
                  archive = buildParetoFront(
                    candidates.map((c, idx) => ({ idx, scores: c.scores })),
                    this.tieEpsilon
                  ).map((p) => p.idx)
                  const hvAfter =
                    hypervolume2D(
                      archive.map((idx) => candidates[idx]!.scores)
                    ) ?? 0
                  if (
                    archive.length > beforeSize ||
                    hvAfter > hvBefore + 1e-6
                  ) {
                    stagnation = 0
                  }
                  this.mergesDue -= 1
                  this.totalMergesTested += 1
                }
              }
            }
          }
          if (attempted) {
            // Skip reflective this iteration
            continue
          }
        }
      }

      const parentIdx = selectProgramCandidateFromInstanceFronts(
        instanceFronts,
        perProgScores,
        () => this.rand()
      )

      const mini = this.minibatch
        ? this.nextMinibatchIndices(feedbackSet.length, t).map(
            (z: number) => feedbackSet[z]!
          )
        : feedbackSet

      // Skip reflection if all minibatch scores are perfect (default: true)
      if ((options as any)?.skipPerfectScore ?? true) {
        const perfect = Number((options as any)?.perfectScore ?? 1)
        const parentMiniScores = await evalOnSetScalar(
          candidates[parentIdx]!.instruction,
          mini
        )
        if (
          parentMiniScores.length > 0 &&
          parentMiniScores.every((s) => s >= perfect)
        ) {
          continue
        }
      }

      const useMerge = false as const

      let childInstr = candidates[parentIdx]!.instruction
      let strategy: 'reflective_mutation' | 'merge' = 'reflective_mutation'
      // For adapter-based strict acceptance
      let adapterParentSum: number | undefined
      let adapterChildSum: number | undefined

      if (useMerge) {
        const second = (parentIdx + 1) % candidates.length
        childInstr = await this.mergeInstructions(
          candidates[parentIdx]!.instruction,
          candidates[second]!.instruction,
          options
        )
        strategy = 'merge'
        this.mergesUsed += 1
      } else {
        const adapter = (options as any)?.gepaAdapter as
          | AxGEPAAdapter
          | undefined
        if (adapter) {
          try {
            const parentMap = {
              instruction: candidates[parentIdx]!.instruction,
            }
            const evalParent = await adapter.evaluate(
              mini as any,
              parentMap,
              true
            )
            adapterParentSum = Array.isArray(evalParent?.scores)
              ? evalParent.scores.reduce((a, b) => a + (Number(b) || 0), 0)
              : undefined
            const reflDs = adapter.make_reflective_dataset(
              parentMap,
              evalParent as any,
              ['instruction']
            )
            const proposedMap = await (adapter.propose_new_texts?.(
              parentMap,
              reflDs,
              ['instruction']
            ) as any)
            const proposedText =
              proposedMap?.instruction ??
              (proposedMap ? (Object.values(proposedMap)[0] as any) : undefined)
            if (typeof proposedText === 'string' && proposedText.length > 0) {
              childInstr = proposedText
            } else {
              childInstr = await this.reflectInstruction(
                candidates[parentIdx]!.instruction,
                program,
                mini,
                async ({ prediction, example }) => {
                  const scores = await (metricFn as unknown as AxMultiMetricFn)(
                    {
                      prediction,
                      example,
                    }
                  )
                  const vals = Object.values(scores || {})
                  return vals.length
                    ? vals.reduce((a, b) => a + b, 0) / vals.length
                    : 0
                },
                options
              )
            }
          } catch {
            childInstr = await this.reflectInstruction(
              candidates[parentIdx]!.instruction,
              program,
              mini,
              async ({ prediction, example }) => {
                const scores = await (metricFn as unknown as AxMultiMetricFn)({
                  prediction,
                  example,
                })
                const vals = Object.values(scores || {})
                return vals.length
                  ? vals.reduce((a, b) => a + b, 0) / vals.length
                  : 0
              },
              options
            )
          }
          if (adapterParentSum !== undefined) {
            try {
              const evalChild = await adapter.evaluate(
                mini as any,
                { instruction: childInstr },
                false
              )
              adapterChildSum = Array.isArray(evalChild?.scores)
                ? evalChild.scores.reduce((a, b) => a + (Number(b) || 0), 0)
                : undefined
            } catch {}
          }
        } else {
          childInstr = await this.reflectInstruction(
            candidates[parentIdx]!.instruction,
            program,
            mini,
            async ({ prediction, example }) => {
              const scores = await (metricFn as unknown as AxMultiMetricFn)({
                prediction,
                example,
              })
              const vals = Object.values(scores || {})
              return vals.length
                ? vals.reduce((a, b) => a + b, 0) / vals.length
                : 0
            },
            options
          )
        }
      }

      const parentMiniArr = await evalOnSetScalar(
        candidates[parentIdx]!.instruction,
        mini
      )
      const childMiniArr = await evalOnSetScalar(childInstr, mini)
      const parentMiniSum = parentMiniArr.reduce((a, b) => a + b, 0)
      const childMiniSum = childMiniArr.reduce((a, b) => a + b, 0)

      this.currentRound = t + 1
      await this.updateOptimizationProgress(
        this.currentRound,
        childMiniSum,
        {
          instructionLen: childInstr.length,
          parent: parentIdx,
          totalRounds: this.numTrials,
        },
        'GEPA',
        { strategy, paretoSetSize: paretoSet.length },
        childMiniSum,
        {
          instructionLen: candidates[parentIdx]!.instruction.length,
          idx: parentIdx,
        },
        { ...(options ?? {}), maxIterations: this.numTrials }
      )

      const accepted =
        childMiniSum > parentMiniSum + this.tieEpsilon &&
        (adapterParentSum === undefined ||
          adapterChildSum === undefined ||
          adapterChildSum > adapterParentSum + this.tieEpsilon)
      if (!accepted) {
        if (++stagnation >= this.earlyStoppingTrials) break
        continue
      }

      // Full evaluation on validation set (vector) and archive update
      const childVec = await evalOnSet(childInstr, paretoSet)
      candidates.push({
        instruction: childInstr,
        parent: parentIdx,
        scores: childVec,
      })
      // Store per-instance scalar scores for Algorithm 2 selection
      perInstanceScores.push(await evalOnSetScalar(childInstr, paretoSet))

      const beforeSize = archive.length
      const hvBefore =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0
      archive = buildParetoFront(
        candidates.map((c, idx) => ({ idx, scores: c.scores })),
        this.tieEpsilon
      ).map((p) => p.idx)
      const hvAfter =
        hypervolume2D(archive.map((idx) => candidates[idx]!.scores)) ?? 0

      // Reset stagnation if archive improved (hypervolume or size)
      if (archive.length > beforeSize || hvAfter > hvBefore + 1e-6) {
        stagnation = 0
      } else {
        stagnation++
        if (stagnation >= this.earlyStoppingTrials) break
      }
      // Schedule merge attempt for next iteration (parity)
      this.lastIterFoundNewProgram = true
      if (this.mergeMax > 0 && this.totalMergesTested < this.mergeMax) {
        this.mergesDue += 1
      }
    }

    // Build Pareto frontier of candidate average vectors
    const pareto = buildParetoFront(
      candidates.map((c, idx) => ({
        idx,
        scores: c.scores,
      })),
      this.tieEpsilon
    )

    // Pick bestScore as max scalarized score on frontier
    const bestScore =
      pareto.length > 0
        ? Math.max(...pareto.map((p) => scalarize(p.scores)))
        : 0

    // Identify best candidate on the front (by scalarized score)
    let bestCandidateIdx: number | undefined
    if (pareto.length > 0) {
      let maxS = Number.NEGATIVE_INFINITY
      for (const p of pareto) {
        const s = scalarize(p.scores)
        if (s > maxS) {
          maxS = s
          bestCandidateIdx = p.idx
        }
      }
    }

    // Compute hypervolume (2D only)
    const hv = hypervolume2D(pareto.map((p) => p.scores))

    this.stats.convergenceInfo.converged = true

    // Record metrics for monitoring
    this.recordParetoMetrics(pareto.length, candidates.length, 'GEPA', hv)

    // Build a unified optimized program (mirrors MiPRO) for the selected best candidate
    const optimizationTime = Date.now() - _startTime
    const optimizedProgram =
      typeof bestCandidateIdx === 'number'
        ? new AxOptimizedProgramImpl<OUT>({
            bestScore,
            stats: this.stats,
            instruction: candidates[bestCandidateIdx]!.instruction,
            demos: [],
            examples: examples as unknown as any[],
            modelConfig: undefined,
            optimizerType: 'GEPA',
            optimizationTime,
            totalRounds: this.numTrials,
            converged: this.stats.convergenceInfo.converged,
          })
        : undefined

    // Generate optimization insights report
    this.generateOptimizationReport(pareto, hv, bestScore)

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
      // Extra field (not part of AxParetoResult): unified optimized program for easy save/apply
      optimizedProgram,
    } as AxParetoResult<OUT>
  }

  /** Lightweight auto presets */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numTrials = 10
        this.minibatch = true
        this.minibatchSize = 15
        break
      case 'medium':
        this.numTrials = 20
        this.minibatch = true
        this.minibatchSize = 25
        break
      case 'heavy':
        this.numTrials = 35
        this.minibatch = true
        this.minibatchSize = 35
        break
    }
  }

  // --- Helpers ---

  private async getBaseInstruction<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>
  ): Promise<string> {
    try {
      // If program exposes instruction via signature, prefer it
      const sig: any = program.getSignature?.()
      if (
        sig &&
        typeof sig.instruction === 'string' &&
        sig.instruction.length > 0
      ) {
        return sig.instruction as string
      }
    } catch {}
    return 'Follow the task precisely. Be concise, correct, and consistent.'
  }

  private async evaluateOnSet<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    set: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn
  ): Promise<number[]> {
    const out: number[] = []
    for (const ex of set) {
      const s = await this.evaluateOne(program, instruction, ex, metricFn)
      out.push(s)
    }
    return out
  }

  private async evaluateAvg<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    set: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn
  ): Promise<number> {
    const arr = await this.evaluateOnSet(program, instruction, set, metricFn)
    return arr.length > 0 ? average(arr) : 0
  }

  private async evaluateOne<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    instruction: string,
    example: Readonly<AxTypedExample<IN>>,
    metricFn: AxMetricFn
  ): Promise<number> {
    try {
      // Apply instruction (best-effort) before calling forward
      ;(program as any).setInstruction?.(instruction)

      const prediction = await program.forward(
        this.studentAI,
        example as IN,
        {
          sampleCount: this.sampleCount,
          // Use the base default majority-picker from MiPRO if available via AxBaseOptimizer
          // leave undefined to use program/model defaults when sampleCount===1
        } as any
      )

      this.stats.totalCalls += 1
      const score = await metricFn({
        prediction,
        example: example as AxExample,
      })
      if (typeof score === 'number' && !Number.isNaN(score)) {
        const threshold =
          typeof this.targetScore === 'number' ? this.targetScore : 0.5
        if (score >= threshold) this.stats.successfulDemos += 1
        return score
      }
      return 0
    } catch (err) {
      const logger = this.getLogger()
      logger?.({ name: 'Notification', id: 'gepa_eval', value: String(err) })
      return 0
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
      input: AxExample
      prediction: unknown
      score: number
    }> = []
    for (const ex of minibatch) {
      try {
        ;(program as any).setInstruction?.(currentInstruction)
        const pred = await program.forward(
          this.studentAI,
          ex as IN,
          {
            sampleCount: this.sampleCount,
          } as any
        )
        this.stats.totalCalls += 1
        const score = await metricFn({
          prediction: pred,
          example: ex as AxExample,
        })
        tuples.push({
          input: ex as AxExample,
          prediction: pred,
          score: typeof score === 'number' ? score : 0,
        })
      } catch {
        tuples.push({ input: ex as AxExample, prediction: {}, score: 0 })
      }
    }

    const aiToUse: AxAIService =
      (options as any)?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI

    // Summarize feedback and maintain short memory
    const critic = ax(
      `minibatch:json "Array of {input,prediction,score}", evalFeedback?:string[] "Evaluator feedback per case if available" -> feedbackSummary:string "Concise feedback: common errors, missing constraints, desired changes"`
    )

    // Optional: external feedback μf
    const externalFeedback: string[] = []
    const feedbackFn:
      | ((
          arg: Readonly<{ prediction: any; example: AxExample }>
        ) => string | string[] | undefined)
      | undefined = (options as any)?.feedbackFn
    if (typeof feedbackFn === 'function') {
      for (let i = 0; i < tuples.length; i++) {
        try {
          const fb = feedbackFn({
            prediction: tuples[i]!.prediction,
            example: tuples[i]!.input,
          })
          if (fb) {
            if (Array.isArray(fb)) externalFeedback.push(...fb)
            else externalFeedback.push(fb)
          }
        } catch {}
      }
    }

    let feedbackSummary = ''
    try {
      const out = (await critic.forward(aiToUse, {
        minibatch: tuples,
        evalFeedback: externalFeedback,
      } as any)) as any
      feedbackSummary =
        (out?.feedbackSummary as string | undefined)?.trim() || ''
      if (feedbackSummary) {
        this.feedbackMemory.unshift(feedbackSummary)
        if (this.feedbackMemory.length > this.feedbackMemorySize)
          this.feedbackMemory.pop()
      }
    } catch {}

    // Use a small reflective update program to produce an improved instruction
    const refl = ax(
      `currentInstruction:string "Current instruction", feedbackSummary?:string "Summarized feedback", recentFeedback?:string[] "Past feedback memory", minibatch:json "Array of {input,prediction,score}" -> newInstruction:string "Improved instruction within 1-6 sentences."`
    )

    try {
      const out = (await refl.forward(aiToUse, {
        currentInstruction,
        feedbackSummary,
        recentFeedback: this.feedbackMemory,
        minibatch: tuples,
      } as any)) as any
      const instr = (out?.newInstruction as string | undefined)?.trim()
      if (instr && instr.length > 16) return instr
    } catch {}

    // Fallback: tweak the instruction minimally
    return `${currentInstruction.trim()} Focus on step-by-step evidence-based reasoning. Avoid hallucinations.`.slice(
      0,
      2000
    )
  }

  private updateSamplerShuffled(trainSize: number): void {
    const ids = Array.from({ length: trainSize }, (_, i) => i)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    }
    for (const i of ids)
      this.samplerState.freq.set(i, (this.samplerState.freq.get(i) ?? 0) + 1)
    const mb = this.minibatchSize
    const mod = trainSize % mb
    const numToPad = mod === 0 ? 0 : mb - mod
    const candidates = Array.from({ length: trainSize }, (_, i) => i).sort(
      (a, b) =>
        (this.samplerState.freq.get(a) ?? 0) -
        (this.samplerState.freq.get(b) ?? 0)
    )
    const padded = [...ids]
    for (let k = 0; k < numToPad; k++) {
      const id = candidates[k % candidates.length]!
      padded.push(id)
      this.samplerState.freq.set(id, (this.samplerState.freq.get(id) ?? 0) + 1)
    }
    this.samplerState.shuffled = padded
    this.samplerState.epoch += 1
  }

  private nextMinibatchIndices(trainSize: number, iteration: number): number[] {
    if (this.samplerState.epoch === -1) {
      this.samplerState.epoch = 0
      this.updateSamplerShuffled(trainSize)
    }
    const mb = this.minibatchSize
    const blocksPerEpoch = Math.max(
      1,
      Math.floor(this.samplerState.shuffled.length / mb)
    )
    const currEpoch = Math.floor(iteration / blocksPerEpoch)
    while (currEpoch >= this.samplerState.epoch)
      this.updateSamplerShuffled(trainSize)
    const base = (iteration * mb) % this.samplerState.shuffled.length
    return this.samplerState.shuffled.slice(base, base + mb)
  }

  private rand(): number {
    this.rngState ^= this.rngState << 13
    this.rngState ^= this.rngState >>> 17
    this.rngState ^= this.rngState << 5
    return ((this.rngState >>> 0) as number) / 4294967296
  }

  private generateOptimizationReport(
    paretoFront: Array<{ scores: Record<string, number>; dominated: number }>,
    hypervolume: number | undefined,
    bestScore: number | undefined
  ): void {
    console.log('\n🎉 GEPA Multi-Objective Optimization Complete!\n')

    console.log('✅ Improvements:')
    if (paretoFront.length > 1) {
      console.log('• Successfully found multiple Pareto-optimal solutions')
    } else {
      console.log('• Found at least one optimal solution')
    }
    if (hypervolume !== undefined && hypervolume > 0) {
      console.log(
        `• Hypervolume improvement: ${(hypervolume * 100).toFixed(1)}%`
      )
    }
    if (bestScore !== undefined) {
      console.log(`• Best score achieved: ${bestScore.toFixed(3)}`)
    }
    console.log('• Multi-objective approach balances competing goals\n')

    console.log('⚠️ Limitations:')
    if (paretoFront.length === 1) {
      console.log('• Limited diversity in Pareto frontier')
    }
    if (this.stats.totalCalls < 100) {
      console.log('• Relatively few optimization trials performed')
    }
    console.log('• Results depend on training data quality and size')
    console.log('• Optimization time scales with problem complexity\n')

    console.log('🔍 Key Issues:')
    if (paretoFront.length < 3) {
      console.log('• Few distinct trade-off points found')
    }
    if (this.stats.convergenceInfo?.converged === false) {
      console.log('• Optimization may not have fully converged')
    }
    console.log('• Evaluation metrics may need domain-specific tuning')
    console.log('• Model selection impacts optimization effectiveness\n')

    console.log('💡 What This Means:')
    console.log(
      '• GEPA framework successfully demonstrates multi-objective optimization'
    )
    console.log('• Pareto frontier reveals real trade-offs between objectives')
    console.log(
      '• Users can select solutions based on their specific priorities'
    )
    console.log('• More training data and trials would likely improve results')
  }

  private async mergeInstructions(
    instructionA: string,
    instructionB: string,
    options?: AxCompileOptions
  ): Promise<string> {
    const aiToUse: AxAIService =
      (options as any)?.overrideTeacherAI ?? this.teacherAI ?? this.studentAI

    // Merge via meta-prompt
    const merger = ax(
      `instructionA:string "Parent A instruction",
       instructionB:string "Parent B instruction",
       recentFeedback?:string[] "Past feedback memory"
       -> mergedInstruction:string "Merged instruction (1-6 sentences) combining strengths, fixing weaknesses"`
    )

    try {
      const out = (await merger.forward(aiToUse, {
        instructionA,
        instructionB,
        recentFeedback: this.feedbackMemory,
      } as any)) as any
      const instr = (out?.mergedInstruction as string | undefined)?.trim()
      if (instr && instr.length > 16) return instr
    } catch {}

    // Fallback: prefer the longer instruction (richer constraints)
    return (
      instructionA.length >= instructionB.length ? instructionA : instructionB
    ).slice(0, 2000)
  }
}
