import type { AxModelConfig } from '../types.js';

export enum AxAIAnthropicModel {
  Claude41Opus = 'claude-opus-4-1-20250805',
  Claude4Opus = 'claude-opus-4-20250514',
  Claude4Sonnet = 'claude-sonnet-4-20250514',
  Claude45Sonnet = 'claude-sonnet-4-5-20250929',
  Claude45Haiku = 'claude-haiku-4-5',
  Claude37Sonnet = 'claude-3-7-sonnet-latest',

  Claude35Sonnet = 'claude-3-5-sonnet-latest',
  Claude35Haiku = 'claude-3-5-haiku-latest',

  Claude3Opus = 'claude-3-opus-latest',
  Claude3Sonnet = 'claude-3-sonnet-20240229',
  Claude3Haiku = 'claude-3-haiku-20240307',

  Claude21 = 'claude-2.1',
  ClaudeInstant12 = 'claude-instant-1.2',
}

export enum AxAIAnthropicVertexModel {
  Claude41Opus = 'claude-opus-4-1@20250805',
  Claude4Opus = 'claude-opus-4@20250514',
  Claude45Sonnet = 'claude-sonnet-4-5@20250929',
  Claude4Sonnet = 'claude-sonnet-4@20250514',
  Claude37Sonnet = 'claude-3-7-sonnet@20250219',
  Claude35SonnetV2 = 'claude-3-5-sonnet-v2@20241022',
  Claude45Haiku = 'claude-haiku-4.5@20251001',
  Claude35Haiku = 'claude-3-5-haiku@20241022',
  Claude35Sonnet = 'claude-3-5-sonnet@20240620',
  Claude3Opus = 'claude-3-opus@20240229',
  Claude3Haiku = 'claude-3-haiku@20240307',
}

export type AxAIAnthropicThinkingConfig = {
  type: 'enabled';
  budget_tokens: number;
  /** Optional: numeric budget hint used in config normalization */
  thinkingTokenBudget?: number;
  /** Optional: include provider thinking content in outputs */
  includeThoughts?: boolean;
};

export type AxAIAnthropicThinkingTokenBudgetLevels = {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
  highest?: number;
};

// Function-style tool definition (Anthropic JSON tool)
export type AxAIAnthropicFunctionTool = {
  name: string;
  description: string;
  input_schema?: object;
} & AxAIAnthropicChatRequestCacheParam;

