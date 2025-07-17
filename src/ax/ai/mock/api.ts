// ReadableStream is available globally in modern browsers and Node.js 16+
import { randomUUID } from '../../util/crypto.js';

import type {
  AxAIModelList,
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxLoggerData,
  AxLoggerFunction,
  AxModelConfig,
  AxModelInfoWithProvider,
} from '../types.js';

export type AxMockAIServiceConfig<TModelKey> = {
  name?: string;
  id?: string;
  modelInfo?: Partial<AxModelInfoWithProvider>;
  embedModelInfo?: AxModelInfoWithProvider;
  features?: { functions?: boolean; streaming?: boolean };
  models?: AxAIModelList<TModelKey>;
  options?: AxAIServiceOptions;
  chatResponse?:
    | AxChatResponse
    | ReadableStream<AxChatResponse>
    | (() => Promise<AxChatResponse | ReadableStream<AxChatResponse>>)
    | ((
        req: Readonly<AxChatRequest<unknown>>,
        options?: Readonly<
          AxAIPromptConfig & AxAIServiceActionOptions<unknown, unknown>
        >
      ) => Promise<AxChatResponse | ReadableStream<AxChatResponse>>);

  embedResponse?:
    | AxEmbedResponse
    | ((
        req: Readonly<AxEmbedRequest>
      ) => AxEmbedResponse | Promise<AxEmbedResponse>);
  shouldError?: boolean;
  errorMessage?: string;
  latencyMs?: number;
};

export class AxMockAIService<TModelKey>
  implements AxAIService<unknown, unknown, TModelKey>
{
  private metrics: AxAIServiceMetrics = {
    latency: {
      chat: { mean: 0, p95: 0, p99: 0, samples: [] },
      embed: { mean: 0, p95: 0, p99: 0, samples: [] },
    },
    errors: {
      chat: { count: 0, rate: 0, total: 0 },
      embed: { count: 0, rate: 0, total: 0 },
    },
  };

  constructor(private readonly config: AxMockAIServiceConfig<TModelKey> = {}) {
    this.config.id = this.config.id ?? randomUUID();
  }
  getLastUsedChatModel(): unknown {
    return this.config.modelInfo?.name ?? 'mock-model';
  }
  getLastUsedEmbedModel(): unknown {
    return this.config.embedModelInfo?.name ?? 'mock-embed-model';
  }
  getLastUsedModelConfig(): AxModelConfig | undefined {
    return this.config.modelInfo
      ? {
          maxTokens: this.config.modelInfo.maxTokens,
          temperature: 0.7, // Default temperature
          stream: this.config.features?.streaming ?? false,
        }
      : undefined;
  }

  getName(): string {
    return this.config.name ?? 'mock-ai-service';
  }

  getId(): string {
    return this.config.id ?? 'mock-ai-service-id';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getFeatures(_model?: string): { functions: boolean; streaming: boolean } {
    return {
      functions: this.config.features?.functions ?? false,
      streaming: this.config.features?.streaming ?? false,
    };
  }

  getModelList(): AxAIModelList<TModelKey> | undefined {
    return this.config.models;
  }

  getMetrics(): AxAIServiceMetrics {
    return this.metrics;
  }

  async chat(
    req: Readonly<AxChatRequest<unknown>>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<unknown, unknown, TModelKey>
    >
  ) {
    if (this.config.latencyMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.latencyMs)
      );
    }

    if (this.config.shouldError) {
      throw new Error(this.config.errorMessage ?? 'Mock chat error');
    }

    this.updateMetrics('chat');

    if (typeof this.config.chatResponse === 'function') {
      return await this.config.chatResponse(req);
    }

    return (
      this.config.chatResponse ?? {
        results: [
          {
            index: 0,
            content: 'Mock response',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: this.getName(),
          model: 'mock-model',
          tokens: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        },
      }
    );
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxAIServiceActionOptions<unknown, unknown, TModelKey>>
  ): Promise<AxEmbedResponse> {
    if (this.config.latencyMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.latencyMs)
      );
    }

    if (this.config.shouldError) {
      throw new Error(this.config.errorMessage ?? 'Mock embed error');
    }

    this.updateMetrics('embed');

    if (typeof this.config.embedResponse === 'function') {
      return this.config.embedResponse(req);
    }

    return (
      this.config.embedResponse ?? {
        embeddings: [[0.1, 0.2, 0.3]],
        modelUsage: {
          ai: this.getName(),
          model: 'mock-model',
          tokens: {
            promptTokens: 5,
            completionTokens: 0,
            totalTokens: 5,
          },
        },
      }
    );
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.config.options = options;
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.config.options ?? {};
  }

  getLogger(): AxLoggerFunction {
    return (
      this.config.options?.logger ??
      ((message: string | AxLoggerData) => {
        console.log(message);
      })
    );
  }

  private updateMetrics(type: 'chat' | 'embed'): void {
    const latency = this.config.latencyMs ?? 0;
    this.metrics.latency[type].samples.push(latency);
    const samples = this.metrics.latency[type].samples;

    // Update mean
    this.metrics.latency[type].mean =
      samples.reduce((a, b) => a + b, 0) / samples.length;

    // Calculate percentiles only if we have enough samples
    if (samples.length > 0) {
      const sortedSamples = [...samples].sort((a, b) => a - b);

      // For p95, we need at least 20 samples for meaningful calculation (1/0.05)
      const p95Index = Math.max(0, Math.floor(sortedSamples.length * 0.95) - 1);
      this.metrics.latency[type].p95 = sortedSamples[p95Index] ?? latency;

      // For p99, we need at least 100 samples for meaningful calculation (1/0.01)
      const p99Index = Math.max(0, Math.floor(sortedSamples.length * 0.99) - 1);
      this.metrics.latency[type].p99 = sortedSamples[p99Index] ?? latency;
    }

    if (this.config.shouldError) {
      this.metrics.errors[type].count++;
      this.metrics.errors[type].total++;

      // Calculate error rate against total requests, not just samples
      const totalRequests = this.metrics.latency[type].samples.length;
      this.metrics.errors[type].rate =
        totalRequests > 0 ? this.metrics.errors[type].count / totalRequests : 0;
    }
  }
}

// Example usage:
/*
const mockService = new MockAIService({
  name: 'test-service',
  modelInfo: {
    name: 'test-model',
    provider: 'test-provider',
    promptTokenCostPer1M: 200,
    completionTokenCostPer1M: 150,
  },
  features: {
    functions: true,
    streaming: true,
  },
  chatResponse: async (req) => ({
    results: [
      {
        content: `Processed request with ${req.chatPrompt.length} messages`,
        finishReason: 'stop',
      },
    ],
    modelUsage: {
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    },
  }),
  latencyMs: 100,
})
*/
