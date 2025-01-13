export const axSpanAttributes = {
  // LLM
  LLM_SYSTEM: 'gen_ai.system',
  LLM_REQUEST_MODEL: 'gen_ai.request.model',
  LLM_REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  LLM_REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  LLM_REQUEST_TOP_K: 'gen_ai.request.top_k',
  LLM_REQUEST_FREQUENCY_PENALTY: 'gen_ai.request.frequency_penalty',
  LLM_REQUEST_PRESENCE_PENALTY: 'gen_ai.request.presence_penalty',
  LLM_REQUEST_STOP_SEQUENCES: 'gen_ai.request.stop_sequences',
  LLM_REQUEST_LLM_IS_STREAMING: 'gen_ai.request.llm_is_streaming',
  LLM_REQUEST_TOP_P: 'gen_ai.request.top_p',

  LLM_USAGE_PROMPT_TOKENS: 'gen_ai.usage.prompt_tokens',
  LLM_USAGE_COMPLETION_TOKENS: 'gen_ai.usage.completion_tokens',

  // Vector DB
  DB_SYSTEM: 'db.system',
  DB_TABLE: 'db.table',
  DB_NAMESPACE: 'db.namespace',
  DB_ID: 'db.id',
  DB_QUERY_TEXT: 'db.query.text',
  DB_VECTOR: 'db.vector',
  DB_OPERATION_NAME: 'db.operation.name',
  DB_VECTOR_QUERY_TOP_K: 'db.vector.query.top_k',

  DB_QUERY_EMBEDDINGS: 'db.query.embeddings',
  DB_QUERY_RESULT: 'db.query.result',

  // Query Embeddings
  DB_QUERY_EMBEDDINGS_VECTOR: 'db.query.embeddings.vector',

  // Query Result (canonical format)
  DB_QUERY_RESULT_ID: 'db.query.result.id',
  DB_QUERY_RESULT_SCORE: 'db.query.result.score',
  DB_QUERY_RESULT_DISTANCE: 'db.query.result.distance',
  DB_QUERY_RESULT_METADATA: 'db.query.result.metadata',
  DB_QUERY_RESULT_VECTOR: 'db.query.result.vector',
  DB_QUERY_RESULT_DOCUMENT: 'db.query.result.document',
}

export const axSpanEvents = {
  LLM_PROMPT: 'gen_ai.prompt',
}

export enum AxLLMRequestTypeValues {
  COMPLETION = 'completion',
  CHAT = 'chat',
  RERANK = 'rerank',
  UNKNOWN = 'unknown',
}

export enum AxSpanKindValues {
  WORKFLOW = 'workflow',
  TASK = 'task',
  AGENT = 'agent',
  TOOL = 'tool',
  UNKNOWN = 'unknown',
}

export type AxSpanAttributeValue = string | number | boolean | undefined | null

export interface AxSpanAttributes {
  [key: string]: AxSpanAttributeValue
}

export interface AxSpanTimeInput {
  timestamp: number
}

export interface AxSpanException {
  message: string
  name: string
  stack?: string
}

export interface AxSpanContext {
  traceId: string
  spanId: string
}

export enum AxSpanStatusCode {
  OK = 'OK',
  ERROR = 'ERROR',
}

export interface AxSpanStatus {
  code: AxSpanStatusCode
  message?: string
}

export interface AxSpanStatus {
  code: AxSpanStatusCode
  description?: string
}

// AxSpan interface as defined in the provided documentation
export interface AxSpan {
  addEvent(
    name: string,
    attributesOrStartTime?: Readonly<AxSpanAttributes | AxSpanTimeInput>,
    startTime?: Readonly<AxSpanTimeInput>
  ): AxSpan
  end(endTime?: Readonly<AxSpanTimeInput>): void
  isRecording(): boolean
  recordAxSpanException(
    exception: Readonly<AxSpanException>,
    time?: Readonly<AxSpanTimeInput>
  ): void
  setAttribute(key: string, value: AxSpanAttributeValue): AxSpan
  setAttributes(attributes: AxSpanAttributes): AxSpan
  setStatus(status: Readonly<AxSpanStatus>): AxSpan
  spanContext(): AxSpanContext
  updateName(name: string): AxSpan
}

// Context interface definition
export interface AxContext {
  /**
   * Deletes a value associated with a key from the context.
   * Returns a new context that inherits from the current context but does not contain the value for the specified key.
   * @param key The symbol key for which to clear the value.
   * @returns A new Context instance without the specified key.
   */
  deleteValue(key: symbol): AxContext

  /**
   * Retrieves a value from the context using a symbol as the key.
   * @param key The symbol key which identifies a context value.
   * @returns The value associated with the key, if any; otherwise, undefined.
   */
  getValue(key: symbol): unknown

  /**
   * Sets a value in the context for the specified key.
   * Returns a new context that inherits from the current context with the new key-value pair added.
   * @param key The symbol key for which to set the value.
   * @param value The value to set for the given key.
   * @returns A new Context instance with the updated key-value pair.
   */
  setValue(key: symbol, value: unknown): AxContext
}

export enum AxSpanKind {
  INTERNAL = 'INTERNAL',
  SERVER = 'SERVER',
  CLIENT = 'CLIENT',
  PRODUCER = 'PRODUCER',
  CONSUMER = 'CONSUMER',
}

export interface AxSpanLink {
  context: AxSpanContext // Placeholder for AxSpanContext type
  attributes?: AxSpanAttributes
}

// AxSpanOptions interface definition
export interface AxSpanOptions {
  /**
   * Optional attributes that can be attached to the AxSpan.
   * @optional
   */
  attributes?: AxSpanAttributes

  /**
   * The kind of span, defaults to AxSpanKind.INTERNAL if not specified.
   * @optional
   */
  kind?: AxSpanKind

  /**
   *  AxSpanLinks that associate this new AxSpan with other AxSpans.
   * @optional
   */
  links?: AxSpanLink[]

  /**
   * Indicates whether the span should be a root span, ignoring any parent span from the context.
   * @optional
   */
  root?: boolean

  /**
   * A manually specified start time for the span, if required.
   * @optional
   */
  startTime?: AxSpanTimeInput
}

export interface AxSpan {
  setStatus(status: Readonly<AxSpanStatus>): void
  end(): void
}

//  AxTracer interface definition
export interface AxTracer {
  /**
   * Starts a new AxSpan with the specified options and executes the provided function. The span is automatically closed after the function executes.
   * @param name The name of the span.
   * @param options AxSpan options to apply to the span.
   * @param fn The function to execute within the span's context.
   * @returns The return value of the function.
   */
  startActiveSpan<F extends (span: AxSpan) => unknown>(
    name: string,
    options: Readonly<AxSpanOptions>,
    fn: F
  ): ReturnType<F>

  /**
   * Starts a new AxSpan with the specified options and context, then executes the provided function. The span is automatically closed after the function executes.
   * @param name The name of the span.
   * @param options AxSpan options to apply to the span.
   * @param context Context to be used for the span.
   * @param fn The function to execute within the span's context.
   * @returns The return value of the function.
   */
  startActiveSpan<F extends (span: AxSpan) => unknown>(
    name: string,
    options: Readonly<AxSpanOptions>,
    context: AxContext,
    fn: F
  ): ReturnType<F>

  startSpan(
    name: string,
    options?: Readonly<AxSpanOptions>,
    context?: AxContext
  ): AxSpan
}
