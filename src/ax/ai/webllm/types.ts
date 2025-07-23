import type { AxModelConfig } from '../types.js';

/**
 * WebLLM: Models for text generation
 * Based on WebLLM's supported models
 */
/**
 * Defines the available WebLLM models.
 */
export enum AxAIWebLLMModel {
  // Llama 3.1 series
  Llama31_8B_Instruct = 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  Llama31_70B_Instruct = 'Llama-3.1-70B-Instruct-q4f16_1-MLC',

  // Llama 3.2 series
  Llama32_1B_Instruct = 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
  Llama32_3B_Instruct = 'Llama-3.2-3B-Instruct-q4f32_1-MLC',

  // Mistral series
  Mistral7B_Instruct = 'Mistral-7B-Instruct-v0.3-q4f32_1-MLC',

  // Phi series
  Phi35_Mini_Instruct = 'Phi-3.5-mini-instruct-q4f32_1-MLC',

  // Gemma series
  Gemma2_2B_Instruct = 'gemma-2-2b-it-q4f32_1-MLC',
  Gemma2_9B_Instruct = 'gemma-2-9b-it-q4f32_1-MLC',

  // Qwen series
  Qwen2_5_0_5B_Instruct = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
  Qwen2_5_1_5B_Instruct = 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  Qwen2_5_3B_Instruct = 'Qwen2.5-3B-Instruct-q4f32_1-MLC',
  Qwen2_5_7B_Instruct = 'Qwen2.5-7B-Instruct-q4f32_1-MLC',
}

/**
 * WebLLM: Model options for text generation
 */
/**
 * Represents the configuration for the WebLLM AI service.
 */
export type AxAIWebLLMConfig = AxModelConfig & {
  /** The model to use. */
  model: AxAIWebLLMModel;
  /** A map of tokens to their bias values. */
  logitBias?: Record<number, number>;
  /** Whether to return log probabilities. */
  logProbs?: boolean;
  /** The number of top log probabilities to return. */
  topLogprobs?: number;
};

/**
 * WebLLM: Chat request structure
 * Based on OpenAI-compatible API from WebLLM
 */
/**
 * Represents a chat request to the WebLLM AI service.
 */
export type AxAIWebLLMChatRequest = {
  /** The model to use. */
  model: AxAIWebLLMModel;
  /** The messages in the chat. */
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'function';
    content?: string;
    name?: string;
    function_call?: {
      name: string;
      arguments: string;
    };
  }>;
  /** The temperature of the sampling. */
  temperature?: number;
  /** The top-p value of the sampling. */
  top_p?: number;
  /** The maximum number of tokens to generate. */
  max_tokens?: number;
  /** Whether to stream the response. */
  stream?: boolean;
  /** A stop sequence or an array of stop sequences. */
  stop?: string | string[];
  /** The presence penalty. */
  presence_penalty?: number;
  /** The frequency penalty. */
  frequency_penalty?: number;
  /** A map of tokens to their bias values. */
  logit_bias?: Record<number, number>;
  /** Whether to return log probabilities. */
  logprobs?: boolean;
  /** The number of top log probabilities to return. */
  top_logprobs?: number;
  /** The number of completions to generate. */
  n?: number;
  /** The tools that the AI can use. */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  }>;
  /** The tool choice behavior. */
  tool_choice?:
    | 'none'
    | 'auto'
    | { type: 'function'; function: { name: string } };
};

/**
 * Represents a chat response from the WebLLM AI service.
 */
export type AxAIWebLLMChatResponse = {
  /** The ID of the response. */
  id: string;
  /** The object type. */
  object: 'chat.completion';
  /** The timestamp of the response. */
  created: number;
  /** The model used for the response. */
  model: AxAIWebLLMModel;
  /** The choices in the response. */
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    logprobs?: {
      content: Array<{
        token: string;
        logprob: number;
        bytes: number[];
        top_logprobs: Array<{
          token: string;
          logprob: number;
          bytes: number[];
        }>;
      }>;
    };
  }>;
  /** The token usage of the response. */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * Represents a delta in a streaming chat response from the WebLLM AI service.
 */
export type AxAIWebLLMChatResponseDelta = {
  /** The ID of the response. */
  id: string;
  /** The object type. */
  object: 'chat.completion.chunk';
  /** The timestamp of the response. */
  created: number;
  /** The model used for the response. */
  model: AxAIWebLLMModel;
  /** The choices in the response. */
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
    logprobs?: {
      content: Array<{
        token: string;
        logprob: number;
        bytes: number[];
        top_logprobs: Array<{
          token: string;
          logprob: number;
          bytes: number[];
        }>;
      }>;
    };
  }>;
  /** The token usage of the response. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * WebLLM doesn't support embeddings natively
 * This is a placeholder for consistency with the framework
 */
export type AxAIWebLLMEmbedModel = never;
export type AxAIWebLLMEmbedRequest = never;
export type AxAIWebLLMEmbedResponse = never;
