import type { AxAIService } from '../ai/types.js'

import type { AxProgram, AxProgramDemos } from './program.js'
import type { AxFieldValue, AxGenIn, AxGenOut } from './types.js'

// Common types used by optimizers
export type AxExample = Record<string, AxFieldValue>

export type AxMetricFn = <T extends AxGenOut = AxGenOut>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => number

export type AxMetricFnArgs = Parameters<AxMetricFn>[0]

// Base optimizer arguments
export type AxOptimizerArgs<IN extends AxGenIn, OUT extends AxGenOut> = {
  ai: AxAIService
  program: Readonly<AxProgram<IN, OUT>>
  examples: Readonly<AxExample[]>
  options?: Record<string, unknown>
}

// Common optimization statistics
export interface AxOptimizationStats {
  totalCalls: number
  successfulDemos: number
  estimatedTokenUsage: number
  earlyStopped: boolean
  earlyStopping?: {
    bestScoreRound: number
    patienceExhausted: boolean
  }
}

// Common optimizer result interface
export interface AxOptimizerResult<IN extends AxGenIn, OUT extends AxGenOut> {
  program?: Readonly<AxProgram<IN, OUT>>
  demos?: AxProgramDemos[]
  stats?: AxOptimizationStats
}

// Base optimizer interface that all optimizers should implement
export interface AxOptimizer<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> {
  /**
   * Main optimization method that optimizes the program using the provided metric function
   * @param metricFn Evaluation metric function to assess program performance
   * @param options Optional configuration options specific to the optimizer
   * @returns Optimization result containing the optimized program, demos, and/or stats
   */
  compile(
    metricFn: AxMetricFn,
    options?: Record<string, unknown>
  ): Promise<AxOptimizerResult<IN, OUT>>

  /**
   * Get optimization statistics if available
   * @returns Optimization statistics or undefined if not supported
   */
  getStats?(): AxOptimizationStats | undefined
}

// Specific optimizer interfaces for type safety

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
}

// Bootstrap-specific compile options
export interface AxBootstrapCompileOptions {
  valset?: readonly AxExample[]
  maxDemos?: number
}

// MiPRO-specific compile options
export interface AxMiPROCompileOptions {
  valset?: readonly AxExample[]
  teacher?: Readonly<AxProgram<AxGenIn, AxGenOut>>
  auto?: 'light' | 'medium' | 'heavy'
}
