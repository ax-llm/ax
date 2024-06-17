import type { AxModelConfig } from '../types.js';

export enum AxOpenAIModel {
  GPT4 = 'gpt-4',
  GPT4O = 'gpt-4o',
  GPT4Turbo = 'gpt-4-turbo',
  GPT35Turbo = 'gpt-3.5-turbo',
  GPT35TurboInstruct = 'gpt-3.5-turbo-instruct',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT3TextBabbage002 = 'text-babbage-002',
  GPT3TextAda001 = 'text-ada-001'
}

export enum AxOpenAIEmbedModels {
  TextEmbeddingAda002 = 'text-embedding-ada-002',
  TextEmbedding3Small = 'text-embedding-3-small',
  TextEmbedding3Large = 'text-embedding-3-large'
}

export type AxOpenAIConfig = Omit<AxModelConfig, 'topK'> & {
  model: AxOpenAIModel | string;
  embedModel?: AxOpenAIEmbedModels | string;
  user?: string;
  responseFormat?: 'json_object';
  bestOf?: number;
  logitBias?: Map<string, number>;
  suffix?: string | null;
  stop?: string[];
  logprobs?: number;
  echo?: boolean;
};

export type AxOpenAILogprob = {
  tokens: string[];
  token_logprobs: number[];
  top_logprobs: Map<string, number>;
  text_offset: number[];
};

export type AxOpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export interface AxOpenAIResponseDelta<T> {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: T;
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }[];
  usage?: AxOpenAIUsage;
  system_fingerprint: string;
}

export type AxOpenAIChatRequest = {
  model: string;
  messages: (
    | { role: 'system'; content: string }
    | {
        role: 'user';
        content:
          | string
          | {
              type: 'image_url' | 'text';
              text?: string;
              image_url?: { url: string; details?: 'high' | 'low' | 'auto' };
            };
        name?: string;
      }
    | {
        role: 'assistant';
        content: string | null;
        name?: string;
        tool_calls?: {
          type: 'function';
          function: {
            name: string;
            // eslint-disable-next-line functional/functional-parameters
            arguments?: string;
          };
        }[];
      }
    | { role: 'tool'; content: string; tool_call_id: string }
  )[];
  tools?: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters?: object;
    };
  }[];
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  response_format?: { type: string };
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: readonly string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Map<string, number>;
  user?: string;
  organization?: string;
};

export type AxOpenAIChatResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: {
        id: string;
        type: 'function';
        // eslint-disable-next-line functional/functional-parameters
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }[];
  usage?: AxOpenAIUsage;
  error?: {
    message: string;
    type: string;
    param: string;
    code: number;
  };
  system_fingerprint: string;
};

export type AxOpenAIChatResponseDelta = AxOpenAIResponseDelta<{
  content: string;
  role?: string;
  tool_calls?: (NonNullable<
    AxOpenAIChatResponse['choices'][0]['message']['tool_calls']
  >[0] & {
    index: number;
  })[];
}>;

export type AxOpenAIEmbedRequest = {
  input: readonly string[];
  model: string;
  user?: string;
};

export type AxOpenAIEmbedResponse = {
  model: string;
  data: {
    embedding: readonly number[];
    index: number;
  }[];
  usage: AxOpenAIUsage;
};
