import { JSONSchemaType } from 'ajv/dist/types/json-schema';

import { API } from '../../util/apicall';
import { GenerateTextModelConfig } from '../types';

/**
 * OpenAI: API call details
 * @export
 */
export type OpenAIApiConfig = API & {
  headers: { 'OpenAI-Organization'?: string };
};

export const apiURLOpenAI = 'https://api.openai.com/';

/**
 * OpenAI: API
 * @export
 */

export const enum OpenAIApi {
  Generate = '/v1/completions',
  ChatGenerate = '/v1/chat/completions',
  Embed = '/v1/embeddings',
  Transcribe = '/v1/audio/transcriptions',
}

/**
 * OpenAI: Models for text generation
 * @export
 */
export enum OpenAIGenerateModel {
  GPT4 = 'gpt-4',
  GPT432K = 'gpt-4-32k',
  GPT35Turbo = 'gpt-3.5-turbo',
  GPT35Turbo16K = 'gpt-3.5-turbo-16k',
  GPT35TextDavinci003 = 'text-davinci-003',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT35CodeDavinci002 = 'code-davinci-002',
  GPT3TextCurie001 = 'text-curie-001',
  GPT3TextBabbage001 = 'text-babbage-001',
  GPT3TextAda001 = 'text-ada-001',
}

/**
 * OpenAI: Models for use in embeddings
 * @export
 */
export enum OpenAIEmbedModels {
  GPT3TextEmbeddingAda002 = 'text-embedding-ada-002',
}

/**
 * OpenAI: Models for for audio transcription
 * @export
 */
export enum OpenAIAudioModel {
  Whisper1 = 'whisper-1',
}

/**
 * OpenAI: Model options for text generation
 * @export
 */
export type OpenAIOptions = Omit<GenerateTextModelConfig, 'topK'> & {
  model: OpenAIGenerateModel;
  embedModel: OpenAIEmbedModels;
  audioModel?: OpenAIAudioModel;
  user?: string;
};

export type OpenAIGenerateRequest = {
  model: string;
  prompt: string;
  suffix: string | null;
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

export type OpenAIGenerateTextResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    text: string;
    index: number;
    finish_reason: 'stop' | 'length' | 'function_call';
    log_probs: OpenAILogprob;
  }[];
  usage: OpenAIUsage;
};

export type OpenAIChatGenerateRequest = {
  model: string;
  messages: {
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
    // eslint-disable-next-line functional/functional-parameters
    function_call?: { name: string; arguments: string }[];
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

export type OpenAIChatGenerateResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: OpenAIUsage;
};

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
