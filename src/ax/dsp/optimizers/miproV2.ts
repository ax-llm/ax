import type { AxAIService } from '../../ai/types.js'
import { AxGen } from '../generate.js'
import type {
  AxCompileOptions,
  AxCostTracker,
  AxExample,
  AxMetricFn,
  AxMiPROCompileOptions,
  AxMiPROOptimizerOptions,
  AxOptimizationProgress,
  AxOptimizationStats,
  AxOptimizer,
  AxOptimizerArgs,
  AxOptimizerResult,
} from '../optimizer.js'
import type { AxProgram, AxProgramDemos } from '../program.js'
import type { AxGenIn, AxGenOut } from '../types.js'
import { updateProgressBar } from '../util.js'

import { AxBootstrapFewShot } from './bootstrapFewshot.js'

interface ConfigType extends Record<string, unknown> {
  instruction: string
  bootstrappedDemos: number
  labeledExamples: number
}

// Extended result interface to include the optimized AxGen
export interface AxMiPROResult<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxOptimizerResult<OUT> {
  optimizedGen?: AxGen<IN, OUT>
}

export class AxMiPRO<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> implements AxOptimizer<IN, OUT>
{
  private studentAI: AxAIService
  private teacherAI?: AxAIService
  private examples: readonly AxExample[]
  private validationSet?: readonly AxExample[]

  // Resource management
  private costTracker?: AxCostTracker

  // Reproducibility
  private seed?: number

  // MiPRO-specific options
  private maxBootstrappedDemos: number
  private maxLabeledDemos: number
  private numCandidates: number
  private initTemperature: number
  private numTrials: number
  private minibatch: boolean
  private minibatchSize: number
  private minibatchFullEvalSteps: number
  private programAwareProposer: boolean
  private dataAwareProposer: boolean
  private viewDataBatchSize: number
  private tipAwareProposer: boolean
  private fewshotAwareProposer: boolean
  private verbose: boolean
  private earlyStoppingTrials: number
  private minImprovementThreshold: number
  private bayesianOptimization: boolean
  private acquisitionFunction:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement'
  private explorationWeight: number

  // Standardized optimizer features
  private targetScore?: number
  private minSuccessRate?: number
  private onProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  private onEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void

  private stats: AxOptimizationStats

