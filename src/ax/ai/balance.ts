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
import {
  type AxBalancerAdaptiveStrategy,
  type AxBalancerCandidateScore,
  type AxBalancerFailureReason,
  type AxBalancerRoutingEvent,
  type AxBalancerStatsKey,
  type AxBalancerStatsObservation,
  type AxBalancerStatsStore,
  AxInMemoryBalancerStatsStore,
  sampleBalancerRouteHealth,
} from './balance_adaptive.js';
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
  AxModelUsage,
  AxSpeechRequest,
  AxSpeechResponse,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
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

type AxAdaptiveBalancerState<TModelKey> = Readonly<{
  strategy: AxBalancerAdaptiveStrategy<TModelKey>;
  namespace: string;
  statsStore: AxBalancerStatsStore;
  routeKeys: ReadonlyMap<AxAIService<unknown, unknown, TModelKey>, string>;
  serviceIndices: ReadonlyMap<AxAIService<unknown, unknown, TModelKey>, number>;
}>;

type AxAdaptiveCandidate<TModelKey> = AxBalancerCandidateScore &
  Readonly<{
    service: AxAIService<unknown, unknown, TModelKey>;
    serviceIndex: number;
    order: number;
    statsKey: AxBalancerStatsKey;
  }>;

type AxBalancerStreamObservationHooks = Readonly<{
  startedAt: number;
  onSuccess: (firstChunkLatencyMs: number) => Promise<void>;
  onFailure: (error: AxAIServiceError, elapsedMs: number) => Promise<void>;
}>;

type AxBalancerChatAttemptHooks = Readonly<{
  onStreaming?: () => void;
  observation?: AxBalancerStreamObservationHooks;
}>;

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
  /**
   * Opt into request-time provider selection using learned failure rate,
   * successful latency, and estimated cost. When omitted, the existing
   * comparator-ordered behavior is unchanged.
   */
  strategy?: AxBalancerAdaptiveStrategy<TModelKey>;
};

