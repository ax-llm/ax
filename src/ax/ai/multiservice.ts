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
  AxLoggerFunction,
  AxModelConfig,
} from './types.js'

type AxAIServiceListItem<TModel = unknown, TEmbedModel = unknown> = {
  key: string
  service: AxAIService<TModel, TEmbedModel>
  description: string
  isInternal?: boolean
}

export class AxMultiServiceRouter implements AxAIService<string, string> {
  private options?: AxAIServiceOptions
  private lastUsedService?: AxAIService<string, string>

  private services: Map<
    string,
    {
      isInternal?: boolean
      description: string
      model?: string
      embedModel?: string
      service: AxAIService<string, string>
    }
  > = new Map()
  /**
   * Constructs a new multi-service router.
   * It validates that each service provides a unique set of model keys,
   * then builds a lookup (map) for routing the chat/embed requests.
   */
  constructor(
    services: (
      | AxAIServiceListItem<string, string>
      | AxAIService<string, string>
    )[]
  ) {
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
          service: service as AxAIService<string, string>,
          description,
          isInternal,
        })
      } else {
        const modelList = item.getModelList() as AxAIModelList | undefined

        if (!modelList) {
          throw new Error(
            `Service ${index} \`${item.getName()}\` has no model list.`
          )
        }

        for (const v of modelList) {
          if (this.services.has(v.key)) {
            const otherService = this.services.get(v.key)?.service
            throw new Error(
              `Service ${index} \`${item.getName()}\` has duplicate model key: ${v.key} as service ${otherService?.getName()}`
            )
          } else {
            if ('model' in v && typeof v.model) {
              this.services.set(v.key, {
                description: v.description,
                service: item as AxAIService<string, string>,
                model: v.model,
              })
            } else if ('embedModel' in v && v.embedModel) {
              this.services.set(v.key, {
                description: v.description,
                service: item as AxAIService<string, string>,
                embedModel: v.embedModel,
              })
            } else {
              throw new Error(
                `Key ${v.key} in model list for service ${index} \`${item.getName()}\` is missing a model or embedModel property.`
              )
            }
          }
        }
      }
    }
  }
  getLastUsedChatModel(): string | undefined {
    return this.lastUsedService?.getLastUsedChatModel()
  }
  getLastUsedEmbedModel(): string | undefined {
    return this.lastUsedService?.getLastUsedEmbedModel()
  }
  getLastUsedModelConfig(): AxModelConfig | undefined {
    return this.lastUsedService?.getLastUsedModelConfig()
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

    this.lastUsedService = item.service

    if (!item.model) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { model, ...reqWithoutModel } = req
      return await item.service.chat(reqWithoutModel, options)
    }

    return await item.service.chat({ model: modelKey, ...req }, options)
  }

  /**
   * Delegates the embed call to the service matching the provided embed model key.
   */
  async embed(
    req: Readonly<AxEmbedRequest<string>>,
    options?: Readonly<AxAIServiceActionOptions<string, string>>
  ): Promise<AxEmbedResponse> {
    const embedModelKey = req.embedModel
    if (!embedModelKey) {
      throw new Error('Embed model key must be specified for multi-service')
    }

    const item = this.services.get(embedModelKey)
    if (!item) {
      throw new Error(`No service found for embed model key: ${embedModelKey}`)
    }

    this.lastUsedService = item.service

    if (!item.model) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { embedModel, ...reqWithoutEmbedModel } = req
      return await item.service.embed(reqWithoutEmbedModel, options)
    }

    return await item.service.embed(
      { embedModel: embedModelKey, ...req },
      options
    )
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
      .map(([key, v]) => {
        if (v.model) {
          return { key, description: v.description, model: v.model }
        } else if (v.embedModel) {
          return { key, description: v.description, embedModel: v.embedModel }
        } else {
          throw new Error(`Service ${key} has no model or embedModel`)
        }
      })
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
    let serviceInstance = this.lastUsedService
    if (!serviceInstance) {
      const firstServiceEntry = this.services.values().next().value
      if (firstServiceEntry) {
        // Check if it's the service directly or the wrapped object
        serviceInstance =
          'service' in firstServiceEntry
            ? firstServiceEntry.service
            : firstServiceEntry
      }
    }

    if (!serviceInstance) {
      throw new Error('No service available to get metrics.')
    }
    return serviceInstance.getMetrics()
  }

  /**
   * Sets options on all underlying services.
   */
  setOptions(options: Readonly<AxAIServiceOptions>): void {
    for (const service of this.services.values()) {
      service.service.setOptions(options)
    }
    this.options = options
  }

  /**
   * Returns the options from the last used service,
   * or falls back to the first service if none has been used.
   */
  getOptions(): Readonly<AxAIServiceOptions> {
    return this.options ?? {}
  }

  /**
   * Returns the logger from the last used service,
   * or falls back to the first service if none has been used.
   */
  getLogger(): AxLoggerFunction {
    let serviceInstance = this.lastUsedService
    if (!serviceInstance) {
      const firstServiceEntry = this.services.values().next().value
      if (firstServiceEntry) {
        serviceInstance = firstServiceEntry.service
      }
    }

    if (!serviceInstance) {
      // Return a default logger if no service is available
      return (message: string) => {
        process.stdout.write(message)
      }
    }
    return serviceInstance.getLogger()
  }
}
