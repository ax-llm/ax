import type { Tracer } from '@opentelemetry/api';
import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxLoggerFunction,
  AxModelConfig,
  AxRateLimiterFunction,
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import type { AxAssertion, AxStreamingAssertion } from './asserts.js';
import type { AxInputFunctionType } from './functions.js';
import type { AxPromptTemplate } from './prompt.js';
import type { AxSignature } from './sig.js';

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

export type AxMessage<IN extends AxGenIn> =
  | { role: 'user'; values: IN }
  | { role: 'assistant'; values: IN };

export type AxProgramTrace<IN extends AxGenIn, OUT extends AxGenOut> = {
  trace: OUT & IN;
  programId: string;
};

export type AxProgramDemos<IN extends AxGenIn, OUT extends AxGenOut> = {
  traces: (OUT & IN)[];
  programId: string;
};

export type AxProgramExamples<IN extends AxGenIn, OUT extends AxGenOut> =
  | AxProgramDemos<IN, OUT>
  | AxProgramDemos<IN, OUT>['traces'];

export type AxResultPickerFunctionFieldResults<OUT extends AxGenOut> = {
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

export type AxResultPickerFunction<OUT extends AxGenOut> = (
  data:
    | AxResultPickerFunctionFieldResults<OUT>
    | AxResultPickerFunctionFunctionResults
) => number | Promise<number>;

export type AxProgramForwardOptions = {
  // Execution control
  maxRetries?: number;
  maxSteps?: number;
  mem?: AxAIMemory;

  // AI service and model configuration
  ai?: AxAIService;
  modelConfig?: AxModelConfig;
  model?: string;

  // Session and tracing
  sessionId?: string;
  traceId?: string | undefined;
  tracer?: Tracer;
  rateLimiter?: AxRateLimiterFunction;

  // Streaming and output
  stream?: boolean;
  sampleCount?: number;
  resultPicker?: AxResultPickerFunction<AxGenOut>;

  // Functions and calls
  functions?: AxInputFunctionType;
  functionCall?: AxChatRequest['functionCall'];
  stopFunction?: string;
  functionResultFormatter?: (result: unknown) => string;

  // Behavior control
  fastFail?: boolean;
  debug?: boolean;

  // Thinking model controls
  thinkingTokenBudget?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'highest'
    | 'none';
  showThoughts?: boolean;

  // Tracing and logging
  traceLabel?: string;
  abortSignal?: AbortSignal;
  logger?: AxLoggerFunction;

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

export type AxProgramStreamingForwardOptions = Omit<
  AxProgramForwardOptions,
  'stream'
>;

export type AxGenDeltaOut<OUT extends AxGenOut> = {
  version: number;
  index: number;
  delta: Partial<OUT>;
};

export type AxGenStreamingOut<OUT extends AxGenOut> = AsyncGenerator<
  AxGenDeltaOut<OUT>,
  void,
  unknown
>;

export type DeltaOut<OUT extends AxGenOut> = Omit<
  AxGenDeltaOut<OUT>,
  'version'
>;

export type AsyncGenDeltaOut<OUT extends AxGenOut> = AsyncGenerator<
  DeltaOut<OUT>,
  void,
  unknown
>;

export type GenDeltaOut<OUT extends AxGenOut> = Generator<
  DeltaOut<OUT>,
  void,
  unknown
>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AxSetExamplesOptions = {
  // No options needed - all fields can be missing in examples
};

export interface AxForwardable<IN extends AxGenIn, OUT extends AxGenOut> {
  forward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT>;

  streamingForward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT>;
}

export interface AxTunable<IN extends AxGenIn, OUT extends AxGenOut> {
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

export interface AxProgrammable<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxForwardable<IN, OUT>,
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
