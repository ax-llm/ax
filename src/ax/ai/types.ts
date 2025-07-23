// ReadableStream is available globally in modern browsers and Node.js 16+

import type { Context, Meter, Tracer } from '@opentelemetry/api';
import type { AxAPI } from '../util/apicall.js';
import type { AxAIFeatures } from './base.js';

export type AxAIInputModelList<TModel, TEmbedModel, TModelKey> =
  (AxAIModelListBase<TModelKey> & {
    isInternal?: boolean;
  } & ({ model: TModel } | { embedModel: TEmbedModel }))[];

export type AxAIModelListBase<TModelKey> = {
  key: TModelKey;
  description: string;
};

export type AxAIModelList<TModelKey> = (AxAIModelListBase<TModelKey> &
  ({ model: string } | { embedModel: string }))[];

export type AxModelInfo = {
  name: string;
  currency?: string;
  characterIsToken?: boolean;
  promptTokenCostPer1M?: number;
  completionTokenCostPer1M?: number;
  aliases?: string[];
  hasThinkingBudget?: boolean;
  hasShowThoughts?: boolean;
  maxTokens?: number;
  isExpensive?: boolean;
  contextWindow?: number;
};

export type AxTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thoughtsTokens?: number;
};

export type AxModelConfig = {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  endSequences?: string[];
  stream?: boolean;
  n?: number;
};

export type AxFunctionHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any,
  extra?: Readonly<{
    sessionId?: string;
    traceId?: string;
    debug?: boolean;
    ai?: AxAIService;
  }>
) => unknown;

export type AxFunctionJSONSchema = {
  type: string;
  properties?: Record<
    string,
    AxFunctionJSONSchema & {
      enum?: string[];
      description: string;
    }
  >;
  required?: string[];
  items?: AxFunctionJSONSchema;
};

export type AxFunction = {
  name: string;
  description: string;
  parameters?: AxFunctionJSONSchema;
  func: AxFunctionHandler;
};

export type AxFunctionResult = Extract<
  AxChatRequest['chatPrompt'][number],
  { role: 'function' }
> & { index: number };

export type AxChatResponseResult = {
  index: number;
  content?: string;
  thought?: string;
  name?: string;
  id?: string;
  functionCalls?: {
    id: string;
    type: 'function';
    function: { name: string; params?: string | object };
  }[];
  annotations?: {
    type: 'url_citation';
    url_citation: {
      url: string;
      title?: string;
      description?: string;
    };
  }[];
  finishReason?:
    | 'stop'
    | 'length'
    | 'function_call'
    | 'content_filter'
    | 'error';
};

export type AxModelUsage = {
  ai: string;
  model: string;
  tokens?: AxTokenUsage;
};

/**
 * Represents a chat response from an AI service.
 */
export type AxChatResponse = {
  /** The session ID of the chat. */
  sessionId?: string;
  /** The remote ID of the chat. */
  remoteId?: string;
  /** The results of the chat response. */
  results: readonly AxChatResponseResult[];
  /** The model usage for the chat response. */
  modelUsage?: AxModelUsage;
};

/**
 * Represents an embedding response from an AI service.
 */
export type AxEmbedResponse = {
  /** The remote ID of the embedding. */
  remoteId?: string;
  /** The session ID of the embedding. */
  sessionId?: string;
  /** The embeddings. */
  embeddings: readonly (readonly number[])[];
  /** The model usage for the embedding response. */
  modelUsage?: AxModelUsage;
};

export type AxModelInfoWithProvider = AxModelInfo & { provider: string };

/**
 * Represents a chat request to an AI service.
 *
 * @template TModel - The type of the model to use for the chat request.
 */
