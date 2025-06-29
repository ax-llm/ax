import type { AxAIService, AxLoggerFunction } from '../ai/types.js'

import { axDefaultOptimizerLogger } from './loggers.js'
import type { AxProgram, AxProgramDemos } from './program.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from './types.js'

// Logger utilities are now exported from ./loggers.js

// Common types used by optimizers
export type AxExample = Record<string, AxFieldValue>

export type AxMetricFn = <T extends AxGenOut = AxGenOut>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => number | Promise<number>

export type AxMetricFnArgs = Parameters<AxMetricFn>[0]

// Multi-objective metric function for Pareto optimization
export type AxMultiMetricFn = <T extends AxGenOut = AxGenOut>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => Record<string, number>

// Progress tracking interface for real-time updates
export interface AxOptimizationProgress {
  round: number
  totalRounds: number
  currentScore: number
  bestScore: number
  tokensUsed: number
  timeElapsed: number
  successfulExamples: number
  totalExamples: number
  currentConfiguration?: Record<string, unknown>
  convergenceInfo?: {
    improvement: number
    stagnationRounds: number
    isConverging: boolean
  }
}

// Cost tracking interface for monitoring resource usage
export interface AxCostTracker {
  trackTokens(count: number, model: string): void
  getCurrentCost(): number
  getTokenUsage(): Record<string, number>
  getTotalTokens(): number
  isLimitReached(): boolean
  reset(): void
}

// Checkpoint interface for saving/loading optimization state
export interface AxOptimizationCheckpoint {
  version: string
  timestamp: number
  optimizerType: string
  optimizerConfig: Record<string, unknown>

  // Current optimization state
  currentRound: number
  totalRounds: number
  bestScore: number
  bestConfiguration?: Record<string, unknown>

  // Historical data
  scoreHistory: number[]
  configurationHistory: Record<string, unknown>[]

  // Resource usage
  stats: AxOptimizationStats

  // Optimizer-specific state
  optimizerState: Record<string, unknown>

  // Examples and validation data
  examples: readonly AxExample[]
  validationSet?: readonly AxExample[]
}

// Simple checkpoint functions - users implement these as needed
export type AxCheckpointSaveFn = (
  checkpoint: Readonly<AxOptimizationCheckpoint>
) => Promise<string>
export type AxCheckpointLoadFn = (
  checkpointId: string
) => Promise<AxOptimizationCheckpoint | null>

// Cost tracker configuration options
export interface AxCostTrackerOptions {
  // Cost-based limits
  costPerModel?: Record<string, number>
  maxCost?: number

  // Token-based limits
  maxTokens?: number
}

// Enhanced optimizer arguments - no longer includes program
export type AxOptimizerArgs = {
  studentAI: AxAIService
  teacherAI?: AxAIService // For generating high-quality examples/corrections
  examples: readonly AxExample[]

  // Evaluation strategy
  validationSet?: readonly AxExample[]

  // Quality thresholds
  minSuccessRate?: number
  targetScore?: number

  // Monitoring & callbacks
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void
  costTracker?: AxCostTracker

  // Checkpointing
  checkpointSave?: AxCheckpointSaveFn
  checkpointLoad?: AxCheckpointLoadFn
  checkpointInterval?: number // Save checkpoint every N rounds
  resumeFromCheckpoint?: string // Checkpoint ID to resume from

  // Logging
  logger?: AxLoggerFunction
  verbose?: boolean

  // Reproducibility
  seed?: number
}

// Enhanced optimization statistics
export interface AxOptimizationStats {
  totalCalls: number
  successfulDemos: number
  estimatedTokenUsage: number
  earlyStopped: boolean
  earlyStopping?: {
    bestScoreRound: number
    patienceExhausted: boolean
    reason: string
  }

  // Resource usage tracking
  resourceUsage: {
    totalTokens: number
    totalTime: number
    avgLatencyPerEval: number
    peakMemoryUsage?: number
    costByModel: Record<string, number>
  }

  // Quality metrics
  convergenceInfo: {
    converged: boolean
    finalImprovement: number
    stagnationRounds: number
    convergenceThreshold: number
  }

  // Evaluation breakdown
  evaluationBreakdown?: {
    trainingScore: number
    validationScore: number
    crossValidationScores?: number[]
    standardDeviation?: number
  }
}

// Simplified result - no program since it's passed to compile
export interface AxOptimizerResult<OUT extends AxGenOut> {
  demos?: AxProgramDemos<AxGenIn, OUT>[]
  stats: AxOptimizationStats
  bestScore: number
  finalConfiguration?: Record<string, unknown>

  // Optimization history for analysis
  scoreHistory?: number[]
  configurationHistory?: Record<string, unknown>[]
}

