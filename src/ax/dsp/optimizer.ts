import type { Counter, Gauge, Histogram, Meter } from '@opentelemetry/api';

import type { AxAIService, AxLoggerFunction } from '../ai/types.js';
import { ax } from '../index.js';

import { AxGen } from './generate.js';
import { axGlobals } from './globals.js';
import { axDefaultOptimizerLogger } from './optimizerLogging.js';
import type { AxOptimizerLoggerFunction } from './optimizerTypes.js';
import type { AxFieldValue, AxGenOut, AxProgramDemos } from './types.js';

// Logger utilities are now exported from ./loggers.js

// Common types used by optimizers
export type AxExample = Record<string, AxFieldValue>;

// Typed example that matches the input type of a program
export type AxTypedExample<IN = any> = IN & {
  [key: string]: AxFieldValue;
};

export type AxMetricFn = <T = any>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => number | Promise<number>;

export type AxMetricFnArgs = Parameters<AxMetricFn>[0];

// Multi-objective metric function for Pareto optimization
export type AxMultiMetricFn = <T = any>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => Record<string, number>;

// Progress tracking interface for real-time updates
export interface AxOptimizationProgress {
  round: number;
  totalRounds: number;
  currentScore: number;
  bestScore: number;
  tokensUsed: number;
  timeElapsed: number;
  successfulExamples: number;
  totalExamples: number;
  currentConfiguration?: Record<string, unknown>;
  bestConfiguration?: Record<string, unknown>;
  convergenceInfo?: {
    improvement: number;
    stagnationRounds: number;
    isConverging: boolean;
  };
}

// Cost tracking interface for monitoring resource usage
export interface AxCostTracker {
  trackTokens(count: number, model: string): void;
  getCurrentCost(): number;
  getTokenUsage(): Record<string, number>;
  getTotalTokens(): number;
  isLimitReached(): boolean;
  reset(): void;
}

// Checkpoint interface for saving/loading optimization state
export interface AxOptimizationCheckpoint {
  version: string;
  timestamp: number;
  optimizerType: string;
  optimizerConfig: Record<string, unknown>;

  // Current optimization state
  currentRound: number;
  totalRounds: number;
  bestScore: number;
  bestConfiguration?: Record<string, unknown>;

  // Historical data
  scoreHistory: number[];
  configurationHistory: Record<string, unknown>[];

  // Resource usage
  stats: AxOptimizationStats;

  // Optimizer-specific state
  optimizerState: Record<string, unknown>;

  // Examples and validation data
  examples: readonly AxExample[];
}

// Simple checkpoint functions - users implement these as needed
export type AxCheckpointSaveFn = (
  checkpoint: Readonly<AxOptimizationCheckpoint>
) => Promise<string>;
export type AxCheckpointLoadFn = (
  checkpointId: string
) => Promise<AxOptimizationCheckpoint | null>;

// Cost tracker configuration options
export interface AxCostTrackerOptions {
  // Cost-based limits
  costPerModel?: Record<string, number>;
  maxCost?: number;

  // Token-based limits
  maxTokens?: number;
}

// Enhanced optimizer arguments - no longer includes program or examples
export type AxOptimizerArgs = {
  studentAI: AxAIService;
  teacherAI?: AxAIService; // For generating high-quality examples/corrections

  // Python optimizer service
  optimizerEndpoint?: string; // Python optimizer service URL
  optimizerTimeout?: number; // Request timeout (default: 30000ms)
  optimizerRetries?: number; // Retry attempts (default: 3)

  // MiPRO-specific options (flattened from AxMiPROOptimizerOptions)
  numCandidates?: number;
  initTemperature?: number;
  maxBootstrappedDemos?: number;
  maxLabeledDemos?: number;
  numTrials?: number;
  minibatch?: boolean;
  minibatchSize?: number;
  minibatchFullEvalSteps?: number;
  programAwareProposer?: boolean;
  dataAwareProposer?: boolean;
  viewDataBatchSize?: number;
  tipAwareProposer?: boolean;
  fewshotAwareProposer?: boolean;
  earlyStoppingTrials?: number;
  minImprovementThreshold?: number;
  bayesianOptimization?: boolean;
  acquisitionFunction?:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement';
  explorationWeight?: number;
  sampleCount?: number;

  // Quality thresholds
  minSuccessRate?: number;
  targetScore?: number;

  // Monitoring & callbacks
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void;
  costTracker?: AxCostTracker;

  // Checkpointing
  checkpointSave?: AxCheckpointSaveFn;
  checkpointLoad?: AxCheckpointLoadFn;
  checkpointInterval?: number; // Save checkpoint every N rounds
  resumeFromCheckpoint?: string; // Checkpoint ID to resume from

  // Logging
  logger?: AxLoggerFunction;
  verbose?: boolean;

  // Reproducibility
  seed?: number;

  // Optimizer logging
  debugOptimizer?: boolean;
  optimizerLogger?: AxOptimizerLoggerFunction;
};

// Enhanced optimization statistics
export interface AxOptimizationStats {
  totalCalls: number;
  successfulDemos: number;
  estimatedTokenUsage: number;
  earlyStopped: boolean;
  earlyStopping?: {
    bestScoreRound: number;
    patienceExhausted: boolean;
    reason: string;
  };
  bestScore: number;
  bestConfiguration?: Record<string, unknown>;

  // Resource usage tracking
  resourceUsage: {
    totalTokens: number;
    totalTime: number;
    avgLatencyPerEval: number;
    peakMemoryUsage?: number;
    costByModel: Record<string, number>;
  };

  // Quality metrics
  convergenceInfo: {
    converged: boolean;
    finalImprovement: number;
    stagnationRounds: number;
    convergenceThreshold: number;
  };

  // Evaluation breakdown
  evaluationBreakdown?: {
    trainingScore: number;
    validationScore: number;
    crossValidationScores?: number[];
    standardDeviation?: number;
  };
}

// Optimizer metrics configuration interface
export interface AxOptimizerMetricsConfig {
  enabled: boolean;
  enabledCategories: (
    | 'optimization'
    | 'convergence'
    | 'resource_usage'
    | 'teacher_student'
    | 'checkpointing'
    | 'pareto'
  )[];
  maxLabelLength: number;
  samplingRate: number;
}

// Default optimizer metrics configuration
export const axDefaultOptimizerMetricsConfig: AxOptimizerMetricsConfig = {
  enabled: true,
  enabledCategories: [
    'optimization',
    'convergence',
    'resource_usage',
    'teacher_student',
    'checkpointing',
    'pareto',
  ],
  maxLabelLength: 100,
  samplingRate: 1.0,
};

// Optimizer metrics instruments interface
export interface AxOptimizerMetricsInstruments {
  // Optimization flow metrics
  optimizationLatencyHistogram?: Histogram;
  optimizationRequestsCounter?: Counter;
  optimizationErrorsCounter?: Counter;

  // Convergence metrics
  convergenceRoundsHistogram?: Histogram;
  convergenceScoreGauge?: Gauge;
  convergenceImprovementGauge?: Gauge;
  stagnationRoundsGauge?: Gauge;
  earlyStoppingCounter?: Counter;

  // Resource usage metrics
  tokenUsageCounter?: Counter;
  costUsageCounter?: Counter;
  memoryUsageGauge?: Gauge;
  optimizationDurationHistogram?: Histogram;

  // Teacher-student metrics
  teacherStudentUsageCounter?: Counter;
  teacherStudentLatencyHistogram?: Histogram;
  teacherStudentScoreImprovementGauge?: Gauge;

  // Checkpointing metrics
  checkpointSaveCounter?: Counter;
  checkpointLoadCounter?: Counter;
  checkpointSaveLatencyHistogram?: Histogram;
  checkpointLoadLatencyHistogram?: Histogram;

  // Pareto optimization metrics
  paretoOptimizationsCounter?: Counter;
  paretoFrontSizeHistogram?: Histogram;
  paretoHypervolumeGauge?: Gauge;
  paretoSolutionsGeneratedHistogram?: Histogram;

  // Program complexity metrics
  programInputFieldsGauge?: Gauge;
  programOutputFieldsGauge?: Gauge;
  examplesCountGauge?: Gauge;
  validationSetSizeGauge?: Gauge;

  // Performance metrics
  evaluationLatencyHistogram?: Histogram;
  demoGenerationLatencyHistogram?: Histogram;
  metricComputationLatencyHistogram?: Histogram;

  // Configuration metrics
  optimizerTypeGauge?: Gauge;
  targetScoreGauge?: Gauge;
  maxRoundsGauge?: Gauge;
}

