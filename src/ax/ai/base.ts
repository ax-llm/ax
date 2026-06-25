import {
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';
import { axGlobals } from '../dsp/globals.js';
import { defaultLogger } from '../dsp/loggers.js';
import { getModelInfo } from '../dsp/modelinfo.js';
import { axSpanAttributes, axSpanEvents } from '../trace/trace.js';
import { mergeAbortSignals } from '../util/abort.js';
import type { RetryConfig } from '../util/apicall.js';
import {
  AxMediaNotSupportedError,
  apiCall,
  defaultRetryConfig,
} from '../util/apicall.js';
import { createHash, randomUUID } from '../util/crypto.js';
import { RespTransformStream } from '../util/transform.js';
import {
  logChatRequest,
  logEmbedRequest,
  logEmbedResponse,
  logResponse,
  logResponseStreamingDoneResult,
} from './debug.js';
import {
  type AxAIMetricsInstruments,
  getOrCreateAIMetricsInstruments,
  mergeCustomLabels,
  recordAbortMetric,
  recordCacheTokenMetric,
  recordContextWindowUsageMetric,
  recordErrorMetric,
  recordErrorRateMetric,
  recordEstimatedCostMetric,
  recordFunctionCallMetric,
  recordLatencyMetric,
  recordLatencyStatsMetrics,
  recordModelConfigMetrics,
  recordMultimodalRequestMetric,
  recordPromptLengthMetric,
  recordRequestMetric,
  recordRequestSizeMetric,
  recordResponseSizeMetric,
  recordStreamingRequestMetric,
  recordThinkingBudgetUsageMetric,
  recordTimeoutMetric,
  recordTokenMetric,
} from './metrics.js';
import { countChatPromptContentChars } from './promptMetrics.js';
import type {
  AxAIInputModelList,
  AxAIService,
  AxAIServiceImpl,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxContextCacheInfo,
  AxContextCacheOperation,
  AxEmbedRequest,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxLoggerFunction,
  AxModelConfig,
  AxModelInfo,
  AxModelUsage,
  AxProviderMetadata,
  AxSpeechRequest,
  AxSpeechResponse,
  AxTokenUsage,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
} from './types.js';
import { axValidateChatRequestMessage } from './validate.js';

/**
 * Entry in the context cache registry.
 * Stores information about cached context for reuse across requests.
 */
type ContextCacheEntry = {
  /** Provider-specific cache resource name */
  cacheName: string;
  /** When the cache expires (timestamp in ms) */
  expiresAt: number;
  /** Hash of the cached content for validation */
  contentHash: string;
  /** Last time the cache was used (timestamp in ms) */
  lastTouchedAt: number;
  /** Number of tokens in the cached content */
  tokenCount?: number;
};

/**
 * Key for the context cache registry.
 */
type ContextCacheKey = {
  providerName: string;
  model: string;
  contentHash: string;
};

/**
 * Global context cache registry.
 * Keyed by a composite string of providerName:contentHash.
 * Sessions with identical cacheable content share the same cache.
 */
const contextCacheRegistry = new Map<string, ContextCacheEntry>();

/**
 * Build a composite key string for the cache registry.
 */
function buildCacheKey(key: ContextCacheKey): string {
  return `${key.providerName}:${key.model}:${key.contentHash}`;
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nestedValue]) => [
          key,
          normalizeForStableStringify(nestedValue),
        ])
    );
  }

  return value;
}

type AxResponseCorrelationMetadata = Pick<
  AxChatResponse,
  'remoteRequestId' | 'remoteSessionId' | 'providerMetadata'
>;

const PROVIDER_REQUEST_ID_HEADERS = [
  'x-request-id',
  'request-id',
  'x-requestid',
  'x-ms-request-id',
  'x-goog-request-id',
  'x-amzn-requestid',
  'x-amz-request-id',
] as const;

const PROVIDER_SESSION_ID_HEADERS = [
  'openai-session-id',
  'anthropic-session-id',
  'x-session-id',
] as const;

function getFirstHeader(
  headers: Headers,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function mergeProviderMetadata(
  base?: Readonly<AxProviderMetadata>,
  next?: Readonly<AxProviderMetadata>
): AxProviderMetadata | undefined {
  if (!base && !next) {
    return undefined;
  }

  const merged: AxProviderMetadata = {};
  for (const source of [base, next]) {
    if (!source) {
      continue;
    }
    for (const [provider, metadata] of Object.entries(source)) {
      merged[provider] = {
        ...(merged[provider] ?? {}),
        ...metadata,
      };
    }
  }
  return merged;
}

function extractResponseCorrelationMetadata(
  headers: Headers,
  providerName: string
): AxResponseCorrelationMetadata {
  const remoteRequestId = getFirstHeader(headers, PROVIDER_REQUEST_ID_HEADERS);
  const remoteSessionId = getFirstHeader(headers, PROVIDER_SESSION_ID_HEADERS);
  const providerMetadata =
    remoteRequestId || remoteSessionId
      ? {
          [providerName]: {
            ...(remoteRequestId ? { requestId: remoteRequestId } : {}),
            ...(remoteSessionId ? { sessionId: remoteSessionId } : {}),
          },
        }
      : undefined;

  return {
    ...(remoteRequestId ? { remoteRequestId } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function mergeCorrelationMetadata(
  current: AxResponseCorrelationMetadata,
  next: Readonly<AxResponseCorrelationMetadata>
): AxResponseCorrelationMetadata {
  return {
    remoteRequestId: next.remoteRequestId ?? current.remoteRequestId,
    remoteSessionId: next.remoteSessionId ?? current.remoteSessionId,
    providerMetadata: mergeProviderMetadata(
      current.providerMetadata,
      next.providerMetadata
    ),
  };
}

function applyResponseCorrelationMetadata(
  res: AxChatResponse | AxEmbedResponse,
  sessionId: string | undefined,
  metadata: Readonly<AxResponseCorrelationMetadata>
): void {
  res.sessionId = sessionId;
  if (metadata.remoteRequestId && !res.remoteRequestId) {
    res.remoteRequestId = metadata.remoteRequestId;
  }
  if (metadata.remoteSessionId) {
    res.remoteSessionId ??= metadata.remoteSessionId;
  }
  res.providerMetadata = mergeProviderMetadata(
    res.providerMetadata,
    metadata.providerMetadata
  );
}

function recordSpanException(span: Span | undefined, error: unknown): void {
  if (!span?.isRecording()) {
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException(err);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err.message,
  });
}

function setResponseCorrelationAttributes(
  res: Readonly<AxChatResponse | AxEmbedResponse>,
  span: Span
): void {
  const attributes: Record<string, string> = {};
  const conversationId = res.remoteSessionId ?? res.sessionId;

  if (res.remoteId) {
    attributes[axSpanAttributes.LLM_RESPONSE_ID] = res.remoteId;
  }
  if (res.modelUsage?.model) {
    attributes[axSpanAttributes.LLM_RESPONSE_MODEL] = res.modelUsage.model;
  }
  if (conversationId) {
    attributes[axSpanAttributes.LLM_CONVERSATION_ID] = conversationId;
  }
  if (res.sessionId) {
    attributes[axSpanAttributes.AX_SESSION_ID] = res.sessionId;
  }
  if (res.remoteRequestId) {
    attributes[axSpanAttributes.AX_PROVIDER_REQUEST_ID] = res.remoteRequestId;
  }
  if (res.remoteSessionId) {
    attributes[axSpanAttributes.AX_PROVIDER_SESSION_ID] = res.remoteSessionId;
  }

  if (Object.keys(attributes).length > 0) {
    span.setAttributes(attributes);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function stringifyFunctionParams(params: unknown): string {
  if (typeof params === 'string') {
    return params;
  }

  return stableStringify(params);
}

function hasCacheableToolState<TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>
): boolean {
  return req.functions?.some((fn) => fn.cache) ?? false;
}

function getCacheableToolState<TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>
):
  | {
      functions?: AxChatRequest['functions'];
      functionCall?: AxChatRequest['functionCall'];
    }
  | undefined {
  if (!hasCacheableToolState(req)) {
    return undefined;
  }

  return {
    functions: req.functions?.map(({ cache: _cache, ...fn }) => fn),
    functionCall: req.functionCall,
  };
}

/**
 * Hash a content part into the hasher.
 */
function hashContentPart(
  hasher: ReturnType<typeof createHash>,
  part: Extract<
    AxChatRequest['chatPrompt'][number],
    { role: 'user' }
  >['content'] extends infer T
    ? T extends Array<infer P>
      ? P
      : never
    : never
): void {
  if (part.type === 'text') {
    hasher.update(`text:${part.text}`);
  } else if (part.type === 'image') {
    hasher.update(`image:${part.mimeType}:${part.image.slice(0, 100)}`);
  } else if (part.type === 'audio') {
    hasher.update(`audio:${part.format}:${part.data.slice(0, 100)}`);
  } else if (part.type === 'file') {
    if ('fileUri' in part) {
      hasher.update(`file:${part.mimeType}:${part.fileUri}`);
    } else {
      hasher.update(`file:${part.mimeType}:${part.data.slice(0, 100)}`);
    }
  }
}

/**
 * Compute a hash of the cacheable content from a chat request.
 * Uses breakpoint semantics: includes all content from the start up to and
 * including the last message with cache: true. System prompts are always included.
 */
function computeCacheableContentHash<TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>,
  cacheableToolState?: {
    functions?: AxChatRequest['functions'];
    functionCall?: AxChatRequest['functionCall'];
  }
): string {
  const hasher = createHash('sha256');
  const { chatPrompt } = req;

  // Find the last message with cache: true (the breakpoint)
  let breakpointIndex = -1;
  for (let i = chatPrompt.length - 1; i >= 0; i--) {
    const msg = chatPrompt[i];
    if ('cache' in msg && msg.cache) {
      breakpointIndex = i;
      break;
    }
  }

  // Hash all messages from start up to and including the breakpoint
  for (let i = 0; i < chatPrompt.length; i++) {
    const msg = chatPrompt[i];

    // Always include system prompts in the cache hash
    if (msg.role === 'system') {
      hasher.update(`system:${msg.content}`);
      continue;
    }

    // For other messages, include only if before or at breakpoint
    if (breakpointIndex >= 0 && i <= breakpointIndex) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          hasher.update(`user:${msg.content}`);
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            hashContentPart(hasher, part);
          }
        }
      } else if (msg.role === 'assistant') {
        if (msg.content) {
          hasher.update(`assistant:${msg.content}`);
        }
        if (msg.functionCalls) {
          for (const call of msg.functionCalls) {
            hasher.update(
              `assistant_function:${call.function.name}:${stringifyFunctionParams(
                call.function.params
              )}`
            );
          }
        }
      } else if (msg.role === 'function') {
        hasher.update(`function:${msg.functionId}:${msg.result}`);
      }
    }
  }

  if (cacheableToolState) {
    hasher.update(`tools:${stableStringify(cacheableToolState)}`);
  }

  return hasher.digest('hex');
}