// Pareto optimization result for multi-objective optimization
export interface AxParetoResult<OUT extends AxGenOut = AxGenOut>
  extends AxOptimizerResult<OUT> {
  paretoFront: ReadonlyArray<{
    demos: readonly AxProgramDemos<AxGenIn, OUT>[]
    scores: Readonly<Record<string, number>>
    configuration: Readonly<Record<string, unknown>>
    dominatedSolutions: number
  }>

  // Multi-objective specific stats
  hypervolume?: number
  paretoFrontSize: number
  convergenceMetrics?: Record<string, number>
}

// Compile options that can override constructor arguments
export interface AxCompileOptions {
  // Method-specific options
  maxIterations?: number
  earlyStoppingPatience?: number
  verbose?: boolean

  // Override args for this specific run
  overrideValidationSet?: readonly AxExample[]
  overrideTargetScore?: number
  overrideCostTracker?: AxCostTracker
  overrideTeacherAI?: AxAIService

  // Progress monitoring overrides
  overrideOnProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  overrideOnEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void

  // Checkpointing overrides
  overrideCheckpointSave?: AxCheckpointSaveFn
  overrideCheckpointLoad?: AxCheckpointLoadFn
  overrideCheckpointInterval?: number
  saveCheckpointOnComplete?: boolean
}

