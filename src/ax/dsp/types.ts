import type {
  AxAIService,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxModelConfig,
  AxSpeechConfig,
} from '../ai/types.js';
import type { AxAIMemory } from '../mem/types.js';
import type { AxAssertion, AxStreamingAssertion } from './asserts.js';
import type { AxInputFunctionType } from './functions.js';
import type { AxGen } from './generate.js';
import type { AxOptimizableComponent } from './optimizable.js';
import type { AxOptimizedProgram } from './optimizer.js';
import type { AxPromptTemplate } from './prompt.js';
import type { AxSignature, AxSignatureBuilder } from './sig.js';
import type { ParseSignature } from './sigtypes.js';

// === Step Context Types ===

/**
 * Record of a single function call executed during a step.
 */
export type AxFunctionCallRecord = {
  readonly name: string;
  readonly args: unknown;
  readonly result: unknown;
};

/**
 * Accumulated token usage across steps.
 */
export type AxStepUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Mutable context object that flows through the generation loop.
 * Accessible to functions and step hooks, enabling per-step control
 * over model, options, functions, and loop flow.
 *
 * Uses a pending mutations pattern: changes are collected during a step
 * and applied at the top of the next iteration.
 */
export interface AxStepContext {
  // Read-only state
  readonly stepIndex: number;
  readonly maxSteps: number;
  readonly isFirstStep: boolean;
  readonly functionsExecuted: ReadonlySet<string>;
  readonly lastFunctionCalls: readonly AxFunctionCallRecord[];
  readonly usage: Readonly<AxStepUsage>;

  // Custom state map (persists across steps)
  readonly state: Map<string, unknown>;

  // Mutators (changes are applied at next step boundary)
  setModel(model: string): void;
  setThinkingBudget(budget: AxAIServiceOptions['thinkingTokenBudget']): void;
  setTemperature(temperature: number): void;
  setMaxTokens(maxTokens: number): void;
  setOptions(
    options: Partial<
      AxAIServiceOptions & { modelConfig?: Partial<AxModelConfig> }
    >
  ): void;
  addFunctions(functions: AxInputFunctionType): void;
  removeFunctions(...names: string[]): void;
  stop(resultValues?: Record<string, unknown>): void;
}

/**
 * Hooks called at various points during the multi-step generation loop.
 */
export type AxStepHooks = {
  beforeStep?: (ctx: AxStepContext) => void | Promise<void>;
  afterStep?: (ctx: AxStepContext) => void | Promise<void>;
  afterFunctionExecution?: (ctx: AxStepContext) => void | Promise<void>;
};

/**
 * Configuration for LLM self-tuning capabilities.
 * When enabled, an `adjustGeneration` function is auto-injected
 * that lets the LLM adjust its own generation parameters.
 */
export type AxSelfTuningConfig = {
  /** Let the LLM pick from available models. */
  model?: boolean;
  /** Let the LLM adjust reasoning depth. */
  thinkingBudget?: boolean;
  /** Let the LLM adjust sampling temperature. */
  temperature?: boolean;
  /** Pool of functions the LLM can activate/deactivate per step. */
  functions?: AxInputFunctionType;
};

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
  | {
      format?: string;
      data?: string;
      id?: string;
      mimeType?: string;
      transcript?: string;
      sampleRate?: number;
      channels?: number;
    }
  | {
      format?: string;
      data?: string;
      id?: string;
      mimeType?: string;
      transcript?: string;
      sampleRate?: number;
      channels?: number;
    }[];

export type AxGenIn = { [key: string]: AxFieldValue };

export type AxGenOut = { [key: string]: AxFieldValue };

export type AxProgramTrace<IN, OUT> = {
  trace: OUT & Partial<IN>;
  programId: string;
};

