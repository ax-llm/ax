export const SpanAttributes = {
  LLM_SYSTEM: 'gen_ai.system',
  LLM_REQUEST_TYPE: 'llm.request.type',
  LLM_REQUEST_MODEL: 'gen_ai.request.model',
  LLM_REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  LLM_REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  LLM_REQUEST_TOP_K: 'gen_ai.request.top_k',
  LLM_REQUEST_FREQUENCY_PENALTY: 'gen_ai.request.frequency_penalty',
  LLM_REQUEST_PRESENCE_PENALTY: 'gen_ai.request.presence_penalty',
  LLM_REQUEST_STOP_SEQUENCES: 'gen_ai.request.stop_sequences',
  LLM_REQUEST_USER: 'gen_ai.request.user',
  LLM_REQUEST_LLM_IS_STREAMING: 'gen_ai.request.llm_is_streaming',
  LLM_REQUEST_PROMPT: 'gen_ai.request.prompt',
  LLM_REQUEST_TOP_P: 'gen_ai.request.top_p',
  LLM_REQUEST_FUNCTIONS: 'llm.request.functions',

  //   LLM_REQUEST_PROMPTS: 'gen_ai.prompt',

  LLM_USAGE_PROMPT_TOKENS: 'gen_ai.usage.prompt_tokens',
  LLM_USAGE_COMPLETION_TOKENS: 'gen_ai.usage.completion_tokens',
  LLM_USAGE_TOTAL_TOKENS: 'llm.usage.total_tokens',

  // Vector DB
  VECTOR_DB_VENDOR: 'db.system',
  VECTOR_DB_QUERY_TOP_K: 'db.vector.query.top_k'
};

export const Events = {
  DB_QUERY_EMBEDDINGS: 'db.query.embeddings',
  DB_QUERY_RESULT: 'db.query.result'
};

export const EventAttributes = {
  // Query Embeddings
  DB_QUERY_EMBEDDINGS_VECTOR: 'db.query.embeddings.vector',

  // Query Result (canonical format)
  DB_QUERY_RESULT_ID: 'db.query.result.id',
  DB_QUERY_RESULT_SCORE: 'db.query.result.score',
  DB_QUERY_RESULT_DISTANCE: 'db.query.result.distance',
  DB_QUERY_RESULT_METADATA: 'db.query.result.metadata',
  DB_QUERY_RESULT_VECTOR: 'db.query.result.vector',
  DB_QUERY_RESULT_DOCUMENT: 'db.query.result.document'
};

export enum LLMRequestTypeValues {
  COMPLETION = 'completion',
  CHAT = 'chat',
  RERANK = 'rerank',
  UNKNOWN = 'unknown'
}

export enum SpanKindValues {
  WORKFLOW = 'workflow',
  TASK = 'task',
  AGENT = 'agent',
  TOOL = 'tool',
  UNKNOWN = 'unknown'
}

export type AttributeValue = string | number | boolean | undefined | null;

export interface Attributes {
  [key: string]: AttributeValue;
}

export interface TimeInput {
  timestamp: number;
}

export interface Exception {
  message: string;
  name: string;
  stack?: string;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export enum SpanStatusCode {
  OK = 'OK',
  ERROR = 'ERROR'
}

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

export interface SpanStatus {
  code: SpanStatusCode;
  description?: string;
}

// Span interface as defined in the provided documentation
export interface Span {
  addEvent(
    name: string,
    attributesOrStartTime?: Readonly<Attributes | TimeInput>,
    startTime?: Readonly<TimeInput>
  ): Span;
  end(endTime?: Readonly<TimeInput>): void;
  isRecording(): boolean;
  recordException(
    exception: Readonly<Exception>,
    time?: Readonly<TimeInput>
  ): void;
  setAttribute(key: string, value: AttributeValue): Span;
  setAttributes(attributes: Attributes): Span;
  setStatus(status: Readonly<SpanStatus>): Span;
  spanContext(): SpanContext;
  updateName(name: string): Span;
}

// Context interface definition
interface Context {
  /**
   * Deletes a value associated with a key from the context.
   * Returns a new context that inherits from the current context but does not contain the value for the specified key.
   * @param key The symbol key for which to clear the value.
   * @returns A new Context instance without the specified key.
   */
  deleteValue(key: symbol): Context;

  /**
   * Retrieves a value from the context using a symbol as the key.
   * @param key The symbol key which identifies a context value.
   * @returns The value associated with the key, if any; otherwise, undefined.
   */
  getValue(key: symbol): unknown;

  /**
   * Sets a value in the context for the specified key.
   * Returns a new context that inherits from the current context with the new key-value pair added.
   * @param key The symbol key for which to set the value.
   * @param value The value to set for the given key.
   * @returns A new Context instance with the updated key-value pair.
   */
  setValue(key: symbol, value: unknown): Context;
}

enum SpanKind {
  INTERNAL = 'INTERNAL',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  PRODUCER = 'PRODUCER',
  CONSUMER = 'CONSUMER'
}

interface Link {
  context: SpanContext; // Placeholder for SpanContext type
  attributes?: Attributes;
}

// SpanOptions interface definition
export interface SpanOptions {
  /**
   * Optional attributes that can be attached to the Span.
   * @optional
   */
  attributes?: Attributes;

  /**
   * The kind of span, defaults to SpanKind.INTERNAL if not specified.
   * @optional
   */
  kind?: SpanKind;

  /**
   * Links that associate this new Span with other Spans.
   * @optional
   */
  links?: Link[];

  /**
   * Indicates whether the span should be a root span, ignoring any parent span from the context.
   * @optional
   */
  root?: boolean;

  /**
   * A manually specified start time for the span, if required.
   * @optional
   */
  startTime?: TimeInput;
}

export interface Span {
  setStatus(status: Readonly<SpanStatus>): void;
  end(): void;
}

// Tracer interface definition
export interface Tracer {
  /**
   * Starts a new Span and executes the provided function. The span is automatically closed after the function executes.
   * @param name The name of the span.
   * @param fn The function to execute within the span's context.
   * @returns The return value of the function.
   */
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    fn: F
  ): ReturnType<F>;

  /**
   * Starts a new Span with the specified options and executes the provided function. The span is automatically closed after the function executes.
   * @param name The name of the span.
   * @param options Span options to apply to the span.
   * @param fn The function to execute within the span's context.
   * @returns The return value of the function.
   */
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: Readonly<SpanOptions>,
    fn: F
  ): ReturnType<F>;

  /**
   * Starts a new Span with the specified options and context, then executes the provided function. The span is automatically closed after the function executes.
   * @param name The name of the span.
   * @param options Span options to apply to the span.
   * @param context Context to be used for the span.
   * @param fn The function to execute within the span's context.
   * @returns The return value of the function.
   */
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: Readonly<SpanOptions>,
    context: Context,
    fn: F
  ): ReturnType<F>;

  startSpan(
    name: string,
    options?: Readonly<SpanOptions>,
    context?: Context
  ): Span;
}
