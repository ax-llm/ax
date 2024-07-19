import type { AxModelConfig } from '../types';

export enum AxAIOllamaModel {
  Codellama = "codellama",
  Llama2 = "llama2"
}

export enum AxAIOllamaEmbedModel {
  Codellama = "codellama",
  Llama2 = "llama2"
}

export type AxAIOllamaConfig = AxModelConfig & {
  model: AxAIOllamaModel | string;
  embedModel: AxAIOllamaEmbedModel | string;
};

export type AxAIOllamaChatRequest = {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  options: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
  };
};

export type AxAIOllamaChatResponse = {
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
  done_reason?: string;
};

export type AxAIOllamaChatResponseDelta = AxAIOllamaChatResponse;

export type AxAIOllamaEmbedRequest = {
  model: string;
  prompt: string;
};

export type AxAIOllamaEmbedResponse = {
  embedding: number[];
  token_count: number;
};