  constructor(args: AxOptimizerArgs & { options?: AxMiPROOptimizerOptions }) {
    if (args.examples.length === 0) {
      throw new Error('No examples found')
    }

    const options = args.options || {}

    // Use standardized args
    this.studentAI = args.studentAI
    this.teacherAI = args.teacherAI
    this.examples = args.examples
    this.validationSet = args.validationSet
    this.targetScore = args.targetScore
    this.minSuccessRate = args.minSuccessRate
    this.onProgress = args.onProgress
    this.onEarlyStop = args.onEarlyStop

    // Resource management
    this.costTracker = args.costTracker

    // Reproducibility
    this.seed = args.seed

    // MiPRO-specific options with proper defaults
    this.numCandidates = options.numCandidates ?? 5
    this.initTemperature = options.initTemperature ?? 0.7
    this.maxBootstrappedDemos = options.maxBootstrappedDemos ?? 3
    this.maxLabeledDemos = options.maxLabeledDemos ?? 4
    this.numTrials = options.numTrials ?? 30
    this.minibatch = options.minibatch ?? true
    this.minibatchSize = options.minibatchSize ?? 25
    this.minibatchFullEvalSteps = options.minibatchFullEvalSteps ?? 10
    this.programAwareProposer = options.programAwareProposer ?? true
    this.dataAwareProposer = options.dataAwareProposer ?? true
    this.viewDataBatchSize = options.viewDataBatchSize ?? 10
    this.tipAwareProposer = options.tipAwareProposer ?? true
    this.fewshotAwareProposer = options.fewshotAwareProposer ?? true
    this.verbose = options.verbose ?? false
    this.earlyStoppingTrials = options.earlyStoppingTrials ?? 5
    this.minImprovementThreshold = options.minImprovementThreshold ?? 0.01
    this.bayesianOptimization = options.bayesianOptimization ?? false
    this.acquisitionFunction =
      options.acquisitionFunction ?? 'expected_improvement'
    this.explorationWeight = options.explorationWeight ?? 0.1

    // Initialize stats
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
        convergenceThreshold: this.minImprovementThreshold,
      },
    }
  }

  /**
   * Configures the optimizer for light, medium, or heavy optimization
   * @param level The optimization level: "light", "medium", or "heavy"
   */
  public configureAuto(level: 'light' | 'medium' | 'heavy'): void {
    switch (level) {
      case 'light':
        this.numCandidates = 3
        this.numTrials = 10
        this.minibatch = true
        this.minibatchSize = 20
        break
      case 'medium':
        this.numCandidates = 5
        this.numTrials = 20
        this.minibatch = true
        this.minibatchSize = 25
        break
      case 'heavy':
        this.numCandidates = 7
        this.numTrials = 30
        this.minibatch = true
        this.minibatchSize = 30
        break
    }
  }

  /**
   * Generates creative tips for instruction generation
   */
  private generateTips(): string[] {
    return [
      'Be very specific and detailed in your instructions.',
      'Focus on step-by-step reasoning in your instructions.',
      'Provide clear constraints and guidelines in your instructions.',
      'Keep your instructions concise and to the point.',
      'Emphasize accuracy and precision in your instructions.',
      'Include examples of good outputs in your instructions.',
      'Focus on handling edge cases in your instructions.',
      'Explicitly outline the reasoning process in your instructions.',
    ]
  }

  /**
   * Generates instruction candidates using the teacher model if available
   * @returns Array of generated instruction candidates
   */
  private async proposeInstructionCandidates(): Promise<string[]> {
    const instructions: string[] = []
    const aiToUse = this.teacherAI || this.studentAI

    // Generate random tips for tip-aware proposing
    const tips = this.tipAwareProposer ? this.generateTips() : []

    // Generate instructions for each candidate
    for (let i = 0; i < this.numCandidates; i++) {
      const tipIndex = tips.length > 0 ? i % tips.length : -1
      const tipToUse = tipIndex >= 0 ? tips[tipIndex] : ''

      const instruction = await this.generateInstruction({
        tip: tipToUse,
        candidateIndex: i,
        ai: aiToUse,
      })

      instructions.push(instruction)
    }

    return instructions
  }

  private async generateInstruction({
    tip,
    candidateIndex,
  }: Readonly<{
    tip: string | undefined
    candidateIndex: number
    ai: Readonly<AxAIService>
  }>): Promise<string> {
    // For now, use simple instruction generation
    // TODO: Implement proper program-aware and data-aware instruction generation using the AI
    const baseInstructions = [
      'Analyze the input carefully and provide a detailed response.',
      'Think step by step and provide a clear answer.',
      'Consider all aspects of the input before responding.',
      'Provide a concise but comprehensive response.',
      'Focus on accuracy and clarity in your response.',
    ]

    let instruction =
      baseInstructions[candidateIndex % baseInstructions.length] ||
      baseInstructions[0]!

    if (tip) {
      instruction = `${instruction} ${tip}`
    }

    return instruction
  }

  /**
   * Bootstraps few-shot examples for the program
   */
  private async bootstrapFewShotExamples(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn
  ): Promise<AxProgramDemos<IN, OUT>[]> {
    if (this.verbose) {
      console.log('Bootstrapping few-shot examples...')
    }

    // Initialize the bootstrapper for this program
    const bootstrapper = new AxBootstrapFewShot<IN, OUT>({
      studentAI: this.studentAI,
      examples: this.examples,
      options: {
        maxDemos: this.maxBootstrappedDemos,
        maxRounds: 3,
        verboseMode: this.verbose,
      },
    })

    const result = await bootstrapper.compile(program, metricFn, {
      maxDemos: this.maxBootstrappedDemos,
    })

    return (result.demos || []) as AxProgramDemos<IN, OUT>[]
  }

  /**
   * Selects labeled examples directly from the training set
   */
  private selectLabeledExamples(): AxExample[] {
    const selectedExamples: AxExample[] = []

    // Random sampling from the training set
    const indices = new Set<number>()
    while (
      indices.size < this.maxLabeledDemos &&
      indices.size < this.examples.length
    ) {
      const idx = Math.floor(Math.random() * this.examples.length)
      if (!indices.has(idx)) {
        indices.add(idx)
        const example = this.examples[idx]
        if (example) {
          selectedExamples.push(example)
        }
      }
    }

    return selectedExamples
  }

  /**
   * Runs optimization to find the best combination of few-shot examples and instructions
   */
  private async runOptimization(
    program: Readonly<AxProgram<IN, OUT>>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    instructions: readonly string[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
  ): Promise<{ bestConfig: ConfigType; bestScore: number }> {
    let bestConfig: ConfigType = {
      instruction: instructions[0] || '',
      bootstrappedDemos: Math.min(1, bootstrappedDemos.length),
      labeledExamples: Math.min(1, labeledExamples.length),
    }
    let bestScore = 0
    let stagnationRounds = 0
    const scoreHistory: number[] = []

    // Optimization loop with early stopping
    for (let i = 0; i < this.numTrials; i++) {
      const config: ConfigType = {
        instruction:
          instructions[i % instructions.length] || instructions[0] || '',
        bootstrappedDemos: Math.min(
          Math.floor(Math.random() * (bootstrappedDemos.length + 1)),
          this.maxBootstrappedDemos
        ),
        labeledExamples: Math.min(
          Math.floor(Math.random() * (labeledExamples.length + 1)),
          this.maxLabeledDemos
        ),
      }

      const score = await this.evaluateConfig(
        program,
        config,
        bootstrappedDemos,
        labeledExamples,
        valset,
        metricFn
      )

      scoreHistory.push(score)

      // Check for improvement
      const improvement = score - bestScore
      if (improvement > this.minImprovementThreshold) {
        bestScore = score
        bestConfig = config
        stagnationRounds = 0
      } else {
        stagnationRounds++
      }

      // Progress callback
      if (this.onProgress) {
        this.onProgress({
          round: i + 1,
          totalRounds: this.numTrials,
          currentScore: score,
          bestScore,
          tokensUsed: this.stats.resourceUsage.totalTokens,
          timeElapsed: Date.now(),
          successfulExamples: this.stats.successfulDemos,
          totalExamples: this.examples.length,
          currentConfiguration: config,
          convergenceInfo: {
            improvement,
            stagnationRounds,
            isConverging: stagnationRounds < this.earlyStoppingTrials,
          },
        })
      }

      // Update progress bar
      updateProgressBar(
        i + 1,
        this.numTrials,
        Math.round(bestScore * 100),
        0,
        'Running MIPROv2 optimization',
        30
      )

      // Cost tracking check (handles token/time/cost budgets)
      if (this.costTracker?.isLimitReached()) {
        this.stats.earlyStopped = true
        this.stats.earlyStopping = {
          bestScoreRound: i + 1,
          patienceExhausted: false,
          reason: 'Cost limit reached',
        }
        break
      }

      // Early stopping check
      if (stagnationRounds >= this.earlyStoppingTrials) {
        this.stats.earlyStopped = true
        this.stats.earlyStopping = {
          bestScoreRound: i - stagnationRounds + 1,
          patienceExhausted: true,
          reason: `No improvement for ${this.earlyStoppingTrials} trials`,
        }
        break
      }

      // Target score check
      if (this.targetScore && bestScore >= this.targetScore) {
        this.stats.earlyStopped = true
        this.stats.earlyStopping = {
          bestScoreRound: i + 1,
          patienceExhausted: false,
          reason: `Target score ${this.targetScore} reached`,
        }
        break
      }
    }

    // Update convergence info
    this.stats.convergenceInfo.stagnationRounds = stagnationRounds
    this.stats.convergenceInfo.finalImprovement =
      scoreHistory.length > 1 ? bestScore - scoreHistory[0]! : 0
    this.stats.convergenceInfo.converged =
      stagnationRounds < this.earlyStoppingTrials

    return { bestConfig, bestScore }
  }

  private async evaluateConfig(
    program: Readonly<AxProgram<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[],
    valset: readonly AxExample[],
    metricFn: AxMetricFn
  ): Promise<number> {
    // Create a copy of the program and apply the configuration
    const testProgram = { ...program }
    this.applyConfigToProgram(
      testProgram,
      config,
      bootstrappedDemos,
      labeledExamples
    )

    let totalScore = 0
    let count = 0

    // Evaluate on a subset of validation examples
    const evalSet = valset.slice(0, Math.min(5, valset.length))

    for (const example of evalSet) {
      try {
        const prediction = await testProgram.forward(
          this.studentAI,
          example as IN
        )
        const score = await metricFn({ prediction, example })
        totalScore += score
        count++
        this.stats.totalCalls++
      } catch {
        // Skip failed predictions
        continue
      }
    }

    return count > 0 ? totalScore / count : 0
  }

  private applyConfigToProgram(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the program supports it
    if (program.setInstruction) {
      program.setInstruction(config.instruction)
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0 && program.setDemos) {
      program.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos))
    }

    // Set examples if needed
    if (config.labeledExamples > 0 && program.setExamples) {
      program.setExamples(labeledExamples.slice(0, config.labeledExamples))
    }
  }

  /**
   * The main compile method to run MIPROv2 optimization
   */
  public async compile(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxMiPROResult<IN, OUT>> {
    const startTime = Date.now()

    // Budget constraints are handled by costTracker if provided

    // Initialize random seed if provided
    if (this.seed !== undefined) {
      // Note: For full reproducibility, we'd need a proper PRNG
      Math.random = (() => {
        let seed = this.seed!
        return () => {
          seed = (seed * 9301 + 49297) % 233280
          return seed / 233280
        }
      })()
    }

    // Configure auto settings if provided (cast to access MiPRO-specific options)
    const miproOptions = options as AxMiPROCompileOptions
    if (miproOptions?.auto) {
      this.configureAuto(miproOptions.auto)
    }

    // Use validation set from constructor args or options, with fallback to split
    const valset =
      options?.overrideValidationSet ||
      this.validationSet ||
      miproOptions?.valset ||
      this.examples.slice(0, Math.floor(this.examples.length * 0.2))

    if (this.verbose || options?.verbose) {
      console.log(`Starting MIPROv2 optimization with ${this.numTrials} trials`)
      console.log(
        `Using ${this.examples.length} examples for training and ${valset.length} for validation`
      )
      if (this.teacherAI) {
        console.log('Using separate teacher model for instruction generation')
      }
    }

    // Step 1: Bootstrap few-shot examples
    let bootstrappedDemos: AxProgramDemos<IN, OUT>[] = []
    if (this.maxBootstrappedDemos > 0) {
      bootstrappedDemos = await this.bootstrapFewShotExamples(program, metricFn)

      if (this.verbose) {
        console.log(
          `Generated ${bootstrappedDemos.length} bootstrapped demonstrations`
        )
      }
    }

    // Step 2: Select labeled examples from training set
    let labeledExamples: AxExample[] = []
    if (this.maxLabeledDemos > 0) {
      labeledExamples = this.selectLabeledExamples()

      if (this.verbose) {
        console.log(
          `Selected ${labeledExamples.length} labeled examples from training set`
        )
      }
    }

    // Step 3: Generate instruction candidates
    const instructions = await this.proposeInstructionCandidates()

    if (this.verbose) {
      console.log(`Generated ${instructions.length} instruction candidates`)
    }

    // Step 4: Run optimization to find the best configuration
    const { bestConfig, bestScore } = await this.runOptimization(
      program,
      bootstrappedDemos,
      labeledExamples,
      instructions,
      valset,
      metricFn
    )

    if (this.verbose || options?.verbose) {
      console.log(`Optimization complete. Best score: ${bestScore}`)
      console.log(`Best configuration: ${JSON.stringify(bestConfig)}`)
    }

    // Check if target score was reached
    if (this.targetScore && bestScore >= this.targetScore) {
      this.stats.earlyStopped = true
      this.stats.earlyStopping = {
        bestScoreRound: this.numTrials,
        patienceExhausted: false,
        reason: `Target score ${this.targetScore} reached with score ${bestScore}`,
      }

      if (this.onEarlyStop) {
        this.onEarlyStop(this.stats.earlyStopping.reason, this.stats)
      }
    }

    // Create a new AxGen instance with the optimized configuration
    let signature
    if (
      'getSignature' in program &&
      typeof program.getSignature === 'function'
    ) {
      signature = program.getSignature()
    } else {
      // Fallback: create a basic signature
      signature = 'input -> output'
    }

    const optimizedGen = new AxGen<IN, OUT>(signature)

    // Apply the best configuration to the new AxGen
    this.applyConfigToAxGen(
      optimizedGen,
      bestConfig,
      bootstrappedDemos,
      labeledExamples
    )

    // Update stats
    this.stats.resourceUsage.totalTime = Date.now() - startTime
    this.stats.convergenceInfo.converged = true
    this.stats.convergenceInfo.finalImprovement = bestScore

    return {
      demos: bootstrappedDemos,
      stats: this.stats,
      bestScore,
      optimizedGen,
      finalConfiguration: {
        instruction: bestConfig.instruction,
        bootstrappedDemos: bestConfig.bootstrappedDemos,
        labeledExamples: bestConfig.labeledExamples,
        numCandidates: this.numCandidates,
        numTrials: this.numTrials,
      },
    }
  }

  /**
   * Applies a configuration to an AxGen instance
   */
  private applyConfigToAxGen(
    axgen: Readonly<AxGen<IN, OUT>>,
    config: Readonly<ConfigType>,
    bootstrappedDemos: readonly AxProgramDemos<IN, OUT>[],
    labeledExamples: readonly AxExample[]
  ): void {
    // Set instruction if the AxGen supports it
    if (
      'setInstruction' in axgen &&
      typeof axgen.setInstruction === 'function'
    ) {
      axgen.setInstruction(config.instruction)
    }

    // Set demos if needed
    if (config.bootstrappedDemos > 0) {
      axgen.setDemos(bootstrappedDemos.slice(0, config.bootstrappedDemos))
    }

    // Set examples if needed
    if (config.labeledExamples > 0) {
      axgen.setExamples(
        labeledExamples.slice(
          0,
          config.labeledExamples
        ) as unknown as readonly (OUT & IN)[]
      )
    }
  }

  /**
   * Get optimization statistics
   * @returns Current optimization statistics
   */
  public getStats(): AxOptimizationStats {
    return this.stats
  }

  /**
   * Get optimizer-specific configuration
   * @returns Current optimizer configuration
   */
  public getConfiguration(): Record<string, unknown> {
    return {
      numCandidates: this.numCandidates,
      initTemperature: this.initTemperature,
      maxBootstrappedDemos: this.maxBootstrappedDemos,
      maxLabeledDemos: this.maxLabeledDemos,
      numTrials: this.numTrials,
      minibatch: this.minibatch,
      minibatchSize: this.minibatchSize,
      minibatchFullEvalSteps: this.minibatchFullEvalSteps,
      programAwareProposer: this.programAwareProposer,
      dataAwareProposer: this.dataAwareProposer,
      tipAwareProposer: this.tipAwareProposer,
      fewshotAwareProposer: this.fewshotAwareProposer,
      earlyStoppingTrials: this.earlyStoppingTrials,
      minImprovementThreshold: this.minImprovementThreshold,
      bayesianOptimization: this.bayesianOptimization,
      acquisitionFunction: this.acquisitionFunction,
      explorationWeight: this.explorationWeight,
    }
  }

  /**
   * Update optimizer configuration
   * @param config New configuration to merge with existing
   */
  public updateConfiguration(config: Record<string, unknown>): void {
    if (config.numCandidates !== undefined) {
      this.numCandidates = config.numCandidates as number
    }
    if (config.initTemperature !== undefined) {
      this.initTemperature = config.initTemperature as number
    }
    if (config.maxBootstrappedDemos !== undefined) {
      this.maxBootstrappedDemos = config.maxBootstrappedDemos as number
    }
    if (config.maxLabeledDemos !== undefined) {
      this.maxLabeledDemos = config.maxLabeledDemos as number
    }
    if (config.numTrials !== undefined) {
      this.numTrials = config.numTrials as number
    }
    if (config.minibatch !== undefined) {
      this.minibatch = config.minibatch as boolean
    }
    if (config.minibatchSize !== undefined) {
      this.minibatchSize = config.minibatchSize as number
    }
    if (config.earlyStoppingTrials !== undefined) {
      this.earlyStoppingTrials = config.earlyStoppingTrials as number
    }
    if (config.minImprovementThreshold !== undefined) {
      this.minImprovementThreshold = config.minImprovementThreshold as number
    }
    if (config.verbose !== undefined) {
      this.verbose = config.verbose as boolean
    }
  }

  /**
   * Reset optimizer state for reuse with different programs
   */
  public reset(): void {
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
        convergenceThreshold: this.minImprovementThreshold,
      },
    }
  }

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  public validateProgram(program: Readonly<AxProgram<IN, OUT>>): {
    isValid: boolean
    issues: string[]
    suggestions: string[]
  } {
    const issues: string[] = []
    const suggestions: string[] = []

    // Check if program has required methods for optimization
    if (!('forward' in program) || typeof program.forward !== 'function') {
      issues.push('Program must have a forward method')
    }

    // Check if we have enough examples
    if (
      this.examples.length <
      this.maxBootstrappedDemos + this.maxLabeledDemos
    ) {
      issues.push(
        `Not enough examples: need at least ${
          this.maxBootstrappedDemos + this.maxLabeledDemos
        }, got ${this.examples.length}`
      )
      suggestions.push(
        'Reduce maxBootstrappedDemos or maxLabeledDemos, or provide more examples'
      )
    }

    // Check if validation set is reasonable
    const valSetSize =
      this.validationSet?.length || Math.floor(this.examples.length * 0.2)
    if (valSetSize < 5) {
      issues.push('Validation set too small for reliable optimization')
      suggestions.push('Provide more examples or a larger validation set')
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    }
  }
}
