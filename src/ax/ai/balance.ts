import type { ReadableStream } from 'stream/web'

import type {
  AxAIModelMap,
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
} from './types.js'

/**
 * Service comparator that sorts services by cost.
 */
export const axCostComparator = (a: AxAIService, b: AxAIService) => {
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

/**
 * Service comparator that respects the input order of services.
 */
export const axInputOrderComparator = () => 0

/**
 * Options for the balancer.
 */
export type AxBalancerOptions = {
  comparator?: (a: AxAIService, b: AxAIService) => number
}

/**
 * Balancer that rotates through services.
 */
export class AxBalancer implements AxAIService {
  private services: AxAIService[]
  private currentServiceIndex: number = 0
  private currentService: AxAIService

  constructor(services: readonly AxAIService[], options?: AxBalancerOptions) {
    if (services.length === 0) {
      throw new Error('No AI services provided.')
    }

    this.services = [...services].sort(options?.comparator ?? axCostComparator)

    const cs = this.services[this.currentServiceIndex]
    if (cs === undefined) {
      throw new Error('Error initializing the AI services.') // More specific error message
    }
    this.currentService = cs
  }

  getModelMap(): AxAIModelMap | undefined {
    throw new Error('Method not implemented.')
  }

  private getNextService(): boolean {
    const cs = this.services[++this.currentServiceIndex]
    if (cs === undefined) {
      return false
    }
    this.currentService = cs
    return true
  }

  private reset(): void {
    this.currentServiceIndex = 0
    const cs = this.services[this.currentServiceIndex]
    if (cs === undefined) {
      throw new Error('No AI services provided.')
    }
    this.currentService = cs
  }

  getName(): string {
    return this.currentService.getName()
  }

  getModelInfo(): Readonly<AxModelInfoWithProvider> {
    return this.currentService.getModelInfo()
  }

  getEmbedModelInfo(): Readonly<AxModelInfoWithProvider> | undefined {
    return this.currentService.getEmbedModelInfo()
  }

  getFeatures(model?: string) {
    return this.currentService.getFeatures(model)
  }

  getMetrics(): AxAIServiceMetrics {
    return this.currentService.getMetrics()
  }

  async chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions> | undefined
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    this.reset()

    while (true) {
      try {
        return await this.currentService.chat(req, options)
      } catch (e) {
        console.warn(`Service ${this.currentService.getName()} failed`)
        if (!this.getNextService()) {
          throw e
        }
        console.warn(`Switching to service ${this.currentService.getName()}`)
      }
    }
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions> | undefined
  ): Promise<AxEmbedResponse> {
    this.reset()

    while (true) {
      try {
        return await this.currentService.embed(req, options)
      } catch (e) {
        console.warn(`Service ${this.currentService.getName()} failed`)
        if (!this.getNextService()) {
          throw e
        }
        console.warn(`Switching to service ${this.currentService.getName()}`)
      }
    }
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.currentService.setOptions(options)
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.currentService.getOptions()
  }
}