// Enhanced base optimizer interface
export interface AxOptimizer<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  /**
   * Optimize a program using the provided metric function
   * @param program The program to optimize (moved from constructor)
   * @param metricFn Evaluation metric function to assess program performance
   * @param options Optional configuration options that can override constructor settings
   * @returns Optimization result containing demos, stats, and configuration
   */
  compile(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxOptimizerResult<OUT>>

  /**
   * Optimize a program with real-time streaming updates
   * @param program The program to optimize
   * @param metricFn Evaluation metric function
   * @param options Optional configuration options
   * @returns Async iterator yielding optimization progress
   */
  compileStream?(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): AsyncIterableIterator<AxOptimizationProgress>

  /**
   * Multi-objective optimization using Pareto frontier
   * @param program The program to optimize
   * @param metricFn Multi-objective metric function
   * @param options Optional configuration options
   * @returns Pareto optimization result
   */
  compilePareto?(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>>

  /**
   * Get current optimization statistics
   * @returns Current optimization statistics
   */
  getStats(): AxOptimizationStats

  /**
   * Cancel ongoing optimization gracefully
   * @returns Promise that resolves when cancellation is complete
   */
  cancel?(): Promise<void>

  /**
   * Reset optimizer state for reuse with different programs
   */
  reset?(): void

  /**
   * Get optimizer-specific configuration
   * @returns Current optimizer configuration
   */
  getConfiguration?(): Record<string, unknown>

  /**
   * Update optimizer configuration
   * @param config New configuration to merge with existing
   */
  updateConfiguration?(config: Readonly<Record<string, unknown>>): void

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  validateProgram?(program: Readonly<AxProgram<IN, OUT>>): {
    isValid: boolean
    issues: string[]
    suggestions: string[]
  }
}

// Specific optimizer options interfaces

export interface AxBootstrapOptimizerOptions {
  maxRounds?: number
  maxExamples?: number
  maxDemos?: number
  batchSize?: number
  earlyStoppingPatience?: number
  teacherAI?: AxAIService
  costMonitoring?: boolean
  maxTokensPerGeneration?: number
  verboseMode?: boolean
  debugMode?: boolean

  // Enhanced options
  adaptiveBatching?: boolean
  dynamicTemperature?: boolean
  qualityThreshold?: number
  diversityWeight?: number
}

export interface AxMiPROOptimizerOptions {
  numCandidates?: number
  initTemperature?: number
  maxBootstrappedDemos?: number
  maxLabeledDemos?: number
  numTrials?: number
  minibatch?: boolean
  minibatchSize?: number
  minibatchFullEvalSteps?: number
  programAwareProposer?: boolean
  dataAwareProposer?: boolean
  viewDataBatchSize?: number
  tipAwareProposer?: boolean
  fewshotAwareProposer?: boolean
  verbose?: boolean
  earlyStoppingTrials?: number
  minImprovementThreshold?: number

  // Enhanced options
  bayesianOptimization?: boolean
  acquisitionFunction?:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement'
  explorationWeight?: number

  // New option: number of samples to generate per forward call for self-consistency
  sampleCount?: number
}

// Legacy compile options (for backward compatibility)
export interface AxBootstrapCompileOptions extends AxCompileOptions {
  validationExamples?: readonly AxExample[]
  maxDemos?: number
  teacherProgram?: Readonly<AxProgram<AxGenIn, AxGenOut>>
}

export interface AxMiPROCompileOptions extends AxCompileOptions {
  validationExamples?: readonly AxExample[]
  teacher?: Readonly<AxProgram<AxGenIn, AxGenOut>>
  auto?: 'light' | 'medium' | 'heavy'

  // Enhanced MiPRO options
  instructionCandidates?: string[]
  customProposer?: (
    context: Readonly<{
      programSummary: string
      dataSummary: string
      previousInstructions: string[]
    }>
  ) => Promise<string[]>
}

// Default cost tracker implementation
export class AxDefaultCostTracker implements AxCostTracker {
  private tokenUsage: Record<string, number> = {}
  private totalTokens = 0

  // Configuration options
  private readonly costPerModel: Record<string, number>
  private readonly maxCost?: number
  private readonly maxTokens?: number

  constructor(options?: AxCostTrackerOptions) {
    this.costPerModel = options?.costPerModel ?? {}
    this.maxCost = options?.maxCost
    this.maxTokens = options?.maxTokens
  }

  trackTokens(count: number, model: string): void {
    this.tokenUsage[model] = (this.tokenUsage[model] || 0) + count
    this.totalTokens += count
  }

  getCurrentCost(): number {
    // Calculate cost on-demand
    let totalCost = 0
    for (const [model, tokens] of Object.entries(this.tokenUsage)) {
      const costPer1K = this.costPerModel[model] || 0.001 // Default fallback
      totalCost += (tokens / 1000) * costPer1K
    }
    return totalCost
  }

  getTokenUsage(): Record<string, number> {
    return { ...this.tokenUsage }
  }

  getTotalTokens(): number {
    return this.totalTokens
  }

  isLimitReached(): boolean {
    // Check token limit if configured
    if (this.maxTokens !== undefined && this.totalTokens >= this.maxTokens) {
      return true
    }

    // Check cost limit if configured (calculate cost on-demand)
    if (this.maxCost !== undefined) {
      const currentCost = this.getCurrentCost()
      if (currentCost >= this.maxCost) {
        return true
      }
    }

    return false
  }

  reset(): void {
    this.tokenUsage = {}
    this.totalTokens = 0
  }
}

/**
 * Abstract base class for optimizers that provides common functionality
 * and standardized handling of AxOptimizerArgs
 */
export abstract class AxBaseOptimizer<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> implements AxOptimizer<IN, OUT>
{
  // Common AxOptimizerArgs fields
  protected readonly studentAI: AxAIService
  protected readonly teacherAI?: AxAIService
  protected readonly examples: readonly AxExample[]
  protected readonly validationSet?: readonly AxExample[]
  protected readonly targetScore?: number
  protected readonly minSuccessRate?: number
  protected readonly onProgress?: (
    progress: Readonly<AxOptimizationProgress>
  ) => void
  protected readonly onEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void
  protected readonly costTracker?: AxCostTracker
  protected readonly seed?: number

  // Checkpointing fields
  protected readonly checkpointSave?: AxCheckpointSaveFn
  protected readonly checkpointLoad?: AxCheckpointLoadFn
  protected readonly checkpointInterval?: number
  protected readonly resumeFromCheckpoint?: string

  // Logging fields
  protected readonly logger?: AxLoggerFunction
  protected readonly verbose?: boolean

  // Checkpoint state
  private currentRound: number = 0
  private scoreHistory: number[] = []
  private configurationHistory: Record<string, unknown>[] = []

  // Common optimization statistics
  protected stats: AxOptimizationStats

  constructor(args: Readonly<AxOptimizerArgs>) {
    if (args.examples.length === 0) {
      throw new Error('No examples found')
    }

    // Set common fields from AxOptimizerArgs
    this.studentAI = args.studentAI
    this.teacherAI = args.teacherAI
    this.examples = args.examples
    this.validationSet = args.validationSet
    this.targetScore = args.targetScore
    this.minSuccessRate = args.minSuccessRate
    this.onProgress = args.onProgress
    this.onEarlyStop = args.onEarlyStop
    this.seed = args.seed

    // Set up checkpointing
    this.checkpointSave = args.checkpointSave
    this.checkpointLoad = args.checkpointLoad
    this.checkpointInterval = args.checkpointInterval ?? 10 // Default: checkpoint every 10 rounds
    this.resumeFromCheckpoint = args.resumeFromCheckpoint

    // Set up logging
    this.logger = args.logger
    this.verbose = args.verbose

    // Set up cost tracker with default if not provided
    const costTracker = new AxDefaultCostTracker({
      maxTokens: 1000000,
    })
    this.costTracker = args.costTracker ?? costTracker

    // Initialize common stats structure
    this.stats = this.initializeStats()
  }

  /**
   * Initialize the optimization statistics structure
   */
  protected initializeStats(): AxOptimizationStats {
    return {
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
  }

  /**
   * Set up reproducible random seed if provided
   */
  protected setupRandomSeed(): void {
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
  }

  /**
   * Check if optimization should stop early due to cost limits
   */
  protected checkCostLimits(): boolean {
    return this.costTracker?.isLimitReached() ?? false
  }

  /**
   * Check if target score has been reached
   */
  protected checkTargetScore(currentScore: number): boolean {
    return this.targetScore !== undefined && currentScore >= this.targetScore
  }

  /**
   * Update resource usage statistics
   */
  protected updateResourceUsage(
    startTime: number,
    tokensUsed: number = 0
  ): void {
    this.stats.resourceUsage.totalTime = Date.now() - startTime
    this.stats.resourceUsage.totalTokens += tokensUsed

    if (this.stats.totalCalls > 0) {
      this.stats.resourceUsage.avgLatencyPerEval =
        this.stats.resourceUsage.totalTime / this.stats.totalCalls
    }
  }

  /**
   * Trigger early stopping with appropriate callbacks
   */
  protected triggerEarlyStopping(reason: string, bestScoreRound: number): void {
    this.stats.earlyStopped = true
    this.stats.earlyStopping = {
      bestScoreRound,
      patienceExhausted: reason.includes('improvement'),
      reason,
    }

    if (this.onEarlyStop) {
      this.onEarlyStop(reason, this.stats)
    }
  }

  /**
   * Get the validation set, with fallback to a split of examples
   */
  protected getValidationSet(options?: AxCompileOptions): readonly AxExample[] {
    return (
      options?.overrideValidationSet ||
      this.validationSet ||
      this.examples.slice(0, Math.floor(this.examples.length * 0.2))
    )
  }

  /**
   * Get the AI service to use for a specific task, preferring teacher when available
   * @param preferTeacher Whether to prefer teacher AI over student AI
   * @param options Optional compile options that may override teacher AI
   * @returns The appropriate AI service to use
   */
  protected getAIService(
    preferTeacher: boolean = false,
    options?: AxCompileOptions
  ): AxAIService {
    // Check for override teacher AI first
    if (preferTeacher && options?.overrideTeacherAI) {
      return options.overrideTeacherAI
    }

    // Then check for configured teacher AI
    if (preferTeacher && this.teacherAI) {
      return this.teacherAI
    }

    return this.studentAI
  }

  /**
   * Check if teacher AI is available (including overrides)
   * @param options Optional compile options that may override teacher AI
   * @returns True if teacher AI is configured or overridden
   */
  protected hasTeacherAI(options?: AxCompileOptions): boolean {
    return (
      options?.overrideTeacherAI !== undefined || this.teacherAI !== undefined
    )
  }

  /**
   * Get teacher AI if available, otherwise return student AI
   * @param options Optional compile options that may override teacher AI
   * @returns Teacher AI if available, otherwise student AI
   */
  protected getTeacherOrStudentAI(options?: AxCompileOptions): AxAIService {
    return options?.overrideTeacherAI || this.teacherAI || this.studentAI
  }

  /**
   * Execute a task with teacher AI if available, otherwise use student AI
   * @param task Function that takes an AI service and returns a promise
   * @param preferTeacher Whether to prefer teacher AI (default: true)
   * @param options Optional compile options that may override teacher AI
   * @returns Result of the task execution
   */
  protected async executeWithTeacher<T>(
    task: (ai: AxAIService) => Promise<T>,
    preferTeacher: boolean = true,
    options?: AxCompileOptions
  ): Promise<T> {
    const ai = this.getAIService(preferTeacher, options)
    return await task(ai)
  }

  /**
   * Abstract method that must be implemented by concrete optimizers
   */
  public abstract compile(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxOptimizerResult<OUT>>

  /**
   * Get current optimization statistics
   */
  public getStats(): AxOptimizationStats {
    return { ...this.stats }
  }

  /**
   * Reset optimizer state for reuse with different programs
   */
  public reset(): void {
    this.stats = this.initializeStats()
    this.costTracker?.reset()
    this.currentRound = 0
    this.scoreHistory = []
    this.configurationHistory = []
  }

  /**
   * Basic program validation that can be extended by concrete optimizers
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
    if (this.examples.length < 2) {
      issues.push('Need at least 2 examples for optimization')
      suggestions.push('Provide more training examples')
    }

    // Check if validation set is reasonable
    const valSetSize = this.getValidationSet().length
    if (valSetSize < 1) {
      issues.push('Validation set is empty')
      suggestions.push('Provide examples or a validation set')
    }

    return {
      isValid: issues.length === 0,
      issues,
      suggestions,
    }
  }

  /**
   * Multi-objective optimization using Pareto frontier
   * Default implementation that leverages the single-objective compile method
   * @param program The program to optimize
   * @param metricFn Multi-objective metric function that returns multiple scores
   * @param options Optional configuration options
   * @returns Pareto optimization result with frontier of non-dominated solutions
   */
  public async compilePareto(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>> {
    const startTime = Date.now()

    if (options?.verbose) {
      this.getLogger(options)?.(
        'Starting Pareto optimization using base implementation',
        { tags: ['discovery'] }
      )
      this.getLogger(options)?.(
        'This will run multiple single-objective optimizations',
        { tags: ['discovery'] }
      )
    }

    // Strategy 1: Generate different weighted combinations of objectives
    const solutions = await this.generateWeightedSolutions(
      program,
      metricFn,
      options
    )

    // Strategy 2: Generate constraint-based solutions (optimize one objective while constraining others)
    const constraintSolutions = await this.generateConstraintSolutions(
      program,
      metricFn,
      options
    )

    // Combine all solutions
    const allSolutions = [...solutions, ...constraintSolutions]

    if (options?.verbose) {
      this.getLogger(options)?.(
        `Generated ${allSolutions.length} candidate solutions`,
        { tags: ['discovery'] }
      )
    }

    // Find Pareto frontier
    const paretoFront = this.findParetoFrontier(allSolutions)

    // Calculate hypervolume if possible
    const hypervolume = this.calculateHypervolume(paretoFront)

    if (options?.verbose) {
      this.getLogger(options)?.(
        `Found ${paretoFront.length} non-dominated solutions`,
        { tags: ['discovery'] }
      )
      this.getLogger(options)?.(
        `Hypervolume: ${hypervolume?.toFixed(4) || 'N/A'}`,
        { tags: ['discovery'] }
      )
    }

    // Update stats
    this.updateResourceUsage(startTime)
    this.stats.convergenceInfo.converged = true

    // Calculate best score as the maximum across all objectives and solutions
    const bestScore =
      paretoFront.length > 0
        ? Math.max(
            ...paretoFront.map((sol) => Math.max(...Object.values(sol.scores)))
          )
        : 0

    return {
      demos: paretoFront.length > 0 ? [...paretoFront[0]!.demos] : undefined,
      stats: this.stats,
      bestScore,
      paretoFront,
      hypervolume,
      paretoFrontSize: paretoFront.length,
      finalConfiguration: {
        paretoFrontSize: paretoFront.length,
        hypervolume,
        strategy: 'weighted_combinations_and_constraints',
        numSolutions: allSolutions.length,
      },
    }
  }

  /**
   * Generate solutions using different weighted combinations of objectives
   */
  private async generateWeightedSolutions(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<
    Array<{
      scores: Record<string, number>
      demos?: AxProgramDemos<AxGenIn, OUT>[]
      configuration: Record<string, unknown>
    }>
  > {
    const solutions: Array<{
      scores: Record<string, number>
      demos?: AxProgramDemos<AxGenIn, OUT>[]
      configuration: Record<string, unknown>
    }> = []

    // First, determine the objectives by running the metric on a sample
    const sampleExample = this.examples[0]!
    const samplePrediction = await program.forward(
      this.studentAI,
      sampleExample as IN
    )
    const sampleScores = await metricFn({
      prediction: samplePrediction,
      example: sampleExample,
    })
    const objectives = Object.keys(sampleScores)

    if (options?.verbose) {
      this.getLogger(options)?.(
        `Detected objectives: ${objectives.join(', ')}`,
        { tags: ['discovery'] }
      )
    }

    // Generate different weight combinations
    const weightCombinations = this.generateWeightCombinations(objectives)

    for (let i = 0; i < weightCombinations.length; i++) {
      const weights = weightCombinations[i]!

      if (options?.verbose) {
        this.getLogger(options)?.(
          `Optimizing with weights: ${JSON.stringify(weights)}`,
          { tags: ['discovery'] }
        )
      }

      // Create a weighted single-objective metric
      const weightedMetric: AxMetricFn = async ({ prediction, example }) => {
        const scores = await metricFn({ prediction, example })
        let weightedScore = 0
        for (const [objective, score] of Object.entries(scores)) {
          weightedScore += score * (weights[objective] || 0)
        }
        return weightedScore
      }

      try {
        // Use the concrete optimizer's compile method
        const result = await this.compile(program, weightedMetric, {
          ...options,
          verbose: false, // Suppress inner optimization logs
        })

        // Evaluate the result with the multi-objective metric
        const scores = await this.evaluateWithMultiObjective(
          program,
          result,
          metricFn
        )

        solutions.push({
          scores,
          demos: result.demos,
          configuration: {
            ...result.finalConfiguration,
            weights,
            strategy: 'weighted_combination',
          },
        })
      } catch (error) {
        if (options?.verbose) {
          this.getLogger(options)?.(
            `Failed optimization with weights ${JSON.stringify(weights)}: ${error}`,
            { tags: ['warning'] }
          )
        }
        continue
      }
    }

    return solutions
  }

  /**
   * Generate solutions using constraint-based optimization
   */
  private async generateConstraintSolutions(
    program: Readonly<AxProgram<IN, OUT>>,
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<
    Array<{
      scores: Record<string, number>
      demos?: AxProgramDemos<AxGenIn, OUT>[]
      configuration: Record<string, unknown>
    }>
  > {
    const solutions: Array<{
      scores: Record<string, number>
      demos?: AxProgramDemos<AxGenIn, OUT>[]
      configuration: Record<string, unknown>
    }> = []

    // Get objectives from a sample evaluation
    const sampleExample = this.examples[0]!
    const samplePrediction = await program.forward(
      this.studentAI,
      sampleExample as IN
    )
    const sampleScores = await metricFn({
      prediction: samplePrediction,
      example: sampleExample,
    })
    const objectives = Object.keys(sampleScores)

    // For each objective, optimize it while constraining others
    for (const primaryObjective of objectives) {
      if (options?.verbose) {
        this.getLogger(options)?.(
          `Optimizing ${primaryObjective} with constraints on other objectives`,
          { tags: ['discovery'] }
        )
      }

      // Create a constraint-based metric
      const constraintMetric: AxMetricFn = async ({ prediction, example }) => {
        const scores = await metricFn({ prediction, example })

        // Primary objective score
        const primaryScore = scores[primaryObjective] || 0

        // Penalty for violating constraints on other objectives
        let penalty = 0
        for (const [objective, score] of Object.entries(scores)) {
          if (objective !== primaryObjective) {
            // Simple constraint: other objectives should be at least 0.3
            // This is a heuristic - in practice you'd set domain-specific thresholds
            if (score < 0.3) {
              penalty += (0.3 - score) * 2 // Penalty factor
            }
          }
        }

        return primaryScore - penalty
      }

      try {
        const result = await this.compile(program, constraintMetric, {
          ...options,
          verbose: false,
        })

        const scores = await this.evaluateWithMultiObjective(
          program,
          result,
          metricFn
        )

        solutions.push({
          scores,
          demos: result.demos,
          configuration: {
            ...result.finalConfiguration,
            primaryObjective,
            strategy: 'constraint_based',
          },
        })
      } catch (error) {
        if (options?.verbose) {
          this.getLogger(options)?.(
            `Failed constraint optimization for ${primaryObjective}: ${error}`,
            { tags: ['warning'] }
          )
        }
        continue
      }
    }

    return solutions
  }

  /**
   * Generate different weight combinations for objectives
   */
  private generateWeightCombinations(
    objectives: string[]
  ): Record<string, number>[] {
    const combinations: Record<string, number>[] = []

    // Single-objective focus (one objective gets weight 1, others get 0)
    for (const objective of objectives) {
      const weights: Record<string, number> = {}
      for (const obj of objectives) {
        weights[obj] = obj === objective ? 1 : 0
      }
      combinations.push(weights)
    }

    // Equal weights
    const equalWeights: Record<string, number> = {}
    for (const objective of objectives) {
      equalWeights[objective] = 1 / objectives.length
    }
    combinations.push(equalWeights)

    // If we have 2 objectives, generate more granular combinations
    if (objectives.length === 2) {
      const [obj1, obj2] = objectives
      for (let w1 = 0.1; w1 <= 0.9; w1 += 0.2) {
        const w2 = 1 - w1
        combinations.push({ [obj1!]: w1, [obj2!]: w2 })
      }
    }

    // If we have 3 objectives, generate some key combinations
    if (objectives.length === 3) {
      const [obj1, obj2, obj3] = objectives
      combinations.push(
        { [obj1!]: 0.5, [obj2!]: 0.3, [obj3!]: 0.2 },
        { [obj1!]: 0.3, [obj2!]: 0.5, [obj3!]: 0.2 },
        { [obj1!]: 0.2, [obj2!]: 0.3, [obj3!]: 0.5 }
      )
    }

    return combinations
  }

  /**
   * Evaluate a single-objective result with multi-objective metrics
   */
  private async evaluateWithMultiObjective(
    program: Readonly<AxProgram<IN, OUT>>,
    result: Readonly<AxOptimizerResult<OUT>>,
    metricFn: AxMultiMetricFn
  ): Promise<Record<string, number>> {
    const valSet = this.getValidationSet()
    const allScores: Record<string, number[]> = {}

    // Apply the optimized configuration to the program
    const testProgram = { ...program }
    if (result.demos && 'setDemos' in testProgram) {
      ;(
        testProgram as unknown as { setDemos: (demos: unknown) => void }
      ).setDemos(result.demos)
    }

    // Evaluate on validation set
    const evalSet = valSet.slice(0, Math.min(5, valSet.length))

    for (const example of evalSet) {
      try {
        const prediction = await testProgram.forward(
          this.studentAI,
          example as IN
        )
        const scores = await metricFn({ prediction, example })

        // Collect scores for each objective
        for (const [objective, score] of Object.entries(scores)) {
          if (!allScores[objective]) {
            allScores[objective] = []
          }
          allScores[objective]!.push(score)
        }
      } catch {
        // Skip failed predictions
        continue
      }
    }

    // Calculate average scores for each objective
    const avgScores: Record<string, number> = {}
    for (const [objective, scores] of Object.entries(allScores)) {
      avgScores[objective] =
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : 0
    }

    return avgScores
  }

  /**
   * Find the Pareto frontier from a set of solutions
   */
  private findParetoFrontier(
    solutions: Array<{
      scores: Record<string, number>
      demos?: AxProgramDemos<AxGenIn, OUT>[]
      configuration: Record<string, unknown>
    }>
  ): Array<{
    demos: readonly AxProgramDemos<AxGenIn, OUT>[]
    scores: Readonly<Record<string, number>>
    configuration: Readonly<Record<string, unknown>>
    dominatedSolutions: number
  }> {
    const paretoFront: Array<{
      demos: readonly AxProgramDemos<AxGenIn, OUT>[]
      scores: Readonly<Record<string, number>>
      configuration: Readonly<Record<string, unknown>>
      dominatedSolutions: number
    }> = []

    // For each solution, check if it's dominated by any other solution
    for (let i = 0; i < solutions.length; i++) {
      const solutionA = solutions[i]!
      let isDominated = false
      let dominatedCount = 0

      for (let j = 0; j < solutions.length; j++) {
        if (i === j) continue

        const solutionB = solutions[j]!

        // Check if B dominates A
        if (this.dominates(solutionB.scores, solutionA.scores)) {
          isDominated = true
          break
        }

        // Count how many solutions A dominates
        if (this.dominates(solutionA.scores, solutionB.scores)) {
          dominatedCount++
        }
      }

      // If A is not dominated by any solution, it's on the Pareto frontier
      if (!isDominated) {
        paretoFront.push({
          demos: solutionA.demos || [],
          scores: solutionA.scores,
          configuration: solutionA.configuration,
          dominatedSolutions: dominatedCount,
        })
      }
    }

    return paretoFront
  }

  /**
   * Check if solution A dominates solution B
   * A dominates B if A is better or equal in all objectives and strictly better in at least one
   */
  private dominates(
    scoresA: Record<string, number>,
    scoresB: Record<string, number>
  ): boolean {
    const objectives = Object.keys(scoresA)

    // Check if A is at least as good as B in all objectives
    let atLeastAsGood = true
    let strictlyBetter = false

    for (const objective of objectives) {
      const scoreA = scoresA[objective] || 0
      const scoreB = scoresB[objective] || 0

      if (scoreA < scoreB) {
        atLeastAsGood = false
        break
      }

      if (scoreA > scoreB) {
        strictlyBetter = true
      }
    }

    return atLeastAsGood && strictlyBetter
  }

  /**
   * Calculate hypervolume of the Pareto frontier
   * Simplified implementation using reference point at origin
   */
  private calculateHypervolume(
    paretoFront: Array<{
      scores: Readonly<Record<string, number>>
    }>
  ): number | undefined {
    if (paretoFront.length === 0) return undefined

    // For simplicity, calculate 2D hypervolume if we have exactly 2 objectives
    const firstSolution = paretoFront[0]!
    const objectives = Object.keys(firstSolution.scores)

    if (objectives.length === 2) {
      const [obj1, obj2] = objectives
      let hypervolume = 0

      // Sort solutions by first objective (descending)
      const sortedSolutions = [...paretoFront].sort(
        (a, b) => (b.scores[obj1!] || 0) - (a.scores[obj1!] || 0)
      )

      let prevScore2 = 0
      for (const solution of sortedSolutions) {
        const score1 = solution.scores[obj1!] || 0
        const score2 = solution.scores[obj2!] || 0

        // Calculate area contribution
        hypervolume += score1 * (score2 - prevScore2)
        prevScore2 = Math.max(prevScore2, score2)
      }

      return hypervolume
    }

    // For higher dimensions, return undefined (would need more complex algorithm)
    return undefined
  }

  /**
   * Save current optimization state to checkpoint
   */
  protected async saveCheckpoint(
    optimizerType: string,
    optimizerConfig: Record<string, unknown>,
    bestScore: number,
    bestConfiguration?: Record<string, unknown>,
    optimizerState: Record<string, unknown> = {},
    options?: AxCompileOptions
  ): Promise<string | undefined> {
    const saveFn = options?.overrideCheckpointSave || this.checkpointSave
    if (!saveFn) return undefined

    const checkpoint: AxOptimizationCheckpoint = {
      version: '1.0.0',
      timestamp: Date.now(),
      optimizerType,
      optimizerConfig,
      currentRound: this.currentRound,
      totalRounds:
        this.stats.resourceUsage.totalTime > 0 ? this.currentRound : 0,
      bestScore,
      bestConfiguration,
      scoreHistory: [...this.scoreHistory],
      configurationHistory: [...this.configurationHistory],
      stats: { ...this.stats },
      optimizerState,
      examples: this.examples,
      validationSet: this.validationSet,
    }

    return await saveFn(checkpoint)
  }

  /**
   * Load optimization state from checkpoint
   */
  protected async loadCheckpoint(
    checkpointId: string,
    options?: AxCompileOptions
  ): Promise<AxOptimizationCheckpoint | null> {
    const loadFn = options?.overrideCheckpointLoad || this.checkpointLoad
    if (!loadFn) return null

    return await loadFn(checkpointId)
  }

  /**
   * Restore optimizer state from checkpoint
   */
  protected restoreFromCheckpoint(
    checkpoint: Readonly<AxOptimizationCheckpoint>
  ): void {
    this.currentRound = checkpoint.currentRound
    this.scoreHistory = [...checkpoint.scoreHistory]
    this.configurationHistory = [...checkpoint.configurationHistory]
    this.stats = { ...checkpoint.stats }
  }

  /**
   * Check if checkpoint should be saved
   */
  protected shouldSaveCheckpoint(
    round: number,
    options?: AxCompileOptions
  ): boolean {
    const interval =
      options?.overrideCheckpointInterval || this.checkpointInterval
    return interval !== undefined && round % interval === 0
  }

  /**
   * Update optimization progress and handle checkpointing
   */
  protected async updateOptimizationProgress(
    round: number,
    score: number,
    configuration: Record<string, unknown>,
    optimizerType: string,
    optimizerConfig: Record<string, unknown>,
    bestScore: number,
    bestConfiguration?: Record<string, unknown>,
    optimizerState: Record<string, unknown> = {},
    options?: AxCompileOptions
  ): Promise<void> {
    this.currentRound = round
    this.scoreHistory.push(score)
    this.configurationHistory.push(configuration)

    // Save checkpoint if needed
    if (this.shouldSaveCheckpoint(round, options)) {
      await this.saveCheckpoint(
        optimizerType,
        optimizerConfig,
        bestScore,
        bestConfiguration,
        optimizerState,
        options
      )
    }
  }

  /**
   * Save final checkpoint on completion
   */
  protected async saveFinalCheckpoint(
    optimizerType: string,
    optimizerConfig: Record<string, unknown>,
    bestScore: number,
    bestConfiguration?: Record<string, unknown>,
    optimizerState: Record<string, unknown> = {},
    options?: AxCompileOptions
  ): Promise<void> {
    if (options?.saveCheckpointOnComplete !== false) {
      await this.saveCheckpoint(
        optimizerType,
        optimizerConfig,
        bestScore,
        bestConfiguration,
        { ...optimizerState, final: true },
        options
      )
    }
  }

  /**
   * Get the logger function with fallback hierarchy:
   * 1. Explicit logger passed to optimizer
   * 2. Logger from student AI service
   * 3. Default optimizer logger
   * 4. undefined if verbose is false
   */
  protected getLogger(
    options?: AxCompileOptions
  ): AxLoggerFunction | undefined {
    // Check if logging should be disabled
    const isVerbose = this.isLoggingEnabled(options)
    if (!isVerbose) {
      return undefined
    }

    // Use explicit logger if provided
    if (this.logger) {
      return this.logger
    }

    // Fall back to default optimizer logger
    return axDefaultOptimizerLogger
  }

  /**
   * Check if logging is enabled based on verbose settings
   */
  protected isLoggingEnabled(options?: AxCompileOptions): boolean {
    // Explicit verbose setting in options takes precedence
    if (options?.verbose !== undefined) {
      return options.verbose
    }

    // Use optimizer's verbose setting
    return this.verbose ?? true // Default to true if not specified
  }
}
