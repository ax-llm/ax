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

export interface AxForwardable<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  TModelKey,
> {
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

export interface AxProgrammable<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  TModelKey = string,
> extends AxForwardable<IN, OUT, TModelKey>,
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
