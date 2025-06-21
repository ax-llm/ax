import type { AxAIService } from '../../ai/types.js'
import type {
  AxBootstrapCompileOptions,
  AxBootstrapOptimizerOptions,
  AxExample,
  AxMetricFn,
  AxOptimizationStats,
  AxOptimizer,
  AxOptimizerArgs,
  AxOptimizerResult,
} from '../optimizer.js'
import type { AxProgram, AxProgramDemos, AxProgramTrace } from '../program.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from '../types.js'
import { updateDetailedProgress, updateProgressBar } from '../util.js'

// Define model config interface
interface ModelConfig {
  temperature: number
  max_tokens?: number
  [key: string]: number | string | boolean | undefined
}

export class AxBootstrapFewShot<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> implements AxOptimizer<IN, OUT>
{
  private studentAI: AxAIService
  private teacherAI?: AxAIService
  private examples: readonly AxExample[]
  private maxRounds: number
  private maxDemos: number
  private maxExamples: number
  private batchSize: number
  private earlyStoppingPatience: number
  private costMonitoring: boolean
  private maxTokensPerGeneration: number
  private verboseMode: boolean
  private debugMode: boolean
  private traces: AxProgramTrace<IN, OUT>[] = []
  private stats: AxOptimizationStats = {
    totalCalls: 0,
    successfulDemos: 0,
    estimatedTokenUsage: 0,
    earlyStopped: false,
    resourceUsage: {
      totalTokens: 0,
      totalTime: 0,
      avgLatencyPerEval: 0,
      costByModel: {},
    },
    convergenceInfo: {
      converged: false,
      finalImprovement: 0,
      stagnationRounds: 0,
      convergenceThreshold: 0.01,
    },
  }

  constructor(
    args: AxOptimizerArgs<OUT> & { options?: AxBootstrapOptimizerOptions }
  ) {
    if (args.examples.length === 0) {
      throw new Error('No examples found')
    }

    const options = args.options || {}

    this.maxRounds = options.maxRounds ?? 3
    this.maxDemos = options.maxDemos ?? 4
    this.maxExamples = options.maxExamples ?? 16
    this.batchSize = options.batchSize ?? 1
    this.earlyStoppingPatience = options.earlyStoppingPatience ?? 0
    this.costMonitoring = options.costMonitoring ?? false
    this.maxTokensPerGeneration = options.maxTokensPerGeneration ?? 0
    this.verboseMode = options.verboseMode ?? true
    this.debugMode = options.debugMode ?? false

    this.studentAI = args.studentAI
    this.teacherAI = args.teacherAI || options.teacherAI
    this.examples = args.examples
  }

  private async compileRound(
    program: Readonly<AxProgram<IN, OUT>>,
    roundIndex: number,
    metricFn: AxMetricFn,
    options?: { maxRounds?: number; maxDemos?: number } | undefined
  ) {
    const st = new Date().getTime()
    const maxDemos = options?.maxDemos ?? this.maxDemos
    const aiOpt = {
      modelConfig: {
        temperature: 0.7,
      } as ModelConfig,
    }

    // Apply token limit if specified
    if (this.maxTokensPerGeneration > 0) {
      aiOpt.modelConfig.max_tokens = this.maxTokensPerGeneration
    }

    const examples = randomSample(this.examples, this.maxExamples)
    const previousSuccessCount = this.traces.length

    // Process examples in batches if batch size > 1
    for (let i = 0; i < examples.length; i += this.batchSize) {
      if (i > 0) {
        aiOpt.modelConfig.temperature = 0.7 + 0.001 * i
      }

      const batch = examples.slice(i, i + this.batchSize)

      // Process batch sequentially for now (could be parallelized if AI service supports it)
      for (const ex of batch) {
        if (!ex) {
          continue
        }

        // Use remaining examples as demonstration examples (excluding current one)
        const exList = examples.filter((e) => e !== ex)
        program.setExamples(exList as unknown as readonly (OUT & IN)[])

        // Use teacher AI if provided, otherwise use student AI
        const aiService = this.teacherAI || this.studentAI

        this.stats.totalCalls++
        let res: OUT
        let error: Error | undefined

        try {
          res = await program.forward(aiService, ex as IN, aiOpt)

          // Estimate token usage if cost monitoring is enabled
          if (this.costMonitoring) {
            // Very rough estimate - replace with actual token counting from your AI service
            this.stats.estimatedTokenUsage +=
              JSON.stringify(ex).length / 4 + JSON.stringify(res).length / 4
          }

          const score = metricFn({ prediction: res, example: ex })
          const success = score >= 0.5 // Assuming a threshold of 0.5 for success
          if (success) {
            this.traces = [...this.traces, ...program.getTraces()]
            this.stats.successfulDemos++
          }
        } catch (err) {
          error = err as Error
          res = {} as OUT
        }

        const current =
          i + examples.length * roundIndex + (batch.indexOf(ex) + 1)
        const total = examples.length * this.maxRounds
        const et = new Date().getTime() - st

        // Use enhanced progress reporting if verbose or debug mode is enabled
        if (this.verboseMode || this.debugMode) {
          // Create a configuration object to pass to updateDetailedProgress
          const configInfo = {
            maxRounds: this.maxRounds,
            batchSize: this.batchSize,
            earlyStoppingPatience: this.earlyStoppingPatience,
            costMonitoring: this.costMonitoring,
            verboseMode: this.verboseMode,
            debugMode: this.debugMode,
          }

          updateDetailedProgress(
            roundIndex,
            current,
            total,
            et,
            ex,
            this.stats,
            configInfo,
            res,
            error
          )
        } else {
          // Use the standard progress bar for normal mode
          updateProgressBar(
            current,
            total,
            this.traces.length,
            et,
            'Tuning Prompt',
            30
          )
        }

        if (this.traces.length >= maxDemos) {
          return
        }
      }
    }

    // Check if we should early stop based on no improvement
    if (this.earlyStoppingPatience > 0) {
      const newSuccessCount = this.traces.length
      const improvement = newSuccessCount - previousSuccessCount

      if (!this.stats.earlyStopping) {
        this.stats.earlyStopping = {
          bestScoreRound: improvement > 0 ? roundIndex : 0,
          patienceExhausted: false,
          reason: 'No improvement detected',
        }
      } else if (improvement > 0) {
        this.stats.earlyStopping.bestScoreRound = roundIndex
      } else if (
        roundIndex - this.stats.earlyStopping.bestScoreRound >=
        this.earlyStoppingPatience
      ) {
        this.stats.earlyStopping.patienceExhausted = true
        this.stats.earlyStopped = true
        this.stats.earlyStopping.reason = `No improvement for ${this.earlyStoppingPatience} rounds`

        if (this.verboseMode || this.debugMode) {
          console.log(
            `\nEarly stopping triggered after ${roundIndex + 1} rounds. No improvement for ${this.earlyStoppingPatience} rounds.`
          )
        }

        return
      }
    }
  }

