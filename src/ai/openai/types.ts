import { JSONSchemaType } from 'ajv/dist/types/json-schema';

import { TextModelConfig } from '../types';

// Transcribe = '/v1/audio/transcriptions',

/**
 * OpenAI: Models for text generation
 * @export
 */
export enum OpenAIModel {
  GPT4 = 'gpt-4',
  GPT432K = 'gpt-4-32k',
  GPT35Turbo = 'gpt-3.5-turbo',
  GPT35TurboInstruct = 'gpt-3.5-turbo-instruct',
  GPT35Turbo16K = 'gpt-3.5-turbo-16k',
  GPT35TextDavinci003 = 'text-davinci-003',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT35CodeDavinci002 = 'code-davinci-002',
  GPT3TextCurie001 = 'text-curie-001',
  GPT3TextBabbage001 = 'text-babbage-001',
  GPT3TextAda001 = 'text-ada-001'
}

/**
 * OpenAI: Models for use in embeddings
 * @export
 */
export enum OpenAIEmbedModels {
  GPT3TextEmbeddingAda002 = 'text-embedding-ada-002'
}

/**
 * OpenAI: Models for for audio transcription
 * @export
 */
export enum OpenAIAudioModel {
  Whisper1 = 'whisper-1'
}

/**
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIOptions = Omit<TextModelConfig, 'topK'> & {
  model: OpenAIModel;
  embedModel: OpenAIEmbedModels;
  audioModel?: OpenAIAudioModel;
  user?: string;
};

export type OpenAICompletionRequest = {
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  n?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  best_of?: number;
  logit_bias?: Map<string, number>;
  user?: string;
  organization?: string;
};

export type OpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export interface OpenAIResponseDelta<T> {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: T;
    finish_reason: string;
  }[];
  usage?: OpenAIUsage;
}

export type OpenAICompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    text: string;
    finish_reason: string;
    logprobs?: OpenAILogprob;
  }[];
  usage?: OpenAIUsage;
};

export type OpenAICompletionResponseDelta = OpenAIResponseDelta<{
  text: string;
  logprobs?: OpenAILogprob;
}>;

export type OpenAIChatRequest = {
  model: string;
  messages: {
    role: string;
    content: string;
    name?: string;
    // eslint-disable-next-line functional/functional-parameters
    function_call?: { name: string; arguments: string };
  }[];
  functions?: {
    name: string;
    description?: string;
    parameters: JSONSchemaType<unknown>;
  }[];
  function_call?: 'none' | 'auto' | { name: string };
  max_tokens: number;
  temperature: number;
  top_p: number;
  n?: number;
  stream?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Map<string, number>;
  user?: string;
  organization?: string;
};

export type OpenAIChatResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
      // eslint-disable-next-line functional/functional-parameters
      function_call?: { name: string; arguments: string };
    };
    finish_reason: string;
  }[];
  usage?: OpenAIUsage;
};

export type OpenAIChatResponseDelta = OpenAIResponseDelta<{
  content: string;
  role?: string;
  // eslint-disable-next-line functional/functional-parameters
  function_call?: { name: string; arguments: string };
}>;

export type OpenAIEmbedRequest = {
  input: readonly string[];
  model: string;
  user?: string;
};

export type OpenAIEmbedResponse = {
  model: string;
  data: {
    embedding: readonly number[];
    index: number;
  }[];
  usage: OpenAIUsage;
};

export type OpenAIAudioRequest = {
  model: string;
  prompt?: string;
  response_format: 'verbose_json';
  temperature?: number;
  language?: string;
};

export type OpenAIAudioResponse = {
  duration: number;
  segments: {
    id: number;
    start: number;
    end: number;
    text: string;
  }[];
};
