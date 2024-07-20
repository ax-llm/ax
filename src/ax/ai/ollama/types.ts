import type { AxModelConfig } from '../types.js';

export enum AxAIOllamaModel {
  Codellama = 'codellama',
  Llama2 = 'llama2',
  MiniLM = 'all-MiniLM',
  Llama2_7B = 'llama2-7B',
  Llama2_13B = 'llama2-13B'
}

export enum AxAIOllamaEmbedModel {
  Codellama = 'codellama',
  Llama2 = 'llama2',
  MiniLM = 'all-MiniLM',
  Llama2_7B = 'llama2-7B',
  Llama2_13B = 'llama2-13B'
}

export interface AxAIOllamaConfig extends AxModelConfig {
  model: AxAIOllamaModel | string;
  embedModel: AxAIOllamaEmbedModel | string;
}

export interface AxAIOllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'system' | 'assistant' | 'function';
    content: string;
    name?: string;
  }>;
  stream: boolean;
  options: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
}

export interface AxAIOllamaChatResponse {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  done_reason?:
    | 'stop'
    | 'length'
    | 'function_call'
    | 'content_filter'
    | 'error';
}

export interface AxAIOllamaChatError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export interface AxAIOllamaMessageStartEvent {
  type: 'message_start';
  message: AxAIOllamaChatResponse;
}

export interface AxAIOllamaContentBlockStartEvent {
  type: 'content_block_start';
  content_block: {
    type: 'text';
    text: string;
  };
}

export interface AxAIOllamaContentBlockDeltaEvent {
  type: 'content_block_delta';
  delta: {
    type: 'text_delta';
    text: string;
  };
}

export interface AxAIOllamaMessageDeltaEvent {
  type: 'message_delta';
  delta: Partial<AxAIOllamaChatResponse>;
}

export type AxAIOllamaChatResponseDelta =
  | AxAIOllamaMessageStartEvent
  | AxAIOllamaContentBlockStartEvent
  | AxAIOllamaContentBlockDeltaEvent
  | AxAIOllamaMessageDeltaEvent
  | AxAIOllamaMessageStopEvent
  | AxAIOllamaContentBlockStopEvent
  | AxAIOllamaPingEvent
  | AxAIOllamaChatError;

export interface AxAIOllamaEmbedRequest {
  model: string;
  prompt: string | readonly string[];
}

export interface AxAIOllamaEmbedResponse {
  embedding: number[];
  token_count: number;
}

export interface AxAIOllamaMessageStopEvent {
  type: 'message_stop';
}

export interface AxAIOllamaContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface AxAIOllamaPingEvent {
  type: 'ping';
}
