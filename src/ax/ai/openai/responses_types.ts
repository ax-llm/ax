import type {
  AxChatRequest,
  AxChatResponseResult,
  AxModelConfig,
} from '../types.js'

// Define content part types directly based on AxChatRequest structure
export interface TextContentPart {
  type: 'text'
  text: string
  cache?: boolean
}

export interface ImageContentPart {
  type: 'image'
  mimeType: string
  image: string
  details?: 'high' | 'low' | 'auto'
  cache?: boolean
}

export interface AudioContentPart {
  type: 'audio'
  data: string
  format?: 'wav'
  cache?: boolean
}

// Union of all content part types
export type UserMessageContentItem =
  | TextContentPart
  | ImageContentPart
  | AudioContentPart

// export type  for function calls as defined in AxChatResponseResult
export type FunctionCallType = NonNullable<
  AxChatResponseResult['functionCalls']
>[number]

// export type  for the items in req.functions
export type RequestFunctionDefinition = NonNullable<
  AxChatRequest['functions']
>[number]

// --- AxAIOpenAI /v1/responses Specific Request Types ---

// Content parts for input messages
export interface AxAIOpenAIResponsesInputTextContentPart {
  readonly type: 'text'
  text: string // Made mutable for stream aggregation
}

export interface AxAIOpenAIResponsesInputImageUrlContentPart {
  readonly type: 'image_url'
  readonly image_url: {
    readonly url: string
    readonly details?: 'low' | 'high' | 'auto'
  }
}

export interface AxAIOpenAIResponsesInputAudioContentPart {
  readonly type: 'input_audio' // This is an assumption based on compatibility needs
  readonly input_audio: {
    readonly data: string // base64 encoded audio
    readonly format?: string // e.g., 'wav', 'mp3'
  }
}

export type AxAIOpenAIResponsesInputContentPart =
  | AxAIOpenAIResponsesInputTextContentPart
  | AxAIOpenAIResponsesInputImageUrlContentPart
  | AxAIOpenAIResponsesInputAudioContentPart

// Input Item: Message
export interface AxAIOpenAIResponsesInputMessageItem {
  readonly type: 'message'
  readonly role: 'system' | 'user' | 'assistant' | 'developer'
  readonly content: string | ReadonlyArray<AxAIOpenAIResponsesInputContentPart>
  readonly name?: string // Optional name for user/assistant messages
  // status?: 'in_progress' | 'completed' | 'incomplete' // Typically for response items
}

// Input Item: Function Call (representing a past call by the model)
export interface AxAIOpenAIResponsesInputFunctionCallItem {
  readonly type: 'function_call'
  readonly id?: string // Optional unique ID of this item in the context
  readonly call_id: string // The ID that links this call to its output
  readonly name: string
  // eslint-disable-next-line functional/functional-parameters
  readonly arguments: string // JSON string of arguments
  // status?: string // Typically for response items
}

// Input Item: Function Call Output (representing the result of a past call)
export interface AxAIOpenAIResponsesInputFunctionCallOutputItem {
  readonly type: 'function_call_output'
  readonly id?: string // Optional unique ID of this item in the context
  readonly call_id: string
  readonly output: string // JSON string of the output
  // status?: string // Typically for response items
}

// Union of all possible input items
// Add other item types here as needed (e.g., FileSearch, WebSearch, Reasoning items)
export type AxAIOpenAIResponsesInputItem =
  | string // Simple text input
  | AxAIOpenAIResponsesInputMessageItem
  | AxAIOpenAIResponsesInputFunctionCallItem
  | AxAIOpenAIResponsesInputFunctionCallOutputItem

// Tool Definitions
export interface AxAIOpenAIResponsesDefineFunctionTool {
  readonly type: 'function'
  readonly name: string
  readonly description?: string
  readonly parameters: object // JSON schema
  readonly strict?: boolean // Default true
}

// Add other tool definitions (FileSearch, WebSearch, etc.)
// export interface AxAIOpenAIResponsesDefineFileSearchTool { type: 'file_search'; vector_store_ids: string[]; ... }
// export interface AxAIOpenAIResponsesDefineWebSearchTool { type: 'web_search_preview'; ... }

export type AxAIOpenAIResponsesToolDefinition =
  AxAIOpenAIResponsesDefineFunctionTool // | AxAIOpenAIResponsesDefineFileSearchTool | ...

// Tool Choice
export type AxAIOpenAIResponsesToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { readonly type: 'function'; readonly name: string }
  | { readonly type: 'file_search' } // And other hosted tools
// | { type: 'web_search_preview' }
// | { type: 'code_interpreter' }