// Singleton instance for optimizer metrics instruments
let globalOptimizerMetricsInstruments:
  | AxOptimizerMetricsInstruments
  | undefined;

// Function to get or create optimizer metrics instruments (singleton pattern)
export const getOrCreateOptimizerMetricsInstruments = (
  meter?: Meter
): AxOptimizerMetricsInstruments | undefined => {
  // Return existing instance if available
  if (globalOptimizerMetricsInstruments) {
    return globalOptimizerMetricsInstruments;
  }

  if (meter) {
    globalOptimizerMetricsInstruments =
      createOptimizerMetricsInstruments(meter);
    return globalOptimizerMetricsInstruments;
  }

  return undefined;
};

// Function to reset the optimizer metrics singleton (useful for testing)
export const resetOptimizerMetricsInstruments = (): void => {
  globalOptimizerMetricsInstruments = undefined;
};

// Global optimizer metrics configuration
let currentOptimizerMetricsConfig: AxOptimizerMetricsConfig =
  axDefaultOptimizerMetricsConfig;

// Function to update optimizer metrics configuration
export const axUpdateOptimizerMetricsConfig = (
  config: Readonly<Partial<AxOptimizerMetricsConfig>>
): void => {
  currentOptimizerMetricsConfig = {
    ...currentOptimizerMetricsConfig,
    ...config,
  };
};

// Function to get current optimizer metrics configuration
export const axGetOptimizerMetricsConfig = (): AxOptimizerMetricsConfig => {
  return { ...currentOptimizerMetricsConfig };
};

export const createOptimizerMetricsInstruments = (
  meter: Meter
): AxOptimizerMetricsInstruments => {
  return {
    // Optimization flow metrics
    optimizationLatencyHistogram: meter.createHistogram(
      'ax_optimizer_optimization_duration_ms',
      {
        description: 'End-to-end duration of optimization runs',
        unit: 'ms',
      }
    ),

    optimizationRequestsCounter: meter.createCounter(
      'ax_optimizer_optimization_requests_total',
      {
        description: 'Total number of optimization requests',
      }
    ),

    optimizationErrorsCounter: meter.createCounter(
      'ax_optimizer_optimization_errors_total',
      {
        description: 'Total number of failed optimizations',
      }
    ),

    // Convergence metrics
    convergenceRoundsHistogram: meter.createHistogram(
      'ax_optimizer_convergence_rounds',
      {
        description: 'Number of rounds until convergence',
      }
    ),

    convergenceScoreGauge: meter.createGauge('ax_optimizer_convergence_score', {
      description: 'Current best score during optimization',
    }),

    convergenceImprovementGauge: meter.createGauge(
      'ax_optimizer_convergence_improvement',
      {
        description: 'Improvement in score from baseline',
      }
    ),

    stagnationRoundsGauge: meter.createGauge('ax_optimizer_stagnation_rounds', {
      description: 'Number of rounds without improvement',
    }),

    earlyStoppingCounter: meter.createCounter(
      'ax_optimizer_early_stopping_total',
      {
        description: 'Total number of early stopping events',
      }
    ),

    // Resource usage metrics
    tokenUsageCounter: meter.createCounter('ax_optimizer_token_usage_total', {
      description: 'Total tokens used during optimization',
    }),

    costUsageCounter: meter.createCounter('ax_optimizer_cost_usage_total', {
      description: 'Total cost incurred during optimization',
      unit: '$',
    }),

    memoryUsageGauge: meter.createGauge('ax_optimizer_memory_usage_bytes', {
      description: 'Peak memory usage during optimization',
      unit: 'By',
    }),

    optimizationDurationHistogram: meter.createHistogram(
      'ax_optimizer_duration_ms',
      {
        description: 'Duration of optimization runs',
        unit: 'ms',
      }
    ),

    // Teacher-student metrics
    teacherStudentUsageCounter: meter.createCounter(
      'ax_optimizer_teacher_student_usage_total',
      {
        description: 'Total number of teacher-student interactions',
      }
    ),

    teacherStudentLatencyHistogram: meter.createHistogram(
      'ax_optimizer_teacher_student_latency_ms',
      {
        description: 'Latency of teacher-student interactions',
        unit: 'ms',
      }
    ),

    teacherStudentScoreImprovementGauge: meter.createGauge(
      'ax_optimizer_teacher_student_score_improvement',
      {
        description: 'Score improvement from teacher-student interactions',
      }
    ),

    // Checkpointing metrics
    checkpointSaveCounter: meter.createCounter(
      'ax_optimizer_checkpoint_save_total',
      {
        description: 'Total number of checkpoint saves',
      }
    ),

    checkpointLoadCounter: meter.createCounter(
      'ax_optimizer_checkpoint_load_total',
      {
        description: 'Total number of checkpoint loads',
      }
    ),

    checkpointSaveLatencyHistogram: meter.createHistogram(
      'ax_optimizer_checkpoint_save_latency_ms',
      {
        description: 'Latency of checkpoint save operations',
        unit: 'ms',
      }
    ),

    checkpointLoadLatencyHistogram: meter.createHistogram(
      'ax_optimizer_checkpoint_load_latency_ms',
      {
        description: 'Latency of checkpoint load operations',
        unit: 'ms',
      }
    ),

    // Pareto optimization metrics
    paretoOptimizationsCounter: meter.createCounter(
      'ax_optimizer_pareto_optimizations_total',
      {
        description: 'Total number of Pareto optimizations',
      }
    ),

    paretoFrontSizeHistogram: meter.createHistogram(
      'ax_optimizer_pareto_front_size',
      {
        description: 'Size of Pareto frontier',
      }
    ),

    paretoHypervolumeGauge: meter.createGauge(
      'ax_optimizer_pareto_hypervolume',
      {
        description: 'Hypervolume of Pareto frontier',
      }
    ),

    paretoSolutionsGeneratedHistogram: meter.createHistogram(
      'ax_optimizer_pareto_solutions_generated',
      {
        description: 'Number of solutions generated for Pareto optimization',
      }
    ),

    // Program complexity metrics
    programInputFieldsGauge: meter.createGauge(
      'ax_optimizer_program_input_fields',
      {
        description: 'Number of input fields in optimized program',
      }
    ),

    programOutputFieldsGauge: meter.createGauge(
      'ax_optimizer_program_output_fields',
      {
        description: 'Number of output fields in optimized program',
      }
    ),

    examplesCountGauge: meter.createGauge('ax_optimizer_examples_count', {
      description: 'Number of training examples used',
    }),

    validationSetSizeGauge: meter.createGauge(
      'ax_optimizer_validation_set_size',
      {
        description: 'Size of validation set used',
      }
    ),

    // Performance metrics
    evaluationLatencyHistogram: meter.createHistogram(
      'ax_optimizer_evaluation_latency_ms',
      {
        description: 'Latency of program evaluations',
        unit: 'ms',
      }
    ),

    demoGenerationLatencyHistogram: meter.createHistogram(
      'ax_optimizer_demo_generation_latency_ms',
      {
        description: 'Latency of demo generation',
        unit: 'ms',
      }
    ),

    metricComputationLatencyHistogram: meter.createHistogram(
      'ax_optimizer_metric_computation_latency_ms',
      {
        description: 'Latency of metric computation',
        unit: 'ms',
      }
    ),

    // Configuration metrics
    optimizerTypeGauge: meter.createGauge('ax_optimizer_type', {
      description: 'Type of optimizer being used',
    }),

    targetScoreGauge: meter.createGauge('ax_optimizer_target_score', {
      description: 'Target score for optimization',
    }),

    maxRoundsGauge: meter.createGauge('ax_optimizer_max_rounds', {
      description: 'Maximum rounds for optimization',
    }),
  };
};

// Utility function to sanitize optimizer metric labels
const sanitizeOptimizerLabels = (
  labels: Record<string, unknown>
): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value !== undefined && value !== null) {
      const stringValue = String(value);
      // Limit label length based on configuration
      const maxLength = currentOptimizerMetricsConfig.maxLabelLength;
      sanitized[key] =
        stringValue.length > maxLength
          ? stringValue.substring(0, maxLength)
          : stringValue;
    }
  }
  return sanitized;
};

// Recording functions for optimization flow metrics
export const recordOptimizationMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  duration: number,
  success: boolean,
  optimizerType: string,
  programSignature?: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      success: success.toString(),
      optimizer_type: optimizerType,
      ...(programSignature ? { program_signature: programSignature } : {}),
    });

    if (instruments.optimizationLatencyHistogram) {
      instruments.optimizationLatencyHistogram.record(duration, labels);
    }

    if (instruments.optimizationRequestsCounter) {
      instruments.optimizationRequestsCounter.add(1, labels);
    }

    if (!success && instruments.optimizationErrorsCounter) {
      instruments.optimizationErrorsCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record optimization metric:', error);
  }
};

