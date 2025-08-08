import type {
  AxAIService,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxModelConfig,
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import type { AxAssertion, AxStreamingAssertion } from './asserts.js';
import type { AxInputFunctionType } from './functions.js';
import type { AxPromptTemplate } from './prompt.js';
import type { AxSignature } from './sig.js';
import type { AxLoggerFunction } from '../ai/types.js';

export type AxFieldValue =
  | string
  | string[]
  | number
  | boolean
  | object
  | null
  | undefined
  | { mimeType: string; data: string }
  | { mimeType: string; data: string }[]
  | { format?: 'wav'; data: string }
  | { format?: 'wav'; data: string }[];

export type AxGenIn = { [key: string]: AxFieldValue };

export type AxGenOut = { [key: string]: AxFieldValue };

/**
 * @deprecated AxMessage will be updated to a new design within this major version.
 * The current structure will be replaced in v15.0.0.
 *
 * Migration timeline:
 * - v14.0.0+: Deprecation warnings (current)
 * - v14.x: New message design introduced alongside existing
 * - v15.0.0: Complete replacement with new design
 */
export type AxMessage<IN> =
  | { role: 'user'; values: IN }
  | { role: 'assistant'; values: IN };

export type AxProgramTrace<IN, OUT> = {
  trace: OUT & IN;
  programId: string;
};

export type AxProgramDemos<IN, OUT> = {
  traces: (OUT & IN)[];
  programId: string;
};

export type AxProgramExamples<IN, OUT> =
  | AxProgramDemos<IN, OUT>
  | AxProgramDemos<IN, OUT>['traces'];

export type AxResultPickerFunctionFieldResults<OUT> = {
  type: 'fields';
  results: readonly { index: number; sample: Partial<OUT> }[];
};

export type AxResultPickerFunctionFunctionResults = {
  type: 'function';
  results: readonly {
    index: number;
    functionName: string;
    functionId: string;
    args: string | object;
    result: string;
    isError?: boolean;
  }[];
};

export type AxResultPickerFunction<OUT> = (
  data:
    | AxResultPickerFunctionFieldResults<OUT>
    | AxResultPickerFunctionFunctionResults
) => number | Promise<number>;

export type AxProgramForwardOptions<MODEL> = AxAIServiceOptions & {
  // Execution control
  maxRetries?: number;
  maxSteps?: number;
  mem?: AxAIMemory;

  // AI service and model configuration
  ai?: AxAIService;
  modelConfig?: AxModelConfig;
  model?: MODEL;

  // Streaming and output
  sampleCount?: number;
  resultPicker?: AxResultPickerFunction<AxGenOut>;

  // Functions and calls
  functions?: AxInputFunctionType;
  functionCall?: AxChatRequest['functionCall'];
  stopFunction?: string;
  functionResultFormatter?: (result: unknown) => string;

  // Behavior control
  fastFail?: boolean;
  showThoughts?: boolean;
  functionCallMode?: 'auto' | 'native' | 'prompt';

  // Tracing and logging
  traceLabel?: string;

  // AxGen-specific options (previously in AxGenOptions)
  description?: string;
  thoughtFieldName?: string;
  promptTemplate?: typeof AxPromptTemplate;
  asserts?: AxAssertion[];
  streamingAsserts?: AxStreamingAssertion[];
  excludeContentFromTrace?: boolean;

  // Field prefix is required for single output field programs
  strictMode?: boolean;
};

export type AxAIServiceActionOptions<
  TModel = unknown,
  TEmbedModel = unknown,
  TModelKey = string,
> = AxAIServiceOptions & {
  ai?: Readonly<AxAIService<TModel, TEmbedModel, TModelKey>>;
  functionResultFormatter?: (result: unknown) => string;
};

export type AxProgramStreamingForwardOptions<MODEL> = Omit<
  AxProgramForwardOptions<MODEL>,
  'stream'
>;

// Helper type to extract model type union from AxAIService (both TModel and TModelKey)
export type AxAIServiceModelType<
  T extends Readonly<AxAIService<any, any, any>>,
> = T extends Readonly<AxAIService<infer TModel, any, infer TModelKey>>
  ? TModel extends unknown
    ? TModelKey // For AxAI wrapper services, only use TModelKey since TModel is unknown
    : TModel | TModelKey // For direct services, use both TModel and TModelKey
  : never;

// Clean forward options type that includes both TModel and model keys
export type AxProgramForwardOptionsWithModels<
  T extends Readonly<AxAIService<any, any, any>>,
> = AxProgramForwardOptions<AxAIServiceModelType<T>>;

// Clean streaming forward options type that includes both TModel and model keys
export type AxProgramStreamingForwardOptionsWithModels<
  T extends Readonly<AxAIService<any, any, any>>,
> = AxProgramStreamingForwardOptions<AxAIServiceModelType<T>>;

export type AxGenDeltaOut<OUT> = {
  version: number;
  index: number;
  delta: Partial<OUT>;
};

export type AxGenStreamingOut<OUT> = AsyncGenerator<
  AxGenDeltaOut<OUT>,
  void,
  unknown
>;

export type DeltaOut<OUT> = Omit<AxGenDeltaOut<OUT>, 'version'>;

export type AsyncGenDeltaOut<OUT> = AsyncGenerator<
  DeltaOut<OUT>,
  void,
  unknown
>;

export type GenDeltaOut<OUT> = Generator<DeltaOut<OUT>, void, unknown>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AxSetExamplesOptions = {
  // No options needed - all fields can be missing in examples
};

export interface AxForwardable<IN, OUT, TModelKey> {
  forward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions<TModelKey>>
  ): Promise<OUT>;

  streamingForward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptions<TModelKey>>
  ): AxGenStreamingOut<OUT>;
}

