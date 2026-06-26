import type { AxModelConfig } from '../types.js';

/**
 * WebLLM: Models for text generation
 * Based on WebLLM's supported models
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

export type AxAIWebLLMModelId = AxAIWebLLMModel | (string & {});

export interface AxAIWebLLMEngine {
  chat: {
    completions: {
      create: (
        request: Readonly<AxAIWebLLMChatRequest>
      ) => Promise<
        | AxAIWebLLMChatResponse
        | AsyncIterable<AxAIWebLLMChatResponseDelta>
        | ReadableStream<AxAIWebLLMChatResponseDelta>
      >;
    };
  };
}

/**
 * WebLLM: Model options for text generation
 */
export type AxAIWebLLMConfig = AxModelConfig & {
  model: AxAIWebLLMModelId;
  supportsFunctions?: boolean;
  logitBias?: Record<number, number>;
  logProbs?: boolean;
  topLogprobs?: number;
};

/**
 * WebLLM: Chat request structure
 * Based on OpenAI-compatible API from WebLLM
 */
export type AxAIWebLLMChatRequest = {
  model: AxAIWebLLMModelId;
  messages: Array<
    | {
        role: 'system' | 'user';
        content?: string;
        name?: string;
      }
    | {
        role: 'assistant';
        content?: string;
        name?: string;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: {
            name: string;
            arguments: string;
          };
        }>;
      }
    | {
        role: 'tool';
        content: string;
        tool_call_id: string;
      }
  >;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<number, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  response_format?:
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema?: unknown };
  n?: number;
  stream_options?: {
    include_usage?: boolean;
  };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  }>;
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
};

/**
 * WebLLM: Chat response structure
 */
export type AxAIWebLLMChatResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: AxAIWebLLMModelId;
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
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * WebLLM: Streaming chat response structure
 */
export type AxAIWebLLMChatResponseDelta = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: AxAIWebLLMModelId;
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
