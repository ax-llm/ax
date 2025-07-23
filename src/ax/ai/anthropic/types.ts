import type { AxModelConfig } from '../types.js';

/**
 * Defines the available Anthropic models.
 */
export enum AxAIAnthropicModel {
  Claude4Opus = 'claude-opus-4-20250514',
  Claude4Sonnet = 'claude-sonnet-4-20250514',
  Claude37Sonnet = 'claude-3-7-sonnet-latest',

  Claude35Sonnet = 'claude-3-5-sonnet-latest',
  Claude35Haiku = 'claude-3-5-haiku-latest',

  Claude3Opus = 'claude-3-opus-latest',
  Claude3Sonnet = 'claude-3-sonnet-20240229',
  Claude3Haiku = 'claude-3-haiku-20240307',

  Claude21 = 'claude-2.1',
  ClaudeInstant12 = 'claude-instant-1.2',
}

/**
 * Defines the available Anthropic models on Vertex AI.
 */
export enum AxAIAnthropicVertexModel {
  Claude37Sonnet = 'claude-3-7-sonnet',
  Claude35Haiku = 'claude-3-5-haiku',
  Claude35Sonnet = 'claude-3-5-sonnet',
  Claude35SonnetV2 = 'claude-3-5-sonnet-v2',
  Claude3Haiku = 'claude-3-haiku',
  Claude3Opus = 'claude-3-opus',
}

/**
 * Represents the thinking configuration for the Anthropic AI service.
 */
export type AxAIAnthropicThinkingConfig = {
  /** The type of thinking configuration. */
  type: 'enabled';
  /** The budget of tokens for thinking. */
  budget_tokens: number;
};

/**
 * Represents the token budget levels for thinking.
 */
export type AxAIAnthropicThinkingTokenBudgetLevels = {
  /** The minimal token budget. */
  minimal?: number;
  /** The low token budget. */
  low?: number;
  /** The medium token budget. */
  medium?: number;
  /** The high token budget. */
  high?: number;
  /** The highest token budget. */
  highest?: number;
};

/**
 * Represents the configuration for the Anthropic AI service.
 */
export type AxAIAnthropicConfig = AxModelConfig & {
  /** The model to use. */
  model: AxAIAnthropicModel | AxAIAnthropicVertexModel;
  /** The thinking configuration. */
  thinking?: AxAIAnthropicThinkingConfig;
  /** The token budget levels for thinking. */
  thinkingTokenBudgetLevels?: AxAIAnthropicThinkingTokenBudgetLevels;
};

export type AxAIAnthropicChatRequestCacheParam = {
  cache_control?: { type: 'ephemeral' };
};

// Type for the request to create a message using Anthropic's Messages API
/**
 * Represents a chat request to the Anthropic AI service.
 */
export type AxAIAnthropicChatRequest = {
  /** The model to use for the chat request. */
  model?: string;
  /** The version of the Anthropic API to use. */
  anthropic_version?: string;
  /** The messages in the chat. */
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
                  thinking: string;
                  signature?: string;
                }
            )[];
      }
  )[];
  /** The tools that the AI can use. */
  tools?: ({
    name: string;
    description: string;
    input_schema?: object;
  } & AxAIAnthropicChatRequestCacheParam)[];
  /** The tool choice behavior. */
  tool_choice?: { type: 'auto' | 'any' } | { type: 'tool'; name?: string };
  /** The maximum number of tokens to generate. */
  max_tokens?: number;
  /** Custom sequences that trigger the end of generation. */
  stop_sequences?: string[];
  /** Whether to stream the response incrementally. */
  stream?: boolean;
  /** The system prompt. */
  system?:
    | string
    | ({
        type: 'text';
        text: string;
      } & AxAIAnthropicChatRequestCacheParam)[];
  /** The randomness of the response. */
  temperature?: number;
  /** The nucleus sampling probability. */
  top_p?: number;
  /** The number of top K options to sample from. */
  top_k?: number;
  /** The extended thinking configuration. */
  thinking?: AxAIAnthropicThinkingConfig;
  /** Optional metadata about the request. */
  metadata?: {
    user_id: string;
  };
};

/**
 * Represents a chat response from the Anthropic AI service.
 */
export type AxAIAnthropicChatResponse = {
  /** The unique identifier for the response. */
  id: string;
  /** The object type, always 'message' for this API. */
  type: 'message';
  /** The conversational role of the generated message, always 'assistant'. */
  role: 'assistant';
  /** The content of the response. */
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
        thinking: string;
        signature?: string;
      }
  )[];
  /** The model used for the response. */
  model: string;
  /** The reason the response stopped. */
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  /** The stop sequence that was hit. */
  stop_sequence?: string;
  /** The token usage of the response. */
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

/**
 * Represents an error from the Anthropic AI service.
 */
export type AxAIAnthropicChatError = {
  /** The type of the error. */
  type: 'error';
  /** The error details. */
  error: {
    type: 'authentication_error';
    message: string;
  };
};

/**
 * Represents the start of a message with an empty content array.
 */
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

/**
 * Indicates the start of a content block within a message.
 */
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
        type: 'thinking';
        thinking: string;
      };
}

/**
 * Represents incremental updates to a content block.
 */
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

/**
 * Marks the end of a content block within a message.
 */
export interface AxAIAnthropicContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

/**
 * Indicates top-level changes to the final message object.
 */
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

/**
 * Marks the end of a message.
 */
export interface AxAIAnthropicMessageStopEvent {
  type: 'message_stop';
}

/**
 * Represents a ping event, which can occur any number of times.
 */
export interface AxAIAnthropicPingEvent {
  type: 'ping';
}

/**
 * Represents an error event.
 */
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