export interface AxTunable<IN, OUT> {
  setExamples: (
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) => void;
  setId: (id: string) => void;
  setParentId: (parentId: string) => void;
  getTraces: () => AxProgramTrace<IN, OUT>[];
  setDemos: (demos: readonly AxProgramDemos<IN, OUT>[]) => void;
}

export interface AxUsable {
  getUsage: () => AxProgramUsage[];
  resetUsage: () => void;
}

export interface AxProgrammable<IN, OUT, TModelKey = string>
  extends AxForwardable<IN, OUT, TModelKey>,
    AxTunable<IN, OUT>,
    AxUsable {
  getSignature: () => AxSignature;
}

export type AxProgramUsage = AxChatResponse['modelUsage'] & {
  ai: string;
  model: string;
};

export interface AxProgramOptions {
  description?: string;
  traceLabel?: string;
}

// === Signature Parsing Types ===
// Type system moved to sigtypes.ts for better organization and features
export type { ParseSignature } from './sigtypes.js';

// =========================
// Optimizer shared type defs
// =========================

// Example types used across optimizers and evaluation utilities
export type AxExample = Record<string, AxFieldValue>;

// Typed example that matches the input type of a program
export type AxTypedExample<IN = any> = IN & {
  [key: string]: AxFieldValue;
};

// Metric functions
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

// Cost tracking interface & options
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

// Optimization checkpoint (serialization format)
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

export type AxCheckpointSaveFn = (
  checkpoint: Readonly<AxOptimizationCheckpoint>
) => Promise<string>;
export type AxCheckpointLoadFn = (
  checkpointId: string
) => Promise<AxOptimizationCheckpoint | null>;

// Optimizer runtime statistics
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
    byCategory: Record<string, number>;
    byInstruction?: Record<string, number>;
  };
}

// Optimizer constructor args (shared config)
export type AxOptimizerArgs = {
  studentAI: AxAIService;
  teacherAI?: AxAIService;

  optimizerEndpoint?: string;
  optimizerTimeout?: number;
  optimizerRetries?: number;

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

  minSuccessRate?: number;
  targetScore?: number;

  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  onEarlyStop?: (
    reason: string,
    stats: Readonly<AxOptimizationStats>
  ) => void;
  costTracker?: AxCostTracker;

  checkpointSave?: AxCheckpointSaveFn;
  checkpointLoad?: AxCheckpointLoadFn;
  checkpointInterval?: number;
  resumeFromCheckpoint?: string;

  logger?: AxLoggerFunction;
  verbose?: boolean;
  seed?: number;
  debugOptimizer?: boolean;
  optimizerLogger?: (data: unknown) => void;
};

// Compile options shared type (kept minimal here to avoid pulling more deps)
export interface AxCompileOptions {
  maxIterations?: number;
  earlyStoppingPatience?: number;
  verbose?: boolean;
  maxDemos?: number;
  auto?: 'light' | 'medium' | 'heavy';
  overrideTargetScore?: number;
  overrideCostTracker?: AxCostTracker;
}
