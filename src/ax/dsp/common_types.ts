import type {
  AxAIService,
  AxAIServiceOptions,
  AxLoggerFunction,
} from '../ai/types.js';
import type { AxGEPAAdapter } from './optimizers/gepaAdapter.js';
import type { AxOptimizerLoggerData } from './optimizerTypes.js';
import type { AxFieldValue, AxResultPickerFunction } from './types.js';

export type AxExample = Record<string, AxFieldValue>;

export type AxTypedExample<IN = any> = IN & {
  [key: string]: AxFieldValue;
};

export type AxMetricFn = <T = any>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => number | Promise<number>;
export type AxMetricFnArgs = Parameters<AxMetricFn>[0];

export type AxMultiMetricFn = <T = any>(
  arg0: Readonly<{ prediction: T; example: AxExample }>
) => Record<string, number> | Promise<Record<string, number>>;

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

export interface AxCostTracker {
  trackTokens(count: number, model: string): void;
  getCurrentCost(): number;
  getTokenUsage(): Record<string, number>;
  getTotalTokens(): number;
  isLimitReached(): boolean;
  reset(): void;
}

export interface AxCostTrackerOptions {
  costPerModel?: Record<string, number>;
  maxCost?: number;
  maxTokens?: number;
}

export interface AxOptimizationCheckpoint {
  version: string;
  timestamp: number;
  optimizerType: string;
  optimizerConfig: Record<string, unknown>;
  currentRound: number;
  totalRounds: number;
  bestScore: number;
  bestConfiguration?: Record<string, unknown>;
  scoreHistory: number[];
  configurationHistory: Record<string, unknown>[];
  stats: AxOptimizationStats;
  optimizerState: Record<string, unknown>;
  examples: readonly AxExample[];
}

export interface AxGEPABootstrapOptions {
  scoreThreshold?: number;
  maxBootstrapDemos?: number;
  maxBootstrapMetricCalls?: number;
}

export type AxCheckpointSaveFn = (
  checkpoint: Readonly<AxOptimizationCheckpoint>
) => Promise<string>;
export type AxCheckpointLoadFn = (
  checkpointId: string
) => Promise<AxOptimizationCheckpoint | null>;

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
  resourceUsage: {
    totalTokens: number;
    totalTime: number;
    avgLatencyPerEval: number;
    peakMemoryUsage?: number;
    costByModel: Record<string, number>;
  };
  convergenceInfo: {
    converged: boolean;
    finalImprovement: number;
    stagnationRounds: number;
    convergenceThreshold: number;
  };
  evaluationBreakdown?: {
    trainingScore: number;
    validationScore: number;
    crossValidationScores?: number[];
    standardDeviation?: number;
  };
}

export type AxOptimizerArgs = {
  studentAI: AxAIService;
  teacherAI?: AxAIService;
  /**
   * AI service options for the optimizer's teacher calls: GEPA feedback and
   * proposals, the ACE reflector and curator, and BootstrapFewShot demo runs.
   * They also apply when those calls fall back to `studentAI`. Set
   * `useExpensiveModel: 'yes'` to use a teacher model marked `isExpensive`.
   */
  teacherOptions?: AxAIServiceOptions;
  numCandidates?: number;
  initTemperature?: number;
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
  sampleCount?: number;
  // Optional: custom picker used when sampleCount > 1
  resultPicker?: AxResultPickerFunction<any>;
  optimizeTopP?: boolean;
  minSuccessRate?: number;
  targetScore?: number;
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void;
  costTracker?: AxCostTracker;
  checkpointSave?: AxCheckpointSaveFn;
  checkpointLoad?: AxCheckpointLoadFn;
  checkpointInterval?: number;
  resumeFromCheckpoint?: string;
  logger?: AxLoggerFunction;
  verbose?: boolean;
  seed?: number;
  debugOptimizer?: boolean;
  optimizerLogger?: (data: AxOptimizerLoggerData) => void;
};

export interface AxCompileOptions {
  maxIterations?: number;
  earlyStoppingPatience?: number;
  verbose?: boolean;
  maxDemos?: number;
  auto?: 'light' | 'medium' | 'heavy';
  overrideTargetScore?: number;
  overrideCostTracker?: AxCostTracker;
  overrideTeacherAI?: AxAIService;
  overrideOnProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  overrideOnEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void;
  overrideCheckpointSave?: AxCheckpointSaveFn;
  overrideCheckpointLoad?: AxCheckpointLoadFn;
  overrideCheckpointInterval?: number;
  saveCheckpointOnComplete?: boolean;
  // GEPA core options (adapter-based)
  gepaAdapter?: AxGEPAAdapter<any, any, any>;
  bootstrap?: boolean | AxGEPABootstrapOptions;
  validationExamples?: readonly AxTypedExample<any>[];
  feedbackExamples?: readonly AxTypedExample<any>[];
  feedbackFn?: (
    args: Readonly<{
      prediction: unknown;
      example: AxExample;
      componentId?: string;
    }>
  ) => string | string[] | undefined;
  skipPerfectScore?: boolean;
  perfectScore?: number;
  maxMetricCalls?: number;
  /**
   * Custom labels to include in OpenTelemetry metrics.
   * These labels are merged with axGlobals.customLabels and AI service customLabels.
   */
  customLabels?: Record<string, string>;
}