/**
 * Provider balancer with ordered failover by default and opt-in adaptive
 * routing for chat requests.
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
  private readonly adaptive: AxAdaptiveBalancerState<TModelKey> | undefined;
  private serviceFailures: Map<
    string,
    { retries: number; lastFailureTime: number }
  > = new Map();

  // Status codes worth retrying on a different service: 408 Request Timeout,
  // 429 Too Many Requests, 5xx server errors, and 529 (Anthropic overloaded).
  private static readonly RETRYABLE_STATUS_CODES = [
    408, 429, 500, 502, 503, 504, 529,
  ];

  constructor(services: TServices, options?: AxBalancerOptions<TModelKey>) {
    if (services.length === 0) {
      throw new Error('No AI services provided.');
    }

    const inputServices = services as readonly AxAIService<
      unknown,
      unknown,
      TModelKey
    >[];
    validateModels(inputServices);

    this.adaptive = options?.strategy
      ? createAdaptiveState(inputServices, options.strategy)
      : undefined;

    this.services = [...inputServices].sort(
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

  getEstimatedCost(modelUsage?: AxModelUsage): number {
    return this.currentService.getEstimatedCost(modelUsage);
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

  /**
   * Whether an error should route to another service rather than fail the request.
   * Mirrors the decisions made in chat()'s catch block so the streaming peek path and
   * the synchronous path agree on what "retryable" means.
   */
  private isRetryableServiceError(e: unknown): e is AxAIServiceError {
    if (!(e instanceof AxAIServiceError)) return false;
    switch (e.constructor) {
      case AxAIServiceAuthenticationError:
        return false;
      case AxAIServiceStatusError:
        return AxBalancer.RETRYABLE_STATUS_CODES.includes(
          (e as AxAIServiceStatusError).status
        );
      case AxAIServiceNetworkError:
      case AxAIServiceResponseError:
      case AxAIServiceStreamTerminatedError:
      case AxAIServiceTimeoutError:
        return true;
      default:
        return false;
    }
  }

  private getCandidateServices(
    req: Readonly<AxChatRequest<TModelKey>>
  ): AxAIService<unknown, unknown, TModelKey>[] {
    const requiresStructuredOutputs =
      req.responseFormat?.type === 'json_schema';
    const caps = req.capabilities;
    const requiresImages = caps?.requiresImages;
    const requiresAudio = caps?.requiresAudio;
    const model = req.model as unknown as string;

    if (!requiresStructuredOutputs && !requiresImages && !requiresAudio) {
      return this.services;
    }

    const candidates = this.services.filter((service) => {
      const features = service.getFeatures(model);
      if (requiresStructuredOutputs && !features.structuredOutputs)
        return false;
      if (requiresImages && !features.media.images.supported) return false;
      if (requiresAudio && !features.media.audio.supported) return false;
      return true;
    });

    if (candidates.length === 0) {
      const requirements = [];
      if (requiresStructuredOutputs) requirements.push('structured outputs');
      if (requiresImages) requirements.push('images');
      if (requiresAudio) requirements.push('audio');

      throw new Error(
        `No services available that support required capabilities: ${requirements.join(', ')}.`
      );
    }

    return candidates;
  }

  /**
   * Wraps a streaming response to make it participate in failover. Two responsibilities:
   *
   * 1. Pre-content errors: eagerly reads the first chunk so a provider error thrown while
   *    reading (e.g. Anthropic's HTTP-200 `overloaded_error` SSE) rejects here, where
   *    {@link chat}'s try/catch can route it through the normal failover path. On success it
   *    returns a new stream that re-emits the buffered first chunk then pumps the rest.
   * 2. Mid-stream errors: a retryable error *after* the first chunk can't fail over
   *    transparently (partial output is already committed), so it is surfaced via
   *    `controller.error`. But we record the failure first (see {@link handleFailure}) —
   *    otherwise the failed service stays out of backoff and an app-level retry via chat()
   *    (which restarts at index 0 and doesn't reset()) would route straight back to it.
   */
  private async peekStreamForFailover(
    stream: ReadableStream<AxChatResponse>,
    service: AxAIService<unknown, unknown, TModelKey>,
    observationHooks?: AxBalancerStreamObservationHooks
  ): Promise<ReadableStream<AxChatResponse>> {
    const reader = stream.getReader();
    // May reject (provider error event) — propagated to chat()'s catch for failover.
    const first = await reader.read();
    const firstChunkLatencyMs = observationHooks
      ? performance.now() - observationHooks.startedAt
      : 0;
    let emittedFirst = false;
    let observed = false;
    const recordSuccess = async (): Promise<void> => {
      if (observed || !observationHooks) return;
      observed = true;
      await observationHooks.onSuccess(firstChunkLatencyMs);
    };
    // Arrow captures `this`/`service`; the ReadableStream source's `this` is not the balancer.
    const recordMidStreamFailure = async (err: unknown): Promise<void> => {
      if (!this.isRetryableServiceError(err)) return;
      this.handleFailure(service, err);
      if (!observed && observationHooks) {
        observed = true;
        await observationHooks.onFailure(
          err,
          performance.now() - observationHooks.startedAt
        );
      }
    };
    return new ReadableStream<AxChatResponse>({
      async pull(controller) {
        if (!emittedFirst) {
          emittedFirst = true;
          if (first.done) {
            await recordSuccess();
            controller.close();
            return;
          }
          controller.enqueue(first.value);
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            await recordSuccess();
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (err) {
          await recordMidStreamFailure(err);
          controller.error(err);
        }
      },
      cancel(reason) {
        observed = true;
        return reader.cancel(reason);
      },
    });
  }

  private async executeChatAttempt(
    service: AxAIService<unknown, unknown, TModelKey>,
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>,
    hooks?: AxBalancerChatAttemptHooks
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const response = await service.chat(req, options);
    if (!(response instanceof ReadableStream)) return response;

    hooks?.onStreaming?.();
    return await this.peekStreamForFailover(
      response,
      service,
      hooks?.observation
    );
  }

  private async chatAdaptive(
    req: Readonly<AxChatRequest<TModelKey>>,
    options: Readonly<AxAIServiceOptions> | undefined,
    candidateServices: AxAIService<unknown, unknown, TModelKey>[]
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const candidates = await this.rankAdaptiveCandidates(
      req,
      options,
      candidateServices
    );
    let lastError: AxAIServiceError | undefined;

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const { service, statsKey } = candidate;
      this.currentService = service;
      this.emitRoutingEvent({
        type: 'selected',
        namespace: statsKey.namespace,
        slice: statsKey.slice,
        logicalModel: statsKey.logicalModel,
        routeKey: candidate.routeKey,
        serviceName: candidate.serviceName,
        attempt: index + 1,
      });

      const startedAt = performance.now();
      let streaming = false;
      try {
        const response = await this.executeChatAttempt(service, req, options, {
          onStreaming: () => {
            streaming = true;
          },
          observation: {
            startedAt,
            onSuccess: async (firstChunkLatencyMs) => {
              this.handleSuccess(service);
              await this.recordAdaptiveObservation(
                candidate,
                { outcome: 'success', latencyMs: firstChunkLatencyMs },
                true
              );
            },
            onFailure: async (error, elapsedMs) => {
              await this.recordAdaptiveObservation(
                candidate,
                { outcome: 'failure' },
                true,
                error,
                elapsedMs
              );
            },
          },
        });
        if (streaming) {
          return response;
        }

        const latencyMs = performance.now() - startedAt;
        this.handleSuccess(service);
        await this.recordAdaptiveObservation(
          candidate,
          { outcome: 'success', latencyMs },
          false
        );
        return response;
      } catch (error) {
        if (!this.isRetryableServiceError(error)) throw error;

        lastError = error;
        this.handleFailure(service, error);
        await this.recordAdaptiveObservation(
          candidate,
          { outcome: 'failure' },
          streaming,
          error,
          performance.now() - startedAt
        );

        const next = candidates[index + 1];
        const details = getFailureDetails(error);
        this.emitRoutingEvent({
          type: 'fallback',
          namespace: statsKey.namespace,
          slice: statsKey.slice,
          logicalModel: statsKey.logicalModel,
          fromRouteKey: candidate.routeKey,
          toRouteKey: next?.routeKey,
          reason: details.reason,
          status: details.status,
        });

        if (this.debug) {
          console.warn(
            `AxBalancer: Switching to service ${next?.serviceName ?? 'none'}`,
            error
          );
        }
      }
    }

    if (lastError) throw lastError;
    throw new Error(
      `All candidate services exhausted (tried ${candidateServices.length} service(s))`
    );
  }

  private async rankAdaptiveCandidates(
    req: Readonly<AxChatRequest<TModelKey>>,
    options: Readonly<AxAIServiceOptions> | undefined,
    candidateServices: AxAIService<unknown, unknown, TModelKey>[]
  ): Promise<AxAdaptiveCandidate<TModelKey>[]> {
    const adaptive = this.adaptive;
    if (!adaptive) return [];

    const logicalModel = String(req.model ?? 'default');
    const sliceValue =
      adaptive.strategy.slice?.({ model: req.model, options }) ?? 'default';
    const slice = normalizePartition('slice', sliceValue);
    // Adaptive health is represented by the shared route statistics, so the
    // legacy balancer backoff gate must not remove a route before ranking.
    const availableServices = candidateServices;
    if (availableServices.length === 0) {
      throw new Error(
        `All candidate services exhausted (tried ${candidateServices.length} service(s))`
      );
    }

    const candidates = await Promise.all(
      availableServices.map(async (service) => {
        const routeKey = adaptive.routeKeys.get(service);
        const serviceIndex = adaptive.serviceIndices.get(service);
        if (routeKey === undefined || serviceIndex === undefined) {
          throw new Error('Adaptive route metadata is missing for a service.');
        }
        const statsKey: AxBalancerStatsKey = {
          namespace: adaptive.namespace,
          slice,
          logicalModel,
          routeKey,
        };
        const stats = await this.getAdaptiveStats(statsKey);
        const { failureProbability, deadlineMissProbability } =
          sampleBalancerRouteHealth(stats, adaptive.strategy.deadlineMs);
        const estimatedCost = this.estimateAdaptiveCost(
          service,
          serviceIndex,
          routeKey,
          req
        );
        const badOutcomeProbability =
          failureProbability +
          (1 - failureProbability) * deadlineMissProbability;

        return {
          service,
          serviceIndex,
          order: candidateServices.indexOf(service),
          statsKey,
          routeKey,
          serviceName: service.getName(),
          score:
            estimatedCost +
            adaptive.strategy.badOutcomeCost * badOutcomeProbability,
          estimatedCost,
          failureProbability,
          deadlineMissProbability,
        } satisfies AxAdaptiveCandidate<TModelKey>;
      })
    );

    candidates.sort((a, b) => a.score - b.score || a.order - b.order);
    const first = candidates[0];
    if (first) {
      this.emitRoutingEvent({
        type: 'ranked',
        namespace: first.statsKey.namespace,
        slice: first.statsKey.slice,
        logicalModel: first.statsKey.logicalModel,
        candidates: candidates.map(
          ({
            routeKey,
            serviceName,
            score,
            estimatedCost,
            failureProbability,
            deadlineMissProbability,
          }) => ({
            routeKey,
            serviceName,
            score,
            estimatedCost,
            failureProbability,
            deadlineMissProbability,
          })
        ),
      });
    }
    return candidates;
  }

  private estimateAdaptiveCost(
    service: AxAIService<unknown, unknown, TModelKey>,
    serviceIndex: number,
    routeKey: string,
    req: Readonly<AxChatRequest<TModelKey>>
  ): number {
    const adaptive = this.adaptive;
    if (!adaptive) return 0;
    const logicalModel = String(req.model ?? 'default');
    const modelEntry = service
      .getModelList()
      ?.find((entry) => Object.is(entry.key, req.model));
    const resolvedModel =
      modelEntry && 'model' in modelEntry
        ? modelEntry.model
        : String(req.model ?? service.getLastUsedChatModel() ?? 'default');
    const expectedTokens = adaptive.strategy.expectedTokens;
    const promptTokens = expectedTokens?.promptTokens ?? 0;
    const completionTokens = expectedTokens?.completionTokens ?? 0;
    const estimatedCost = adaptive.strategy.estimateCost
      ? adaptive.strategy.estimateCost({
          service,
          serviceIndex,
          routeKey,
          logicalModel,
          resolvedModel,
          expectedTokens,
        })
      : service.getEstimatedCost(
          expectedTokens
            ? {
                ai: service.getName(),
                model: resolvedModel,
                tokens: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                },
              }
            : undefined
        );

    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      throw new Error(
        `Adaptive estimated cost for route "${routeKey}" must be finite and non-negative.`
      );
    }
    return estimatedCost;
  }

  private async getAdaptiveStats(
    key: AxBalancerStatsKey
  ): Promise<Awaited<ReturnType<AxBalancerStatsStore['get']>>> {
    const adaptive = this.adaptive;
    if (!adaptive) return undefined;
    try {
      return await adaptive.statsStore.get(key);
    } catch (error) {
      this.emitRoutingEvent({
        type: 'store-error',
        namespace: key.namespace,
        slice: key.slice,
        logicalModel: key.logicalModel,
        operation: 'get',
        routeKey: key.routeKey,
        errorType: getErrorType(error),
      });
      return undefined;
    }
  }

  private async recordAdaptiveObservation(
    candidate: AxAdaptiveCandidate<TModelKey>,
    observation: AxBalancerStatsObservation,
    streaming: boolean,
    error?: AxAIServiceError,
    failureLatencyMs?: number
  ): Promise<void> {
    const adaptive = this.adaptive;
    if (!adaptive) return;
    try {
      await adaptive.statsStore.observe(candidate.statsKey, observation);
    } catch (storeError) {
      this.emitRoutingEvent({
        type: 'store-error',
        namespace: candidate.statsKey.namespace,
        slice: candidate.statsKey.slice,
        logicalModel: candidate.statsKey.logicalModel,
        operation: 'observe',
        routeKey: candidate.routeKey,
        errorType: getErrorType(storeError),
      });
    }

    const details = error ? getFailureDetails(error) : undefined;
    this.emitRoutingEvent({
      type: 'observation',
      namespace: candidate.statsKey.namespace,
      slice: candidate.statsKey.slice,
      logicalModel: candidate.statsKey.logicalModel,
      routeKey: candidate.routeKey,
      serviceName: candidate.serviceName,
      outcome: observation.outcome,
      latencyMs:
        observation.outcome === 'success'
          ? observation.latencyMs
          : failureLatencyMs,
      streaming,
      reason: details?.reason,
      status: details?.status,
    });
  }

  private emitRoutingEvent(event: AxBalancerRoutingEvent): void {
    const callback = this.adaptive?.strategy.onRoutingEvent;
    if (!callback) return;
    try {
      void Promise.resolve(callback(event)).catch(() => {});
    } catch {
      // Observability must never affect routing.
    }
  }

  async chat(
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const candidateServices = this.getCandidateServices(req);
    if (this.adaptive) {
      return await this.chatAdaptive(req, options, candidateServices);
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
        const response = await this.executeChatAttempt(
          currentService,
          req,
          options
        );
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
            // Only retry specific status codes that are retryable.
            if (
              !AxBalancer.RETRYABLE_STATUS_CODES.includes(
                (e as AxAIServiceStatusError).status
              )
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
          if (!AxBalancer.RETRYABLE_STATUS_CODES.includes(e.status)) {
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

  async transcribe(
    req: Readonly<AxTranscriptionRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    return await this.currentService.transcribe(req, options);
  }

  async speak(
    req: Readonly<AxSpeechRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    return await this.currentService.speak(req, options);
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

function createAdaptiveState<TModelKey>(
  services: readonly AxAIService<unknown, unknown, TModelKey>[],
  strategy: AxBalancerAdaptiveStrategy<TModelKey>
): AxAdaptiveBalancerState<TModelKey> {
  if (!Number.isFinite(strategy.deadlineMs) || strategy.deadlineMs <= 0) {
    throw new Error(
      'Adaptive deadlineMs must be finite and greater than zero.'
    );
  }
  if (
    !Number.isFinite(strategy.badOutcomeCost) ||
    strategy.badOutcomeCost < 0
  ) {
    throw new Error('Adaptive badOutcomeCost must be finite and non-negative.');
  }
  if (strategy.expectedTokens) {
    for (const [name, value] of Object.entries(strategy.expectedTokens)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Adaptive expectedTokens.${name} must be finite and non-negative.`
        );
      }
    }
  }
  if (strategy.statsStore && !strategy.routeKey) {
    throw new Error(
      'Adaptive routeKey is required when a custom statsStore is supplied.'
    );
  }

  const routeKeys = new Map<AxAIService<unknown, unknown, TModelKey>, string>();
  const serviceIndices = new Map<
    AxAIService<unknown, unknown, TModelKey>,
    number
  >();
  const seenRouteKeys = new Set<string>();
  services.forEach((service, serviceIndex) => {
    const rawRouteKey =
      strategy.routeKey?.(service, serviceIndex) ?? service.getId();
    const routeKey = normalizePartition('routeKey', rawRouteKey);
    if (seenRouteKeys.has(routeKey)) {
      throw new Error(`Adaptive routeKey "${routeKey}" must be unique.`);
    }
    seenRouteKeys.add(routeKey);
    routeKeys.set(service, routeKey);
    serviceIndices.set(service, serviceIndex);
  });

  return {
    strategy,
    namespace: normalizePartition('namespace', strategy.namespace ?? 'default'),
    statsStore: strategy.statsStore ?? new AxInMemoryBalancerStatsStore(),
    routeKeys,
    serviceIndices,
  };
}

function normalizePartition(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Adaptive ${name} must be a non-empty string.`);
  }
  return normalized;
}

function getFailureDetails(error: AxAIServiceError): Readonly<{
  reason: AxBalancerFailureReason;
  status: number | undefined;
}> {
  if (error instanceof AxAIServiceStatusError) {
    return { reason: 'status', status: error.status };
  }
  if (error instanceof AxAIServiceNetworkError) {
    return { reason: 'network', status: undefined };
  }
  if (error instanceof AxAIServiceStreamTerminatedError) {
    return { reason: 'stream-terminated', status: undefined };
  }
  if (error instanceof AxAIServiceTimeoutError) {
    return { reason: 'timeout', status: undefined };
  }
  return { reason: 'response', status: undefined };
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
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