export type AxChatRequest<TModel = string> = {
  /** The chat prompt, consisting of a series of messages. */
  chatPrompt: (
    | { role: 'system'; content: string; cache?: boolean }
    | {
        role: 'user';
        name?: string;
        content:
          | string
          | (
              | {
                  type: 'text';
                  text: string;
                  cache?: boolean;
                }
              | {
                  type: 'image';
                  mimeType: string;
                  image: string;
                  details?: 'high' | 'low' | 'auto';
                  cache?: boolean;
                }
              | {
                  type: 'audio';
                  data: string;
                  format?: 'wav';
                  cache?: boolean;
                }
            )[];
      }
    | {
        role: 'assistant';
        content?: string;
        name?: string;
        functionCalls?: {
          id: string;
          type: 'function';
          function: { name: string; params?: string | object };
        }[];
        cache?: boolean;
      }
    | {
        role: 'function';
        result: string;
        isError?: boolean;
        functionId: string;
        cache?: boolean;
      }
  )[];
  /** The functions that the AI can call. */
  functions?: Readonly<{
    name: string;
    description: string;
    parameters?: AxFunctionJSONSchema;
  }>[];
  /** The function call behavior. */
  functionCall?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  /** The model configuration. */
  modelConfig?: AxModelConfig;
  /** The model to use for the chat request. */
  model?: TModel;
};

export interface AxAIServiceMetrics {
  latency: {
    chat: {
      mean: number;
      p95: number;
      p99: number;
      samples: number[];
    };
    embed: {
      mean: number;
      p95: number;
      p99: number;
      samples: number[];
    };
  };
  errors: {
    chat: {
      count: number;
      rate: number;
      total: number;
    };
    embed: {
      count: number;
      rate: number;
      total: number;
    };
  };
}

export type AxInternalChatRequest<TModel> = Omit<AxChatRequest, 'model'> &
  Required<Pick<AxChatRequest<TModel>, 'model'>>;

/**
 * Represents an embedding request to an AI service.
 *
 * @template TEmbedModel - The type of the embedding model to use.
 */
export type AxEmbedRequest<TEmbedModel = string> = {
  /** The texts to embed. */
  texts?: readonly string[];
  /** The embedding model to use. */
  embedModel?: TEmbedModel;
};

export type AxInternalEmbedRequest<TEmbedModel> = Omit<
  AxEmbedRequest,
  'embedModel'
> &
  Required<Pick<AxEmbedRequest<TEmbedModel>, 'embedModel'>>;

export type AxRateLimiterFunction = <T = unknown>(
  reqFunc: () => Promise<T | ReadableStream<T>>,
  info: Readonly<{ modelUsage?: AxModelUsage }>
) => Promise<T | ReadableStream<T>>;

// Typed logging objects for structured logging
export type AxLoggerData =
  | {
      name: 'ChatRequestChatPrompt';
      step: number;
      value: AxChatRequest['chatPrompt'];
    }
  | {
      name: 'FunctionResults';
      value: AxFunctionResult[];
    }
  | {
      name: 'ChatResponseResults';
      value: AxChatResponseResult[];
    }
  | {
      name: 'ChatResponseStreamingResult';
      index: number;
      value: AxChatResponseResult & { delta?: string };
    }
  | {
      name: 'ChatResponseStreamingDoneResult';
      index: number;
      value: AxChatResponseResult;
    }
  | {
      name: 'FunctionError';
      index: number;
      fixingInstructions: string;
      error: unknown;
    }
  | {
      name: 'ValidationError';
      index: number;
      fixingInstructions: string;
      error: unknown; // Using unknown since ValidationError is defined in dsp/errors.ts
    }
  | {
      name: 'AssertionError';
      index: number;
      fixingInstructions: string;
      error: unknown; // Using unknown since AxAssertionError is defined in dsp/asserts.ts
    }
  | {
      name: 'RefusalError';
      index: number;
      error: unknown; // Using unknown since AxAIRefusalError is defined in util/apicall.ts
    }
  | {
      name: 'ResultPickerUsed';
      sampleCount: number;
      selectedIndex: number;
      latency: number;
    }
  | {
      name: 'Notification';
      id: string;
      value: string;
    }
  | {
      name: 'EmbedRequest';
      embedModel: string;
      value: readonly string[];
    }
  | {
      name: 'EmbedResponse';
      totalEmbeddings: number;
      value: {
        length: number;
        sample: number[];
        truncated: boolean;
      }[];
    };

export type AxLoggerFunction = (message: AxLoggerData) => void;

/**
 * Represents the options for an AI service.
 */
