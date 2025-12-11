// ReadableStream is available globally in modern browsers and Node.js 16+

import {
  AxAIServiceAuthenticationError,
  AxAIServiceError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';

import type { AxAIFeatures } from './base.js';
import type {
  AxAIModelList,
  AxAIService,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxLoggerFunction,
  AxModelConfig,
} from './types.js';

// Helper type to extract model keys from a service
type ExtractServiceModelKeys<T> = T extends AxAIService<any, any, infer K>
  ? K
  : never;

// Helper type to extract model keys from an array of services
type ExtractAllModelKeys<T extends readonly any[]> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? ExtractServiceModelKeys<First> | ExtractAllModelKeys<Rest>
  : never;

/**
 * Options for the balancer.
 */
export type AxBalancerOptions<TModelKey = string> = {
  comparator?: (
    a: AxAIService<unknown, unknown, TModelKey>,
    b: AxAIService<unknown, unknown, TModelKey>
  ) => number;
  debug?: boolean;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxRetries?: number;
};

/**
 * Balancer that rotates through services.
 */
export class AxBalancer<
  TServices extends readonly AxAIService<
    any,
    any,
    any
  >[] = readonly AxAIService[],
  TModelKey = ExtractAllModelKeys<TServices>,
> implements AxAIService<unknown, unknown, TModelKey>
{
  private services: AxAIService<unknown, unknown, TModelKey>[];
  private currentServiceIndex = 0;
  private currentService: AxAIService<unknown, unknown, TModelKey>;
  private debug: boolean;
  private initialBackoffMs: number;
  private maxBackoffMs: number;
  private maxRetries: number;
  private serviceFailures: Map<
    string,
    { retries: number; lastFailureTime: number }
  > = new Map();

  constructor(services: TServices, options?: AxBalancerOptions<TModelKey>) {
    if (services.length === 0) {
      throw new Error('No AI services provided.');
    }

    validateModels(
      services as readonly AxAIService<unknown, unknown, TModelKey>[]
    );

    this.services = [...services].sort(
      options?.comparator ?? AxBalancer.metricComparator<TModelKey>
    ) as AxAIService<unknown, unknown, TModelKey>[];

    const cs = this.services[this.currentServiceIndex];
    if (cs === undefined) {
      throw new Error('Error initializing the AI services.'); // More specific error message
    }
    this.currentService = cs;
    this.debug = options?.debug ?? true;
    this.initialBackoffMs = options?.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options?.maxBackoffMs ?? 32000;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Static factory method for type-safe balancer creation with automatic model key inference.
   */
  static create<const TServices extends readonly AxAIService<any, any, any>[]>(
    services: TServices,
    options?: AxBalancerOptions<ExtractAllModelKeys<TServices>>
  ): AxBalancer<TServices, ExtractAllModelKeys<TServices>> {
    return new AxBalancer(services, options);
  }
  getLastUsedChatModel(): unknown {
    return this.currentService.getLastUsedChatModel();
  }
  getLastUsedEmbedModel(): unknown {
    return this.currentService.getLastUsedEmbedModel();
  }
  getLastUsedModelConfig(): AxModelConfig | undefined {
    return this.currentService.getLastUsedModelConfig();
  }

  /**
   * Service comparator that respects the input order of services.
   */
  public static inputOrderComparator = () => 0;

  /**
   * Service comparator that sorts services by cost.
   */

  // Requires a rethink
  /*
    public static costComparator = (a: AxAIService, b: AxAIService) => {
      const aInfo = a.getModelInfo()
      const bInfo = b.getModelInfo()
      const aTotalCost =
        (aInfo.promptTokenCostPer1M || Infinity) +
        (aInfo.completionTokenCostPer1M || Infinity)
      const bTotalCost =
        (bInfo.promptTokenCostPer1M || Infinity) +
        (bInfo.completionTokenCostPer1M || Infinity)
      return aTotalCost - bTotalCost
    }
    */

  public static metricComparator = <TModelKey = string>(
    a: AxAIService<unknown, unknown, TModelKey>,
    b: AxAIService<unknown, unknown, TModelKey>
  ) => {
    const aMetrics = a.getMetrics();
    const bMetrics = b.getMetrics();
    // Compare mean chat latency between services
    return aMetrics.latency.chat.mean - bMetrics.latency.chat.mean;
  };

  getModelList(): AxAIModelList<TModelKey> | undefined {
    // Return model list from the first service that has one
    // Ideally we would merge them, but they are expected to be the same
    for (const service of this.services) {
      const list = service.getModelList();
      if (list) return list;
    }
    return undefined;
  }

  private getNextService(
    services: AxAIService<unknown, unknown, TModelKey>[],
    currentIndex: number
  ): {
    service: AxAIService<unknown, unknown, TModelKey> | undefined;
    index: number;
  } {
    const nextIndex = currentIndex + 1;
    const cs = services[nextIndex];
    if (cs === undefined) {
      return { service: undefined, index: nextIndex };
    }
    return { service: cs, index: nextIndex };
  }

  private reset(): void {
    // This resets the main pointer, but for per-request routing we might start elsewhere
    this.currentServiceIndex = 0;
    const cs = this.services[this.currentServiceIndex];
    if (cs === undefined) {
      throw new Error('No AI services provided.');
    }
    this.currentService = cs;
  }

  getName(): string {
    return this.currentService.getName();
  }

  getId(): string {
    return this.currentService.getId();
  }

  getFeatures(model?: string) {
    // Aggregate features from all services
    const features: AxAIFeatures = {
      functions: false,
      streaming: false,
      thinking: false,
      multiTurn: false,
      structuredOutputs: false,
      media: {
        images: { supported: false, formats: [] },
        audio: { supported: false, formats: [] },
        files: { supported: false, formats: [], uploadMethod: 'none' },
        urls: { supported: false, webSearch: false, contextFetching: false },
      },
      caching: { supported: false, types: [] },
    };

    for (const service of this.services) {
      const f = service.getFeatures(model);
      if (f.functions) features.functions = true;
      if (f.streaming) features.streaming = true;
      if (f.thinking) features.thinking = true;
      if (f.multiTurn) features.multiTurn = true;
      if (f.structuredOutputs) features.structuredOutputs = true;
      if (f.functionCot) features.functionCot = true;
      if (f.hasThinkingBudget) features.hasThinkingBudget = true;
      if (f.hasShowThoughts) features.hasShowThoughts = true;

      // Merge media capabilities
      if (f.media.images.supported) features.media.images.supported = true;
      features.media.images.formats = Array.from(
        new Set([...features.media.images.formats, ...f.media.images.formats])
      );
      if (f.media.audio.supported) features.media.audio.supported = true;
      features.media.audio.formats = Array.from(
        new Set([...features.media.audio.formats, ...f.media.audio.formats])
      );
      if (f.media.files.supported) features.media.files.supported = true;
      features.media.files.formats = Array.from(
        new Set([...features.media.files.formats, ...f.media.files.formats])
      );
      if (f.media.files.uploadMethod !== 'none') {
        features.media.files.uploadMethod = f.media.files.uploadMethod;
      }
      if (f.media.urls.supported) features.media.urls.supported = true;
      if (f.media.urls.webSearch) features.media.urls.webSearch = true;
      if (f.media.urls.contextFetching)
        features.media.urls.contextFetching = true;

      if (f.caching.supported) features.caching.supported = true;
      features.caching.types = Array.from(
        new Set([...features.caching.types, ...f.caching.types])
      );
    }
    return features;
  }

  getMetrics(): AxAIServiceMetrics {
    // Aggregate metrics from all services
    const metrics: AxAIServiceMetrics = {
      latency: {
        chat: { mean: 0, p95: 0, p99: 0, samples: [] },
        embed: { mean: 0, p95: 0, p99: 0, samples: [] },
      },
      errors: {
        chat: { count: 0, rate: 0, total: 0 },
        embed: { count: 0, rate: 0, total: 0 },
      },
    };

    let chatLatencySum = 0;
    let chatLatencyCount = 0;
    let embedLatencySum = 0;
    let embedLatencyCount = 0;

    for (const service of this.services) {
      const m = service.getMetrics();

      // Aggregate Chat Errors
      metrics.errors.chat.count += m.errors.chat.count;
      metrics.errors.chat.total += m.errors.chat.total;

      // Aggregate Embed Errors
      metrics.errors.embed.count += m.errors.embed.count;
      metrics.errors.embed.total += m.errors.embed.total;

      // Weighted average for chat mean latency
      const chatSamples = m.latency.chat.samples.length;
      if (chatSamples > 0) {
        chatLatencySum += m.latency.chat.mean * chatSamples;
        chatLatencyCount += chatSamples;
      }

      // Weighted average for embed mean latency
      const embedSamples = m.latency.embed.samples.length;
      if (embedSamples > 0) {
        embedLatencySum += m.latency.embed.mean * embedSamples;
        embedLatencyCount += embedSamples;
      }
    }

    if (metrics.errors.chat.total > 0) {
      metrics.errors.chat.rate =
        metrics.errors.chat.count / metrics.errors.chat.total;
    }

    if (metrics.errors.embed.total > 0) {
      metrics.errors.embed.rate =
        metrics.errors.embed.count / metrics.errors.embed.total;
    }

    if (chatLatencyCount > 0) {
      metrics.latency.chat.mean = chatLatencySum / chatLatencyCount;
    }

    if (embedLatencyCount > 0) {
      metrics.latency.embed.mean = embedLatencySum / embedLatencyCount;
    }

    // Note: p95/p99 aggregation is inexact without raw samples,
    // so we take the max of the individual services to show the worst case performance
    for (const service of this.services) {
      const m = service.getMetrics();
      metrics.latency.chat.p95 = Math.max(
        metrics.latency.chat.p95,
        m.latency.chat.p95
      );
      metrics.latency.chat.p99 = Math.max(
        metrics.latency.chat.p99,
        m.latency.chat.p99
      );
      metrics.latency.embed.p95 = Math.max(
        metrics.latency.embed.p95,
        m.latency.embed.p95
      );
      metrics.latency.embed.p99 = Math.max(
        metrics.latency.embed.p99,
        m.latency.embed.p99
      );
    }

    return metrics;
  }

  private canRetryService(
    service: AxAIService<unknown, unknown, TModelKey>
  ): boolean {
    const failure = this.serviceFailures.get(service.getId());
    if (!failure) return true;

    const { retries, lastFailureTime } = failure;
    const timeSinceLastFailure = Date.now() - lastFailureTime;

    const backoffMs = Math.min(
      this.initialBackoffMs * 2 ** retries,
      this.maxBackoffMs
    );
    return timeSinceLastFailure >= backoffMs;
  }

  private handleFailure(
    service: AxAIService<unknown, unknown, TModelKey>,
    e: AxAIServiceError
  ): void {
    const failure = this.serviceFailures.get(service.getId());
    const retries = (failure?.retries ?? 0) + 1;

    this.serviceFailures.set(service.getId(), {
      retries,
      lastFailureTime: Date.now(),
    });

    if (this.debug) {
      console.warn(
        `AxBalancer: Service ${service.getName()} failed (retry ${retries}/${this.maxRetries})`,
        e
      );
    }
  }

  private handleSuccess(
    service: AxAIService<unknown, unknown, TModelKey>
  ): void {
    this.serviceFailures.delete(service.getId());
  }

  async chat(
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    // Determine required features
    const requiresStructuredOutputs =
      req.responseFormat?.type === 'json_schema';

    // Check for other capabilities
    const caps = req.capabilities;
    const requiresImages = caps?.requiresImages;
    const requiresAudio = caps?.requiresAudio;
    // We can add check for other capability flags here if needed

    // Filter services based on capabilities
    let candidateServices = this.services;
    const model = req.model as unknown as string; // best effort casting

    if (requiresStructuredOutputs || requiresImages || requiresAudio) {
      candidateServices = this.services.filter((s) => {
        const f = s.getFeatures(model);
        if (requiresStructuredOutputs && !f.structuredOutputs) return false;
        if (requiresImages && !f.media.images.supported) return false;
        if (requiresAudio && !f.media.audio.supported) return false;
        return true;
      });

      if (candidateServices.length === 0) {
        const requirements = [];
        if (requiresStructuredOutputs) requirements.push('structured outputs');
        if (requiresImages) requirements.push('images');
        if (requiresAudio) requirements.push('audio');

        throw new Error(
          `No services available that support required capabilities: ${requirements.join(', ')}.`
        );
      }
    }

    // Use a local index for this request flow
    let currentIndex = 0;
    let currentService = candidateServices[currentIndex];

    // Check if we stumbled into a case where the array is empty (unlikely given check above)
    if (!currentService) {
      throw new Error('No matching AI services available for request.');
    }

    // Update the main currentService pointer so other methods (metrics etc) reflect the active one
    this.currentService = currentService;

    while (true) {
      if (!this.canRetryService(currentService)) {
        // Try next service
        const next = this.getNextService(candidateServices, currentIndex);
        if (!next.service) {
          throw new Error(
            `All candidate services exhausted (tried ${candidateServices.length} service(s))`
          );
        }
        currentService = next.service;
        currentIndex = next.index;
        this.currentService = currentService;
        continue;
      }

      try {
        const response = await currentService.chat(req, options);
        this.handleSuccess(currentService);
        return response;
      } catch (e) {
        if (!(e instanceof AxAIServiceError)) {
          throw e;
        }

        switch (e.constructor) {
          case AxAIServiceAuthenticationError:
            // Handle authentication failure, e.g., refresh token, prompt user to re-login
            throw e;

          case AxAIServiceStatusError: {
            // Only retry specific status codes that are retryable
            // 408 = Request Timeout, 429 = Too Many Requests, 5xx = Server errors
            const retryableStatuses = [408, 429, 500, 502, 503, 504];
            if (
              !retryableStatuses.includes((e as AxAIServiceStatusError).status)
            ) {
              throw e;
            }
            break;
          }

          case AxAIServiceNetworkError:
            // Handle network issues
            break;

          case AxAIServiceResponseError:
            // Handle errors related to processing the response
            break;

          case AxAIServiceStreamTerminatedError:
            // Handle unexpected stream termination
            break;

          case AxAIServiceTimeoutError:
            // Handle request timeouts
            break;

          default:
            throw e;
        }

        this.handleFailure(currentService, e);

        // Check if we should switch services
        const failure = this.serviceFailures.get(currentService.getId());
        if ((failure?.retries ?? 0) >= this.maxRetries) {
          const next = this.getNextService(candidateServices, currentIndex);

          if (this.debug) {
            console.warn(
              `AxBalancer: Switching to service ${next.service?.getName() ?? 'none'}`,
              e
            );
          }

          if (!next.service) {
            // No more services to try
            throw e; // Or throw exhausted error? The original code threw e if handleFailure returned false (meaning no next service)
          }

          currentService = next.service;
          currentIndex = next.index;
          this.currentService = currentService;
        }
      }
    }
  }

  async embed(
    req: Readonly<AxEmbedRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse> {
    this.reset();
    let currentIndex = this.currentServiceIndex;

    while (true) {
      if (!this.canRetryService(this.currentService)) {
        const next = this.getNextService(this.services, currentIndex);
        if (!next.service) {
          throw new Error(
            `All services exhausted (tried ${this.services.length} service(s))`
          );
        }
        this.currentService = next.service;
        currentIndex = next.index;
        this.currentServiceIndex = currentIndex;
        continue;
      }

      try {
        const response = await this.currentService.embed(req, options);
        this.handleSuccess(this.currentService);
        return response;
      } catch (e) {
        if (!(e instanceof AxAIServiceError)) {
          throw e;
        }

        // Don't retry non-retryable status codes (4xx except 408 and 429)
        if (e instanceof AxAIServiceStatusError) {
          const retryableStatuses = [408, 429, 500, 502, 503, 504];
          if (!retryableStatuses.includes(e.status)) {
            throw e;
          }
        }

        // Don't retry authentication errors
        if (e instanceof AxAIServiceAuthenticationError) {
          throw e;
        }

        this.handleFailure(this.currentService, e);

        const failure = this.serviceFailures.get(this.currentService.getId());
        if ((failure?.retries ?? 0) >= this.maxRetries) {
          const next = this.getNextService(this.services, currentIndex);
          if (!next.service) {
            throw e;
          }
          this.currentService = next.service;
          currentIndex = next.index;
          this.currentServiceIndex = currentIndex;
        }
      }
    }
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    // Broadcast options to all services
    for (const service of this.services) {
      service.setOptions(options);
    }
    // Also update current options
    this.currentService.setOptions(options);
    this.debug = options.debug ?? this.debug;
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.currentService.getOptions();
  }

  getLogger(): AxLoggerFunction {
    return this.currentService.getLogger();
  }
}

function validateModels<TModelKey = string>(
  services: readonly AxAIService<unknown, unknown, TModelKey>[]
) {
  // Check if any service has a model list.
  const serviceWithModel = services.find(
    (service) => service.getModelList() !== undefined
  );
  if (!serviceWithModel) {
    // No service provides a model list; no validation needed.
    return;
  }

  // Use the first service with a model list as the reference.
  const referenceModelList = serviceWithModel.getModelList();
  if (!referenceModelList) {
    throw new Error('No model list found in any service.');
  }
  const referenceKeys = new Set(referenceModelList.map((model) => model.key));

  // Validate that all services provide a model list with the same keys.
  for (let i = 0; i < services.length; i++) {
    const service = services[i];
    if (!service) {
      throw new Error(`Service at index ${i} is undefined`);
    }
    const modelList = service.getModelList();
    if (!modelList) {
      throw new Error(
        `Service at index ${i} (${service.getName()}) has no model list while another service does.`
      );
    }

    const serviceKeys = new Set(modelList.map((model) => model.key));

    // Check for missing keys compared to the reference
    for (const key of referenceKeys) {
      if (!serviceKeys.has(key)) {
        throw new Error(
          `Service at index ${i} (${service.getName()}) is missing model "${key}"`
        );
      }
    }
    // Check for extra keys not in the reference
    for (const key of serviceKeys) {
      if (!referenceKeys.has(key)) {
        throw new Error(
          `Service at index ${i} (${service.getName()}) has extra model "${key}"`
        );
      }
    }
  }
}