export interface AxAIFeatures {
  functions: boolean;
  streaming: boolean;
  functionCot?: boolean;
  hasThinkingBudget?: boolean;
  hasShowThoughts?: boolean;
  /** Whether the provider supports complex structured outputs (JSON schema) */
  structuredOutputs?: boolean;
  /** Enhanced media capability specifications */
  media: {
    /** Image processing capabilities */
    images: {
      /** Whether the provider supports image inputs */
      supported: boolean;
      /** Supported image MIME types (e.g., ['image/jpeg', 'image/png']) */
      formats: string[];
      /** Maximum image size in bytes */
      maxSize?: number;
      /** Supported detail/quality levels for image processing */
      detailLevels?: ('high' | 'low' | 'auto')[];
    };
    /** Audio processing capabilities */
    audio: {
      /** Whether the provider supports audio inputs */
      supported: boolean;
      /** Supported audio formats (e.g., ['wav', 'mp3']) */
      formats: string[];
      /** Maximum audio duration in seconds */
      maxDuration?: number;
      /** Audio output capabilities for conversational audio models */
      output?: {
        /** Whether the provider supports generated audio responses */
        supported: boolean;
        /** Supported generated audio formats */
        formats: string[];
        /** Default output sample rate, when fixed by the provider */
        sampleRate?: number;
        /** Known built-in voice names, when enumerable */
        voices?: string[];
      };
    };
    /** File processing capabilities */
    files: {
      /** Whether the provider supports file inputs */
      supported: boolean;
      /** Supported file MIME types (e.g., ['application/pdf', 'text/plain']) */
      formats: string[];
      /** Maximum file size in bytes */
      maxSize?: number;
      /** How files are uploaded to the provider */
      uploadMethod: 'inline' | 'upload' | 'cloud' | 'none';
    };
    /** URL and web content capabilities */
    urls: {
      /** Whether the provider supports URL inputs */
      supported: boolean;
      /** Whether the provider can perform web searches */
      webSearch: boolean;
      /** Whether the provider can fetch web page content */
      contextFetching: boolean;
    };
  };
  /** Content caching capabilities */
  caching: {
    /** Whether the provider supports content caching */
    supported: boolean;
    /** Types of caching available */
    types: ('ephemeral' | 'persistent')[];
    /** Whether explicit cache breakpoints are needed. If false, provider has automatic lookback and cache_control is always applied to system and last tool when caching is detected. Defaults to true. */
    cacheBreakpoints?: boolean;
  };
  /** Whether the provider supports thinking/reasoning modes */
  thinking: boolean;
  /** Whether the provider supports multi-turn conversations */
  multiTurn: boolean;
}

export interface AxBaseAIArgs<TModel, TEmbedModel, TModelKey> {
  name: string;
  apiURL?: string; // Make optional for local LLMs
  headers: () => Promise<Record<string, string>>;
  modelInfo: Readonly<AxModelInfo[]>;
  defaults: Readonly<{ model: TModel; embedModel?: TEmbedModel }>;
  options?: Readonly<AxAIServiceOptions>;
  supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures);
  models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
}

export const axBaseAIDefaultConfig = (): AxModelConfig =>
  structuredClone({
    temperature: 0,
  });

export const axBaseAIDefaultCreativeConfig = (): AxModelConfig =>
  structuredClone({
    temperature: 0.4,
    frequencyPenalty: 0.2,
  });

/**
 * Returns a stateful diff over cumulative {@link AxTokenUsage} readings.
 * Some providers (e.g. Anthropic) report a running cumulative on every
 * streaming event, but the underlying OTel token counters are additive —
 * recording the cumulative per-event would multiply the true cost by the
 * event count. State is per call so concurrent streams don't share it.
 *
 * Every numeric field on `tokens` is treated as cumulative; non-numeric
 * fields (e.g. serviceTier) are dropped from the delta — they don't make
 * sense to repeat on every event and downstream OTel recording doesn't
 * read them. Returns `undefined` when no field increased.
 *
 * This assumes all streaming providers report cumulative-or-once-at-end
 * usage (true for Anthropic, OpenAI, Gemini today).
 */
const makeDiffTokenUsage = (): ((
  cumulative: Readonly<AxTokenUsage>
) => Partial<AxTokenUsage> | undefined) => {
  const recorded: Record<string, number> = {};
  return (tokens) => {
    const delta: Partial<Record<keyof AxTokenUsage, unknown>> = {};
    let anyIncrement = false;
    for (const [key, cur] of Object.entries(tokens) as [
      keyof AxTokenUsage,
      AxTokenUsage[keyof AxTokenUsage],
    ][]) {
      if (typeof cur !== 'number') continue;
      const prev = recorded[key] ?? 0;
      // Clamp to handle the unlikely case of a provider reporting a decrease.
      const inc = Math.max(0, cur - prev);
      if (cur > prev) recorded[key] = cur;
      if (inc > 0) {
        delta[key] = inc;
        anyIncrement = true;
      }
    }
    return anyIncrement ? (delta as Partial<AxTokenUsage>) : undefined;
  };
};

export class AxBaseAI<
  TModel,
  TEmbedModel,
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
  TModelKey,