// Recording functions for convergence metrics
export const recordConvergenceMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  rounds: number,
  currentScore: number,
  improvement: number,
  stagnationRounds: number,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.convergenceRoundsHistogram) {
      instruments.convergenceRoundsHistogram.record(rounds, labels);
    }

    if (instruments.convergenceScoreGauge) {
      instruments.convergenceScoreGauge.record(currentScore, labels);
    }

    if (instruments.convergenceImprovementGauge) {
      instruments.convergenceImprovementGauge.record(improvement, labels);
    }

    if (instruments.stagnationRoundsGauge) {
      instruments.stagnationRoundsGauge.record(stagnationRounds, labels);
    }
  } catch (error) {
    console.warn('Failed to record convergence metric:', error);
  }
};

export const recordEarlyStoppingMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  reason: string,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      reason,
      optimizer_type: optimizerType,
    });

    if (instruments.earlyStoppingCounter) {
      instruments.earlyStoppingCounter.add(1, labels);
    }
  } catch (error) {
    console.warn('Failed to record early stopping metric:', error);
  }
};

// Recording functions for resource usage metrics
export const recordResourceUsageMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  tokensUsed: number,
  costIncurred: number,
  optimizerType: string,
  memoryUsage?: number
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.tokenUsageCounter) {
      instruments.tokenUsageCounter.add(tokensUsed, labels);
    }

    if (instruments.costUsageCounter) {
      instruments.costUsageCounter.add(costIncurred, labels);
    }

    if (memoryUsage !== undefined && instruments.memoryUsageGauge) {
      instruments.memoryUsageGauge.record(memoryUsage, labels);
    }
  } catch (error) {
    console.warn('Failed to record resource usage metric:', error);
  }
};

export const recordOptimizationDurationMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  duration: number,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.optimizationDurationHistogram) {
      instruments.optimizationDurationHistogram.record(duration, labels);
    }
  } catch (error) {
    console.warn('Failed to record optimization duration metric:', error);
  }
};

// Recording functions for teacher-student metrics
export const recordTeacherStudentMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  latency: number,
  scoreImprovement: number,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.teacherStudentUsageCounter) {
      instruments.teacherStudentUsageCounter.add(1, labels);
    }

    if (instruments.teacherStudentLatencyHistogram) {
      instruments.teacherStudentLatencyHistogram.record(latency, labels);
    }

    if (instruments.teacherStudentScoreImprovementGauge) {
      instruments.teacherStudentScoreImprovementGauge.record(
        scoreImprovement,
        labels
      );
    }
  } catch (error) {
    console.warn('Failed to record teacher-student metric:', error);
  }
};

// Recording functions for checkpointing metrics
export const recordCheckpointMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  operation: 'save' | 'load',
  latency: number,
  success: boolean,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      operation,
      success: success.toString(),
      optimizer_type: optimizerType,
    });

    if (operation === 'save') {
      if (instruments.checkpointSaveCounter) {
        instruments.checkpointSaveCounter.add(1, labels);
      }
      if (instruments.checkpointSaveLatencyHistogram) {
        instruments.checkpointSaveLatencyHistogram.record(latency, labels);
      }
    } else {
      if (instruments.checkpointLoadCounter) {
        instruments.checkpointLoadCounter.add(1, labels);
      }
      if (instruments.checkpointLoadLatencyHistogram) {
        instruments.checkpointLoadLatencyHistogram.record(latency, labels);
      }
    }
  } catch (error) {
    console.warn('Failed to record checkpoint metric:', error);
  }
};

// Recording functions for Pareto optimization metrics
export const recordParetoMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  frontSize: number,
  solutionsGenerated: number,
  optimizerType: string,
  hypervolume?: number
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.paretoOptimizationsCounter) {
      instruments.paretoOptimizationsCounter.add(1, labels);
    }

    if (instruments.paretoFrontSizeHistogram) {
      instruments.paretoFrontSizeHistogram.record(frontSize, labels);
    }

    if (hypervolume !== undefined && instruments.paretoHypervolumeGauge) {
      instruments.paretoHypervolumeGauge.record(hypervolume, labels);
    }

    if (instruments.paretoSolutionsGeneratedHistogram) {
      instruments.paretoSolutionsGeneratedHistogram.record(
        solutionsGenerated,
        labels
      );
    }
  } catch (error) {
    console.warn('Failed to record Pareto metric:', error);
  }
};

// Recording functions for program complexity metrics
export const recordProgramComplexityMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  inputFields: number,
  outputFields: number,
  examplesCount: number,
  validationSetSize: number,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.programInputFieldsGauge) {
      instruments.programInputFieldsGauge.record(inputFields, labels);
    }

    if (instruments.programOutputFieldsGauge) {
      instruments.programOutputFieldsGauge.record(outputFields, labels);
    }

    if (instruments.examplesCountGauge) {
      instruments.examplesCountGauge.record(examplesCount, labels);
    }

    if (instruments.validationSetSizeGauge) {
      instruments.validationSetSizeGauge.record(validationSetSize, labels);
    }
  } catch (error) {
    console.warn('Failed to record program complexity metric:', error);
  }
};

// Recording functions for performance metrics
export const recordOptimizerPerformanceMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  metricType: 'evaluation' | 'demo_generation' | 'metric_computation',
  duration: number,
  optimizerType: string
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      metric_type: metricType,
      optimizer_type: optimizerType,
    });

    switch (metricType) {
      case 'evaluation':
        if (instruments.evaluationLatencyHistogram) {
          instruments.evaluationLatencyHistogram.record(duration, labels);
        }
        break;
      case 'demo_generation':
        if (instruments.demoGenerationLatencyHistogram) {
          instruments.demoGenerationLatencyHistogram.record(duration, labels);
        }
        break;
      case 'metric_computation':
        if (instruments.metricComputationLatencyHistogram) {
          instruments.metricComputationLatencyHistogram.record(
            duration,
            labels
          );
        }
        break;
    }
  } catch (error) {
    console.warn('Failed to record optimizer performance metric:', error);
  }
};

// Recording functions for configuration metrics
export const recordOptimizerConfigurationMetric = (
  instruments: Readonly<AxOptimizerMetricsInstruments>,
  optimizerType: string,
  targetScore?: number,
  maxRounds?: number
): void => {
  try {
    const labels = sanitizeOptimizerLabels({
      optimizer_type: optimizerType,
    });

    if (instruments.optimizerTypeGauge) {
      instruments.optimizerTypeGauge.record(1, labels);
    }

    if (targetScore !== undefined && instruments.targetScoreGauge) {
      instruments.targetScoreGauge.record(targetScore, labels);
    }

    if (maxRounds !== undefined && instruments.maxRoundsGauge) {
      instruments.maxRoundsGauge.record(maxRounds, labels);
    }
  } catch (error) {
    console.warn('Failed to record optimizer configuration metric:', error);
  }
};

// Simplified result - no program since it's passed to compile
export interface AxOptimizerResult<OUT> {
  demos?: AxProgramDemos<any, OUT>[];
  stats: AxOptimizationStats;
  bestScore: number;
  finalConfiguration?: Record<string, unknown>;

  // Optimization history for analysis
  scoreHistory?: number[];
  configurationHistory?: Record<string, unknown>[];
}

// Pareto optimization result for multi-objective optimization
export interface AxParetoResult<OUT = any> extends AxOptimizerResult<OUT> {
  paretoFront: ReadonlyArray<{
    demos: readonly AxProgramDemos<any, OUT>[];
    scores: Readonly<Record<string, number>>;
    configuration: Readonly<Record<string, unknown>>;
    dominatedSolutions: number;
  }>;

  // Multi-objective specific stats
  hypervolume?: number;
  paretoFrontSize: number;
  convergenceMetrics?: Record<string, number>;
}

// Compile options that can override constructor arguments
export interface AxCompileOptions {
  // Method-specific options
  maxIterations?: number;
  earlyStoppingPatience?: number;
  verbose?: boolean;

  // Optimizer-specific overrides
  maxDemos?: number; // Bootstrap-specific
  auto?: 'light' | 'medium' | 'heavy'; // MiPRO-specific

  // Override args for this specific run
  overrideTargetScore?: number;
  overrideCostTracker?: AxCostTracker;
  overrideTeacherAI?: AxAIService;

  // Progress monitoring overrides
  overrideOnProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  overrideOnEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void;