export type AxProgramDemos<IN, OUT, ID extends string = string> = {
  traces: (OUT & Partial<IN>)[];
  programId: ID;
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

export type AxFunctionCallTrace = {
  fn: string;
  componentId?: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  ms: number;
};

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
  speech?: AxSpeechConfig;

  // Functions and calls
  functions?: AxInputFunctionType;
  functionCall?: AxChatRequest['functionCall'];
  stopFunction?: string | string[];
  functionResultFormatter?: (result: unknown) => string;
  onFunctionCall?: (
    call: Readonly<AxFunctionCallTrace>
  ) => void | Promise<void>;

  // Behavior control
  fastFail?: boolean;
  showThoughts?: boolean;
  functionCallMode?: 'auto' | 'native' | 'prompt';
  structuredOutputMode?: 'auto' | 'native' | 'function';

  // Caching hook
  cachingFunction?: (
    key: string,
    value?: AxGenOut
  ) => AxGenOut | undefined | Promise<AxGenOut | undefined>;

  // Memory tag cleanup control
  disableMemoryCleanup?: boolean;

  // Tracing and logging
  traceLabel?: string;

  // Step context and hooks
  stepHooks?: AxStepHooks;
  selfTuning?: boolean | AxSelfTuningConfig;

  // AxGen-specific options (previously in AxGenOptions)
  description?: string;
  thoughtFieldName?: string;
  promptTemplate?: typeof AxPromptTemplate;
  asserts?: AxAssertion<any>[];
  streamingAsserts?: AxStreamingAssertion[];
  excludeContentFromTrace?: boolean;

  // Field prefix is required for single output field programs
  strictMode?: boolean;

  // Custom Ax template-engine string to use instead of the built-in dspy.md.
  // Uses Mustache-style syntax with {{ var }}, {{ if cond }} / {{ else }} / {{ /if }}.
  // Receives the same variables as the default template (identityText, taskDefinitionText, etc.).
  // Useful for reordering prompt sections, e.g. placing <task_definition> before <identity>
  // to enable cross-signature prompt caching on providers like Azure OpenAI.
  customTemplate?: string;
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
    values: IN,
    options?: Readonly<AxProgramForwardOptions<TModelKey>>
  ): Promise<OUT>;

  streamingForward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramStreamingForwardOptions<TModelKey>>
  ): AxGenStreamingOut<OUT>;
}

export interface AxTunable<IN, OUT> {
  getId(): string;
  setId(id: string): void;
  getTraces(): AxProgramTrace<IN, OUT>[];
  namedProgramInstances?(): AxNamedProgramInstance<any, any>[];
  setDemos(
    demos: readonly AxProgramDemos<IN, OUT>[],
    options?: { modelConfig?: Record<string, unknown> }
  ): void;
  applyOptimization(optimizedProgram: AxOptimizedProgram<OUT>): void;

  /**
   * Enumerate all string-valued artifacts this program tree exposes for
   * reflective optimization (instructions, signature descriptions, function
   * names/descriptions, agent system prompts, etc.). Composite programs
   * flat-map their children's components and append their own.
   *
   * The optimizer never walks the tree — traversal is encapsulated here.
   */
  getOptimizableComponents(): readonly AxOptimizableComponent[];

  /**
   * Apply a map of `componentKey → newValue` updates produced by an optimizer.
   * Each program filters keys belonging to itself and dispatches internally.
   * Unknown keys are silently ignored, which lets parents broadcast a single
   * map across the whole subtree.
   */
  applyOptimizedComponents(updates: Readonly<Record<string, string>>): void;
}

export type AxNamedProgramInstance<IN = any, OUT = any> = {
  id: string;
  program: AxTunable<IN, OUT>;
  signature?: string;
};

export type AxAgentUsage = {
  actor: AxProgramUsage[];
  responder: AxProgramUsage[];
};

export interface AxUsable {
  getUsage(): AxProgramUsage[] | AxAgentUsage;
  getChatLog(): readonly AxChatLogEntry[];
  resetUsage(): void;
}

export interface AxProgrammable<IN, OUT, TModelKey = string>
  extends AxForwardable<IN, OUT, TModelKey>,
    AxTunable<IN, OUT>,
    AxUsable {
  getSignature(): AxSignature;
}

export type AxProgramUsage = AxChatResponse['modelUsage'] & {
  ai: string;
  model: string;
};

// === Chat Log Types (for training/distillation capture) ===

/**
 * A normalized chat message with standard roles: system, user, assistant, tool.
 * Assistant content uses inline XML: `<think>` for reasoning, `<tool_call>` for tool invocations.
 */
export type AxChatLogMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; name: string; content: string };

/**
 * A single chat round-trip entry: the full prompt sent to the model and its response,
 * with normalized roles and inline XML formatting.
 */
export type AxChatLogEntry = {
  /** Optional composite-program label for the program/node that produced this chat round trip. */
  name?: string;
  model: string;
  messages: AxChatLogMessage[];
  /** Ax-local session identifier used for conversation tracking and memory isolation. */
  sessionId?: AxChatResponse['sessionId'];
  /** Provider response/message/completion identifier. */
  remoteId?: AxChatResponse['remoteId'];
  /** Provider request identifier, usually from response headers. */
  remoteRequestId?: AxChatResponse['remoteRequestId'];
  /** Provider conversation/session identifier when distinct from Ax's local sessionId. */
  remoteSessionId?: AxChatResponse['remoteSessionId'];
  /** Provider-specific metadata that should flow through adapters. */
  providerMetadata?: AxChatResponse['providerMetadata'];
  modelUsage?: AxChatResponse['modelUsage'];
  /** Set by the AxAgent coordinator when running a two-stage ctx+task flow. */
  stage?: 'ctx' | 'task';
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