  public async compile(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxBootstrapCompileOptions
  ): Promise<AxOptimizerResult<OUT>> {
    const maxRounds = options?.maxIterations ?? this.maxRounds
    this.traces = []
    this.stats = {
      totalCalls: 0,
      successfulDemos: 0,
      estimatedTokenUsage: 0,
      earlyStopped: false,
      resourceUsage: {
        totalTokens: 0,
        totalTime: 0,
        avgLatencyPerEval: 0,
        costByModel: {},
      },
      convergenceInfo: {
        converged: false,
        finalImprovement: 0,
        stagnationRounds: 0,
        convergenceThreshold: 0.01,
      },
    }

    for (let i = 0; i < maxRounds; i++) {
      await this.compileRound(program, i, metricFn, options)

      // Break early if early stopping was triggered
      if (this.stats.earlyStopped) {
        break
      }
    }

    if (this.traces.length === 0) {
      throw new Error(
        'No demonstrations found. Either provide more examples or improve the existing ones.'
      )
    }

    const demos: AxProgramDemos<IN, OUT>[] = groupTracesByKeys(this.traces)

    // Calculate best score from traces
    let bestScore = 0
    if (this.traces.length > 0) {
      // Simple approximation - in a real implementation you'd track scores properly
      bestScore =
        this.stats.successfulDemos / Math.max(1, this.stats.totalCalls)
    }

    return {
      demos,
      stats: this.stats,
      bestScore,
      finalConfiguration: {
        maxRounds: this.maxRounds,
        maxDemos: this.maxDemos,
        batchSize: this.batchSize,
        successRate: bestScore,
      },
    }
  }

  // Get optimization statistics
  public getStats(): AxOptimizationStats {
    return this.stats
  }
}

function groupTracesByKeys<IN extends AxGenIn, OUT extends AxGenOut>(
  programTraces: readonly AxProgramTrace<IN, OUT>[]
): AxProgramDemos<IN, OUT>[] {
  const groupedTraces = new Map<string, Record<string, AxFieldValue>[]>()

  // Group all traces by their keys
  for (const programTrace of programTraces) {
    if (groupedTraces.has(programTrace.programId)) {
      const traces = groupedTraces.get(programTrace.programId)
      if (traces) {
        traces.push(programTrace.trace)
      }
    } else {
      groupedTraces.set(programTrace.programId, [programTrace.trace])
    }
  }

  // Convert the Map into an array of ProgramDemos
  const programDemosArray: AxProgramDemos<IN, OUT>[] = []
  groupedTraces.forEach((traces, programId) => {
    programDemosArray.push({
      traces: traces as unknown as (OUT & IN)[],
      programId,
    })
  })

  return programDemosArray
}

const randomSample = <T>(array: readonly T[], n: number): T[] => {
  // Clone the array to avoid modifying the original array
  const clonedArray = [...array]
  // Shuffle the cloned array
  for (let i = clonedArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const caI = clonedArray[i]
    const caJ = clonedArray[j]

    if (!caI || !caJ) {
      throw new Error('Invalid array elements')
    }

    ;[clonedArray[i], clonedArray[j]] = [caJ, caI]
  }
  // Return the first `n` items of the shuffled array
  return clonedArray.slice(0, n)
}