> implements AxAIService<TModel, TEmbedModel, TModelKey>
{
  #debug?: boolean;
  #verbose = false;

  private rt?: AxAIServiceOptions['rateLimiter'];
  private fetch?: AxAIServiceOptions['fetch'];
  private tracer?: AxAIServiceOptions['tracer'];
  private meter?: AxAIServiceOptions['meter'];
  private timeout?: AxAIServiceOptions['timeout'];
  private excludeContentFromTrace?: boolean;
  private models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
  private abortSignal?: AbortSignal;
  private logger?: AxLoggerFunction;
  private corsProxy?: AxAIServiceOptions['corsProxy'];
  private retry?: AxAIServiceOptions['retry'];
  private customLabels?: Record<string, string>;
  private contextCache?: AxAIServiceOptions['contextCache'];
  private beta?: AxAIServiceOptions['beta'];
  private includeRequestBodyInErrors?: AxAIServiceOptions['includeRequestBodyInErrors'];

  private modelInfo: readonly AxModelInfo[];
  private modelUsage?: AxModelUsage;
  private embedModelUsage?: AxModelUsage;
  private defaults: AxBaseAIArgs<TModel, TEmbedModel, TModelKey>['defaults'];
  private lastUsedModelConfig?: AxModelConfig;
  private lastUsedChatModel?: TModel;
  private lastUsedEmbedModel?: TEmbedModel;

  protected apiURL?: string;
  protected name: string;
  protected id: string;
  protected headers: () => Promise<Record<string, string>>;
  protected supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures);

  // Add private metrics tracking properties
  private metrics: AxAIServiceMetrics = {
    latency: {
      chat: {
        mean: 0,
        p95: 0,
        p99: 0,
        samples: [],
      },
      embed: {
        mean: 0,
        p95: 0,
        p99: 0,
        samples: [],
      },
    },
    errors: {
      chat: {
        count: 0,
        rate: 0,
        total: 0,
      },
      embed: {
        count: 0,
        rate: 0,
        total: 0,
      },
    },
  };

  constructor(
    private readonly aiImpl: Readonly<
      AxAIServiceImpl<
        TModel,
        TEmbedModel,
        TChatRequest,
        TEmbedRequest,
        TChatResponse,
        TChatResponseDelta,
        TEmbedResponse
      >
    >,
    {
      name,
      apiURL,
      headers,
      modelInfo,
      defaults,
      options = {},
      supportFor,
      models,
    }: Readonly<AxBaseAIArgs<TModel, TEmbedModel, TModelKey>>
  ) {
    this.name = name;
    this.apiURL = apiURL || '';
    this.headers = headers;
    this.supportFor = supportFor;
    this.modelInfo = modelInfo;
    this.models = models;
    this.id = randomUUID();

    const model = this.getModel(defaults.model) ?? defaults.model;
    const embedModel =
      this.getEmbedModel(defaults.embedModel) ?? defaults.embedModel;

    this.defaults = { model, embedModel };

    if (
      !defaults.model ||
      typeof defaults.model !== 'string' ||
      defaults.model === ''
    ) {
      throw new Error('No model defined');
    }

    this.setOptions(options);

    if (models) {
      _validateModels(models);
    }
  }

  private getEffectiveDebug(
    options?: Readonly<Pick<AxAIServiceOptions, 'debug'>>
  ): boolean {
    return options?.debug ?? this.#debug ?? axGlobals.debug ?? false;
  }

  private getEffectiveTracer(
    options?: Readonly<Pick<AxAIServiceOptions, 'tracer'>>
  ): AxAIServiceOptions['tracer'] {
    return options?.tracer ?? this.tracer ?? axGlobals.tracer;
  }

  private getEffectiveMeter(
    options?: Readonly<Pick<AxAIServiceOptions, 'meter'>>
  ): AxAIServiceOptions['meter'] {
    return options?.meter ?? this.meter ?? axGlobals.meter;
  }

  private getEffectiveLogger(
    options?: Readonly<Pick<AxAIServiceOptions, 'logger'>>
  ): AxLoggerFunction {
    return options?.logger ?? this.logger ?? axGlobals.logger ?? defaultLogger;
  }

  private getEffectiveAbortSignal(
    options?: Readonly<Pick<AxAIServiceOptions, 'abortSignal'>>
  ): AbortSignal | undefined {
    return mergeAbortSignals(
      options?.abortSignal,
      mergeAbortSignals(this.abortSignal, axGlobals.abortSignal)
    );
  }

  private getMetricsInstruments(
    options?: Readonly<Pick<AxAIServiceOptions, 'meter'>>
  ): AxAIMetricsInstruments | undefined {
    return getOrCreateAIMetricsInstruments(this.getEffectiveMeter(options));
  }

  public setName(name: string): void {
    this.name = name;
  }

  public getId(): string {
    return this.id;
  }

  public setAPIURL(apiURL: string): void {
    this.apiURL = apiURL;
  }

  public setHeaders(headers: () => Promise<Record<string, string>>): void {
    this.headers = headers;
  }

  get debug(): boolean {
    return this.getEffectiveDebug();
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.#debug = options.debug;
    // verbose controls low-level HTTP logging (separate from debug)
    this.#verbose = options.verbose ?? false;
    this.rt = options.rateLimiter;
    this.fetch = options.fetch;
    this.timeout = options.timeout;
    this.tracer = options.tracer;
    this.meter = options.meter;
    this.excludeContentFromTrace = options.excludeContentFromTrace;
    this.abortSignal = options.abortSignal;
    this.logger = options.logger;
    this.corsProxy = options.corsProxy;
    this.retry = options.retry;
    this.customLabels = options.customLabels;
    this.contextCache = options.contextCache;
    this.beta = options.beta;
    this.includeRequestBodyInErrors = options.includeRequestBodyInErrors;
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return {
      debug: this.getEffectiveDebug(),
      verbose: this.#verbose,
      rateLimiter: this.rt,
      fetch: this.fetch,
      tracer: this.getEffectiveTracer(),
      meter: this.getEffectiveMeter(),
      timeout: this.timeout,
      excludeContentFromTrace: this.excludeContentFromTrace,
      abortSignal: this.getEffectiveAbortSignal(),
      logger: this.getEffectiveLogger(),
      corsProxy: this.corsProxy,
      retry: this.retry,
      customLabels: this.getMergedCustomLabels(),
      contextCache: this.contextCache,
      beta: this.beta,
      includeRequestBodyInErrors: this.includeRequestBodyInErrors,
    };
  }

  getLogger(): AxLoggerFunction {
    return this.getEffectiveLogger();
  }

  // Helper to get merged custom labels from globals, service options, and per-call options
  private getMergedCustomLabels(
    optionsCustomLabels?: Record<string, string>
  ): Record<string, string> {
    return mergeCustomLabels(
      axGlobals.customLabels,
      this.customLabels,
      optionsCustomLabels
    );
  }

  getModelList() {
    const models = [];
    for (const model of this.models ?? []) {
      if (model.isInternal) {
        continue;
      }

      if ('model' in model && model.model) {
        models.push({
          key: model.key as TModelKey,
          description: model.description,
          model: model.model as string,
        } as const);
      }

      if ('embedModel' in model && model.embedModel) {
        models.push({
          key: model.key as TModelKey,
          description: model.description,
          embedModel: model.embedModel as string,
        } as const);
      }
    }

    return models;
  }

  getName(): string {
    return this.name;
  }

  getFeatures(model?: TModel): AxAIFeatures {
    return typeof this.supportFor === 'function'
      ? this.supportFor(model ?? this.defaults.model)
      : this.supportFor;
  }

  getLastUsedChatModel(): TModel | undefined {
    return this.lastUsedChatModel;
  }

  getLastUsedEmbedModel(): TEmbedModel | undefined {
    return this.lastUsedEmbedModel;
  }

  getLastUsedModelConfig(): AxModelConfig | undefined {
    return this.lastUsedModelConfig;
  }

  async transcribe(
    req: Readonly<AxTranscriptionRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    const impl = this.aiImpl as unknown as {
      transcribe?: (
        req: Readonly<AxTranscriptionRequest<TModel | TModelKey>>,
        options?: Readonly<AxAIServiceOptions>
      ) => Promise<AxTranscriptionResponse>;
    };
    if (impl.transcribe) {
      return await impl.transcribe(req, {
        ...this.getOptions(),
        ...(options ?? {}),
      });
    }
    throw new AxMediaNotSupportedError('Audio transcription', this.name, false);
  }

  async speak(
    req: Readonly<AxSpeechRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    const impl = this.aiImpl as unknown as {
      speak?: (
        req: Readonly<AxSpeechRequest<TModel | TModelKey>>,
        options?: Readonly<AxAIServiceOptions>
      ) => Promise<AxSpeechResponse>;
    };
    if (impl.speak) {
      return await impl.speak(req, {
        ...this.getOptions(),
        ...(options ?? {}),
      });
    }
    throw new AxMediaNotSupportedError('Audio speech', this.name, false);
  }

  // Method to calculate percentiles
  private calculatePercentile(
    samples: readonly number[],
    percentile: number
  ): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] ?? 0;
  }

  // Method to update latency metrics
  private updateLatencyMetrics(
    type: 'chat' | 'embed',
    duration: number,
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metrics = this.metrics.latency[type];
    metrics.samples.push(duration);

    // Keep only last 1000 samples to prevent memory issues
    if (metrics.samples.length > 1000) {
      metrics.samples.shift();
    }

    // Update statistics
    metrics.mean =
      metrics.samples.reduce((a, b) => a + b, 0) / metrics.samples.length;
    metrics.p95 = this.calculatePercentile(metrics.samples, 95);
    metrics.p99 = this.calculatePercentile(metrics.samples, 99);

    // Export to OpenTelemetry metrics
    const metricsInstruments = this.getMetricsInstruments(options);
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      const customLabels = this.getMergedCustomLabels(options?.customLabels);

      // Record individual latency measurement
      recordLatencyMetric(
        metricsInstruments,
        type,
        duration,
        this.name,
        model,
        customLabels
      );

      // Record latency statistics as gauges
      recordLatencyStatsMetrics(
        metricsInstruments,
        type,
        metrics.mean,
        metrics.p95,
        metrics.p99,
        this.name,
        model,
        customLabels
      );
    }
  }

  // Method to update error metrics
  private updateErrorMetrics(
    type: 'chat' | 'embed',
    isError: boolean,
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metrics = this.metrics.errors[type];
    metrics.total++;
    if (isError) {
      metrics.count++;
    }
    metrics.rate = metrics.count / metrics.total;

    // Export to OpenTelemetry metrics
    const metricsInstruments = this.getMetricsInstruments(options);
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      const customLabels = this.getMergedCustomLabels(options?.customLabels);

      // Always record request count
      recordRequestMetric(
        metricsInstruments,
        type,
        this.name,
        model,
        customLabels
      );

      // Record error count if there was an error
      if (isError) {
        recordErrorMetric(
          metricsInstruments,
          type,
          this.name,
          model,
          customLabels
        );
      }

      // Record current error rate as a gauge
      recordErrorRateMetric(
        metricsInstruments,
        type,
        metrics.rate,
        this.name,
        model,
        customLabels
      );
    }
  }

  private recordEstimatedCost(
    operationType: 'chat' | 'embed',
    costUSD: number,
    model: string,
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    if (costUSD <= 0) return;
    const metricsInstruments = this.getMetricsInstruments(options);
    if (!metricsInstruments) return;
    const customLabels = this.getMergedCustomLabels(options?.customLabels);
    recordEstimatedCostMetric(
      metricsInstruments,
      operationType,
      costUSD,
      this.name,
      model,
      customLabels
    );
  }

  private recordTokenUsage(
    model: string,
    tokens?: Partial<AxTokenUsage>,
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (!metricsInstruments || !tokens) return;
    const {
      promptTokens,
      completionTokens,
      totalTokens,
      thoughtsTokens,
      cacheReadTokens,
      cacheCreationTokens,
    } = tokens;
    const customLabels = this.getMergedCustomLabels(options?.customLabels);

    if (promptTokens) {
      recordTokenMetric(
        metricsInstruments,
        'input',
        promptTokens,
        this.name,
        model,
        customLabels
      );
    }

    if (completionTokens) {
      recordTokenMetric(
        metricsInstruments,
        'output',
        completionTokens,
        this.name,
        model,
        customLabels
      );
    }

    if (totalTokens) {
      recordTokenMetric(
        metricsInstruments,
        'total',
        totalTokens,
        this.name,
        model,
        customLabels
      );
    }

    if (thoughtsTokens) {
      recordTokenMetric(
        metricsInstruments,
        'thoughts',
        thoughtsTokens,
        this.name,
        model,
        customLabels
      );
    }

    if (cacheReadTokens) {
      recordCacheTokenMetric(
        metricsInstruments,
        'read',
        cacheReadTokens,
        this.name,
        model,
        customLabels
      );
    }

    if (cacheCreationTokens) {
      recordCacheTokenMetric(
        metricsInstruments,
        'write',
        cacheCreationTokens,
        this.name,
        model,
        customLabels
      );
    }
  }

  // Helper method to calculate request size in bytes
  private calculateRequestSize(req: unknown): number {
    try {
      return new TextEncoder().encode(JSON.stringify(req)).length;
    } catch {
      return 0;
    }
  }

  // Helper method to calculate response size in bytes
  private calculateResponseSize(response: unknown): number {
    try {
      return new TextEncoder().encode(JSON.stringify(response)).length;
    } catch {
      return 0;
    }
  }

  // Helper method to detect multimodal content
  private detectMultimodalContent(
    req: Readonly<AxChatRequest<TModel | TModelKey>>
  ): {
    hasImages: boolean;
    hasAudio: boolean;
  } {
    let hasImages = false;
    let hasAudio = false;

    if (req.chatPrompt && Array.isArray(req.chatPrompt)) {
      for (const message of req.chatPrompt) {
        if (message.role === 'user' && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'image') {
              hasImages = true;
            } else if (part.type === 'audio') {
              hasAudio = true;
            }
          }
        }
      }
    }

    return { hasImages, hasAudio };
  }

  // Helper method to calculate context window usage
  private calculateContextWindowUsage(
    model: TModel,
    modelUsage?: AxModelUsage
  ): number {
    if (!modelUsage?.tokens?.promptTokens) return 0;

    // Get model info to find context window size
    const modelInfo = getModelInfo({
      model: model as string,
      modelInfo: this.modelInfo,
    });
    if (!modelInfo?.contextWindow) return 0;

    return modelUsage.tokens.promptTokens / modelInfo.contextWindow;
  }

  // Helper method to estimate cost by model name
  private estimateCostByName(
    modelName: string,
    modelUsage?: AxModelUsage
  ): number {
    if (!modelUsage?.tokens) return 0;

    // Get model info to find pricing
    const modelInfo = getModelInfo({
      model: modelName,
      modelInfo: this.modelInfo,
    });
    if (
      !modelInfo ||
      (!modelInfo.promptTokenCostPer1M && !modelInfo.completionTokenCostPer1M)
    )
      return 0;

    const {
      promptTokens = 0,
      completionTokens = 0,
      thoughtsTokens = 0,
      cacheReadTokens = 0,
      cacheCreationTokens = 0,
      speed,
    } = modelUsage.tokens;

    // Determine if long-context rates apply based on total input tokens
    const totalInputTokens = promptTokens + cacheReadTokens;
    const isLongContext =
      modelInfo.longContextThreshold !== undefined &&
      totalInputTokens > modelInfo.longContextThreshold;

    const useFastPricing = speed === 'fast';
    const promptCostPer1M = useFastPricing
      ? (modelInfo.fastPromptTokenCostPer1M ??
        modelInfo.promptTokenCostPer1M ??
        0)
      : isLongContext
        ? (modelInfo.longContextPromptTokenCostPer1M ??
          modelInfo.promptTokenCostPer1M ??
          0)
        : (modelInfo.promptTokenCostPer1M ?? 0);
    const completionCostPer1M = useFastPricing
      ? (modelInfo.fastCompletionTokenCostPer1M ??
        modelInfo.completionTokenCostPer1M ??
        0)
      : isLongContext
        ? (modelInfo.longContextCompletionTokenCostPer1M ??
          modelInfo.completionTokenCostPer1M ??
          0)
        : (modelInfo.completionTokenCostPer1M ?? 0);
    const cacheReadCostPer1M = useFastPricing
      ? (modelInfo.fastCacheReadTokenCostPer1M ??
        modelInfo.cacheReadTokenCostPer1M ??
        promptCostPer1M)
      : isLongContext
        ? (modelInfo.longContextCacheReadTokenCostPer1M ??
          modelInfo.cacheReadTokenCostPer1M ??
          promptCostPer1M)
        : (modelInfo.cacheReadTokenCostPer1M ?? promptCostPer1M);
    const cacheWriteCostPer1M = useFastPricing
      ? (modelInfo.fastCacheWriteTokenCostPer1M ??
        modelInfo.cacheWriteTokenCostPer1M ??
        promptCostPer1M)
      : (modelInfo.cacheWriteTokenCostPer1M ?? promptCostPer1M);

    // Thinking tokens are billed as output tokens
    const totalOutputTokens = completionTokens + thoughtsTokens;

    return (
      (promptTokens * promptCostPer1M) / 1_000_000 +
      (totalOutputTokens * completionCostPer1M) / 1_000_000 +
      (cacheReadTokens * cacheReadCostPer1M) / 1_000_000 +
      (cacheCreationTokens * cacheWriteCostPer1M) / 1_000_000
    );
  }

  // Helper method to record function call metrics
  private recordFunctionCallMetrics(
    functionCalls?: readonly unknown[],
    model?: TModel,
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (!metricsInstruments || !functionCalls) return;

    for (const call of functionCalls) {
      if (
        call &&
        typeof call === 'object' &&
        'function' in call &&
        call.function &&
        typeof call.function === 'object' &&
        'name' in call.function
      ) {
        recordFunctionCallMetric(
          metricsInstruments,
          (call.function as { name: string }).name,
          undefined, // latency would need to be tracked separately
          this.name,
          model as string,
          this.getMergedCustomLabels(options?.customLabels)
        );
      }
    }
  }

  // Helper method to record timeout metrics
  private recordTimeoutMetric(
    type: 'chat' | 'embed',
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      recordTimeoutMetric(
        metricsInstruments,
        type,
        this.name,
        model,
        this.getMergedCustomLabels(options?.customLabels)
      );
    }
  }

  // Helper method to record abort metrics
  private recordAbortMetric(
    type: 'chat' | 'embed',
    options?: Readonly<Pick<AxAIServiceOptions, 'customLabels' | 'meter'>>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      recordAbortMetric(
        metricsInstruments,
        type,
        this.name,
        model,
        this.getMergedCustomLabels(options?.customLabels)
      );
    }
  }

  // Comprehensive method to record all chat-related metrics
  private recordChatMetrics(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>,
    result?: AxChatResponse | ReadableStream<AxChatResponse>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (!metricsInstruments) return;

    const model = this.lastUsedChatModel as string;
    const modelConfig = this.lastUsedModelConfig;
    const customLabels = this.getMergedCustomLabels(options?.customLabels);

    // Record streaming request metric
    const isStreaming = modelConfig?.stream ?? false;
    recordStreamingRequestMetric(
      metricsInstruments,
      'chat',
      isStreaming,
      this.name,
      model,
      customLabels
    );

    // Record multimodal request metric
    const { hasImages, hasAudio } = this.detectMultimodalContent(req);
    recordMultimodalRequestMetric(
      metricsInstruments,
      hasImages,
      hasAudio,
      this.name,
      model,
      customLabels
    );

    // Record prompt length metric
    const promptLength = countChatPromptContentChars(req.chatPrompt);
    recordPromptLengthMetric(
      metricsInstruments,
      promptLength,
      this.name,
      model,
      customLabels
    );

    // Record model configuration metrics
    recordModelConfigMetrics(
      metricsInstruments,
      modelConfig?.temperature,
      modelConfig?.maxTokens,
      this.name,
      model,
      customLabels
    );

    // Record thinking budget usage if applicable
    if (
      options?.thinkingTokenBudget &&
      this.modelUsage?.tokens?.thoughtsTokens
    ) {
      recordThinkingBudgetUsageMetric(
        metricsInstruments,
        this.modelUsage.tokens.thoughtsTokens,
        this.name,
        model,
        customLabels
      );
    }

    // Record request size
    const requestSize = this.calculateRequestSize(req);
    recordRequestSizeMetric(
      metricsInstruments,
      'chat',
      requestSize,
      this.name,
      model,
      customLabels
    );

    // Record response size and function calls for non-streaming responses
    if (result && !isStreaming) {
      const chatResponse = result as AxChatResponse;
      const responseSize = this.calculateResponseSize(chatResponse);
      recordResponseSizeMetric(
        metricsInstruments,
        'chat',
        responseSize,
        this.name,
        model,
        customLabels
      );

      // Record function call metrics
      if (chatResponse.results) {
        for (const chatResult of chatResponse.results) {
          if (chatResult.functionCalls) {
            this.recordFunctionCallMetrics(
              chatResult.functionCalls,
              this.lastUsedChatModel,
              options
            );
          }
        }
      }

      // Record context window usage
      const contextUsage = this.calculateContextWindowUsage(
        this.lastUsedChatModel!,
        chatResponse.modelUsage
      );
      if (contextUsage > 0) {
        recordContextWindowUsageMetric(
          metricsInstruments,
          contextUsage,
          this.name,
          model,
          customLabels
        );
      }
    }
  }

  // Comprehensive method to record all embed-related metrics
  private recordEmbedMetrics(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    result: Readonly<AxEmbedResponse>,
    options?: Readonly<AxAIServiceOptions>
  ): void {
    const metricsInstruments = this.getMetricsInstruments(options);
    if (!metricsInstruments) return;

    const model = this.lastUsedEmbedModel as string;
    const customLabels = this.getMergedCustomLabels(options?.customLabels);

    // Record request size
    const requestSize = this.calculateRequestSize(req);
    recordRequestSizeMetric(
      metricsInstruments,
      'embed',
      requestSize,
      this.name,
      model,
      customLabels
    );

    // Record response size
    const responseSize = this.calculateResponseSize(result);
    recordResponseSizeMetric(
      metricsInstruments,
      'embed',
      responseSize,
      this.name,
      model,
      customLabels
    );
  }

  // Public method to get metrics
  public getMetrics(): AxAIServiceMetrics {
    return structuredClone(this.metrics);
  }

  // Public method to get estimated cost for a given model usage
  public getEstimatedCost(modelUsage?: AxModelUsage): number {
    if (!modelUsage) return 0;
    return this.estimateCostByName(modelUsage.model, modelUsage);
  }

  async chat(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const startTime = performance.now();
    let isError = false;
    let result: AxChatResponse | ReadableStream<AxChatResponse>;

    // Merge per-model-key default options if a key entry provides them
    const modelKeyEntry = this.getModelByKey(
      req.model as TModel | TEmbedModel | TModelKey
    );
    const modelKeyThinkingTokenBudget = modelKeyEntry
      ? (
          modelKeyEntry as {
            thinkingTokenBudget?: AxAIServiceOptions['thinkingTokenBudget'];
          }
        ).thinkingTokenBudget
      : undefined;
    const mergedOptions: Readonly<AxAIServiceOptions> = {
      ...(this.beta !== undefined ? { beta: this.beta } : undefined),
      ...(modelKeyEntry
        ? {
            thinkingTokenBudget: modelKeyThinkingTokenBudget,
            showThoughts: (
              modelKeyEntry as {
                showThoughts?: AxAIServiceOptions['showThoughts'];
              }
            ).showThoughts,
            stream: (
              modelKeyEntry as {
                stream?: AxAIServiceOptions['stream'];
              }
            ).stream,
            debug: (
              modelKeyEntry as {
                debug?: AxAIServiceOptions['debug'];
              }
            ).debug,
            useExpensiveModel: (
              modelKeyEntry as {
                useExpensiveModel?: AxAIServiceOptions['useExpensiveModel'];
              }
            ).useExpensiveModel,
            beta: (
              modelKeyEntry as {
                beta?: AxAIServiceOptions['beta'];
              }
            ).beta,
          }
        : undefined),
      // Filter out undefined values from options to avoid overriding model key defaults
      ...Object.fromEntries(
        Object.entries(options ?? {}).filter(([, value]) => value !== undefined)
      ),
    } as AxAIServiceOptions;

    try {
      result = await this._chat1(req, mergedOptions);
      return result;
    } catch (error) {
      isError = true;
      // Check for specific error types
      if (error instanceof Error) {
        if (
          error.message.includes('timeout') ||
          error.name === 'TimeoutError'
        ) {
          this.recordTimeoutMetric('chat', mergedOptions);
        } else if (
          error.message.includes('abort') ||
          error.name === 'AbortError'
        ) {
          this.recordAbortMetric('chat', mergedOptions);
        }
      }
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.updateLatencyMetrics('chat', duration, mergedOptions);
      this.updateErrorMetrics('chat', isError, mergedOptions);

      // Record additional metrics if successful
      if (!isError) {
        this.recordChatMetrics(req, mergedOptions, result!);
      }
    }
  }

  private async _chat1(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const model =
      this.getModel(req.model) ?? (req.model as TModel) ?? this.defaults.model;

    // Validate chat prompt messages
    if (Array.isArray(req.chatPrompt)) {
      for (const item of req.chatPrompt) {
        axValidateChatRequestMessage(item);
      }
    }

    // Merge per-model-key default modelConfig if provided
    const modelKeyEntry = this.getModelByKey(
      req.model as TModel | TEmbedModel | TModelKey
    );
    const modelConfig = {
      ...this.aiImpl.getModelConfig(),
      ...(modelKeyEntry
        ? (modelKeyEntry as { modelConfig?: AxModelConfig }).modelConfig
        : undefined),
      ...req.modelConfig,
    } as AxModelConfig;

    const selectedModelInfo = getModelInfo({
      model: model as string,
      modelInfo: this.modelInfo,
    });
    if (selectedModelInfo?.notSupported?.temperature) {
      if ('temperature' in modelConfig) {
        delete (modelConfig as { temperature?: number }).temperature;
      }
    }
    if (selectedModelInfo?.notSupported?.topP) {
      if ('topP' in modelConfig) {
        delete (modelConfig as { topP?: number }).topP;
      }
    }

    // Check for expensive model usage
    if (
      selectedModelInfo?.isExpensive &&
      options?.useExpensiveModel !== 'yes'
    ) {
      throw new Error(
        `Model ${model as string} is marked as expensive and requires explicit confirmation. Set useExpensiveModel: "yes" to proceed.`
      );
    }

    // stream is true by default unless explicitly set to false
    modelConfig.stream =
      (options?.stream !== undefined ? options.stream : modelConfig.stream) ??
      true;

    const canStream = this.getFeatures(model).streaming;
    if (!canStream) {
      modelConfig.stream = false;
    }

    const tracer = this.getEffectiveTracer(options);
    if (tracer) {
      return await tracer.startActiveSpan(
        'AI Chat Request',
        {
          kind: SpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_OPERATION_NAME]: 'chat',
            [axSpanAttributes.LLM_REQUEST_MODEL]: model as string,
            [axSpanAttributes.LLM_REQUEST_MAX_TOKENS]:
              modelConfig.maxTokens ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_TEMPERATURE]: modelConfig.temperature,
            [axSpanAttributes.LLM_REQUEST_TOP_P]: modelConfig.topP ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_TOP_K]: modelConfig.topK ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_FREQUENCY_PENALTY]:
              modelConfig.frequencyPenalty ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_PRESENCE_PENALTY]:
              modelConfig.presencePenalty ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_STOP_SEQUENCES]:
              modelConfig.stopSequences?.join(', ') ?? 'Not set',
            [axSpanAttributes.LLM_REQUEST_LLM_IS_STREAMING]:
              modelConfig.stream ?? 'Not set',
            ...(options?.sessionId
              ? {
                  [axSpanAttributes.LLM_CONVERSATION_ID]: options.sessionId,
                  [axSpanAttributes.AX_SESSION_ID]: options.sessionId,
                }
              : {}),
          },
        },
        options?.traceContext ?? context.active(),
        async (span) => {
          return await this._chat2(model, modelConfig, req, options, span);
        }
      );
    }
    return await this._chat2(model, modelConfig, req, options);
  }

  private cleanupFunctionSchema(
    fn: Readonly<NonNullable<AxChatRequest['functions']>[number]>
  ): NonNullable<AxChatRequest['functions']>[number] {
    const cleanFn = { ...fn };
    if (cleanFn.parameters) {
      const cleanParams = { ...cleanFn.parameters };

      // Remove empty required array
      if (
        Array.isArray(cleanParams.required) &&
        cleanParams.required.length === 0
      ) {
        delete cleanParams.required;
      }

      // Remove empty properties object
      if (
        cleanParams.properties &&
        Object.keys(cleanParams.properties).length === 0
      ) {
        delete cleanParams.properties;
      }

      // After cleaning, remove the entire parameters object if it's effectively empty
      // i.e., either no keys left or just { type: 'object' } remaining.
      if (
        Object.keys(cleanParams).length === 0 ||
        (Object.keys(cleanParams).length === 1 && cleanParams.type === 'object')
      ) {
        delete cleanFn.parameters;
      } else {
        cleanFn.parameters = cleanParams;
      }
    }
    return cleanFn;
  }

  /**
   * Peeks the first raw streaming delta and, if the provider classifies it as a retryable
   * transient error (e.g. an Anthropic `overloaded_error` SSE event), re-issues the request
   * with exponential backoff — the same policy {@link apiCall} applies to an HTTP 529 status,
   * so streaming and non-streaming overloads behave identically. The first delta is classified
   * on the raw chunk (no stateful transform runs), so peeking has no side effects. After the
   * retry budget is exhausted the original error delta is replayed so it surfaces normally
   * (and the balancer can still fail over). A non-error first delta is replayed unchanged.
   *
   * Note: re-issuing cancels the previous stream's reader best-effort; the underlying fetch
   * body of the abandoned overloaded request is released by GC rather than promptly aborted,
   * since apiCall's streams don't propagate cancel. Acceptable for the transient-overload case.
   */
  private async retryTransientStreamStart(
    stream: ReadableStream<TChatResponseDelta>,
    reissue: () => Promise<unknown>,
    retryOverride?: Partial<RetryConfig>
  ): Promise<ReadableStream<TChatResponseDelta>> {
    const cfg: RetryConfig = { ...defaultRetryConfig, ...retryOverride };
    const classify = this.aiImpl.classifyStreamErrorStatus;
    let current = stream;
    let attempt = 0;

    while (true) {
      const reader = current.getReader();
      const first = await reader.read();

      if (!first.done) {
        const status = classify?.(first.value);
        if (
          status !== undefined &&
          cfg.retryableStatusCodes.includes(status) &&
          attempt < cfg.maxRetries
        ) {
          await reader.cancel().catch(() => {});
          attempt++;
          const delay = Math.min(
            cfg.initialDelayMs * cfg.backoffFactor ** (attempt - 1),
            cfg.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          const next = await reissue();
          if (!(next instanceof ReadableStream)) {
            return next as ReadableStream<TChatResponseDelta>;
          }
          current = next as ReadableStream<TChatResponseDelta>;
          continue;
        }
      }

      // Good first delta, or a non-retryable / retry-exhausted error: replay the buffered
      // first delta and pump the rest, so the normal transform pipeline runs once.
      let emittedFirst = false;
      return new ReadableStream<TChatResponseDelta>({
        async pull(controller) {
          if (!emittedFirst) {
            emittedFirst = true;
            if (first.done) {
              controller.close();
              return;
            }
            controller.enqueue(first.value);
            return;
          }
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            controller.error(err);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
    }
  }

  private async _chat2(
    model: TModel,
    modelConfig: Readonly<AxModelConfig>,
    chatReq: Readonly<Omit<AxChatRequest<TModel | TModelKey>, 'modelConfig'>>,
    options?: Readonly<AxAIServiceOptions>,
    span?: Span
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (!this.aiImpl.createChatReq) {
      throw new Error('createChatReq not implemented');
    }

    const debug = this.getEffectiveDebug(options);
    const verbose = options?.verbose ?? this.#verbose;
    const logger = this.getEffectiveLogger(options);
    const abortSignal = this.getEffectiveAbortSignal(options);
    const excludeContentFromTrace =
      options?.excludeContentFromTrace ?? this.excludeContentFromTrace;

    let functions: NonNullable<AxChatRequest['functions']> | undefined;

    if (chatReq.functions && chatReq.functions.length > 0) {
      functions = chatReq.functions.map((fn) => this.cleanupFunctionSchema(fn));
    }

    const req = {
      ...chatReq,
      model,
      functions,
      modelConfig,
    };

    // Store the last used model and config
    this.lastUsedChatModel = model;
    this.lastUsedModelConfig = modelConfig;

    if (debug) {
      logChatRequest(
        req.chatPrompt,
        options?.stepIndex ?? 0,
        logger,
        options?.debugHideSystemPrompt
      );
    }

    // After logging, optionally emulate prompt-based function mode centrally
    const providerSupportsFunctions = this.getFeatures(model).functions;
    const requestedFunctionCallMode = options?.functionCallMode ?? 'auto';
    const shouldEmulatePromptMode =
      requestedFunctionCallMode === 'prompt' ||
      (requestedFunctionCallMode === 'auto' && !providerSupportsFunctions);

    const effectiveReq = shouldEmulatePromptMode
      ? {
          ...req,
          chatPrompt: req.chatPrompt.map((msg) => {
            if (msg.role === 'assistant') {
              const { content, name, cache } = msg;
              return {
                role: 'assistant' as const,
                content,
                name,
                cache,
              } as typeof msg;
            }
            if (msg.role === 'function') {
              const content = msg.result;
              return {
                role: 'user' as const,
                content,
              } as (typeof req.chatPrompt)[number];
            }
            return msg;
          }),
          functions: [],
        }
      : req;

    // Handle context caching if enabled and supported
    const cacheResult = await this.handleContextCaching(
      model,
      effectiveReq,
      options,
      span
    );

    let responseMetadata: AxResponseCorrelationMetadata = {};
    const onResponseMetadata = (metadata: { headers: Headers }): void => {
      responseMetadata = mergeCorrelationMetadata(
        responseMetadata,
        extractResponseCorrelationMetadata(metadata.headers, this.name)
      );
    };

    const fn = async () => {
      // If we have a prepared cached request from the provider, use it
      if (cacheResult?.preparedRequest) {
        const { apiConfig, request: reqValue } = cacheResult.preparedRequest;

        if (span?.isRecording()) {
          setChatRequestEvents(chatReq, span, excludeContentFromTrace);
        }

        const res = await apiCall(
          {
            name: apiConfig.name,
            url: apiConfig.url ?? this.apiURL,
            localCall: apiConfig.localCall,
            headers: await this.buildHeaders(apiConfig.headers),
            stream: modelConfig.stream,
            timeout: this.timeout,
            verbose,
            fetch: this.fetch,
            span,
            abortSignal,
            corsProxy: this.corsProxy,
            onResponseMetadata,
            retry: options?.retry ?? this.retry,
            includeRequestBodyInErrors:
              options?.includeRequestBodyInErrors ??
              this.includeRequestBodyInErrors,
          },
          reqValue
        );
        return res;
      }

      // Standard path without context caching
      const [apiConfig, reqValue] = await this.aiImpl.createChatReq(
        effectiveReq,
        options
      );

      if (span?.isRecording()) {
        setChatRequestEvents(chatReq, span, excludeContentFromTrace);
      }

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: apiConfig.url ?? this.apiURL,
          localCall: apiConfig.localCall,
          headers: await this.buildHeaders(apiConfig.headers),
          stream: modelConfig.stream,
          timeout: this.timeout,
          verbose,
          fetch: this.fetch,
          span,
          abortSignal,
          corsProxy: this.corsProxy,
          onResponseMetadata,
          retry: options?.retry ?? this.retry,
          includeRequestBodyInErrors:
            options?.includeRequestBodyInErrors ??
            this.includeRequestBodyInErrors,
        },
        reqValue
      );
      return res;
    };

    const rt = options?.rateLimiter ?? this.rt;
    const issueRequest = () =>
      rt ? rt(fn, { modelUsage: this.modelUsage }) : fn();
    let rv: Awaited<ReturnType<typeof fn>>;
    try {
      rv = await issueRequest();
      // Pre-content streaming retry: if the stream's FIRST delta is a transient error event
      // (e.g. Anthropic's HTTP-200 `overloaded_error` SSE, which precedes message_start),
      // re-issue with backoff so a streaming overload gets the same retry policy as an HTTP 529
      // status — before the balancer sees it. Scope is the first delta only: an error preceded
      // by leading ping/message_start events isn't retried here, and an error after content
      // can't be retried at all (output already committed) — both instead surface during
      // consumption and fail over downstream. Only providers implementing
      // classifyStreamErrorStatus participate; others are unaffected.
      if (
        modelConfig.stream &&
        rv instanceof ReadableStream &&
        this.aiImpl.classifyStreamErrorStatus
      ) {
        rv = (await this.retryTransientStreamStart(
          rv as ReadableStream<TChatResponseDelta>,
          issueRequest,
          options?.retry ?? this.retry
        )) as typeof rv;
      }
    } catch (error) {
      recordSpanException(span, error);
      if (span?.isRecording()) {
        span.end();
      }
      throw error;
    }

    if (modelConfig.stream) {
      if (!this.aiImpl.createChatStreamResp) {
        throw new Error('createChatStreamResp not implemented');
      }

      const respFn = this.aiImpl.createChatStreamResp.bind(this);
      const diffTokenUsage = makeDiffTokenUsage();
      let recordedCost = 0;
      let streamRemoteId: string | undefined;
      let streamRemoteRequestId: string | undefined;
      let streamRemoteSessionId: string | undefined;
      let streamProviderMetadata: AxProviderMetadata | undefined;

      const wrappedRespFn =
        (state: object) => (resp: Readonly<TChatResponseDelta>) => {
          try {
            const res = respFn(resp, state);
            if (res.remoteId) {
              streamRemoteId = res.remoteId;
            } else if (streamRemoteId) {
              res.remoteId = streamRemoteId;
            }
            if (res.remoteRequestId) {
              streamRemoteRequestId = res.remoteRequestId;
            } else if (streamRemoteRequestId) {
              res.remoteRequestId = streamRemoteRequestId;
            }
            if (res.remoteSessionId) {
              streamRemoteSessionId = res.remoteSessionId;
            } else if (streamRemoteSessionId) {
              res.remoteSessionId = streamRemoteSessionId;
            }
            streamProviderMetadata = mergeProviderMetadata(
              streamProviderMetadata,
              res.providerMetadata
            );
            if (streamProviderMetadata) {
              res.providerMetadata = streamProviderMetadata;
            }
            applyResponseCorrelationMetadata(
              res,
              options?.sessionId,
              responseMetadata
            );
            if (res.remoteRequestId) {
              streamRemoteRequestId = res.remoteRequestId;
            }
            if (res.remoteSessionId) {
              streamRemoteSessionId = res.remoteSessionId;
            }
            streamProviderMetadata = mergeProviderMetadata(
              streamProviderMetadata,
              res.providerMetadata
            );

            // Only call getTokenUsage if modelUsage is not already provided by the service
            if (!res.modelUsage) {
              const tokenUsage = this.aiImpl.getTokenUsage();
              if (tokenUsage) {
                res.modelUsage = {
                  ai: this.name,
                  model: model as string,
                  tokens: tokenUsage,
                };
              }
            }
            this.modelUsage = res.modelUsage;
            if (res.modelUsage?.tokens) {
              const deltaTokens = diffTokenUsage(res.modelUsage.tokens);
              if (deltaTokens) {
                this.recordTokenUsage(
                  res.modelUsage.model,
                  deltaTokens,
                  options
                );
                // Compute cumulative cost so long-context pricing tiers are accounted for,
                // then diff it to get an accurate delta.
                const curCost = this.estimateCostByName(
                  res.modelUsage.model,
                  res.modelUsage
                );
                const costDelta = Math.max(0, curCost - recordedCost);
                if (curCost > recordedCost) recordedCost = curCost;
                this.recordEstimatedCost(
                  'chat',
                  costDelta,
                  res.modelUsage.model,
                  options
                );
              }
            }

            if (span?.isRecording()) {
              setChatResponseEvents(res, span, excludeContentFromTrace);
            }

            return res;
          } catch (error) {
            recordSpanException(span, error);
            if (span?.isRecording()) {
              span.end();
            }
            throw error;
          }
        };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const doneCb = async (values: readonly AxChatResponse[]) => {
        if (span?.isRecording()) {
          span.end();
        }
        if (debug) {
          logResponseStreamingDoneResult(values, logger);
        }
      };

      // Check if we're in browser environment for compatibility
      const isBrowser = typeof window !== 'undefined';

      if (isBrowser) {
        // Use browser-compatible manual stream processing instead of pipeThrough
        const sourceStream = rv as ReadableStream<TChatResponseDelta>;
        const transformState = {};
        const transformedValues: AxChatResponse[] = [];
        return new ReadableStream<AxChatResponse>({
          start: (controller) => {
            const reader = sourceStream.getReader();

            const onAbort = () => {
              try {
                reader.cancel().catch(() => {});
              } catch {}
              try {
                this.recordAbortMetric('chat', options);
              } catch {}
              try {
                if (span?.isRecording()) span.end();
              } catch {}
              try {
                // DOMException is available in browsers; fallback to Error if unavailable
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                controller.error(new DOMException('Aborted', 'AbortError'));
              } catch {
                controller.error(new Error('Aborted'));
              }
            };

            if (abortSignal) {
              if (abortSignal.aborted) {
                onAbort();
                return;
              }
              abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            async function read() {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    // Call done callback with all transformed values
                    if (doneCb) {
                      await doneCb(transformedValues);
                    }
                    controller.close();
                    break;
                  }

                  const transformedValue = wrappedRespFn(transformState)(value);
                  if (transformedValue) {
                    transformedValues.push(transformedValue);
                    controller.enqueue(transformedValue);
                  }
                }
              } catch (error) {
                recordSpanException(span, error);
                controller.error(error);
                if (span?.isRecording()) {
                  try {
                    span.end();
                  } catch {}
                }
              } finally {
                reader.releaseLock();
                if (abortSignal) {
                  try {
                    abortSignal.removeEventListener('abort', onAbort);
                  } catch {}
                }
              }
            }

            read();
          },
        });
      }
      // Use pipeThrough for Node.js environments where it's fully supported
      const st = (rv as ReadableStream<TChatResponseDelta>).pipeThrough(
        new RespTransformStream<TChatResponseDelta, AxChatResponse>(
          wrappedRespFn({}),
          doneCb
        )
      );
      return st;
    }

    if (!this.aiImpl.createChatResp) {
      throw new Error('createChatResp not implemented');
    }

    try {
      const res = this.aiImpl.createChatResp(rv as TChatResponse);
      applyResponseCorrelationMetadata(
        res,
        options?.sessionId,
        responseMetadata
      );

      // Only call getTokenUsage if modelUsage is not already provided by the service
      if (!res.modelUsage) {
        const tokenUsage = this.aiImpl.getTokenUsage();
        if (tokenUsage) {
          res.modelUsage = {
            ai: this.name,
            model: model as string,
            tokens: tokenUsage,
          };
        }
      }

      if (res.modelUsage) {
        this.modelUsage = res.modelUsage;
        this.recordTokenUsage(
          res.modelUsage.model,
          res.modelUsage.tokens,
          options
        );
        this.recordEstimatedCost(
          'chat',
          this.estimateCostByName(res.modelUsage.model, res.modelUsage),
          res.modelUsage.model,
          options
        );
      }

      if (span?.isRecording()) {
        setChatResponseEvents(res, span, excludeContentFromTrace);
        span.end();
      }

      if (debug) {
        logResponse(res, logger);
      }

      return res;
    } catch (error) {
      recordSpanException(span, error);
      if (span?.isRecording()) {
        span.end();
      }
      throw error;
    }
  }

  async embed(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse> {
    const startTime = performance.now();
    let isError = false;
    let result: AxEmbedResponse | undefined;

    // Merge per-model-key default options if a key entry provides them
    const modelKeyEntry = this.getModelByKey(
      req.embedModel as TModel | TEmbedModel | TModelKey
    );
    const mergedOptions: Readonly<AxAIServiceOptions> = {
      ...(this.beta !== undefined ? { beta: this.beta } : undefined),
      ...(modelKeyEntry
        ? {
            thinkingTokenBudget: (
              modelKeyEntry as {
                thinkingTokenBudget?: AxAIServiceOptions['thinkingTokenBudget'];
              }
            ).thinkingTokenBudget,
            showThoughts: (
              modelKeyEntry as {
                showThoughts?: AxAIServiceOptions['showThoughts'];
              }
            ).showThoughts,
            stream: (
              modelKeyEntry as {
                stream?: AxAIServiceOptions['stream'];
              }
            ).stream,
            debug: (
              modelKeyEntry as {
                debug?: AxAIServiceOptions['debug'];
              }
            ).debug,
            useExpensiveModel: (
              modelKeyEntry as {
                useExpensiveModel?: AxAIServiceOptions['useExpensiveModel'];
              }
            ).useExpensiveModel,
            beta: (
              modelKeyEntry as {
                beta?: AxAIServiceOptions['beta'];
              }
            ).beta,
          }
        : undefined),
      ...options,
    } as AxAIServiceOptions;

    try {
      result = await this._embed1(req, mergedOptions);
      return result;
    } catch (error) {
      isError = true;
      // Check for specific error types
      if (error instanceof Error) {
        if (
          error.message.includes('timeout') ||
          error.name === 'TimeoutError'
        ) {
          this.recordTimeoutMetric('embed', mergedOptions);
        } else if (
          error.message.includes('abort') ||
          error.name === 'AbortError'
        ) {
          this.recordAbortMetric('embed', mergedOptions);
        }
      }
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.updateLatencyMetrics('embed', duration, mergedOptions);
      this.updateErrorMetrics('embed', isError, mergedOptions);

      // Record additional metrics if successful
      if (!isError && result) {
        this.recordEmbedMetrics(req, result, mergedOptions);
      }
    }
  }

  private async _embed1(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse> {
    const embedModel =
      this.getEmbedModel(req.embedModel) ??
      (req.embedModel as TEmbedModel) ??
      this.defaults.embedModel;

    if (!embedModel) {
      throw new Error('No embed model defined');
    }

    const tracer = this.getEffectiveTracer(options);
    if (tracer) {
      return await tracer.startActiveSpan(
        'AI Embed Request',
        {
          kind: SpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_OPERATION_NAME]: 'embeddings',
            [axSpanAttributes.LLM_REQUEST_MODEL]: embedModel as string,
            ...(options?.sessionId
              ? {
                  [axSpanAttributes.LLM_CONVERSATION_ID]: options.sessionId,
                  [axSpanAttributes.AX_SESSION_ID]: options.sessionId,
                }
              : {}),
          },
        },
        options?.traceContext ?? context.active(),
        async (span) => {
          return await this._embed2(embedModel, req, options, span);
        }
      );
    }
    return await this._embed2(embedModel, req, options);
  }

  private async _embed2(
    embedModel: TEmbedModel,
    embedReq: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceOptions>,
    span?: Span
  ): Promise<AxEmbedResponse> {
    if (!this.aiImpl.createEmbedReq) {
      throw new Error('createEmbedReq not implemented');
    }
    if (!this.aiImpl.createEmbedResp) {
      throw new Error('createEmbedResp not implemented');
    }

    // Bind provider implementation method to preserve `this` and satisfy TS
    const createEmbedReq = this.aiImpl.createEmbedReq!.bind(this.aiImpl);
    const debug = this.getEffectiveDebug(options);
    const verbose = options?.verbose ?? this.#verbose;
    const logger = this.getEffectiveLogger(options);
    const abortSignal = this.getEffectiveAbortSignal(options);

    const req = {
      ...embedReq,
      embedModel,
    };

    // Store the last used embed model
    this.lastUsedEmbedModel = embedModel;

    if (debug) {
      logEmbedRequest(req.texts ?? [], embedModel as string, logger);
    }

    let responseMetadata: AxResponseCorrelationMetadata = {};
    const onResponseMetadata = (metadata: { headers: Headers }): void => {
      responseMetadata = mergeCorrelationMetadata(
        responseMetadata,
        extractResponseCorrelationMetadata(metadata.headers, this.name)
      );
    };

    const fn = async () => {
      const [apiConfig, reqValue] = await createEmbedReq(req, options);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: apiConfig.url ?? this.apiURL,
          localCall: apiConfig.localCall,
          headers: await this.buildHeaders(apiConfig.headers),
          verbose,
          fetch: this.fetch,
          timeout: this.timeout,
          span,
          abortSignal,
          corsProxy: this.corsProxy,
          onResponseMetadata,
          retry: options?.retry ?? this.retry,
          includeRequestBodyInErrors:
            options?.includeRequestBodyInErrors ??
            this.includeRequestBodyInErrors,
        },
        reqValue
      );
      return res;
    };

    const rt = options?.rateLimiter ?? this.rt;
    let resValue: Awaited<ReturnType<typeof fn>>;
    try {
      resValue = rt
        ? await rt(fn, { modelUsage: this.embedModelUsage })
        : await fn();
    } catch (error) {
      recordSpanException(span, error);
      if (span?.isRecording()) {
        span.end();
      }
      throw error;
    }

    let res: AxEmbedResponse;
    try {
      res = this.aiImpl.createEmbedResp(resValue as TEmbedResponse);
      applyResponseCorrelationMetadata(
        res,
        options?.sessionId,
        responseMetadata
      );
    } catch (error) {
      recordSpanException(span, error);
      if (span?.isRecording()) {
        span.end();
      }
      throw error;
    }

    // Only call getTokenUsage if modelUsage is not already provided by the service
    if (!res.modelUsage) {
      const tokenUsage = this.aiImpl.getTokenUsage();
      if (tokenUsage) {
        res.modelUsage = {
          ai: this.name,
          model: embedModel as string,
          tokens: tokenUsage,
        };
      }
    }
    this.embedModelUsage = res.modelUsage;
    if (res.modelUsage) {
      this.recordTokenUsage(
        res.modelUsage.model,
        res.modelUsage.tokens,
        options
      );
      this.recordEstimatedCost(
        'embed',
        this.estimateCostByName(res.modelUsage.model, res.modelUsage),
        res.modelUsage.model,
        options
      );
    }

    if (span?.isRecording()) {
      setResponseCorrelationAttributes(res, span);
      if (res.modelUsage?.tokens) {
        span.addEvent(axSpanEvents.GEN_AI_USAGE, {
          [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
            res.modelUsage.tokens.promptTokens,
          [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
            res.modelUsage.tokens.completionTokens ?? 0,
          [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
            res.modelUsage.tokens.totalTokens,
        });
      }
    }

    if (debug) {
      logEmbedResponse(res.embeddings, logger);
    }

    span?.end();
    return res;
  }

  private async buildHeaders(
    headers: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    return { ...(await this.headers()), ...headers };
  }

  private getModelByKey(
    modelName?: TModel | TEmbedModel | TModelKey
  ): AxAIInputModelList<TModel, TEmbedModel, TModelKey>[number] | undefined {
    if (!modelName) {
      return undefined;
    }
    const item = this.models?.find((v) => v.key === modelName);
    return item;
  }

  private getModel(modelName?: TModel | TModelKey): TModel | undefined {
    const item = this.getModelByKey(modelName);
    return item && 'model' in item ? item.model : undefined;
  }

  private getEmbedModel(
    modelName?: TEmbedModel | TModelKey
  ): TEmbedModel | undefined {
    const item = this.getModelByKey(modelName);
    return item && 'embedModel' in item ? item.embedModel : undefined;
  }

  /**
   * Handle context caching for providers that support it.
   * This method manages cache lookup, creation, TTL refresh, and cache operations.
   *
   * Behavior: If contextCache is present, caching is enabled.
   * - If `name` is provided, use that cache directly
   * - Otherwise, auto-create/reuse cache based on content hash
   */
  private async handleContextCaching(
    model: TModel,
    req: Readonly<AxInternalChatRequest<TModel>>,
    options?: Readonly<AxAIServiceOptions>,
    span?: Span
  ): Promise<{
    preparedRequest?: {
      apiConfig: import('../util/apicall.js').AxAPI;
      request: TChatRequest;
    };
    cacheInfo?: AxContextCacheInfo;
  } | null> {
    const cacheOptions = options?.contextCache;

    // If caching is not configured, skip
    if (!cacheOptions) {
      return null;
    }

    const supportsExplicit = this.aiImpl.supportsContextCache?.(model) ?? false;
    const supportsImplicit =
      this.aiImpl.supportsImplicitCaching?.(model) ?? false;

    // If provider supports neither explicit nor implicit caching, throw error
    if (!supportsExplicit && !supportsImplicit) {
      throw new Error(
        `Context caching is not supported by this provider/model (${this.getName()}/${model}). ` +
          `Remove the contextCache option or use a provider that supports caching.`
      );
    }

    // If provider only supports implicit caching (e.g., Anthropic), return null
    // Implicit caching is handled at the request level (cache_control injection)
    if (!supportsExplicit) {
      return null;
    }
    const ttlSeconds = cacheOptions.ttlSeconds ?? 3600; // Default 1 hour
    const refreshWindowSeconds = cacheOptions.refreshWindowSeconds ?? 300; // 5 minutes
    const minTokens = cacheOptions.minTokens ?? 2048;

    // If an explicit cache name is provided, use it directly
    if (cacheOptions.name) {
      return this.useCacheByName(model, req, cacheOptions.name, options, span);
    }

    // Compute content hash for cache lookup/validation
    const cacheableToolState = this.getContextCacheToolState(req, cacheOptions);
    const contentHash = computeCacheableContentHash(req, cacheableToolState);

    // Check if there's no cacheable content
    if (!contentHash || contentHash === createHash('sha256').digest('hex')) {
      return null;
    }

    const cacheKey: ContextCacheKey = {
      providerName: this.getName(),
      model: String(model),
      contentHash,
    };

    const cacheKeyStr = buildCacheKey(cacheKey);
    const now = Date.now();

    // Use external registry if provided, otherwise use in-memory registry
    const externalRegistry = cacheOptions.registry;

    // Look up existing cache entry
    const existingEntry = externalRegistry
      ? await externalRegistry.get(cacheKeyStr)
      : contextCacheRegistry.get(cacheKeyStr);

    if (existingEntry && existingEntry.expiresAt > now) {
      // Cache hit - check if we need to refresh TTL
      const shouldRefresh =
        existingEntry.expiresAt - now < refreshWindowSeconds * 1000;

      if (shouldRefresh && this.aiImpl.buildCacheUpdateTTLOp) {
        // Refresh TTL
        await this.executeCacheOperation(
          this.aiImpl.buildCacheUpdateTTLOp(
            existingEntry.cacheName,
            ttlSeconds
          ),
          options,
          span
        );

        // Update entry with new expiration
        const updatedEntry = {
          cacheName: existingEntry.cacheName,
          expiresAt: now + ttlSeconds * 1000,
          tokenCount: existingEntry.tokenCount,
        };

        if (externalRegistry) {
          await externalRegistry.set(cacheKeyStr, updatedEntry);
        } else {
          contextCacheRegistry.set(cacheKeyStr, {
            ...updatedEntry,
            contentHash,
            lastTouchedAt: now,
          });
        }
      }

      // Use the existing cache
      return this.useCacheByName(
        model,
        req,
        existingEntry.cacheName,
        options,
        span
      );
    }

    // Cache miss or expired - create a new cache
    // Check minimum token threshold (heuristic: ~4 chars per token)
    const estimatedTokens = this.estimateCacheableTokens(
      req,
      cacheableToolState
    );
    if (estimatedTokens < minTokens) {
      // Below threshold, don't create explicit cache
      return null;
    }

    // Build and execute cache creation operation
    const createOp = this.aiImpl.buildCacheCreateOp?.(req, options);
    if (createOp) {
      const cacheInfo = await this.executeCacheOperation(
        createOp,
        options,
        span
      );

      if (cacheInfo) {
        // Store in registry
        const newEntry = {
          cacheName: cacheInfo.name,
          expiresAt: new Date(cacheInfo.expiresAt).getTime(),
          tokenCount: cacheInfo.tokenCount,
        };

        if (externalRegistry) {
          await externalRegistry.set(cacheKeyStr, newEntry);
        } else {
          contextCacheRegistry.set(cacheKeyStr, {
            ...newEntry,
            contentHash,
            lastTouchedAt: now,
          });
        }

        // Use the newly created cache
        return this.useCacheByName(model, req, cacheInfo.name, options, span);
      }
    }

    return null;
  }

  /**
   * Use an existing cache by name to prepare the chat request.
   */
  private async useCacheByName(
    _model: TModel,
    req: Readonly<AxInternalChatRequest<TModel>>,
    cacheName: string,
    options?: Readonly<AxAIServiceOptions>,
    _span?: Span
  ): Promise<{
    preparedRequest?: {
      apiConfig: import('../util/apicall.js').AxAPI;
      request: TChatRequest;
    };
    cacheInfo?: AxContextCacheInfo;
  } | null> {
    // Use the provider's prepareCachedChatReq if available
    if (this.aiImpl.prepareCachedChatReq) {
      const prepared = await this.aiImpl.prepareCachedChatReq(
        req,
        options ?? {},
        cacheName
      );
      return {
        preparedRequest: {
          apiConfig: prepared.apiConfig,
          request: prepared.request,
        },
      };
    }

    // Fallback: provider doesn't support cached request preparation
    return null;
  }

  private getContextCacheToolState(
    req: Readonly<AxInternalChatRequest<TModel>>,
    cacheOptions: Readonly<AxAIServiceOptions['contextCache']>
  ) {
    if (!cacheOptions) {
      return undefined;
    }

    return (
      this.aiImpl.getContextCacheToolState?.(req, {
        contextCache: cacheOptions,
      }) ?? getCacheableToolState(req)
    );
  }

  /**
   * Execute a context cache operation (create/update/delete).
   */
  private async executeCacheOperation(
    op: AxContextCacheOperation,
    options?: Readonly<AxAIServiceOptions>,
    span?: Span
  ): Promise<AxContextCacheInfo | undefined> {
    const verbose = options?.verbose ?? this.#verbose;
    const abortSignal = this.getEffectiveAbortSignal(options);

    try {
      span?.addEvent('context_cache.operation', {
        type: op.type,
        endpoint: op.apiConfig.name,
      });

      const response = await apiCall(
        {
          name: op.apiConfig.name,
          url: op.apiConfig.url ?? this.apiURL,
          localCall: op.apiConfig.localCall,
          headers: await this.buildHeaders(op.apiConfig.headers),
          stream: false,
          timeout: this.timeout,
          verbose,
          fetch: this.fetch,
          span,
          abortSignal,
          corsProxy: this.corsProxy,
          retry: options?.retry ?? this.retry,
          includeRequestBodyInErrors:
            options?.includeRequestBodyInErrors ??
            this.includeRequestBodyInErrors,
        },
        op.request
      );

      return op.parseResponse(response);
    } catch (error) {
      // Log but don't fail the main request if cache operation fails
      span?.addEvent('context_cache.error', {
        type: op.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Estimate the number of tokens in cacheable content.
   * Uses a simple heuristic of ~4 characters per token.
   * Includes: system prompts (always) + messages/parts marked with cache: true.
   */
  private estimateCacheableTokens<TModel>(
    req: Readonly<AxInternalChatRequest<TModel>>,
    cacheableToolState?: {
      functions?: AxChatRequest['functions'];
      functionCall?: AxChatRequest['functionCall'];
    }
  ): number {
    const { chatPrompt } = req;
    let charCount = 0;

    for (const msg of chatPrompt) {
      // Always include system prompts
      if (msg.role === 'system') {
        charCount += msg.content.length;
        continue;
      }

      // Include other messages/parts only if marked with cache: true
      if ('cache' in msg && msg.cache) {
        if (msg.role === 'user') {
          if (typeof msg.content === 'string') {
            charCount += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if ('cache' in part && part.cache) {
                if (part.type === 'text') {
                  charCount += part.text.length;
                }
                // Images, audio, files are harder to estimate; use a fixed amount
                else if (part.type === 'image') {
                  charCount += 1000; // Images typically use ~1000 tokens
                } else if (part.type === 'audio') {
                  charCount += 2000; // Audio uses more tokens
                } else if (part.type === 'file') {
                  charCount += 500; // Files vary widely
                }
              }
            }
          }
        } else if (msg.role === 'assistant') {
          if (msg.content) {
            charCount += msg.content.length;
          }
          if (msg.functionCalls) {
            for (const call of msg.functionCalls) {
              charCount += call.function.name.length;
              charCount += stringifyFunctionParams(call.function.params).length;
            }
          }
        } else if (msg.role === 'function') {
          charCount += msg.functionId.length;
          charCount += msg.result.length;
        }
      }
    }

    if (cacheableToolState) {
      charCount += stableStringify(cacheableToolState).length;
    }

    // Heuristic: ~4 characters per token
    return Math.ceil(charCount / 4);
  }
}

export function setChatRequestEvents(
  req: Readonly<AxChatRequest<unknown>>,
  span: Span,
  excludeContentFromTrace?: boolean
): void {
  const userMessages: string[] = [];

  if (
    req.chatPrompt &&
    Array.isArray(req.chatPrompt) &&
    req.chatPrompt.length > 0
  ) {
    for (const prompt of req.chatPrompt) {
      switch (prompt.role) {
        case 'system':
          if (prompt.content) {
            const eventData: { content?: string } = {};
            if (!excludeContentFromTrace) {
              eventData.content = prompt.content;
            }
            span.addEvent(axSpanEvents.GEN_AI_SYSTEM_MESSAGE, eventData);
          }
          break;
        case 'user':
          if (typeof prompt.content === 'string') {
            userMessages.push(prompt.content);
          } else if (Array.isArray(prompt.content)) {
            for (const part of prompt.content) {
              if (part.type === 'text') {
                userMessages.push(part.text);
              }
            }
          }
          break;
        case 'assistant': {
          const functionCalls = prompt.functionCalls?.map((call) => {
            return {
              id: call.id,
              type: call.type,
              function: call.function.name,
              arguments: call.function.params,
            };
          });

          if (functionCalls && functionCalls.length > 0) {
            const eventData: { content?: string; function_calls: string } = {
              function_calls: JSON.stringify(functionCalls, null, 2),
            };
            if (!excludeContentFromTrace && prompt.content) {
              eventData.content = prompt.content;
            }
            span.addEvent(axSpanEvents.GEN_AI_ASSISTANT_MESSAGE, eventData);
          } else if (prompt.content) {
            const eventData: { content?: string } = {};
            if (!excludeContentFromTrace) {
              eventData.content = prompt.content;
            }
            span.addEvent(axSpanEvents.GEN_AI_ASSISTANT_MESSAGE, eventData);
          }
          break;
        }

        case 'function': {
          const eventData: { content?: string; id: string } = {
            id: prompt.functionId,
          };
          if (!excludeContentFromTrace) {
            eventData.content = prompt.result;
          }
          span.addEvent(axSpanEvents.GEN_AI_TOOL_MESSAGE, eventData);
          break;
        }
      }
    }
  }

  // Always add user message event, even if empty
  const userEventData: { content?: string } = {};
  if (!excludeContentFromTrace) {
    userEventData.content = userMessages.join('\n');
  }
  span.addEvent(axSpanEvents.GEN_AI_USER_MESSAGE, userEventData);
}

export function setChatResponseEvents(
  res: Readonly<AxChatResponse>,
  span: Span,
  excludeContentFromTrace?: boolean
) {
  setResponseCorrelationAttributes(res, span);

  if (res.modelUsage?.tokens) {
    const thoughtsTokensEntry = res.modelUsage.tokens.thoughtsTokens
      ? {
          [axSpanAttributes.LLM_USAGE_THOUGHTS_TOKENS]:
            res.modelUsage.tokens.thoughtsTokens,
        }
      : {};
    span.addEvent(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
        res.modelUsage.tokens.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        res.modelUsage.tokens.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
        res.modelUsage.tokens.totalTokens,
      ...thoughtsTokensEntry,
    });
  }

  if (!res.results) {
    return;
  }

  for (let index = 0; index < res.results.length; index++) {
    const result = res.results[index];
    if (!result) {
      continue;
    }

    // Skip empty results that have no meaningful content to avoid empty GEN_AI_CHOICE events
    if (
      !result.content &&
      !result.thought &&
      !result.functionCalls?.length &&
      !result.finishReason
    ) {
      continue;
    }

    const toolCalls = result.functionCalls?.map((call) => {
      return {
        id: call.id,
        type: call.type,
        function: call.function.name,
        arguments: call.function.params,
      };
    });

    const message: { content?: string; tool_calls?: unknown[] } = {};

    if (toolCalls && toolCalls.length > 0) {
      if (!excludeContentFromTrace) {
        message.content = result.content;
      }
      message.tool_calls = toolCalls;
    } else {
      if (!excludeContentFromTrace) {
        message.content = result.content ?? '';
      }
    }

    span.addEvent(axSpanEvents.GEN_AI_CHOICE, {
      finish_reason: result.finishReason,
      index,
      message: JSON.stringify(message, null, 2),
    });
  }
}

function _validateModels<TModel, TEmbedModel, TModelKey>(
  models: Readonly<AxAIInputModelList<TModel, TEmbedModel, TModelKey>>
): void {
  // Validate duplicate keys in models.
  const keys = new Set<TModelKey>();
  for (const model of models) {
    if (keys.has(model.key)) {
      throw new Error(
        `Duplicate model key detected: "${model.key}". Each model key must be unique.`
      );
    }
    keys.add(model.key);
  }
}