  // Checkpointing overrides
  overrideCheckpointSave?: AxCheckpointSaveFn;
  overrideCheckpointLoad?: AxCheckpointLoadFn;
  overrideCheckpointInterval?: number;
  saveCheckpointOnComplete?: boolean;
}

// Enhanced base optimizer interface
export interface AxOptimizer {
  /**
   * Optimize a program using the provided metric function
   * @param program The program to optimize
   * @param examples Training examples (typed based on the program) - will be auto-split into train/validation
   * @param metricFn Evaluation metric function to assess program performance
   * @param options Optional configuration options
   * @returns Optimization result containing demos, stats, and configuration
   */
  compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxOptimizerResult<OUT>>;

  /**
   * Optimize a program with real-time streaming updates
   * @param program The program to optimize
   * @param examples Training examples
   * @param metricFn Evaluation metric function
   * @param options Optional configuration options
   * @returns Async iterator yielding optimization progress
   */
  compileStream?<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): AsyncIterableIterator<AxOptimizationProgress>;

  /**
   * Multi-objective optimization using Pareto frontier
   * @param program The program to optimize
   * @param examples Training examples
   * @param metricFn Multi-objective metric function
   * @param options Optional configuration options
   * @returns Pareto optimization result
   */
  compilePareto?<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>>;

  /**
   * Get current optimization statistics
   * @returns Current optimization statistics
   */
  getStats(): AxOptimizationStats;

  /**
   * Cancel ongoing optimization gracefully
   * @returns Promise that resolves when cancellation is complete
   */
  cancel?(): Promise<void>;

  /**
   * Reset optimizer state for reuse with different programs
   */
  reset?(): void;

  /**
   * Get optimizer-specific configuration
   * @returns Current optimizer configuration
   */
  getConfiguration?(): Record<string, unknown>;

  /**
   * Update optimizer configuration
   * @param config New configuration to merge with existing
   */
  updateConfiguration?(config: Readonly<Record<string, unknown>>): void;

  /**
   * Validate that the optimizer can handle the given program
   * @param program Program to validate
   * @returns Validation result with any issues found
   */
  validateProgram?<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>
  ): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  };
}

// Specific optimizer options interfaces

export interface AxBootstrapOptimizerOptions {
  maxRounds?: number;
  maxExamples?: number;
  maxDemos?: number;
  batchSize?: number;
  earlyStoppingPatience?: number;
  teacherAI?: AxAIService;
  costMonitoring?: boolean;
  maxTokensPerGeneration?: number;
  verboseMode?: boolean;
  debugMode?: boolean;

  // Enhanced options
  adaptiveBatching?: boolean;
  dynamicTemperature?: boolean;
  qualityThreshold?: number;
  diversityWeight?: number;
}

export interface AxMiPROOptimizerOptions {
  numCandidates?: number;
  initTemperature?: number;
  maxBootstrappedDemos?: number;
  maxLabeledDemos?: number;
  numTrials?: number;
  minibatch?: boolean;
  minibatchSize?: number;
  minibatchFullEvalSteps?: number;
  programAwareProposer?: boolean;
  dataAwareProposer?: boolean;
  viewDataBatchSize?: number;
  tipAwareProposer?: boolean;
  fewshotAwareProposer?: boolean;
  verbose?: boolean;
  earlyStoppingTrials?: number;
  minImprovementThreshold?: number;

  // Enhanced options
  bayesianOptimization?: boolean;
  acquisitionFunction?:
    | 'expected_improvement'
    | 'upper_confidence_bound'
    | 'probability_improvement';
  explorationWeight?: number;

  // New option: number of samples to generate per forward call for self-consistency
  sampleCount?: number;
}

// Default cost tracker implementation
export class AxDefaultCostTracker implements AxCostTracker {
  private tokenUsage: Record<string, number> = {};
  private totalTokens = 0;

  // Configuration options
  private readonly costPerModel: Record<string, number>;
  private readonly maxCost?: number;
  private readonly maxTokens?: number;

  constructor(options?: AxCostTrackerOptions) {
    this.costPerModel = options?.costPerModel ?? {};
    this.maxCost = options?.maxCost;
    this.maxTokens = options?.maxTokens;
  }

  trackTokens(count: number, model: string): void {
    this.tokenUsage[model] = (this.tokenUsage[model] || 0) + count;
    this.totalTokens += count;
  }

  getCurrentCost(): number {
    // Calculate cost on-demand
    let totalCost = 0;
    for (const [model, tokens] of Object.entries(this.tokenUsage)) {
      const costPer1K = this.costPerModel[model] || 0.001; // Default fallback
      totalCost += (tokens / 1000) * costPer1K;
    }
    return totalCost;
  }

  getTokenUsage(): Record<string, number> {
    return { ...this.tokenUsage };
  }

  getTotalTokens(): number {
    return this.totalTokens;
  }

  isLimitReached(): boolean {
    // Check token limit if configured
    if (this.maxTokens !== undefined && this.totalTokens >= this.maxTokens) {
      return true;
    }

    // Check cost limit if configured (calculate cost on-demand)
    if (this.maxCost !== undefined) {
      const currentCost = this.getCurrentCost();
      if (currentCost >= this.maxCost) {
        return true;
      }
    }

    return false;
  }

  reset(): void {
    this.tokenUsage = {};
    this.totalTokens = 0;
  }
}

/**
 * Abstract base class for optimizers that provides common functionality
 * and standardized handling of AxOptimizerArgs
 */
export abstract class AxBaseOptimizer implements AxOptimizer {
  // Common AxOptimizerArgs fields
  protected readonly studentAI: AxAIService;
  protected readonly teacherAI?: AxAIService;
  protected readonly targetScore?: number;
  protected readonly minSuccessRate?: number;
  protected readonly onProgress?: (
    progress: Readonly<AxOptimizationProgress>
  ) => void;
  protected readonly onEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void;
  protected readonly costTracker?: AxCostTracker;
  protected readonly seed?: number;

  // Checkpointing fields
  protected readonly checkpointSave?: AxCheckpointSaveFn;
  protected readonly checkpointLoad?: AxCheckpointLoadFn;
  protected readonly checkpointInterval?: number;
  protected readonly resumeFromCheckpoint?: string;

  // Logging fields
  protected readonly logger?: AxLoggerFunction;
  protected readonly verbose?: boolean;

  // Optimizer logging
  protected readonly debugOptimizer: boolean;
  protected readonly optimizerLogger?: AxOptimizerLoggerFunction;

  // Checkpoint state
  protected currentRound = 0;
  private scoreHistory: number[] = [];
  private configurationHistory: Record<string, unknown>[] = [];

  // Common optimization statistics
  protected stats: AxOptimizationStats;

  // Metrics instruments
  protected readonly metricsInstruments?: AxOptimizerMetricsInstruments;

  // Result explanation generator
  private resultExplainer?: ReturnType<typeof ax>;

  constructor(args: Readonly<AxOptimizerArgs>) {
    // Set common fields from AxOptimizerArgs
    this.studentAI = args.studentAI;
    this.teacherAI = args.teacherAI;
    this.targetScore = args.targetScore;
    this.minSuccessRate = args.minSuccessRate;
    this.onProgress = args.onProgress;
    this.onEarlyStop = args.onEarlyStop;
    this.seed = args.seed;

    // Set up checkpointing
    this.checkpointSave = args.checkpointSave;
    this.checkpointLoad = args.checkpointLoad;
    this.checkpointInterval = args.checkpointInterval ?? 10; // Default: checkpoint every 10 rounds
    this.resumeFromCheckpoint = args.resumeFromCheckpoint;

    // Set up logging
    this.logger = args.logger;
    this.verbose = args.verbose;

    // Set up cost tracker with default if not provided
    const costTracker = new AxDefaultCostTracker({
      maxTokens: 1000000,
    });
    this.costTracker = args.costTracker ?? costTracker;

    // Initialize metrics instruments
    this.metricsInstruments = getOrCreateOptimizerMetricsInstruments(
      axGlobals.meter
    );

    // Initialize common stats structure
    this.stats = this.initializeStats();

    // Set up optimizer logging
    this.debugOptimizer = args.debugOptimizer ?? false;
    this.optimizerLogger =
      args.optimizerLogger ??
      (this.verbose ? axDefaultOptimizerLogger : undefined);

    // Initialize result explanation generator
    this.initializeResultExplainer();
  }

