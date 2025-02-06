import type { ReadableStream } from 'stream/web'

import {
  AxAIServiceAuthenticationError,
  AxAIServiceError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js'

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
} from './types.js'

/**
 * Options for the balancer.
 */
export type AxBalancerOptions = {
  comparator?: (a: AxAIService, b: AxAIService) => number
  debug?: boolean
}

/**
 * Balancer that rotates through services.
 */
export class AxBalancer implements AxAIService {
  private services: AxAIService[]
  private currentServiceIndex: number = 0
  private currentService: AxAIService
  private debug: boolean

  constructor(services: readonly AxAIService[], options?: AxBalancerOptions) {
    if (services.length === 0) {
      throw new Error('No AI services provided.')
    }

    this.services = [...services].sort(
      options?.comparator ?? AxBalancer.costComparator
    )

    const cs = this.services[this.currentServiceIndex]
    if (cs === undefined) {
      throw new Error('Error initializing the AI services.') // More specific error message
    }
    this.currentService = cs
    this.debug = options?.debug ?? true
  }

  /**
   * Service comparator that respects the input order of services.
   */
  public static inputOrderComparator = () => 0

  /**
   * Service comparator that sorts services by cost.
   */
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

  getModelList(): AxAIModelList | undefined {
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
        if (!(e instanceof AxAIServiceError)) {
          throw e
        }

        switch (e.constructor) {
          case AxAIServiceAuthenticationError:
            // Handle authentication failure, e.g., refresh token, prompt user to re-login
            throw e

          case AxAIServiceStatusError:
            // Handle specific HTTP error codes, e.g., display a user-friendly message for a 404 Not Found
            break

          case AxAIServiceNetworkError:
            // Handle network issues, e.g., display a message about checking network connectivity
            break

          case AxAIServiceResponseError:
            // Handle errors related to processing the response, e.g., log the error and retry the request
            break

          case AxAIServiceStreamTerminatedError:
            // Handle unexpected stream termination, e.g., retry the request or display an error message
            break

          case AxAIServiceTimeoutError:
            // Handle request timeouts, e.g., increase timeout, retry, or display an error message
            break

          default:
            throw e
          // Handle unexpected AxAIServiceErrors
        }

        if (this.debug) {
          console.warn(
            `AxBalancer: Service ${this.currentService.getName()} failed`,
            e
          )
        }
        if (!this.getNextService()) {
          throw e
        }
        if (this.debug) {
          console.warn(
            `AxBalancer: Switching to service ${this.currentService.getName()}`
          )
        }
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
        if (this.debug) {
          console.warn(`Service ${this.currentService.getName()} failed`)
        }
        if (!this.getNextService()) {
          throw e
        }
        if (this.debug) {
          console.warn(`Switching to service ${this.currentService.getName()}`)
        }
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
