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
  AxModelInfoWithProvider,
} from '../types.js'

export class AxMockAIService implements AxAIService {
  private options: AxAIServiceOptions = {}
  private metrics: AxAIServiceMetrics = {
    latency: {
      chat: { mean: 0, p95: 0, p99: 0, samples: [] },
      embed: { mean: 0, p95: 0, p99: 0, samples: [] },
    },
    errors: {
      chat: { count: 0, rate: 0, total: 0 },
      embed: { count: 0, rate: 0, total: 0 },
    },
  }

  constructor(
    private readonly config: {
      name?: string
      modelInfo?: Partial<AxModelInfoWithProvider>
      embedModelInfo?: AxModelInfoWithProvider
      features?: { functions?: boolean; streaming?: boolean }
      models?: AxAIModelList
      chatResponse?:
        | AxChatResponse
        | ((
            req: Readonly<AxChatRequest>
          ) => AxChatResponse | Promise<AxChatResponse>)
      embedResponse?:
        | AxEmbedResponse
        | ((
            req: Readonly<AxEmbedRequest>
          ) => AxEmbedResponse | Promise<AxEmbedResponse>)
      shouldError?: boolean
      errorMessage?: string
      latencyMs?: number
    } = {}
  ) {}

  getName(): string {
    return this.config.name ?? 'mock-ai-service'
  }

  getModelInfo(): Readonly<AxModelInfoWithProvider> {
    return {
      name: 'mock-model',
      provider: 'mock-provider',
      promptTokenCostPer1M: 100,
      completionTokenCostPer1M: 100,
      ...this.config.modelInfo,
    }
  }

  getEmbedModelInfo(): Readonly<AxModelInfoWithProvider> | undefined {
    return this.config.embedModelInfo
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getFeatures(_model?: string): { functions: boolean; streaming: boolean } {
    return {
      functions: this.config.features?.functions ?? false,
      streaming: this.config.features?.streaming ?? false,
    }
  }

  getModelList(): AxAIModelList | undefined {
    return this.config.models
  }

  getMetrics(): AxAIServiceMetrics {
    return this.metrics
  }

  async chat(
    req: Readonly<AxChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (this.config.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs))
    }

    if (this.config.shouldError) {
      throw new Error(this.config.errorMessage ?? 'Mock chat error')
    }

    this.updateMetrics('chat')

    if (typeof this.config.chatResponse === 'function') {
      return this.config.chatResponse(req)
    }

    return (
      this.config.chatResponse ?? {
        results: [
          {
            content: 'Mock response',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }
    )
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    if (this.config.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs))
    }

    if (this.config.shouldError) {
      throw new Error(this.config.errorMessage ?? 'Mock embed error')
    }

    this.updateMetrics('embed')

    if (typeof this.config.embedResponse === 'function') {
      return this.config.embedResponse(req)
    }

    return (
      this.config.embedResponse ?? {
        embeddings: [[0.1, 0.2, 0.3]],
        modelUsage: {
          promptTokens: 5,
          completionTokens: 0,
          totalTokens: 5,
        },
      }
    )
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.options = options
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.options
  }

  private updateMetrics(type: 'chat' | 'embed'): void {
    const latency = this.config.latencyMs ?? 0
    this.metrics.latency[type].samples.push(latency)
    const samples = this.metrics.latency[type].samples

    // Update mean
    this.metrics.latency[type].mean =
      samples.reduce((a, b) => a + b, 0) / samples.length

    // Calculate percentiles only if we have enough samples
    if (samples.length > 0) {
      const sortedSamples = [...samples].sort((a, b) => a - b)

      // For p95, we need at least 20 samples for meaningful calculation (1/0.05)
      const p95Index = Math.max(0, Math.floor(sortedSamples.length * 0.95) - 1)
      this.metrics.latency[type].p95 = sortedSamples[p95Index] ?? latency

      // For p99, we need at least 100 samples for meaningful calculation (1/0.01)
      const p99Index = Math.max(0, Math.floor(sortedSamples.length * 0.99) - 1)
      this.metrics.latency[type].p99 = sortedSamples[p99Index] ?? latency
    }

    if (this.config.shouldError) {
      this.metrics.errors[type].count++
      this.metrics.errors[type].total++

      // Calculate error rate against total requests, not just samples
      const totalRequests = this.metrics.latency[type].samples.length
      this.metrics.errors[type].rate =
        totalRequests > 0 ? this.metrics.errors[type].count / totalRequests : 0
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