// Main Request for /v1/responses
export interface AxAIOpenAIResponsesRequest<TModel = string> {
  readonly input: string | ReadonlyArray<AxAIOpenAIResponsesInputItem>
  readonly model: TModel
  readonly background?: boolean | null
  readonly include?: ReadonlyArray<
    | 'file_search_call.results'
    | 'message.input_image.image_url'
    | 'computer_call_output.output.image_url'
    | 'reasoning.encrypted_content'
    | 'code_interpreter_call.outputs'
  > | null
  readonly instructions?: string | null // Maps to system prompt
  readonly max_output_tokens?: number | null
  readonly metadata?: Readonly<Record<string, string>> | null
  readonly parallel_tool_calls?: boolean | null
  readonly previous_response_id?: string | null
  readonly reasoning?: {
    readonly effort?: 'low' | 'medium' | 'high' | null
    readonly summary?: 'auto' | 'concise' | 'detailed' | null // 'generate_summary' is deprecated
  } | null
  readonly service_tier?: 'auto' | 'default' | 'flex' | null
  readonly store?: boolean | null // Whether to store for later retrieval
  readonly stream?: boolean | null
  readonly temperature?: number | null
  readonly text?: {
    readonly format?:
      | { readonly type: 'text' }
      | { readonly type: 'json_object' } // Older JSON mode
      | { readonly type: 'json_schema'; readonly json_schema?: object } // Structured Outputs
      | null
  } | null
  readonly tool_choice?: AxAIOpenAIResponsesToolChoice | null
  readonly tools?: ReadonlyArray<AxAIOpenAIResponsesToolDefinition> | null
  readonly top_p?: number | null
  readonly truncation?: 'auto' | 'disabled' | null // How to handle context window overflow
  readonly user?: string | null // User identifier for tracking/moderation
  readonly seed?: number | null // Added seed from later in the code
}

// --- AxAIOpenAI /v1/responses Specific Response Types ---

// Output Item: Message (from assistant)
export interface AxAIOpenAIResponsesOutputMessageItem {
  type: 'message' // Mutable during construction
  id: string // Mutable during construction
  role: 'assistant' // Mutable during construction
  content: ReadonlyArray<
    | AxAIOpenAIResponsesOutputTextContentPart
    | AxAIOpenAIResponsesOutputRefusalContentPart
  >
  status: 'in_progress' | 'completed' | 'incomplete' // Mutable during construction
}

// Output Item: Function Call (emitted by the model)
export interface AxAIOpenAIResponsesFunctionCallItem {
  type: 'function_call' // Mutable during construction
  id: string // Mutable during construction
  call_id: string // Mutable during construction
  name: string // Mutable during construction
  // eslint-disable-next-line functional/functional-parameters
  arguments: string // Mutable during construction (appendable)
  status?: 'in_progress' | 'completed' | 'incomplete' | 'searching' | 'failed' // Mutable
}

// Output Item: Reasoning (if requested and supported)
export interface AxAIOpenAIResponsesReasoningItem {
  readonly type: 'reasoning' // Typically not built incrementally in the same way by client
  readonly id: string
  readonly summary: ReadonlyArray<string | object>
  readonly encrypted_content?: string | null
  readonly status?: 'in_progress' | 'completed' | 'incomplete'
}

// Add this new export interface for output_text parts
export interface AxAIOpenAIResponsesOutputTextContentPart {
  readonly type: 'output_text'
  readonly text: string
  readonly annotations?: ReadonlyArray<unknown>
}

export interface AxAIOpenAIResponsesOutputRefusalContentPart {
  readonly type: 'refusal'
  readonly refusal: string
}

// Add export interface for reasoning summary parts
export interface AxAIOpenAIResponsesReasoningSummaryPart {
  readonly type: 'summary_text'
  readonly text: string
}

// Update the union of all possible output items
export type AxAIOpenAIResponsesOutputItem =
  | AxAIOpenAIResponsesOutputMessageItem
  | AxAIOpenAIResponsesFunctionCallItem
  | AxAIOpenAIResponsesReasoningItem
  | AxAIOpenAIResponsesFileSearchToolCall
  | AxAIOpenAIResponsesWebSearchToolCall
  | AxAIOpenAIResponsesComputerToolCall
  | AxAIOpenAIResponsesCodeInterpreterToolCall
  | AxAIOpenAIResponsesImageGenerationToolCall
  | AxAIOpenAIResponsesLocalShellToolCall
  | AxAIOpenAIResponsesMCPToolCall

