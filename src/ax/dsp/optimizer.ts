import type { AxAIService } from '../ai/types.js'

import type { AxProgram, AxProgramDemos } from './program.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from './types.js'

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

  // Progress monitoring overrides
  overrideOnProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  overrideOnEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void
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
  updateConfiguration?(config: Record<string, unknown>): void

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
}

// Legacy compile options (for backward compatibility)
export interface AxBootstrapCompileOptions extends AxCompileOptions {
  valset?: readonly AxExample[]
  maxDemos?: number
  teacherProgram?: Readonly<AxProgram<AxGenIn, AxGenOut>>
}

export interface AxMiPROCompileOptions extends AxCompileOptions {
  valset?: readonly AxExample[]
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
