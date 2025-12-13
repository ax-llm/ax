// ReadableStream is available globally in modern browsers and Node.js 16+

import type { Context, Meter, Tracer } from '@opentelemetry/api';
import type { AxAPI } from '../util/apicall.js';
import type { AxAIFeatures } from './base.js';

export type AxAIInputModelList<TModel, TEmbedModel, TModelKey> =
  (AxAIModelListBase<TModelKey> & {
    isInternal?: boolean;
    /** Optional per-model config applied when this key is used (callers still override) */
    modelConfig?: Omit<AxModelConfig, 'model' | 'embedModel'>;
    /** Optional per-model options applied when this key is used (callers still override) */
    thinkingTokenBudget?: AxAIServiceOptions['thinkingTokenBudget'];
    showThoughts?: AxAIServiceOptions['showThoughts'];
    stream?: AxAIServiceOptions['stream'];
    debug?: AxAIServiceOptions['debug'];
    useExpensiveModel?: AxAIServiceOptions['useExpensiveModel'];
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
  supported?: {
    thinkingBudget?: boolean;
    showThoughts?: boolean;
    structuredOutputs?: boolean;
  };
  notSupported?: {
    temperature?: boolean;
    topP?: boolean;
  };
  maxTokens?: number;
  isExpensive?: boolean;
  contextWindow?: number;
};

export type AxTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thoughtsTokens?: number;
  reasoningTokens?: number; // For O1-style models
  cacheCreationTokens?: number; // Cost of creating cache entries
  cacheReadTokens?: number; // Tokens read from cache (often free)
  serviceTier?: 'standard' | 'priority' | 'batch'; // Service level used
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
  title?: string;
  additionalProperties?: boolean;
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

/** Single thinking block item with its signature */
export type AxThoughtBlockItem = {
  data: string;
  encrypted: boolean;
  signature?: string;
};

export type AxChatResponseResult = {
  index: number;
  content?: string;
  thought?: string;
  /** Array of thinking blocks, each with its own signature */
  thoughtBlocks?: AxThoughtBlockItem[];
  name?: string;
  id?: string;
  functionCalls?: {
    id: string;
    type: 'function';
    function: { name: string; params?: string | object };
  }[];
  citations?: AxCitation[];
  finishReason?:
    | 'stop'
    | 'length'
    | 'function_call'
    | 'content_filter'
    | 'error';
  logprobs?: {
    content?: {
      token: string;
      logprob: number;
      topLogprobs?: { token: string; logprob: number }[];
    }[];
  };
};

// Normalized citation shape used across providers
export type AxCitation = {
  url: string;
  title?: string;
  description?: string;
  license?: string;
  publicationDate?: string;
  snippet?: string;
};

export type AxModelUsage = {
  ai: string;
  model: string;
  tokens?: AxTokenUsage;
  citations?: AxCitation[];
};

export type AxChatResponse = {
  sessionId?: string;
  remoteId?: string;
  results: readonly AxChatResponseResult[];
  modelUsage?: AxModelUsage;
};

export type AxEmbedResponse = {
  remoteId?: string;
  sessionId?: string;
  embeddings: readonly (readonly number[])[];
  modelUsage?: AxModelUsage;
};

export type AxModelInfoWithProvider = AxModelInfo & { provider: string };

export type AxChatRequest<TModel = string> = {
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
                  /** Optimization preference for image processing */
                  optimize?: 'quality' | 'size' | 'auto';
                  /** Fallback text description when images aren't supported */
                  altText?: string;
                }
              | {
                  type: 'audio';
                  data: string;
                  format?: 'wav' | 'mp3' | 'ogg';
                  cache?: boolean;
                  /** Pre-transcribed text content for fallback */
                  transcription?: string;
                  /** Duration of audio in seconds */
                  duration?: number;
                }
              | {
                  /** File content type with inline data */
                  type: 'file';
                  /** File data as base64 */
                  data: string;
                  /** Original filename */
                  filename?: string;
                  /** MIME type of the file */
                  mimeType: string;
                  cache?: boolean;
                  /** Pre-extracted text content for fallback */
                  extractedText?: string;
                }
              | {
                  /** File content type with cloud storage URI */
                  type: 'file';
                  /** File URI (e.g., gs:// URL) */
                  fileUri: string;
                  /** Original filename */
                  filename?: string;
                  /** MIME type of the file */
                  mimeType: string;
                  cache?: boolean;
                  /** Pre-extracted text content for fallback */
                  extractedText?: string;
                }
              | {
                  /** URL/Link content type */
                  type: 'url';
                  /** The URL to fetch content from */
                  url: string;
                  cache?: boolean;
                  /** Pre-fetched content for providers without web access */
                  cachedContent?: string;
                  /** Page title for context */
                  title?: string;
                  /** Page description for context */
                  description?: string;
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
        /** Array of thinking blocks, each with its own signature */
        thoughtBlocks?: AxThoughtBlockItem[];
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

  /** Provider capability preferences and requirements */
  capabilities?: {
    /** Whether the request requires image support */
    requiresImages?: boolean;
    /** Whether the request requires audio support */
    requiresAudio?: boolean;
    /** Whether the request requires file support */
    requiresFiles?: boolean;
    /** Whether the request requires web search capabilities */
    requiresWebSearch?: boolean;
    /** How to handle unsupported content types */
    fallbackBehavior?: 'error' | 'degrade' | 'skip';
  };

  /** Content processing preferences and hints */
  processing?: {
    /** Whether to apply image compression */
    imageCompression?: boolean;
    /** Whether to apply audio transcription */
    audioTranscription?: boolean;
    /** Whether to extract text from files */
    fileTextExtraction?: boolean;
    /** Whether to fetch content from URLs */
    urlContentFetching?: boolean;
  };

  functions?: Readonly<{
    name: string;
    description: string;
    parameters?: AxFunctionJSONSchema;
  }>[];
  functionCall?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  responseFormat?: {
    type: 'json_object' | 'json_schema';
    schema?: any;
  };
  modelConfig?: AxModelConfig;
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

export type AxEmbedRequest<TEmbedModel = string> = {
  texts?: readonly string[];
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
    }
  | {
      name: 'ChatResponseUsage';
      value: AxModelUsage;
    }
  | {
      name: 'ChatResponseCitations';
      value: AxCitation[];
    };

export type AxLoggerFunction = (message: AxLoggerData) => void;

export type AxAIServiceOptions = {
  debug?: boolean;
  verbose?: boolean; // Low-level HTTP request/response logging
  rateLimiter?: AxRateLimiterFunction;
  fetch?: typeof fetch;
  tracer?: Tracer;
  meter?: Meter;
  timeout?: number;
  excludeContentFromTrace?: boolean;
  abortSignal?: AbortSignal;
  logger?: AxLoggerFunction;
  sessionId?: string;
  debugHideSystemPrompt?: boolean;
  traceContext?: Context;
  stream?: boolean;
  functionCallMode?: 'auto' | 'native' | 'prompt';
  thinkingTokenBudget?:
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'highest'
    | 'none';
  showThoughts?: boolean;
  useExpensiveModel?: 'yes';
  stepIndex?: number;
  corsProxy?: string; // CORS proxy URL for browser environments
};

export interface AxAIService<
  TModel = unknown,
  TEmbedModel = unknown,
  TModelKey = string,
> {
  getId(): string;
  getName(): string;
  getFeatures(model?: TModel): AxAIFeatures;
  getModelList(): AxAIModelList<TModelKey> | undefined;
  getMetrics(): AxAIServiceMetrics;
  getLogger(): AxLoggerFunction;

  getLastUsedChatModel(): TModel | undefined;
  getLastUsedEmbedModel(): TEmbedModel | undefined;
  getLastUsedModelConfig(): AxModelConfig | undefined;

  chat(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>>;
  embed(
    req: Readonly<AxEmbedRequest<TEmbedModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse>;

  setOptions(options: Readonly<AxAIServiceOptions>): void;
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