// Main Response from /v1/responses (non-streaming)
export interface AxAIOpenAIResponsesResponse {
  readonly id: string // Response ID
  readonly object: string // e.g., "response"
  readonly created: number // Timestamp
  readonly model: string // Model ID used
  readonly output: ReadonlyArray<AxAIOpenAIResponsesOutputItem>
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number // Or output_tokens / generated_tokens
    readonly total_tokens: number
    // reasoning_tokens?: number // if applicable and included
  } | null
}

// --- Streaming Event Types for /v1/responses ---

// Base streaming event interface
export interface AxAIOpenAIResponsesStreamEventBase {
  readonly type: string
  readonly sequence_number: number
}

// Response lifecycle events
export interface AxAIOpenAIResponsesResponseCreatedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.created'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

export interface AxAIOpenAIResponsesResponseInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.in_progress'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

export interface AxAIOpenAIResponsesResponseCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.completed'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

export interface AxAIOpenAIResponsesResponseFailedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.failed'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

export interface AxAIOpenAIResponsesResponseIncompleteEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.incomplete'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

export interface AxAIOpenAIResponsesResponseQueuedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.queued'
  readonly response: Readonly<AxAIOpenAIResponsesResponse>
}

// Output item events
export interface AxAIOpenAIResponsesOutputItemAddedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.output_item.added'
  readonly output_index: number
  readonly item: Readonly<AxAIOpenAIResponsesOutputItem>
}

export interface AxAIOpenAIResponsesOutputItemDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.output_item.done'
  readonly output_index: number
  readonly item: Readonly<AxAIOpenAIResponsesOutputItem>
}

// Content part events
export interface AxAIOpenAIResponsesContentPartAddedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.content_part.added'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly part: Readonly<
    | AxAIOpenAIResponsesOutputTextContentPart
    | AxAIOpenAIResponsesOutputRefusalContentPart
  >
}

export interface AxAIOpenAIResponsesContentPartDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.content_part.done'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly part: Readonly<
    | AxAIOpenAIResponsesOutputTextContentPart
    | AxAIOpenAIResponsesOutputRefusalContentPart
  >
}

// Text delta events
export interface AxAIOpenAIResponsesOutputTextDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.output_text.delta'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly delta: string
}

export interface AxAIOpenAIResponsesOutputTextDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.output_text.done'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly text: string
}

// Refusal events
export interface AxAIOpenAIResponsesRefusalDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.refusal.delta'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly delta: string
}

export interface AxAIOpenAIResponsesRefusalDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.refusal.done'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly refusal: string
}

// Function call events
export interface AxAIOpenAIResponsesFunctionCallArgumentsDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.function_call_arguments.delta'
  readonly item_id: string
  readonly output_index: number
  readonly delta: string
}

export interface AxAIOpenAIResponsesFunctionCallArgumentsDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.function_call_arguments.done'
  readonly item_id: string
  readonly output_index: number
  // eslint-disable-next-line functional/functional-parameters
  readonly arguments: string
}

// File search events
export interface AxAIOpenAIResponsesFileSearchCallInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.file_search_call.in_progress'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesFileSearchCallSearchingEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.file_search_call.searching'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesFileSearchCallCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.file_search_call.completed'
  readonly item_id: string
  readonly output_index: number
}

// Web search events
export interface AxAIOpenAIResponsesWebSearchCallInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.web_search_call.in_progress'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesWebSearchCallSearchingEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.web_search_call.searching'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesWebSearchCallCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.web_search_call.completed'
  readonly item_id: string
  readonly output_index: number
}

// Reasoning events
export interface AxAIOpenAIResponsesReasoningDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning.delta'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly delta: object
}

export interface AxAIOpenAIResponsesReasoningDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning.done'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly text: string
}

// Reasoning summary events
export interface AxAIOpenAIResponsesReasoningSummaryPartAddedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary_part.added'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly part: Readonly<AxAIOpenAIResponsesReasoningSummaryPart>
}

export interface AxAIOpenAIResponsesReasoningSummaryPartDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary_part.done'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly part: Readonly<AxAIOpenAIResponsesReasoningSummaryPart>
}

export interface AxAIOpenAIResponsesReasoningSummaryTextDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary_text.delta'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly delta: string
}

export interface AxAIOpenAIResponsesReasoningSummaryTextDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary_text.done'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly text: string
}

export interface AxAIOpenAIResponsesReasoningSummaryDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary.delta'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly delta: object
}

export interface AxAIOpenAIResponsesReasoningSummaryDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.reasoning_summary.done'
  readonly item_id: string
  readonly output_index: number
  readonly summary_index: number
  readonly text: string
}

