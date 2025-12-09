import { context, type Span, SpanKind } from '@opentelemetry/api';
import { axGlobals } from '../dsp/globals.js';
import { defaultLogger } from '../dsp/loggers.js';
import type { AxMessage } from '../dsp/types.js';
import { axSpanAttributes, axSpanEvents } from '../trace/trace.js';
import { apiCall } from '../util/apicall.js';
import { randomUUID } from '../util/crypto.js';
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
  recordAbortMetric,
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
import type {
  AxAIInputModelList,
  AxAIService,
  AxAIServiceImpl,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxLoggerFunction,
  AxModelConfig,
  AxModelInfo,
  AxModelUsage,
} from './types.js';
import { axValidateChatRequestMessage } from './validate.js';

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
  #debug = false;

  private rt?: AxAIServiceOptions['rateLimiter'];
  private fetch?: AxAIServiceOptions['fetch'];
  private tracer?: AxAIServiceOptions['tracer'];
  private meter?: AxAIServiceOptions['meter'];
  private timeout?: AxAIServiceOptions['timeout'];
  private excludeContentFromTrace?: boolean;
  private models?: AxAIInputModelList<TModel, TEmbedModel, TModelKey>;
  private abortSignal?: AbortSignal;
  private logger: AxLoggerFunction = axGlobals.logger ?? defaultLogger;
  private corsProxy?: AxAIServiceOptions['corsProxy'];

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
    this.tracer = options.tracer ?? axGlobals.tracer;
    this.meter = options.meter ?? axGlobals.meter;
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

  private getMetricsInstruments(): AxAIMetricsInstruments | undefined {
    return getOrCreateAIMetricsInstruments(this.meter);
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
    return this.#debug;
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.#debug = options.debug ?? axGlobals.debug ?? false;
    this.rt = options.rateLimiter;
    this.fetch = options.fetch;
    this.timeout = options.timeout;
    this.tracer = options.tracer ?? axGlobals.tracer;
    this.meter = options.meter ?? axGlobals.meter;
    this.excludeContentFromTrace = options.excludeContentFromTrace;
    this.abortSignal = options.abortSignal;
    this.logger = options.logger ?? axGlobals.logger ?? this.logger;
    this.corsProxy = options.corsProxy;
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return {
      debug: this.#debug,
      rateLimiter: this.rt,
      fetch: this.fetch,
      tracer: this.tracer,
      meter: this.meter,
      timeout: this.timeout,
      excludeContentFromTrace: this.excludeContentFromTrace,
      abortSignal: this.abortSignal,
      logger: this.logger,
      corsProxy: this.corsProxy,
    };
  }

  getLogger(): AxLoggerFunction {
    return this.logger;
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
  private updateLatencyMetrics(type: 'chat' | 'embed', duration: number): void {
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
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);

      // Record individual latency measurement
      recordLatencyMetric(metricsInstruments, type, duration, this.name, model);

      // Record latency statistics as gauges
      recordLatencyStatsMetrics(
        metricsInstruments,
        type,
        metrics.mean,
        metrics.p95,
        metrics.p99,
        this.name,
        model
      );
    }
  }

  // Method to update error metrics
  private updateErrorMetrics(type: 'chat' | 'embed', isError: boolean): void {
    const metrics = this.metrics.errors[type];
    metrics.total++;
    if (isError) {
      metrics.count++;
    }
    metrics.rate = metrics.count / metrics.total;

    // Export to OpenTelemetry metrics
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);

      // Always record request count
      recordRequestMetric(metricsInstruments, type, this.name, model);

      // Record error count if there was an error
      if (isError) {
        recordErrorMetric(metricsInstruments, type, this.name, model);
      }

      // Record current error rate as a gauge
      recordErrorRateMetric(
        metricsInstruments,
        type,
        metrics.rate,
        this.name,
        model
      );
    }
  }

  // Method to record token usage metrics
  private recordTokenUsage(modelUsage?: AxModelUsage): void {
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments && modelUsage?.tokens) {
      const { promptTokens, completionTokens, totalTokens, thoughtsTokens } =
        modelUsage.tokens;

      if (promptTokens) {
        recordTokenMetric(
          metricsInstruments,
          'input',
          promptTokens,
          this.name,
          modelUsage.model
        );
      }

      if (completionTokens) {
        recordTokenMetric(
          metricsInstruments,
          'output',
          completionTokens,
          this.name,
          modelUsage.model
        );
      }

      if (totalTokens) {
        recordTokenMetric(
          metricsInstruments,
          'total',
          totalTokens,
          this.name,
          modelUsage.model
        );
      }

      if (thoughtsTokens) {
        recordTokenMetric(
          metricsInstruments,
          'thoughts',
          thoughtsTokens,
          this.name,
          modelUsage.model
        );
      }
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

  // Helper method to calculate prompt length
  private calculatePromptLength(
    req: Readonly<AxChatRequest<TModel | TModelKey>>
  ): number {
    let totalLength = 0;

    if (req.chatPrompt && Array.isArray(req.chatPrompt)) {
      for (const message of req.chatPrompt) {
        if (message.role === 'system' || message.role === 'assistant') {
          if (message.content) {
            totalLength += message.content.length;
          }
        } else if (message.role === 'user') {
          if (typeof message.content === 'string') {
            totalLength += message.content.length;
          } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (part.type === 'text') {
                totalLength += part.text.length;
              }
            }
          }
        } else if (message.role === 'function') {
          if (message.result) {
            totalLength += message.result.length;
          }
        }
      }
    }

    return totalLength;
  }

  // Helper method to calculate context window usage
  private calculateContextWindowUsage(
    model: TModel,
    modelUsage?: AxModelUsage
  ): number {
    if (!modelUsage?.tokens?.promptTokens) return 0;

    // Get model info to find context window size
    const modelInfo = this.modelInfo.find(
      (info) => info.name === (model as string)
    );
    if (!modelInfo?.contextWindow) return 0;

    return modelUsage.tokens.promptTokens / modelInfo.contextWindow;
  }

  // Helper method to estimate cost
  private estimateCost(model: TModel, modelUsage?: AxModelUsage): number {
    if (!modelUsage?.tokens) return 0;

    // Get model info to find pricing
    const modelInfo = this.modelInfo.find(
      (info) => info.name === (model as string)
    );
    if (
      !modelInfo ||
      (!modelInfo.promptTokenCostPer1M && !modelInfo.completionTokenCostPer1M)
    )
      return 0;

    const { promptTokens = 0, completionTokens = 0 } = modelUsage.tokens;
    const promptCostPer1M = modelInfo.promptTokenCostPer1M || 0;
    const completionCostPer1M = modelInfo.completionTokenCostPer1M || 0;

    return (
      (promptTokens * promptCostPer1M) / 1000000 +
      (completionTokens * completionCostPer1M) / 1000000
    );
  }

  // Helper method to estimate cost by model name
  private estimateCostByName(
    modelName: string,
    modelUsage?: AxModelUsage
  ): number {
    if (!modelUsage?.tokens) return 0;

    // Get model info to find pricing
    const modelInfo = this.modelInfo.find((info) => info.name === modelName);
    if (
      !modelInfo ||
      (!modelInfo.promptTokenCostPer1M && !modelInfo.completionTokenCostPer1M)
    )
      return 0;

    const { promptTokens = 0, completionTokens = 0 } = modelUsage.tokens;
    const promptCostPer1M = modelInfo.promptTokenCostPer1M || 0;
    const completionCostPer1M = modelInfo.completionTokenCostPer1M || 0;

    return (
      (promptTokens * promptCostPer1M) / 1000000 +
      (completionTokens * completionCostPer1M) / 1000000
    );
  }

  // Helper method to record function call metrics
  private recordFunctionCallMetrics(
    functionCalls?: readonly unknown[],
    model?: TModel
  ): void {
    const metricsInstruments = this.getMetricsInstruments();
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
          model as string
        );
      }
    }
  }

  // Helper method to record timeout metrics
  private recordTimeoutMetric(type: 'chat' | 'embed'): void {
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      recordTimeoutMetric(metricsInstruments, type, this.name, model);
    }
  }

  // Helper method to record abort metrics
  private recordAbortMetric(type: 'chat' | 'embed'): void {
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments) {
      const model =
        type === 'chat'
          ? (this.lastUsedChatModel as string)
          : (this.lastUsedEmbedModel as string);
      recordAbortMetric(metricsInstruments, type, this.name, model);
    }
  }

  // Comprehensive method to record all chat-related metrics
  private recordChatMetrics(
    req: Readonly<AxChatRequest<TModel | TModelKey>>,
    options?: Readonly<AxAIServiceOptions>,
    result?: AxChatResponse | ReadableStream<AxChatResponse>
  ): void {
    const metricsInstruments = this.getMetricsInstruments();
    if (!metricsInstruments) return;

    const model = this.lastUsedChatModel as string;
    const modelConfig = this.lastUsedModelConfig;

    // Record streaming request metric
    const isStreaming = modelConfig?.stream ?? false;
    recordStreamingRequestMetric(
      metricsInstruments,
      'chat',
      isStreaming,
      this.name,
      model
    );

    // Record multimodal request metric
    const { hasImages, hasAudio } = this.detectMultimodalContent(req);
    recordMultimodalRequestMetric(
      metricsInstruments,
      hasImages,
      hasAudio,
      this.name,
      model
    );

    // Record prompt length metric
    const promptLength = this.calculatePromptLength(req);
    recordPromptLengthMetric(
      metricsInstruments,
      promptLength,
      this.name,
      model
    );

    // Record model configuration metrics
    recordModelConfigMetrics(
      metricsInstruments,
      modelConfig?.temperature,
      modelConfig?.maxTokens,
      this.name,
      model
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
        model
      );
    }

    // Record request size
    const requestSize = this.calculateRequestSize(req);
    recordRequestSizeMetric(
      metricsInstruments,
      'chat',
      requestSize,
      this.name,
      model
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
        model
      );

      // Record function call metrics
      if (chatResponse.results) {
        for (const chatResult of chatResponse.results) {
          if (chatResult.functionCalls) {
            this.recordFunctionCallMetrics(
              chatResult.functionCalls,
              this.lastUsedChatModel
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
          model
        );
      }

      // Record estimated cost
      const estimatedCost = this.estimateCost(
        this.lastUsedChatModel!,
        chatResponse.modelUsage
      );
      if (estimatedCost > 0) {
        recordEstimatedCostMetric(
          metricsInstruments,
          'chat',
          estimatedCost,
          this.name,
          model
        );
      }
    }
  }

  // Comprehensive method to record all embed-related metrics
  private recordEmbedMetrics(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    result: Readonly<AxEmbedResponse>
  ): void {
    const metricsInstruments = this.getMetricsInstruments();
    if (!metricsInstruments) return;

    const model = this.lastUsedEmbedModel as string;

    // Record request size
    const requestSize = this.calculateRequestSize(req);
    recordRequestSizeMetric(
      metricsInstruments,
      'embed',
      requestSize,
      this.name,
      model
    );

    // Record response size
    const responseSize = this.calculateResponseSize(result);
    recordResponseSizeMetric(
      metricsInstruments,
      'embed',
      responseSize,
      this.name,
      model
    );

    // Record estimated cost
    const estimatedCost = this.estimateCostByName(model, result.modelUsage);
    if (estimatedCost > 0) {
      recordEstimatedCostMetric(
        metricsInstruments,
        'embed',
        estimatedCost,
        this.name,
        model
      );
    }
  }

  // Public method to get metrics
  public getMetrics(): AxAIServiceMetrics {
    return structuredClone(this.metrics);
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
          this.recordTimeoutMetric('chat');
        } else if (
          error.message.includes('abort') ||
          error.name === 'AbortError'
        ) {
          this.recordAbortMetric('chat');
        }
      }
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.updateLatencyMetrics('chat', duration);
      this.updateErrorMetrics('chat', isError);

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

    const selectedModelInfo = this.modelInfo.find(
      (info) => info.name === (model as string)
    );
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

    // Check for thinkingTokenBudget support
    if (
      options?.thinkingTokenBudget &&
      !this.getFeatures(model).hasThinkingBudget
    ) {
      throw new Error(
        `Model ${model as string} does not support thinkingTokenBudget.`
      );
    }

    // Check for showThoughts support
    if (options?.showThoughts && !this.getFeatures(model).hasShowThoughts) {
      throw new Error(
        `Model ${model as string} does not support showThoughts.`
      );
    }

    // Check for expensive model usage
    const modelInfo = this.modelInfo.find(
      (info) => info.name === (model as string)
    );
    if (modelInfo?.isExpensive && options?.useExpensiveModel !== 'yes') {
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

    if (this.tracer) {
      return await this.tracer.startActiveSpan(
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

    const debug = options?.debug ?? this.#debug;

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
        options?.logger ?? this.logger,
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

    const fn = async () => {
      const [apiConfig, reqValue] = await this.aiImpl.createChatReq(
        effectiveReq,
        options
      );

      if (span?.isRecording()) {
        setChatRequestEvents(chatReq, span, this.excludeContentFromTrace);
      }

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          localCall: apiConfig.localCall,
          headers: await this.buildHeaders(apiConfig.headers),
          stream: modelConfig.stream,
          timeout: this.timeout,
          debug,
          fetch: this.fetch,
          span,
          abortSignal: options?.abortSignal ?? this.abortSignal,
          corsProxy: this.corsProxy,
        },
        reqValue
      );
      return res;
    };

    const rt = options?.rateLimiter ?? this.rt;
    const rv = rt ? await rt(fn, { modelUsage: this.modelUsage }) : await fn();

    if (modelConfig.stream) {
      if (!this.aiImpl.createChatStreamResp) {
        throw new Error('createChatStreamResp not implemented');
      }

      const respFn = this.aiImpl.createChatStreamResp.bind(this);
      const wrappedRespFn =
        (state: object) => (resp: Readonly<TChatResponseDelta>) => {
          const res = respFn(resp, state);
          res.sessionId = options?.sessionId;

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
          this.recordTokenUsage(res.modelUsage);

          if (span?.isRecording()) {
            setChatResponseEvents(res, span, this.excludeContentFromTrace);
          }

          return res;
        };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const doneCb = async (values: readonly AxChatResponse[]) => {
        if (span?.isRecording()) {
          span.end();
        }
        if (debug) {
          logResponseStreamingDoneResult(
            values,
            options?.logger ?? this.logger
          );
        }
      };

      // Check if we're in browser environment for compatibility
      const isBrowser = typeof window !== 'undefined';

      if (isBrowser) {
        // Use browser-compatible manual stream processing instead of pipeThrough
        const sourceStream = rv as ReadableStream<TChatResponseDelta>;
        const transformState = {};
        const transformedValues: AxChatResponse[] = [];
        const abortSignal = options?.abortSignal ?? this.abortSignal;
        return new ReadableStream<AxChatResponse>({
          start: (controller) => {
            const reader = sourceStream.getReader();

            const onAbort = () => {
              try {
                reader.cancel().catch(() => {});
              } catch {}
              try {
                this.recordAbortMetric('chat');
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

    const res = this.aiImpl.createChatResp(rv as TChatResponse);
    res.sessionId = options?.sessionId;

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
      this.recordTokenUsage(res.modelUsage);
    }

    if (span?.isRecording()) {
      setChatResponseEvents(res, span, this.excludeContentFromTrace);
      span.end();
    }

    if (debug) {
      logResponse(res, options?.logger ?? this.logger);
    }

    return res;
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
          this.recordTimeoutMetric('embed');
        } else if (
          error.message.includes('abort') ||
          error.name === 'AbortError'
        ) {
          this.recordAbortMetric('embed');
        }
      }
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      this.updateLatencyMetrics('embed', duration);
      this.updateErrorMetrics('embed', isError);

      // Record additional metrics if successful
      if (!isError && result) {
        this.recordEmbedMetrics(req, result);
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

    if (this.tracer) {
      return await this.tracer.startActiveSpan(
        'AI Embed Request',
        {
          kind: SpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_OPERATION_NAME]: 'embeddings',
            [axSpanAttributes.LLM_REQUEST_MODEL]: embedModel as string,
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
    const debug = options?.debug ?? this.#debug;

    const req = {
      ...embedReq,
      embedModel,
    };

    // Store the last used embed model
    this.lastUsedEmbedModel = embedModel;

    if (debug) {
      logEmbedRequest(
        req.texts ?? [],
        embedModel as string,
        options?.logger ?? this.logger
      );
    }

    const fn = async () => {
      const [apiConfig, reqValue] = await createEmbedReq(req);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          localCall: apiConfig.localCall,
          headers: await this.buildHeaders(apiConfig.headers),
          debug,
          fetch: this.fetch,
          timeout: this.timeout,
          span,
          abortSignal: options?.abortSignal ?? this.abortSignal,
          corsProxy: this.corsProxy,
        },
        reqValue
      );
      return res;
    };

    const rt = options?.rateLimiter ?? this.rt;
    const resValue = rt
      ? await rt(fn, { modelUsage: this.embedModelUsage })
      : await fn();
    const res = this.aiImpl.createEmbedResp?.(resValue as TEmbedResponse);

    res.sessionId = options?.sessionId;

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
    this.recordTokenUsage(res.modelUsage);

    if (span?.isRecording() && res.modelUsage?.tokens) {
      span.addEvent(axSpanEvents.GEN_AI_USAGE, {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
          res.modelUsage.tokens.promptTokens,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
          res.modelUsage.tokens.completionTokens ?? 0,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
          res.modelUsage.tokens.totalTokens,
      });
    }

    if (debug) {
      logEmbedResponse(res.embeddings, options?.logger ?? this.logger);
    }

    span?.end();
    return res;
  }

  private async buildHeaders(
    headers: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    return { ...headers, ...(await this.headers()) };
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

export function validateAxMessageArray<T>(
  values: ReadonlyArray<AxMessage<T>>
): void {
  let index = 0;
  for (const message of values) {
    if (!message || typeof message !== 'object') {
      throw new Error(
        `AxMessage array validation failed: Item at index ${index} is not a valid message object`
      );
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(
        `AxMessage array validation failed: Item at index ${index} has invalid role: ${
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (message as any).role
        }`
      );
    }
    // The current AxMessage design accepts any "values" payload. Do not enforce non-empty object.
    index++;
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
