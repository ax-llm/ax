import type { AxModelConfig } from '../types.js';

/**
 * Defines the available OpenAI models.
 */
export enum AxAIOpenAIModel {
  // Non-reasoning models
  GPT4 = 'gpt-4',
  GPT41 = 'gpt-4.1',
  GPT41Mini = 'gpt-4.1-mini',
  GPT4O = 'gpt-4o',
  GPT4OMini = 'gpt-4o-mini',
  GPT4ChatGPT4O = 'chatgpt-4o-latest',
  GPT4Turbo = 'gpt-4-turbo',
  GPT35Turbo = 'gpt-3.5-turbo',
  GPT35TurboInstruct = 'gpt-3.5-turbo-instruct',
  GPT35TextDavinci002 = 'text-davinci-002',
  GPT3TextBabbage002 = 'text-babbage-002',
  GPT3TextAda001 = 'text-ada-001',
  // Reasoning models
  O1 = 'o1',
  O1Mini = 'o1-mini',
  O3 = 'o3',
  O3Mini = 'o3-mini',
  O4Mini = 'o4-mini',
}

/**
 * Defines the available OpenAI embedding models.
 */
export enum AxAIOpenAIEmbedModel {
  TextEmbeddingAda002 = 'text-embedding-ada-002',
  TextEmbedding3Small = 'text-embedding-3-small',
  TextEmbedding3Large = 'text-embedding-3-large',
}

/**
 * Represents a URL citation from a web search.
 */
export type AxAIOpenAIUrlCitation = {
  /** The URL of the citation. */
  url: string;
  /** The title of the citation. */
  title?: string;
  /** The description of the citation. */
  description?: string;
};

/**
 * Represents an annotation in the response.
 */
export type AxAIOpenAIAnnotation = {
  /** The type of the annotation. */
  type: 'url_citation';
  /** The URL citation. */
  url_citation: AxAIOpenAIUrlCitation;
};

/**
 * Represents the configuration for the OpenAI AI service.
 *
 * @template TModel - The type of the chat model.
 * @template TEmbedModel - The type of the embedding model.
 */
export type AxAIOpenAIConfig<TModel, TEmbedModel> = Omit<
  AxModelConfig,
  'topK'