// Image generation events
export interface AxAIOpenAIResponsesImageGenerationCallInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.image_generation_call.in_progress'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesImageGenerationCallGeneratingEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.image_generation_call.generating'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesImageGenerationCallCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.image_generation_call.completed'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesImageGenerationCallPartialImageEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.image_generation_call.partial_image'
  readonly item_id: string
  readonly output_index: number
  readonly partial_image_index: number
  readonly partial_image_b64: string
}

// MCP events
export interface AxAIOpenAIResponsesMCPCallInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_call.in_progress'
  readonly item_id: string
  readonly output_index: number
}

export interface AxAIOpenAIResponsesMCPCallArgumentsDeltaEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_call.arguments.delta'
  readonly item_id: string
  readonly output_index: number
  readonly delta: object
}

export interface AxAIOpenAIResponsesMCPCallArgumentsDoneEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_call.arguments.done'
  readonly item_id: string
  readonly output_index: number
  // eslint-disable-next-line functional/functional-parameters
  readonly arguments: object
}

export interface AxAIOpenAIResponsesMCPCallCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_call.completed'
}

export interface AxAIOpenAIResponsesMCPCallFailedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_call.failed'
}

export interface AxAIOpenAIResponsesMCPListToolsInProgressEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_list_tools.in_progress'
}

export interface AxAIOpenAIResponsesMCPListToolsCompletedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_list_tools.completed'
}

export interface AxAIOpenAIResponsesMCPListToolsFailedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.mcp_list_tools.failed'
}

// Annotation events
export interface AxAIOpenAIResponsesOutputTextAnnotationAddedEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'response.output_text_annotation.added'
  readonly item_id: string
  readonly output_index: number
  readonly content_index: number
  readonly annotation_index: number
  readonly annotation: object
}

// Error event
export interface AxAIOpenAIResponsesErrorEvent
  extends AxAIOpenAIResponsesStreamEventBase {
  readonly type: 'error'
  readonly code: string | null
  readonly message: string
  readonly param: string | null
}

// Union of all streaming events
export type AxAIOpenAIResponsesStreamEvent =
  | AxAIOpenAIResponsesResponseCreatedEvent
  | AxAIOpenAIResponsesResponseInProgressEvent
  | AxAIOpenAIResponsesResponseCompletedEvent
  | AxAIOpenAIResponsesResponseFailedEvent
  | AxAIOpenAIResponsesResponseIncompleteEvent
  | AxAIOpenAIResponsesResponseQueuedEvent
  | AxAIOpenAIResponsesOutputItemAddedEvent
  | AxAIOpenAIResponsesOutputItemDoneEvent
  | AxAIOpenAIResponsesContentPartAddedEvent
  | AxAIOpenAIResponsesContentPartDoneEvent
  | AxAIOpenAIResponsesOutputTextDeltaEvent
  | AxAIOpenAIResponsesOutputTextDoneEvent
  | AxAIOpenAIResponsesRefusalDeltaEvent
  | AxAIOpenAIResponsesRefusalDoneEvent
  | AxAIOpenAIResponsesFunctionCallArgumentsDeltaEvent
  | AxAIOpenAIResponsesFunctionCallArgumentsDoneEvent
  | AxAIOpenAIResponsesFileSearchCallInProgressEvent
  | AxAIOpenAIResponsesFileSearchCallSearchingEvent
  | AxAIOpenAIResponsesFileSearchCallCompletedEvent
  | AxAIOpenAIResponsesWebSearchCallInProgressEvent
  | AxAIOpenAIResponsesWebSearchCallSearchingEvent
  | AxAIOpenAIResponsesWebSearchCallCompletedEvent
  | AxAIOpenAIResponsesReasoningDeltaEvent
  | AxAIOpenAIResponsesReasoningDoneEvent
  | AxAIOpenAIResponsesReasoningSummaryPartAddedEvent
  | AxAIOpenAIResponsesReasoningSummaryPartDoneEvent
  | AxAIOpenAIResponsesReasoningSummaryTextDeltaEvent
  | AxAIOpenAIResponsesReasoningSummaryTextDoneEvent
  | AxAIOpenAIResponsesReasoningSummaryDeltaEvent
  | AxAIOpenAIResponsesReasoningSummaryDoneEvent
  | AxAIOpenAIResponsesImageGenerationCallInProgressEvent
  | AxAIOpenAIResponsesImageGenerationCallGeneratingEvent
  | AxAIOpenAIResponsesImageGenerationCallCompletedEvent
  | AxAIOpenAIResponsesImageGenerationCallPartialImageEvent
  | AxAIOpenAIResponsesMCPCallInProgressEvent
  | AxAIOpenAIResponsesMCPCallArgumentsDeltaEvent
  | AxAIOpenAIResponsesMCPCallArgumentsDoneEvent
  | AxAIOpenAIResponsesMCPCallCompletedEvent
  | AxAIOpenAIResponsesMCPCallFailedEvent
  | AxAIOpenAIResponsesMCPListToolsInProgressEvent
  | AxAIOpenAIResponsesMCPListToolsCompletedEvent
  | AxAIOpenAIResponsesMCPListToolsFailedEvent
  | AxAIOpenAIResponsesOutputTextAnnotationAddedEvent
  | AxAIOpenAIResponsesErrorEvent