export type AxAIServiceOptions = {
  /** Whether to enable debug mode. */
  debug?: boolean;
  /** A rate limiter function to use. */
  rateLimiter?: AxRateLimiterFunction;
  /** The fetch function to use. */
  fetch?: typeof fetch;
  /** The tracer to use for OpenTelemetry. */
  tracer?: Tracer;
  /** The meter to use for OpenTelemetry. */
  meter?: Meter;
  /** The timeout in milliseconds. */
  timeout?: number;
  /** Whether to exclude content from the trace. */
  excludeContentFromTrace?: boolean;
  /** An abort signal to cancel the request. */
  abortSignal?: AbortSignal;
  /** A logger function to use. */
  logger?: AxLoggerFunction;
  /** The session ID. */
  sessionId?: string;
  /** Whether to hide the system prompt in debug logs. */
  debugHideSystemPrompt?: boolean;
  /** The trace context for OpenTelemetry. */
  traceContext?: Context;
  /** Whether to stream the response. */
  stream?: boolean;
  /** The token budget for thinking. */
  thinkingTokenBudget?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'highest'
    | 'none';
  /** Whether to show thoughts in the response. */
  showThoughts?: boolean;
  /** Whether to use an expensive model. */
  useExpensiveModel?: 'yes';
  /** The step index for multi-step programs. */
  stepIndex?: number;
  /** The CORS proxy URL for browser environments. */
  corsProxy?: string;
};

/**
 * Represents an AI service.
 *
 * @template TModel - The type of the chat model.
 * @template TEmbedModel - The type of the embedding model.
 * @template TModelKey - The type of the model key.
 */
export interface AxAIService<
  TModel = unknown,
  TEmbedModel = unknown,
  TModelKey = string,
> {
  /** Gets the ID of the AI service instance. */
  getId(): string;
  /** Gets the name of the AI service. */
  getName(): string;
  /** Gets the features of the AI service. */
  getFeatures(model?: TModel): AxAIFeatures;
  /** Gets the list of available models. */
  getModelList(): AxAIModelList<TModelKey> | undefined;
  /** Gets the metrics for the AI service. */
  getMetrics(): AxAIServiceMetrics;
  /** Gets the logger for the AI service. */
  getLogger(): AxLoggerFunction;

  /** Gets the last used chat model. */
  getLastUsedChatModel(): TModel | undefined;
  /** Gets the last used embedding model. */
  getLastUsedEmbedModel(): TEmbedModel | undefined;
  /** Gets the last used model configuration. */
  getLastUsedModelConfig(): AxModelConfig | undefined;

  /**
   * Performs a chat request.
   * @param {Readonly<AxChatRequest<TModel | TModelKey>>} req - The chat request.
   * @param {Readonly<AxAIServiceOptions>} [options] - The options for the request.
   * @returns {Promise<AxChatResponse | ReadableStream<AxChatResponse>>} The chat response or a stream of chat responses.
   */
  chat(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>>;
  /**
   * Performs an embedding request.
   * @param {Readonly<AxEmbedRequest<TEmbedModel | TModelKey>>} req - The embedding request.
   * @param {Readonly<AxAIServiceOptions>} [options] - The options for the request.
   * @returns {Promise<AxEmbedResponse>} The embedding response.
   */
  embed(
    req: Readonly<AxEmbedRequest<TEmbedModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse>;

  /**
   * Sets the options for the AI service.
   * @param {Readonly<AxAIServiceOptions>} options - The options to set.
   */
  setOptions(options: Readonly<AxAIServiceOptions>): void;
  /** Gets the options for the AI service. */
  getOptions(): Readonly<AxAIServiceOptions>;
}

export interface AxAIServiceImpl<
  TModel,
  TEmbedModel,
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
> {
  createChatReq(
    req: Readonly<AxInternalChatRequest<TModel>>,
    config?: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, TChatRequest]> | [AxAPI, TChatRequest];

  createChatResp(resp: Readonly<TChatResponse>): AxChatResponse;

  createChatStreamResp?(
    resp: Readonly<TChatResponseDelta>,
    state: object
  ): AxChatResponse;

  createEmbedReq?(
    req: Readonly<AxInternalEmbedRequest<TEmbedModel>>
  ): Promise<[AxAPI, TEmbedRequest]> | [AxAPI, TEmbedRequest];

  createEmbedResp?(resp: Readonly<TEmbedResponse>): AxEmbedResponse;

  getModelConfig(): AxModelConfig;

  getTokenUsage(): AxTokenUsage | undefined;
}
