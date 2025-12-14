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
import type { AxGen } from './generate.js';
import type { AxOptimizedProgram } from './optimizer.js';
import type { AxPromptTemplate } from './prompt.js';
import type { AxSignature, AxSignatureBuilder } from './sig.js';
import type { ParseSignature } from './sigtypes.js';

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
  trace: OUT & Partial<IN>;
  programId: string;
};

export type AxProgramDemos<IN, OUT> = {
  traces: (OUT & Partial<IN>)[];
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
  stopFunction?: string | string[];
  functionResultFormatter?: (result: unknown) => string;

  // Behavior control
  fastFail?: boolean;
  showThoughts?: boolean;
  functionCallMode?: 'auto' | 'native' | 'prompt';
  cacheSystemPrompt?: boolean;

  // Caching hook
  cachingFunction?: (
    key: string,
    value?: AxGenOut
  ) => AxGenOut | undefined | Promise<AxGenOut | undefined>;

  // Memory tag cleanup control
  disableMemoryCleanup?: boolean;

  // Tracing and logging
  traceLabel?: string;

  // AxGen-specific options (previously in AxGenOptions)
  description?: string;
  thoughtFieldName?: string;
  promptTemplate?: typeof AxPromptTemplate;
  asserts?: AxAssertion<any>[];
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
  partial?: OUT;
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
  applyOptimization: (optimizedProgram: AxOptimizedProgram<OUT>) => void;
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

// === Examples Type Utility ===
// Derives the example item type (OUT & Partial<IN>) from:
// - An AxSignature instance
// - An AxSignatureBuilder instance (from f())
// - A string signature (parsed via ParseSignature)
export type AxExample<T> = T extends AxSignature<infer IN, infer OUT>
  ? OUT & Partial<IN>
  : T extends AxSignatureBuilder<infer IN2, infer OUT2>
    ? OUT2 & Partial<IN2>
    : T extends AxGen<infer IN4, infer OUT4>
      ? OUT4 & Partial<IN4>
      : T extends string
        ? ParseSignature<T> extends {
            inputs: infer IN3;
            outputs: infer OUT3;
          }
          ? OUT3 & Partial<IN3>
          : never
        : never;

export type AxExamples<T> = ReadonlyArray<AxExample<T>>;

// === AxGen Helper Types ===
// Similar to AxExamples, these extract input/output types from AxGen signatures
export type AxGenInput<T> = T extends AxGen<infer IN, any>
  ? IN
  : T extends AxSignature<infer IN2, any>
    ? IN2
    : T extends AxSignatureBuilder<infer IN3, any>
      ? IN3
      : T extends string
        ? ParseSignature<T> extends {
            inputs: infer IN4;
            outputs: any;
          }
          ? IN4
          : never
        : never;

export type AxGenOutput<T> = T extends AxGen<any, infer OUT>
  ? OUT
  : T extends AxSignature<any, infer OUT2>
    ? OUT2
    : T extends AxSignatureBuilder<any, infer OUT3>
      ? OUT3
      : T extends string
        ? ParseSignature<T> extends {
            inputs: any;
            outputs: infer OUT4;
          }
          ? OUT4
          : never
        : never;

// =========================
// Optimizer shared type defs
// =========================

// Shared optimizer-related types are exported exclusively from `common_types.ts`
// to avoid duplicate type exports when generating the package index.