// Legacy delta export interface for backward compatibility - now maps to the new streaming events
export interface AxAIOpenAIResponsesResponseDelta {
  readonly id?: string // Overall response ID, appears in first event usually
  readonly model?: string // Model ID, might appear in first event
  readonly event?: string // e.g., 'response.delta', 'response.item_delta', 'response.done'

  // If event is 'response.delta' or 'response.item_delta'
  readonly delta?: {
    // For message content delta
    readonly content?: string // If item is a message part
    // For tool call argument delta
    // eslint-disable-next-line functional/functional-parameters
    readonly arguments?: string // If item is a function_call part
    // Other potential delta fields based on item type
  }

  // If event is 'response.item_created', 'response.item_delta', 'response.item_completed'
  readonly item_index?: number // Index of the item in the `items` array
  readonly item?: Partial<Readonly<AxAIOpenAIResponsesOutputItem>> // The item being streamed or its delta

  // If event is 'response.done'
  readonly response?: Readonly<AxAIOpenAIResponsesResponse> // The final full response object (often without items if streamed separately)
  readonly usage?: {
    readonly prompt_tokens: number
    readonly completion_tokens: number
    readonly total_tokens: number
    // reasoning_tokens?: number
  } | null // Usage often comes in the 'response.done' event or with stream_options
}

// export type  for the function that updates the request before sending
export type ResponsesReqUpdater<
  TModel,
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> = (req: Readonly<TResponsesReq>) => Readonly<TResponsesReq>

// Utility export type  to make properties of T mutable
export type Mutable<T> = { -readonly [P in keyof T]: T[P] }

export type AxAIOpenAIResponsesConfig<TModel, TEmbedModel> = Omit<
  AxModelConfig,
  'topK'
> & {
  model: TModel
  embedModel?: TEmbedModel
  user?: string
  bestOf?: number
  logitBias?: Map<string, number>
  suffix?: string | null
  stop?: string[]
  logprobs?: number
  echo?: boolean
  dimensions?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  store?: boolean
  systemPrompt?: string
  parallelToolCalls?: boolean
  seed?: number
  responseFormat?: 'text' | 'json_object' | 'json_schema'
  serviceTier?: 'auto' | 'default' | 'flex'
}

// ToolCall response types
export interface AxAIOpenAIResponsesToolCallBase {
  id: string
  type: string
  status?: string
}

export interface AxAIOpenAIResponsesFileSearchToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'file_search_call'
  queries: string[]
  results?: {
    file_id: string
    filename: string
    score: number
    text: string
    attributes?: Record<string, string | boolean | number>
  }[]
}

export interface AxAIOpenAIResponsesWebSearchToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'web_search_call'
  queries: string[]
}

export interface AxAIOpenAIResponsesComputerToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'computer_call'
  action: object
}

export interface AxAIOpenAIResponsesCodeInterpreterToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'code_interpreter_call'
  code: string
  results?: unknown[]
}

export interface AxAIOpenAIResponsesImageGenerationToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'image_generation_call'
  result?: string
}

export interface AxAIOpenAIResponsesLocalShellToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'local_shell_call'
  action: object
}

export interface AxAIOpenAIResponsesMCPToolCall
  extends AxAIOpenAIResponsesToolCallBase {
  type: 'mcp_call'
  name: string
  args: string
  server_label: string
  output?: string
  error?: string
}

export type AxAIOpenAIResponsesToolCall =
  | AxAIOpenAIResponsesFunctionCallItem
  | AxAIOpenAIResponsesFileSearchToolCall
  | AxAIOpenAIResponsesWebSearchToolCall
  | AxAIOpenAIResponsesComputerToolCall
  | AxAIOpenAIResponsesCodeInterpreterToolCall
  | AxAIOpenAIResponsesImageGenerationToolCall
  | AxAIOpenAIResponsesLocalShellToolCall
  | AxAIOpenAIResponsesMCPToolCall