// Server tool: Web Search (see Anthropic docs)
// https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool
export type AxAIAnthropicWebSearchTool = {
  type: 'web_search_20250305';
  name: string; // typically "web_search"
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_location?: {
    type: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
};

export type AxAIAnthropicRequestTool =
  | AxAIAnthropicFunctionTool
  | AxAIAnthropicWebSearchTool;

export type AxAIAnthropicConfig = AxModelConfig & {
  model: AxAIAnthropicModel | AxAIAnthropicVertexModel;
  thinking?: AxAIAnthropicThinkingConfig;
  thinkingTokenBudgetLevels?: AxAIAnthropicThinkingTokenBudgetLevels;
  tools?: ReadonlyArray<AxAIAnthropicRequestTool>;
};

export type AxAIAnthropicChatRequestCacheParam = {
  cache_control?: { type: 'ephemeral' };
};

// Type for the request to create a message using Anthropic's Messages API
export type AxAIAnthropicChatRequest = {
  model?: string;
  anthropic_version?: string;
  messages: (
    | {
        role: 'user';
        content:
          | string
          | (
              | ({
                  type: 'text';
                  text: string;
                } & AxAIAnthropicChatRequestCacheParam)
              | ({
                  type: 'image';
                  source: { type: 'base64'; media_type: string; data: string };
                } & AxAIAnthropicChatRequestCacheParam)
              | {
                  type: 'tool_result';
                  is_error?: boolean;
                  tool_use_id: string;
                  content:
                    | string
                    | (
                        | ({
                            type: 'text';
                            text: string;
                          } & AxAIAnthropicChatRequestCacheParam)
                        | ({
                            type: 'image';
                            source: {
                              type: 'base64';
                              media_type: string;
                              data: string;
                            };
                          } & AxAIAnthropicChatRequestCacheParam)
                      )[];
                }
            )[];
      }
    | {
        role: 'assistant';
        content:
          | string
          | (
              | { type: 'text'; text: string }
              | { type: 'tool_use'; id: string; name: string; input: object }
              | { type: 'thinking'; thinking: string; signature?: string }
              | {
                  type: 'redacted_thinking';
                  // Anthropic requires `data` for redacted_thinking blocks in requests
                  data: string;
                  signature?: string;
                }
            )[];
      }
  )[];
  tools?: AxAIAnthropicRequestTool[];
  tool_choice?: { type: 'auto' | 'any' } | { type: 'tool'; name?: string };
  max_tokens?: number; // Maximum number of tokens to generate
  // Optional metadata about the request
  stop_sequences?: string[]; // Custom sequences that trigger the end of generation
  stream?: boolean; // Whether to stream the response incrementally
  system?:
    | string
    | ({
        type: 'text';
        text: string;
      } & AxAIAnthropicChatRequestCacheParam)[]; // system prompt
  temperature?: number; // Randomness of the response
  top_p?: number; // Nucleus sampling probability
  top_k?: number; // Sample from the top K options
  thinking?: AxAIAnthropicThinkingConfig; // Extended thinking configuration
  metadata?: {
    user_id: string;
  };
};

export type AxAIAnthropicChatResponse = {
  id: string; // Unique identifier for the response
  type: 'message'; // Object type, always 'message' for this API
  role: 'assistant'; // Conversational role of the generated message, always 'assistant'
  content: (
    | {
        type: 'text';
        text: string;
      }
    | {
        id: string;
        name: string;
        type: 'tool_use';
        input?: string;
      }
    | {
        type: 'thinking';
        thinking: string;
        signature?: string;
      }
    | {
        type: 'redacted_thinking';
        // Responses may surface either `thinking` or `data` depending on API version
        thinking?: string;
        data?: string;
        signature?: string;
      }
  )[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type AxAIAnthropicChatError = {
  type: 'error';
  error: {
    type: 'authentication_error';
    message: string;
  };
};

// Represents the start of a message with an empty content array
export interface AxAIAnthropicMessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: [];
    model: string;
    stop_reason: null | string;
    stop_sequence: null | string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

// Indicates the start of a content block within a message
export interface AxAIAnthropicContentBlockStartEvent {
  index: number;
  type: 'content_block_start';
  content_block:
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'tool_use';
        id: string;
        name: string;
        input: object;
      }
    | {
        // Server-side tool invocation (e.g., web_search)
        type: 'server_tool_use';
        id: string;
        name: string;
        input: object;
      }
    | {
        // Server tool result container (we ignore its payload in responses)
        type: 'web_search_tool_result';
        tool_use_id: string;
        content: unknown[];
      }
    | {
        type: 'thinking';
        thinking: string;
      };
}

// Represents incremental updates to a content block
export interface AxAIAnthropicContentBlockDeltaEvent {
  index: number;
  type: 'content_block_delta';
  delta:
    | {
        type: 'text_delta';
        text: string;
      }
    | {
        type: 'input_json_delta';
        partial_json: string;
      }
    | {
        type: 'thinking_delta';
        thinking: string;
      }
    | {
        type: 'signature_delta';
        signature: string;
      };
}

// Marks the end of a content block within a message
export interface AxAIAnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

// Indicates top-level changes to the final message object
export interface AxAIAnthropicMessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

// Marks the end of a message
export interface AxAIAnthropicMessageStopEvent {
  type: 'message_stop';
}

// Represents a ping event, which can occur any number of times
export interface AxAIAnthropicPingEvent {
  type: 'ping';
}

// Represents an error event
export interface AxAIAnthropicErrorEvent {
  type: 'error';
  error: {
    type: 'overloaded_error';
    message: string;
  };
}

// Union type for all possible event types in the stream
export type AxAIAnthropicChatResponseDelta =
  | AxAIAnthropicMessageStartEvent
  | AxAIAnthropicContentBlockStartEvent
  | AxAIAnthropicContentBlockDeltaEvent
  | AxAIAnthropicContentBlockStopEvent
  | AxAIAnthropicMessageDeltaEvent
  | AxAIAnthropicMessageStopEvent
  | AxAIAnthropicPingEvent
  | AxAIAnthropicErrorEvent;