> & {
  /** The model to use. */
  model: TModel;
  /** The embedding model to use. */
  embedModel?: TEmbedModel;
  /** A unique identifier for the end-user. */
  user?: string;
  /** The format of the response. */
  responseFormat?: 'json_object';
  /** The number of best-of completions to generate. */
  bestOf?: number;
  /** A map of tokens to their bias values. */
  logitBias?: Map<string, number>;
  /** A suffix to append to the prompt. */
  suffix?: string | null;
  /** An array of stop sequences. */
  stop?: string[];
  /** The number of log probabilities to return. */
  logprobs?: number;
  /** Whether to echo the prompt in the response. */
  echo?: boolean;
  /** The dimensions of the embedding. */
  dimensions?: number;
  /** The reasoning effort to use. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Whether to store the conversation. */
  store?: boolean;
  /** The service tier to use. */
  serviceTier?: 'auto' | 'default' | 'flex';
  /** The options for web search. */
  webSearchOptions?: {
    searchContextSize?: 'low' | 'medium' | 'high';
    userLocation?: {
      approximate: {
        type: 'approximate';
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    } | null;
  };
};

/**
 * Represents the log probabilities of tokens in a response.
 */
export type AxAIOpenAILogprob = {
  /** The tokens. */
  tokens: string[];
  /** The log probabilities of the tokens. */
  token_logprobs: number[];
  /** The top log probabilities of the tokens. */
  top_logprobs: Map<string, number>;
  /** The text offset of the tokens. */
  text_offset: number[];
};

/**
 * Represents the token usage of a request.
 */
export type AxAIOpenAIUsage = {
  /** The number of prompt tokens. */
  prompt_tokens: number;
  /** The number of completion tokens. */
  completion_tokens: number;
  /** The total number of tokens. */
  total_tokens: number;
};

/**
 * Represents a delta in a streaming response from the OpenAI AI service.
 *
 * @template T - The type of the delta.
 */
export interface AxAIOpenAIResponseDelta<T> {
  /** The ID of the response. */
  id: string;
  /** The object type. */
  object: string;
  /** The timestamp of the response. */
  created: number;
  /** The model used for the response. */
  model: string;
  /** The choices in the response. */
  choices: {
    index: number;
    delta: T;
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }[];
  /** The token usage of the response. */
  usage?: AxAIOpenAIUsage;
  /** The system fingerprint. */
  system_fingerprint: string;
}

/**
 * Represents a chat request to the OpenAI AI service.
 *
 * @template TModel - The type of the model to use.
 */
export type AxAIOpenAIChatRequest<TModel> = {
  /** The model to use. */
  model: TModel;
  /** The reasoning effort to use. */
  reasoning_effort?: 'low' | 'medium' | 'high';
  /** Whether to store the conversation. */
  store?: boolean;
  /** The messages in the chat. */
  messages: (
    | { role: 'system'; content: string }
    | {
        role: 'user';
        content:
          | string
          | (
              | {
                  type: string;
                  text: string;
                }
              | {
                  type: 'image_url';
                  image_url: { url: string; details?: 'high' | 'low' | 'auto' };
                }
              | {
                  type: 'input_audio';
                  input_audio: { data: string; format?: 'wav' };
                }
              | {
                  type: 'file';
                  file: {
                    file_data: string;
                    filename: string;
                  };
                }
            )[];
        name?: string;
      }
    | {
        role: 'assistant';
        content:
          | string
          | {
              type: string;
              text: string;
            };
        name?: string;
      }
    | {
        role: 'assistant';
        content?:
          | string
          | {
              type: string;
              text: string;
            };
        name?: string;
        tool_calls: {
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
  /** The tools that the AI can use. */
  tools?: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters?: object;
    };
  }[];
  /** The tool choice behavior. */
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  /** The format of the response. */
  response_format?: { type: string };
  /** The maximum number of completion tokens. */
  max_completion_tokens?: number;
  /** The temperature of the sampling. */
  temperature?: number;
  /** The top-p value of the sampling. */
  top_p?: number;
  /** The number of completions to generate. */
  n?: number;
  /** Whether to stream the response. */
  stream?: boolean;
  /** An array of stop sequences. */
  stop?: readonly string[];
  /** The presence penalty. */
  presence_penalty?: number;
  /** The frequency penalty. */
  frequency_penalty?: number;
  /** A map of tokens to their bias values. */
  logit_bias?: Map<string, number>;
  /** A unique identifier for the end-user. */
  user?: string;
  /** The organization to use. */
  organization?: string;
  /** The options for web search. */
  web_search_options?: {
    search_context_size?: 'low' | 'medium' | 'high';
    user_location?: {
      approximate: {
        type: 'approximate';
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    } | null;
  };
};

/**
 * Represents a chat response from the OpenAI AI service.
 */
export type AxAIOpenAIChatResponse = {
  /** The ID of the response. */
  id: string;
  /** The object type. */
  object: 'chat.completion';
  /** The timestamp of the response. */
  created: number;
  /** The model used for the response. */
  model: string;
  /** The choices in the response. */
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      refusal: string | null;
      reasoning_content?: string;
      annotations?: AxAIOpenAIAnnotation[];
      tool_calls?: {
        id: string;
        type: 'function';
        // eslint-disable-next-line functional/functional-parameters
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  }[];
  /** The token usage of the response. */
  usage?: AxAIOpenAIUsage;
  /** The error in the response. */
  error?: {
    message: string;
    type: string;
    param: string;
    code: number;
  };
  /** The system fingerprint. */
  system_fingerprint: string;
};

/**
 * Represents a delta in a streaming chat response from the OpenAI AI service.
 */
export type AxAIOpenAIChatResponseDelta = AxAIOpenAIResponseDelta<{
  content: string | null;
  refusal?: string | null;
  reasoning_content?: string;
  role?: string;
  annotations?: AxAIOpenAIAnnotation[];
  tool_calls?: (NonNullable<
    AxAIOpenAIChatResponse['choices'][0]['message']['tool_calls']
  >[0] & {
    index: number;
  })[];
}>;

/**
 * Represents an embedding request to the OpenAI AI service.
 *
 * @template TEmbedModel - The type of the embedding model to use.
 */
export type AxAIOpenAIEmbedRequest<TEmbedModel> = {
  /** The texts to embed. */
  input: readonly string[];
  /** The embedding model to use. */
  model: TEmbedModel;
  /** The dimensions of the embedding. */
  dimensions?: number;
  /** A unique identifier for the end-user. */
  user?: string;
};

/**
 * Represents an embedding response from the OpenAI AI service.
 */
export type AxAIOpenAIEmbedResponse = {
  /** The model used for the response. */
  model: string;
  /** The embeddings. */
  data: {
    embedding: readonly number[];
    index: number;
  }[];
  /** The token usage of the response. */
  usage: AxAIOpenAIUsage;
};
