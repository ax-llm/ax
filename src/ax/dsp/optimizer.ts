import type { AxAIService } from '../ai/types.js'

import type { AxProgram, AxProgramDemos } from './program.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from './types.js'

// Common types used by optimizers
export type AxExample = Record<string, AxFieldValue>

export type AxMetricFn = <T extends AxGenOut = AxGenOut>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => number

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
  trackLatency(ms: number): void
  getCurrentCost(): number
  getTokenUsage(): Record<string, number>
  reset(): void
}

// Evaluation strategy configuration
export interface AxEvaluationStrategy {
  name: 'holdout' | 'cross-validation' | 'bootstrap' | 'temporal-split'

  // For cross-validation
  folds?: number
  stratified?: boolean

  // For temporal splits (time-series data)
  splitRatio?: number
  timeColumn?: string

  // For bootstrap
  bootstrapSamples?: number

  // Custom validation function
  customSplit?: (examples: readonly AxExample[]) => {
    train: readonly AxExample[]
    validation: readonly AxExample[]
  }
}

// Enhanced optimizer arguments - no longer includes program
export type AxOptimizerArgs<OUT extends AxGenOut = AxGenOut> = {
  studentAI: AxAIService
  teacherAI?: AxAIService // For generating high-quality examples/corrections
  examples: readonly AxExample[]

  // Resource management
  tokenBudget?: number
  timeBudget?: number // in milliseconds
  maxConcurrentEvals?: number

  // Evaluation strategy
  validationSet?: readonly AxExample[]
  evaluationStrategy?: AxEvaluationStrategy

  // Quality thresholds
  minSuccessRate?: number
  targetScore?: number

  // Monitoring & callbacks
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void
  costTracker?: AxCostTracker

  // Reproducibility
  seed?: number
  cacheResults?: boolean
  cacheKey?: string

  // Warm start support
  warmStart?: {
    previousResults: AxOptimizerResult<OUT>
    continueFromBest: boolean
    inheritDemos?: boolean
  }
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

  // Cache information
  cacheInfo?: {
    cacheHits: number
    cacheMisses: number
    cacheKey?: string
  }
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
  overrideTokenBudget?: number
  overrideTimeBudget?: number
  overrideTargetScore?: number

  // Evaluation overrides
  overrideEvaluationStrategy?: AxEvaluationStrategy
  overrideCostTracker?: AxCostTracker

  // Progress monitoring overrides
  overrideOnProgress?: (progress: Readonly<AxOptimizationProgress>) => void
  overrideOnEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void

  // Experimental features
  enableParallelEvaluation?: boolean
  enableAdaptiveBatching?: boolean
  enableProgressiveValidation?: boolean
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
  seed?: number
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
  multiObjective?: boolean
  paretoFrontSize?: number
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
export class DefaultCostTracker implements AxCostTracker {
  private tokenUsage: Record<string, number> = {}
  private latencies: number[] = []
  private totalCost = 0

  // Rough cost estimates per 1K tokens (in USD)
  private readonly costPerModel: Record<string, number> = {
    'gpt-4': 0.03,
    'gpt-4-turbo': 0.01,
    'gpt-3.5-turbo': 0.002,
    'claude-3-opus': 0.015,
    'claude-3-sonnet': 0.003,
    'claude-3-haiku': 0.00025,
    'gemini-pro': 0.0005,
    'gemini-pro-vision': 0.002,
  }

  trackTokens(count: number, model: string): void {
    this.tokenUsage[model] = (this.tokenUsage[model] || 0) + count
    const costPer1K = this.costPerModel[model] || 0.001 // Default fallback
    this.totalCost += (count / 1000) * costPer1K
  }

  trackLatency(ms: number): void {
    this.latencies.push(ms)
  }

  getCurrentCost(): number {
    return this.totalCost
  }

  getTokenUsage(): Record<string, number> {
    return { ...this.tokenUsage }
  }

  reset(): void {
    this.tokenUsage = {}
    this.latencies = []
    this.totalCost = 0
  }

  getAverageLatency(): number {
    return this.latencies.length > 0
      ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
      : 0
  }
}

// Utility functions for optimizer management

/**
 * Create a default evaluation strategy based on dataset size
 */
export function createDefaultEvaluationStrategy(
  exampleCount: number,
  hasValidationSet: boolean = false
): AxEvaluationStrategy {
  if (hasValidationSet) {
    return { name: 'holdout' }
  }

  if (exampleCount < 50) {
    return { name: 'bootstrap', bootstrapSamples: 100 }
  } else if (exampleCount < 200) {
    return { name: 'cross-validation', folds: 5, stratified: true }
  } else {
    return { name: 'holdout', splitRatio: 0.8 }
  }
}

/**
 * Create a default cost tracker with common model pricing
 */
export function createDefaultCostTracker(): DefaultCostTracker {
  return new DefaultCostTracker()
}

/**
 * Validate optimizer arguments for common issues
 */
export function validateOptimizerArgs(args: Readonly<AxOptimizerArgs>): {
  isValid: boolean
  issues: string[]
  suggestions: string[]
} {
  const issues: string[] = []
  const suggestions: string[] = []

  if (args.examples.length === 0) {
    issues.push('No examples provided')
    suggestions.push(
      'Provide at least 10-20 examples for effective optimization'
    )
  } else if (args.examples.length < 5) {
    issues.push('Very few examples provided')
    suggestions.push(
      'Consider providing more examples (10-50) for better optimization results'
    )
  }

  if (args.tokenBudget && args.tokenBudget < 1000) {
    issues.push('Token budget is very low')
    suggestions.push(
      'Consider increasing token budget to at least 10,000 for meaningful optimization'
    )
  }

  if (args.timeBudget && args.timeBudget < 60000) {
    // 1 minute
    issues.push('Time budget is very short')
    suggestions.push('Consider allowing at least 5-10 minutes for optimization')
  }

  if (
    args.validationSet &&
    args.validationSet.length < Math.max(5, args.examples.length * 0.2)
  ) {
    issues.push('Validation set is too small')
    suggestions.push(
      'Validation set should be at least 20% of training examples or 5 examples minimum'
    )
  }

  return {
    isValid: issues.length === 0,
    issues,
    suggestions,
  }
}
