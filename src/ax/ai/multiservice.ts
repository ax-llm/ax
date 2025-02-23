import type { ReadableStream } from 'stream/web'

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
} from './types.js'

type AxAIServiceListItem = {
  key: string
  service: AxAIService
  description: string
  isInternal?: boolean
}

export class AxMultiServiceRouter implements AxAIService<string, string> {
  private services: Map<
    string,
    {
      useDefaultModel?: boolean
      isInternal?: boolean
      description: string
      model: string
      service: AxAIService
    }
  > = new Map()
  /**
   * Constructs a new multi-service router.
   * It validates that each service provides a unique set of model keys,
   * then builds a lookup (map) for routing the chat/embed requests.
   */
  constructor(services: (AxAIServiceListItem | AxAIService)[]) {
    if (services.length === 0) {
      throw new Error('No AI services provided.')
    }

    // Determine input type based on first element (assuming homogeneous array)

    for (const [index, item] of services.entries()) {
      const isKeyBased = 'key' in item

      if (isKeyBased) {
        if (this.services.has(item.key)) {
          throw new Error(`Duplicate model key: ${item.key}`)
        }

        const { service, description, isInternal } = item

        this.services.set(item.key, {
          service,
          description,
          isInternal,
          model: item.service.getDefaultModels().model,
          useDefaultModel: true,
        })
      } else {
        const modelList = item.getModelList() as AxAIModelList | undefined

        if (!modelList) {
          throw new Error(
            `Service ${index} \`${item.getName()}\` has no model list.`
          )
        }

        for (const { key, description, model } of modelList ?? []) {
          if (this.services.has(key)) {
            const otherService = this.services.get(key)?.service
            throw new Error(
              `Service ${index} \`${item.getName()}\` has duplicate model key: ${key} as service ${otherService?.getName()}`
            )
          }

          this.services.set(key, {
            description,
            service: item,
            model,
          })
        }
      }
    }
  }

  /**
   * Delegates the chat call to the service matching the provided model key.
   */
  async chat(
    req: Readonly<AxChatRequest<string>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<string, string>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const modelKey = req.model
    if (!modelKey) {
      throw new Error('Model key must be specified for multi-service')
    }

    const item = this.services.get(modelKey)
    if (!item) {
      throw new Error(`No service found for model key: ${modelKey}`)
    }

    const service = item.service
    const model = item.useDefaultModel ? req.model : modelKey
    return await service.chat({ model, ...req }, options)
  }

  /**
   * Delegates the embed call to the service matching the provided embed model key.
   */
  async embed(
    req: Readonly<AxEmbedRequest<string>>,
    options?: Readonly<AxAIServiceActionOptions<string, string>>
  ): Promise<AxEmbedResponse> {
    const modelKey = req.embedModel
    if (!modelKey) {
      throw new Error('Embed model key must be specified for multi-service')
    }

    const item = this.services.get(modelKey)
    if (!item) {
      throw new Error(`No service found for embed model key: ${modelKey}`)
    }

    // Remove embedModel from request as service should use its default
    const service = item.service
    const embedModel = item.useDefaultModel ? req.embedModel : modelKey
    return await service.embed({ embedModel, ...req }, options)
  }

  /**
   * Returns a composite ID built from the IDs of the underlying services.
   */
  getId(): string {
    return (
      'MultiServiceRouter:' +
      Array.from(this.services.values())
        .map((s) => s.service.getId())
        .join(',')
    )
  }

  /**
   * Returns the name of this router.
   */
  getName(): string {
    return 'MultiServiceRouter'
  }

  /**
   * Aggregates all available models across the underlying services.
   */
  getModelList(): AxAIModelList {
    return Array.from(this.services)
      .filter(([, value]) => !value.isInternal)
      .map(([key, { description, model }]) => ({
        key,
        description,
        model,
      }))
  }

  getDefaultModels(): Readonly<{ model: string; embedModel?: string }> {
    throw new Error(
      'getDefaultModels is not supported for multi-service router.'
    )
  }

  /**
   * If a model key is provided, delegate to the corresponding service's features.
   * Otherwise, returns a default feature set.
   */
  getFeatures(model?: string): {
    functions: boolean
    streaming: boolean
    functionCot?: boolean
  } {
    if (model) {
      const service = this.services.get(model)
      if (service) {
        return service.service.getFeatures(model)
      }
    }
    return { functions: false, streaming: false }
  }

  /**
   * Returns aggregated metrics from the underlying service.
   * Uses the metrics from the last service that was used,
   * or falls back to the first service if none has been used.
   */
  getMetrics(): AxAIServiceMetrics {
    const service = this.services.values().next().value
    if (!service) {
      throw new Error('No service available to get metrics.')
    }
    return service.service.getMetrics()
  }

  /**
   * Sets options on all underlying services.
   */
  setOptions(options: Readonly<AxAIServiceOptions>): void {
    for (const service of this.services.values()) {
      service.service.setOptions(options)
    }
  }

  /**
   * Returns the options from the last used service,
   * or falls back to the first service if none has been used.
   */
  getOptions(): Readonly<AxAIServiceOptions> {
    const service = this.services.values().next().value
    if (!service) {
      throw new Error('No service available to get options.')
    }
    return service.service.getOptions()
  }
}