  /**
   * Initialize the result explanation generator
   */
  private initializeResultExplainer(): void {
    try {
      this.resultExplainer = ax(`
        optimizationScore:number "Final optimization score (0.0 to 1.0)",
        bestConfiguration:json "Best configuration found during optimization",
        totalRounds:number "Number of optimization rounds completed",
        converged:boolean "Whether optimization converged to a stable solution",
        earlyStoppedReason?:string "Reason for early stopping if applicable",
        resourcesUsed:json "Tokens, time, and cost consumed during optimization" ->
        humanExplanation:string "Clear, jargon-free explanation of optimization results for humans",
        recommendations:string[] "Actionable recommendations based on the results",
        performanceAssessment:string "Assessment of how well the optimization performed"
      `);
    } catch (error) {
      // If ax generator initialization fails, continue without it
      this.resultExplainer = undefined;
      if (this.verbose) {
        console.warn(
          '[AxBaseOptimizer] Failed to initialize result explainer:',
          error
        );
      }
    }
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
      bestScore: 0,
      bestConfiguration: {},
    };
  }

  /**
   * Set up reproducible random seed if provided
   */
  protected setupRandomSeed(): void {
    if (this.seed !== undefined) {
      // Note: For full reproducibility, we'd need a proper PRNG
      Math.random = (() => {
        let seed = this.seed!;
        return () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        };
      })();
    }
  }

  /**
   * Check if optimization should stop early due to cost limits
   */
  protected checkCostLimits(): boolean {
    return this.costTracker?.isLimitReached() ?? false;
  }

  /**
   * Check if target score has been reached
   */
  protected checkTargetScore(currentScore: number): boolean {
    return this.targetScore !== undefined && currentScore >= this.targetScore;
  }

  /**
   * Update resource usage statistics
   */
  protected updateResourceUsage(startTime: number, tokensUsed = 0): void {
    this.stats.resourceUsage.totalTime = Date.now() - startTime;
    this.stats.resourceUsage.totalTokens += tokensUsed;

    if (this.stats.totalCalls > 0) {
      this.stats.resourceUsage.avgLatencyPerEval =
        this.stats.resourceUsage.totalTime / this.stats.totalCalls;
    }
  }

  /**
   * Trigger early stopping with appropriate callbacks
   */
  protected triggerEarlyStopping(reason: string, bestScoreRound: number): void {
    this.stats.earlyStopped = true;
    this.stats.earlyStopping = {
      bestScoreRound,
      patienceExhausted: reason.includes('improvement'),
      reason,
    };

    // Record early stopping metrics (use a default optimizer type)
    this.recordEarlyStoppingMetrics(reason, 'unknown');

    if (this.onEarlyStop) {
      this.onEarlyStop(reason, this.stats);
    }
    const optLogger = this.getOptimizerLogger();
    optLogger?.({
      name: 'EarlyStopping',
      value: {
        reason,
        finalScore: this.stats.bestScore ?? 0,
        round: bestScoreRound,
      },
    });
  }

  /**
   * Validate that examples meet minimum requirements for optimization
   * @param examples Examples to validate
   * @param requireSplit Whether this optimizer requires train/validation split (default: true)
   * @throws Error if examples don't meet minimum requirements
   */
  protected validateExamples<IN>(
    examples: readonly AxTypedExample<IN>[],
    requireSplit = true
  ): void {
    if (!examples || examples.length === 0) {
      throw new Error('At least 1 example is required for optimization');
    }

    if (requireSplit) {
      // For auto-splitting optimizers, we need at least 2 examples
      // (1 for training, 1 for validation)
      if (examples.length < 2) {
        throw new Error(
          'At least 2 examples are required for optimization with auto-splitting. ' +
            'Provide more examples to enable proper train/validation split.'
        );
      }
    }

    // Warn if very few examples
    const recommendedMin = requireSplit ? 10 : 5;
    if (examples.length < recommendedMin && this.verbose) {
      console.warn(
        `[Ax Optimizer] Warning: Only ${examples.length} examples provided. Consider providing more examples (${recommendedMin}+ recommended) for better optimization results.`
      );
    }
  }

  /**
   * Get the AI service to use for a specific task, preferring teacher when available
   * @param preferTeacher Whether to prefer teacher AI over student AI
   * @param options Optional compile options that may override teacher AI
   * @returns The appropriate AI service to use
   */
  protected getAIService(
    preferTeacher = false,
    options?: AxCompileOptions
  ): AxAIService {
    // Check for override teacher AI first
    if (preferTeacher && options?.overrideTeacherAI) {
      return options.overrideTeacherAI;
    }

    // Then check for configured teacher AI
    if (preferTeacher && this.teacherAI) {
      return this.teacherAI;
    }

    return this.studentAI;
  }

  /**
   * Check if teacher AI is available (including overrides)
   * @param options Optional compile options that may override teacher AI
   * @returns True if teacher AI is configured or overridden
   */
  protected hasTeacherAI(options?: AxCompileOptions): boolean {
    return (
      options?.overrideTeacherAI !== undefined || this.teacherAI !== undefined
    );
  }

  /**
   * Get teacher AI if available, otherwise return student AI
   * @param options Optional compile options that may override teacher AI
   * @returns Teacher AI if available, otherwise student AI
   */
  protected getTeacherOrStudentAI(options?: AxCompileOptions): AxAIService {
    return options?.overrideTeacherAI || this.teacherAI || this.studentAI;
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
    preferTeacher = true,
    options?: AxCompileOptions
  ): Promise<T> {
    const ai = this.getAIService(preferTeacher, options);
    return await task(ai);
  }

  /**
   * Abstract method that must be implemented by concrete optimizers
   */
  public abstract compile<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): Promise<AxOptimizerResult<OUT>>;

  /**
   * Optimize a program with real-time streaming updates
   * @param program The program to optimize
   * @param examples Training examples
   * @param metricFn Evaluation metric function
   * @param options Optional configuration options
   * @returns Async iterator yielding optimization progress
   */
  public async *compileStream<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMetricFn,
    options?: AxCompileOptions
  ): AsyncIterableIterator<AxOptimizationProgress> {
    const startTime = Date.now();
    const optimizerType = this.constructor.name;
    const programSignature = program.getSignature().toString();

    this.recordOptimizationStart(optimizerType, programSignature);

    let earlyStopReason: string | undefined;

    const updateProgress = (
      round: number,
      score: number,
      configuration: Record<string, unknown>,
      optimizerType: string,
      optimizerConfig: Record<string, unknown>,
      bestScore: number,
      bestConfiguration: Record<string, unknown> | undefined,
      optimizerState: Record<string, unknown> = {},
      options?: AxCompileOptions
    ) => {
      const optLogger = this.getOptimizerLogger(options);
      optLogger?.({
        name: 'RoundProgress',
        value: {
          round,
          totalRounds: options?.maxIterations ?? 0,
          currentScore: score,
          bestScore,
          configuration,
        },
      });
      this.updateOptimizationProgress(
        round,
        score,
        configuration,
        optimizerType,
        optimizerConfig,
        bestScore,
        bestConfiguration,
        optimizerState,
        options
      );
    };

    const onEarlyStop = (
      reason: string,
      _stats: Readonly<AxOptimizationStats>
    ) => {
      earlyStopReason = reason;
      this.triggerEarlyStopping(reason, this.currentRound);
    };

    const onProgress = (progress: Readonly<AxOptimizationProgress>) => {
      this.onProgress?.(progress);
      updateProgress(
        progress.round,
        progress.currentScore,
        progress.currentConfiguration || {},
        optimizerType,
        {}, // No optimizerConfig here, it's part of the progress object
        progress.bestScore,
        progress.bestConfiguration,
        progress.convergenceInfo,
        options
      );
    };

    const compileResult = await this.compile(program, examples, metricFn, {
      ...options,
      overrideOnProgress: onProgress,
      overrideOnEarlyStop: onEarlyStop,
    });

    const duration = Date.now() - startTime;
    this.recordOptimizationComplete(
      duration,
      true,
      optimizerType,
      programSignature
    );

    if (earlyStopReason) {
      this.getLogger(options)?.({
        name: 'Notification',
        id: 'optimization_early_stop',
        value: `Optimization stopped early due to ${earlyStopReason}`,
      });
    }

    return {
      demos: compileResult.demos,
      stats: compileResult.stats,
      bestScore: compileResult.bestScore,
      finalConfiguration: compileResult.finalConfiguration,
      scoreHistory: compileResult.scoreHistory,
      configurationHistory: compileResult.configurationHistory,
    };
  }

  /**
   * Multi-objective optimization using Pareto frontier
   * Default implementation that leverages the single-objective compile method
   * @param program The program to optimize
   * @param examples Training examples
   * @param metricFn Multi-objective metric function that returns multiple scores
   * @param options Optional configuration options
   * @returns Pareto optimization result with frontier of non-dominated solutions
   */
  public async compilePareto<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<AxParetoResult<OUT>> {
    const _optimizerType = this.constructor.name;
    const startTime = Date.now();

    // Strategy 1: Generate different weighted combinations of objectives
    const solutions = await this.generateWeightedSolutions(
      program,
      examples,
      metricFn,
      options
    );

    // Strategy 2: Generate constraint-based solutions (optimize one objective while constraining others)
    const constraintSolutions = await this.generateConstraintSolutions(
      program,
      examples,
      metricFn,
      options
    );

    // Combine all solutions
    const allSolutions = [...solutions, ...constraintSolutions];

    // if (options?.verbose) {
    //   this.getLogger(options)?.(
    //     `Generated ${allSolutions.length} candidate solutions`,
    //     { tags: ['discovery'] }
    //   );
    // }

    // Find Pareto frontier
    const paretoFront = this.findParetoFrontier(allSolutions);

    // Calculate hypervolume if possible
    const hypervolume = this.calculateHypervolume(paretoFront);

    // if (options?.verbose) {
    //   this.getLogger(options)?.(
    //     `Found ${paretoFront.length} non-dominated solutions`,
    //     { tags: ['discovery'] }
    //   );
    //   this.getLogger(options)?.(
    //     `Hypervolume: ${hypervolume?.toFixed(4) || 'N/A'}`,
    //     { tags: ['discovery'] }
    //   );
    // }

    // Update stats
    this.updateResourceUsage(startTime);
    this.stats.convergenceInfo.converged = true;

    // Record Pareto optimization metrics
    this.recordParetoMetrics(
      paretoFront.length,
      allSolutions.length,
      'base_optimizer',
      hypervolume
    );

    // Calculate best score as the maximum across all objectives and solutions
    const bestScore =
      paretoFront.length > 0
        ? Math.max(
            ...paretoFront.map((sol) => Math.max(...Object.values(sol.scores)))
          )
        : 0;

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
    };
  }

  /**
   * Generate solutions using different weighted combinations of objectives
   */
  private async generateWeightedSolutions<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<
    Array<{
      scores: Record<string, number>;
      demos?: AxProgramDemos<any, OUT>[];
      configuration: Record<string, unknown>;
    }>
  > {
    const solutions: Array<{
      scores: Record<string, number>;
      demos?: AxProgramDemos<any, OUT>[];
      configuration: Record<string, unknown>;
    }> = [];

    // First, determine the objectives by running the metric on a sample
    if (!examples || examples.length === 0) {
      throw new Error('No examples provided for Pareto optimization');
    }
    const sampleExample = examples[0]!;
    const samplePrediction = await program.forward(
      this.getAIService(false, options),
      sampleExample as any
    );
    const sampleScores = await metricFn({
      prediction: samplePrediction,
      example: sampleExample,
    });
    const objectives = Object.keys(sampleScores);

    // if (options?.verbose) {
    //   this.getLogger(options)?.(
    //     `Detected objectives: ${objectives.join(', ')}`,
    //     { tags: ['discovery'] }
    //   );
    // }

    // Generate different weight combinations
    const weightCombinations = this.generateWeightCombinations(objectives);

    for (let i = 0; i < weightCombinations.length; i++) {
      const weights = weightCombinations[i]!;

      // if (options?.verbose) {
      //   this.getLogger(options)?.(
      //     `Optimizing with weights: ${JSON.stringify(weights)}`,
      //     { tags: ['discovery'] }
      //   );
      // }

      // Create a weighted single-objective metric
      const weightedMetric: AxMetricFn = async ({ prediction, example }) => {
        const scores = await metricFn({ prediction, example });
        let weightedScore = 0;
        for (const [objective, score] of Object.entries(scores)) {
          weightedScore += score * (weights[objective] || 0);
        }
        return weightedScore;
      };

      try {
        // Use the concrete optimizer's compile method
        const result = await this.compile(program, examples, weightedMetric, {
          ...options,
          verbose: false, // Suppress inner optimization logs
        });

        // Evaluate the result with the multi-objective metric
        const scores = await this.evaluateWithMultiObjective(
          program,
          result,
          metricFn,
          examples
        );

        solutions.push({
          scores,
          demos: result.demos,
          configuration: {
            ...result.finalConfiguration,
            weights,
            strategy: 'weighted_combination',
          },
        });
      } catch (_error) {
        // if (options?.verbose) {
        //   this.getLogger(options)?.(
        //     `Failed optimization with weights ${JSON.stringify(weights)}: ${error}`,
        //     { tags: ['warning'] }
        //   );
        // }
      }
    }

    return solutions;
  }

  /**
   * Generate solutions using constraint-based optimization
   */
  private async generateConstraintSolutions<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    examples: readonly AxTypedExample<IN>[],
    metricFn: AxMultiMetricFn,
    options?: AxCompileOptions
  ): Promise<
    Array<{
      scores: Record<string, number>;
      demos?: AxProgramDemos<any, OUT>[];
      configuration: Record<string, unknown>;
    }>
  > {
    const solutions: Array<{
      scores: Record<string, number>;
      demos?: AxProgramDemos<any, OUT>[];
      configuration: Record<string, unknown>;
    }> = [];

    // Get objectives from a sample evaluation
    if (!examples || examples.length === 0) {
      throw new Error('No examples provided for multi-objective optimization');
    }
    const sampleExample = examples[0]!;
    const samplePrediction = await program.forward(
      this.getAIService(false, options),
      sampleExample as any
    );
    const sampleScores = await metricFn({
      prediction: samplePrediction,
      example: sampleExample,
    });
    const objectives = Object.keys(sampleScores);

    // For each objective, optimize it while constraining others
    for (const primaryObjective of objectives) {
      // if (options?.verbose) {
      //   this.getLogger(options)?.(
      //     `Optimizing ${primaryObjective} with constraints on other objectives`,
      //     { tags: ['discovery'] }
      //   );
      // }

      // Create a constraint-based metric
      const constraintMetric: AxMetricFn = async ({ prediction, example }) => {
        const scores = await metricFn({ prediction, example });

        // Primary objective score
        const primaryScore = scores[primaryObjective] || 0;

        // Penalty for violating constraints on other objectives
        let penalty = 0;
        for (const [objective, score] of Object.entries(scores)) {
          if (objective !== primaryObjective) {
            // Simple constraint: other objectives should be at least 0.3
            // This is a heuristic - in practice you'd set domain-specific thresholds
            if (score < 0.3) {
              penalty += (0.3 - score) * 2; // Penalty factor
            }
          }
        }

        return primaryScore - penalty;
      };

      try {
        const result = await this.compile(program, examples, constraintMetric, {
          ...options,
          verbose: false,
        });

        const scores = await this.evaluateWithMultiObjective(
          program,
          result,
          metricFn,
          examples
        );

        solutions.push({
          scores,
          demos: result.demos,
          configuration: {
            ...result.finalConfiguration,
            primaryObjective,
            strategy: 'constraint_based',
          },
        });
      } catch (_error) {
        // if (options?.verbose) {
        //   this.getLogger(options)?.(
        //     `Failed constraint optimization for ${primaryObjective}: ${error}`,
        //     { tags: ['warning'] }
        //   );
        // }
      }
    }

    return solutions;
  }

  /**
   * Generate different weight combinations for objectives
   */
  private generateWeightCombinations(
    objectives: string[]
  ): Record<string, number>[] {
    const combinations: Record<string, number>[] = [];

    // Single-objective focus (one objective gets weight 1, others get 0)
    for (const objective of objectives) {
      const weights: Record<string, number> = {};
      for (const obj of objectives) {
        weights[obj] = obj === objective ? 1 : 0;
      }
      combinations.push(weights);
    }

    // Equal weights
    const equalWeights: Record<string, number> = {};
    for (const objective of objectives) {
      equalWeights[objective] = 1 / objectives.length;
    }
    combinations.push(equalWeights);

    // If we have 2 objectives, generate more granular combinations
    if (objectives.length === 2) {
      const [obj1, obj2] = objectives;
      for (let w1 = 0.1; w1 <= 0.9; w1 += 0.2) {
        const w2 = 1 - w1;
        combinations.push({ [obj1!]: w1, [obj2!]: w2 });
      }
    }

    // If we have 3 objectives, generate some key combinations
    if (objectives.length === 3) {
      const [obj1, obj2, obj3] = objectives;
      combinations.push(
        { [obj1!]: 0.5, [obj2!]: 0.3, [obj3!]: 0.2 },
        { [obj1!]: 0.3, [obj2!]: 0.5, [obj3!]: 0.2 },
        { [obj1!]: 0.2, [obj2!]: 0.3, [obj3!]: 0.5 }
      );
    }

    return combinations;
  }

  /**
   * Evaluate a single-objective result with multi-objective metrics
   */
  private async evaluateWithMultiObjective<IN, OUT extends AxGenOut>(
    program: Readonly<AxGen<IN, OUT>>,
    result: Readonly<AxOptimizerResult<OUT>>,
    metricFn: AxMultiMetricFn,
    examples: readonly AxTypedExample<IN>[]
  ): Promise<Record<string, number>> {
    const testProgram = new AxGen(program.getSignature());
    if (result.demos) {
      testProgram.setDemos(result.demos);
    }

    // NOTE: This evaluation method needs examples to be passed as parameter
    // For now, returning empty predictions array
    const _predictions: { prediction: OUT; example: any }[] = [];
    // for (const ex of examples) {
    //   const prediction = await testProgram.forward(this.studentAI, ex as IN);
    //   predictions.push({ prediction, example: ex });
    // }

    // Create validation split from examples (use last 20% or max 5 examples)
    const valSplitSize = Math.max(
      1,
      Math.min(5, Math.floor(examples.length * 0.2))
    );
    const valSet = examples.slice(-valSplitSize);
    const allScores: Record<string, number[]> = {};

    // Evaluate on validation set
    const evalSet = valSet;

    for (const example of evalSet) {
      try {
        const prediction = await testProgram.forward(
          this.studentAI,
          example as IN
        );
        const scores = await metricFn({ prediction, example });

        // Collect scores for each objective
        for (const [objective, score] of Object.entries(scores)) {
          if (!allScores[objective]) {
            allScores[objective] = [];
          }
          allScores[objective]!.push(score);
        }
      } catch {}
    }

    // Calculate average scores for each objective
    const avgScores: Record<string, number> = {};
    for (const [objective, scores] of Object.entries(allScores)) {
      avgScores[objective] =
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : 0;
    }

    return avgScores;
  }

  /**
   * Find the Pareto frontier from a set of solutions
   */
  private findParetoFrontier<OUT extends AxGenOut>(
    solutions: Array<{
      scores: Record<string, number>;
      demos?: AxProgramDemos<any, OUT>[];
      configuration: Record<string, unknown>;
    }>
  ): Array<{
    demos: readonly AxProgramDemos<any, OUT>[];
    scores: Readonly<Record<string, number>>;
    configuration: Readonly<Record<string, unknown>>;
    dominatedSolutions: number;
  }> {
    const paretoFront: Array<{
      demos: readonly AxProgramDemos<any, OUT>[];
      scores: Readonly<Record<string, number>>;
      configuration: Readonly<Record<string, unknown>>;
      dominatedSolutions: number;
    }> = [];

    // For each solution, check if it's dominated by any other solution
    for (let i = 0; i < solutions.length; i++) {
      const solutionA = solutions[i]!;
      let isDominated = false;
      let dominatedCount = 0;

      for (let j = 0; j < solutions.length; j++) {
        if (i === j) continue;

        const solutionB = solutions[j]!;

        // Check if B dominates A
        if (this.dominates(solutionB.scores, solutionA.scores)) {
          isDominated = true;
          break;
        }

        // Count how many solutions A dominates
        if (this.dominates(solutionA.scores, solutionB.scores)) {
          dominatedCount++;
        }
      }

      // If A is not dominated by any solution, it's on the Pareto frontier
      if (!isDominated) {
        paretoFront.push({
          demos: solutionA.demos || [],
          scores: solutionA.scores,
          configuration: solutionA.configuration,
          dominatedSolutions: dominatedCount,
        });
      }
    }

    return paretoFront;
  }

  /**
   * Check if solution A dominates solution B
   * A dominates B if A is better or equal in all objectives and strictly better in at least one
   */
  private dominates(
    scoresA: Record<string, number>,
    scoresB: Record<string, number>
  ): boolean {
    const objectives = Object.keys(scoresA);

    // Check if A is at least as good as B in all objectives
    let atLeastAsGood = true;
    let strictlyBetter = false;

    for (const objective of objectives) {
      const scoreA = scoresA[objective] || 0;
      const scoreB = scoresB[objective] || 0;

      if (scoreA < scoreB) {
        atLeastAsGood = false;
        break;
      }

      if (scoreA > scoreB) {
        strictlyBetter = true;
      }
    }

    return atLeastAsGood && strictlyBetter;
  }

  /**
   * Calculate hypervolume of the Pareto frontier
   * Simplified implementation using reference point at origin
   */
  private calculateHypervolume(
    paretoFront: Array<{
      scores: Readonly<Record<string, number>>;
    }>
  ): number | undefined {
    if (paretoFront.length === 0) return undefined;

    // For simplicity, calculate 2D hypervolume if we have exactly 2 objectives
    const firstSolution = paretoFront[0]!;
    const objectives = Object.keys(firstSolution.scores);

    if (objectives.length === 2) {
      const [obj1, obj2] = objectives;
      let hypervolume = 0;

      // Sort solutions by first objective (descending)
      const sortedSolutions = [...paretoFront].sort(
        (a, b) => (b.scores[obj1!] || 0) - (a.scores[obj1!] || 0)
      );

      let prevScore2 = 0;
      for (const solution of sortedSolutions) {
        const score1 = solution.scores[obj1!] || 0;
        const score2 = solution.scores[obj2!] || 0;

        // Calculate area contribution
        hypervolume += score1 * (score2 - prevScore2);
        prevScore2 = Math.max(prevScore2, score2);
      }

      return hypervolume;
    }

    // For higher dimensions, return undefined (would need more complex algorithm)
    return undefined;
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
    const saveFn = options?.overrideCheckpointSave || this.checkpointSave;
    if (!saveFn) return undefined;

    const startTime = Date.now();
    let success = false;
    let checkpointId: string | undefined;

    try {
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
        examples: [], // examples now passed to compile
      };

      checkpointId = await saveFn(checkpoint);
      success = true;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const latency = Date.now() - startTime;
      this.recordCheckpointMetrics('save', latency, success, optimizerType);
    }

    return checkpointId;
  }

  /**
   * Load optimization state from checkpoint
   */
  protected async loadCheckpoint(
    checkpointId: string,
    options?: AxCompileOptions
  ): Promise<AxOptimizationCheckpoint | null> {
    const loadFn = options?.overrideCheckpointLoad || this.checkpointLoad;
    if (!loadFn) return null;

    const startTime = Date.now();
    let success = false;
    let checkpoint: AxOptimizationCheckpoint | null = null;

    try {
      checkpoint = await loadFn(checkpointId);
      success = checkpoint !== null;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const latency = Date.now() - startTime;
      // Use a default optimizer type since we don't know it at load time
      this.recordCheckpointMetrics('load', latency, success, 'unknown');
    }

    return checkpoint;
  }

  /**
   * Restore optimizer state from checkpoint
   */
  protected restoreFromCheckpoint(
    checkpoint: Readonly<AxOptimizationCheckpoint>
  ): void {
    this.currentRound = checkpoint.currentRound;
    this.scoreHistory = [...checkpoint.scoreHistory];
    this.configurationHistory = [...checkpoint.configurationHistory];
    this.stats = { ...checkpoint.stats };
  }

  /**
   * Check if checkpoint should be saved
   */
  protected shouldSaveCheckpoint(
    round: number,
    options?: AxCompileOptions
  ): boolean {
    const interval =
      options?.overrideCheckpointInterval || this.checkpointInterval;
    return interval !== undefined && round % interval === 0;
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
    this.currentRound = round;
    this.scoreHistory.push(score);
    this.configurationHistory.push(configuration);

    // Save checkpoint if needed
    if (this.shouldSaveCheckpoint(round, options)) {
      await this.saveCheckpoint(
        optimizerType,
        optimizerConfig,
        bestScore,
        bestConfiguration,
        optimizerState,
        options
      );
    }
    const optLogger = this.getOptimizerLogger(options);
    optLogger?.({
      name: 'RoundProgress',
      value: {
        round,
        totalRounds: options?.maxIterations ?? 0,
        currentScore: score,
        bestScore,
        configuration,
      },
    });
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
      );
    }
  }

  /**
   * Get the logger function with fallback hierarchy:
   * 1. Explicit logger passed to optimizer
   * 2. Logger from student AI service
   * 3. undefined if verbose is false
   */
  protected getLogger(
    options?: AxCompileOptions
  ): AxLoggerFunction | undefined {
    // Check if logging should be disabled
    const isVerbose = this.isLoggingEnabled(options);
    if (!isVerbose) {
      return undefined;
    }

    // Use explicit logger if provided
    if (this.logger) {
      return this.logger;
    }

    // Fall back to student AI logger
    return this.studentAI.getLogger();
  }

  /**
   * Check if logging is enabled based on verbose settings
   */
  protected isLoggingEnabled(options?: AxCompileOptions): boolean {
    // Explicit verbose setting in options takes precedence
    if (options?.verbose !== undefined) {
      return options.verbose;
    }

    // Use optimizer's verbose setting
    return this.verbose ?? true; // Default to true if not specified
  }

  /**
   * Record optimization start metrics
   */
  protected recordOptimizationStart(
    optimizerType: string,
    programSignature?: string
  ): void {
    if (!this.metricsInstruments) return;

    // Record program complexity metrics
    if (programSignature) {
      // Extract field counts from signature (simplified)
      const inputFields = (programSignature.match(/input:/g) || []).length;
      const outputFields = (programSignature.match(/output:/g) || []).length;

      recordProgramComplexityMetric(
        this.metricsInstruments,
        inputFields,
        outputFields,
        0, // this.examples.length - now in options
        0, // this.getValidationSet().length - now in options
        optimizerType
      );
    }

    // Record configuration metrics
    recordOptimizerConfigurationMetric(
      this.metricsInstruments,
      optimizerType,
      this.targetScore,
      undefined // maxRounds would be set by concrete optimizers
    );
  }

  /**
   * Record optimization completion metrics
   */
  protected recordOptimizationComplete(
    duration: number,
    success: boolean,
    optimizerType: string,
    programSignature?: string
  ): void {
    if (!this.metricsInstruments) return;

    recordOptimizationMetric(
      this.metricsInstruments,
      duration,
      success,
      optimizerType,
      programSignature
    );

    recordOptimizationDurationMetric(
      this.metricsInstruments,
      duration,
      optimizerType
    );

    // Record resource usage
    const currentCost = this.costTracker?.getCurrentCost() ?? 0;
    const totalTokens = this.costTracker?.getTotalTokens() ?? 0;
    recordResourceUsageMetric(
      this.metricsInstruments,
      totalTokens,
      currentCost,
      optimizerType
    );
  }

  /**
   * Record convergence metrics
   */
  protected recordConvergenceMetrics(
    rounds: number,
    currentScore: number,
    improvement: number,
    stagnationRounds: number,
    optimizerType: string
  ): void {
    if (!this.metricsInstruments) return;

    recordConvergenceMetric(
      this.metricsInstruments,
      rounds,
      currentScore,
      improvement,
      stagnationRounds,
      optimizerType
    );
  }

  /**
   * Record early stopping metrics
   */
  protected recordEarlyStoppingMetrics(
    reason: string,
    optimizerType: string
  ): void {
    if (!this.metricsInstruments) return;

    recordEarlyStoppingMetric(this.metricsInstruments, reason, optimizerType);
  }

  /**
   * Record teacher-student interaction metrics
   */
  protected recordTeacherStudentMetrics(
    latency: number,
    scoreImprovement: number,
    optimizerType: string
  ): void {
    if (!this.metricsInstruments) return;

    recordTeacherStudentMetric(
      this.metricsInstruments,
      latency,
      scoreImprovement,
      optimizerType
    );
  }

  /**
   * Record checkpoint metrics
   */
  protected recordCheckpointMetrics(
    operation: 'save' | 'load',
    latency: number,
    success: boolean,
    optimizerType: string
  ): void {
    if (!this.metricsInstruments) return;

    recordCheckpointMetric(
      this.metricsInstruments,
      operation,
      latency,
      success,
      optimizerType
    );
  }

  /**
   * Record Pareto optimization metrics
   */
  protected recordParetoMetrics(
    frontSize: number,
    solutionsGenerated: number,
    optimizerType: string,
    hypervolume?: number
  ): void {
    if (!this.metricsInstruments) return;

    recordParetoMetric(
      this.metricsInstruments,
      frontSize,
      solutionsGenerated,
      optimizerType,
      hypervolume
    );
  }

  /**
   * Record performance metrics
   */
  protected recordPerformanceMetrics(
    metricType: 'evaluation' | 'demo_generation' | 'metric_computation',
    duration: number,
    optimizerType: string
  ): void {
    if (!this.metricsInstruments) return;

    recordOptimizerPerformanceMetric(
      this.metricsInstruments,
      metricType,
      duration,
      optimizerType
    );
  }

  // Optimizer logging methods
  protected isOptimizerLoggingEnabled(options?: AxCompileOptions): boolean {
    return this.debugOptimizer || (options?.verbose ?? this.verbose ?? false);
  }

  protected getOptimizerLogger(
    options?: AxCompileOptions
  ): AxOptimizerLoggerFunction | undefined {
    if (!this.isOptimizerLoggingEnabled(options)) return undefined;
    return (
      this.optimizerLogger ??
      axGlobals.optimizerLogger ??
      axDefaultOptimizerLogger
    );
  }

  public getStats(): AxOptimizationStats {
    return { ...this.stats };
  }

  /**
   * Generate a human-readable explanation of optimization results
   */
  protected async explainOptimizationResults(
    bestScore: number,
    bestConfiguration?: Record<string, unknown>,
    options?: AxCompileOptions
  ): Promise<
    | {
        humanExplanation: string;
        recommendations: string[];
        performanceAssessment: string;
      }
    | undefined
  > {
    if (!this.resultExplainer) {
      return undefined;
    }

    try {
      const ai = this.getTeacherOrStudentAI(options);

      const result = await this.resultExplainer.forward(ai, {
        optimizationScore: bestScore,
        bestConfiguration: bestConfiguration || {},
        totalRounds: Math.max(1, this.currentRound), // Ensure at least 1 round
        converged: this.stats.convergenceInfo.converged,
        earlyStoppedReason: this.stats.earlyStopping?.reason || undefined,
        resourcesUsed: {
          totalTokens: this.stats.resourceUsage.totalTokens,
          totalTime: this.stats.resourceUsage.totalTime,
          avgLatencyPerEval: this.stats.resourceUsage.avgLatencyPerEval,
          costByModel: this.stats.resourceUsage.costByModel,
        },
      });

      return {
        humanExplanation:
          result.humanExplanation ||
          'Optimization completed with mixed results.',
        recommendations: result.recommendations || [
          'Review the optimization settings and consider running with more examples.',
        ],
        performanceAssessment:
          result.performanceAssessment ||
          'Performance assessment not available.',
      };
    } catch (error) {
      if (this.verbose) {
        console.warn(
          '[AxBaseOptimizer] Failed to generate result explanation:',
          error
        );
      }
      return undefined;
    }
  }

  /**
   * Log human-readable optimization completion message
   */
  protected async logOptimizationComplete(
    optimizerType: string,
    bestScore: number,
    bestConfiguration?: Record<string, unknown>,
    options?: AxCompileOptions
  ): Promise<void> {
    const optLogger = this.getOptimizerLogger(options);
    if (!optLogger) return;

    // Generate human-readable explanation
    const explanation = await this.explainOptimizationResults(
      bestScore,
      bestConfiguration,
      options
    );

    if (explanation) {
      optLogger({
        name: 'OptimizationComplete',
        value: {
          optimizerType,
          bestScore,
          bestConfiguration: bestConfiguration || {},
          totalCalls: this.stats.totalCalls,
          successRate:
            this.stats.totalCalls > 0
              ? `${((this.stats.successfulDemos / this.stats.totalCalls) * 100).toFixed(1)}%`
              : '0.0%',
          explanation: explanation.humanExplanation,
          recommendations: explanation.recommendations,
          performanceAssessment: explanation.performanceAssessment,
          stats: this.stats,
        },
      });
    } else {
      // Fallback to basic completion logging
      optLogger({
        name: 'OptimizationComplete',
        value: {
          optimizerType,
          bestScore,
          bestConfiguration: bestConfiguration || {},
          totalCalls: this.stats.totalCalls,
          successRate:
            this.stats.totalCalls > 0
              ? `${((this.stats.successfulDemos / this.stats.totalCalls) * 100).toFixed(1)}%`
              : '0.0%',
          stats: this.stats,
        },
      });
    }
  }

  public reset(): void {
    this.stats = this.initializeStats();
    this.costTracker?.reset();
    this.currentRound = 0;
    this.scoreHistory = [];
    this.configurationHistory = [];
  }
}
