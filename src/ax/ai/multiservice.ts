// ReadableStream is available globally in modern browsers and Node.js 16+

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
} from './types.js';

type AxAIServiceListItem<
  TModel = unknown,
  TEmbedModel = unknown,
  TModelKey = string,
> = {
  key: TModelKey;
  service: AxAIService<TModel, TEmbedModel, TModelKey>;
  description: string;
  isInternal?: boolean;
};

export class AxMultiServiceRouter<TModelKey = string>
  implements AxAIService<unknown, unknown, TModelKey>
{
  private options?: AxAIServiceOptions;
  private lastUsedService?: AxAIService<unknown, unknown, TModelKey>;

  private services: Map<
    TModelKey,
    {
      isInternal?: boolean;
      description: string;
      model?: string;
      embedModel?: string;
      service: AxAIService<unknown, unknown, TModelKey>;
    }
  > = new Map();
  /**
   * Constructs a new multi-service router.
   * It validates that each service provides a unique set of model keys,
   * then builds a lookup (map) for routing the chat/embed requests.
   */
  constructor(
    services: (
      | AxAIServiceListItem<unknown, unknown, TModelKey>
      | AxAIService<unknown, unknown, TModelKey>
    )[]
  ) {
    if (services.length === 0) {
      throw new Error('No AI services provided.');
    }

    // Determine input type based on first element (assuming homogeneous array)

    for (const [index, item] of services.entries()) {
      const isKeyBased = 'key' in item;

      if (isKeyBased) {
        if (this.services.has(item.key)) {
          throw new Error(`Duplicate model key: ${item.key}`);
        }

        const { service, description, isInternal } = item;

        this.services.set(item.key, {
          service: service as AxAIService<unknown, unknown, TModelKey>,
          description,
          isInternal,
        });
      } else {
        const modelList = item.getModelList() as
          | AxAIModelList<TModelKey>
          | undefined;

        if (!modelList) {
          throw new Error(
            `Service ${index} \`${item.getName()}\` has no model list.`
          );
        }

        for (const v of modelList) {
          if (this.services.has(v.key)) {
            const otherService = this.services.get(v.key)?.service;
            throw new Error(
              `Service ${index} \`${item.getName()}\` has duplicate model key: ${v.key} as service ${otherService?.getName()}`
            );
          }
          if ('model' in v && typeof v.model) {
            this.services.set(v.key, {
              description: v.description,
              service: item as AxAIService<unknown, unknown, TModelKey>,
              model: v.model,
            });
          } else if ('embedModel' in v && v.embedModel) {
            this.services.set(v.key, {
              description: v.description,
              service: item as AxAIService<unknown, unknown, TModelKey>,
              embedModel: v.embedModel,
            });
          } else {
            throw new Error(
              `Key ${v.key} in model list for service ${index} \`${item.getName()}\` is missing a model or embedModel property.`
            );
          }
        }
      }
    }
  }
  getLastUsedChatModel(): unknown | undefined {
    return this.lastUsedService?.getLastUsedChatModel();
  }
  getLastUsedEmbedModel(): unknown | undefined {
    return this.lastUsedService?.getLastUsedEmbedModel();
  }
  getLastUsedModelConfig(): AxModelConfig | undefined {
    return this.lastUsedService?.getLastUsedModelConfig();
  }

  /**
   * Delegates the chat call to the service matching the provided model key.
   */
  async chat(
    req: Readonly<AxChatRequest<string>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<unknown, unknown, TModelKey>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const modelKey = req.model as TModelKey;
    if (!modelKey) {
      throw new Error('Model key must be specified for multi-service');
    }

    const item = this.services.get(modelKey);
    if (!item) {
      throw new Error(`No service found for model key: ${modelKey}`);
    }

    this.lastUsedService = item.service;

    if (!item.model) {
      const { model: _, ...reqWithoutModel } = req;
      return await item.service.chat(reqWithoutModel, options);
    }

    return await item.service.chat({ model: modelKey, ...req }, options);
  }

  /**
   * Delegates the embed call to the service matching the provided embed model key.
   */
  async embed(
    req: Readonly<AxEmbedRequest<string>>,
    options?: Readonly<AxAIServiceActionOptions<unknown, unknown, TModelKey>>
  ): Promise<AxEmbedResponse> {
    const embedModelKey = req.embedModel as TModelKey;
    if (!embedModelKey) {
      throw new Error('Embed model key must be specified for multi-service');
    }

    const item = this.services.get(embedModelKey);
    if (!item) {
      throw new Error(`No service found for embed model key: ${embedModelKey}`);
    }

    this.lastUsedService = item.service;

    if (!item.model) {
      const { embedModel: _, ...reqWithoutEmbedModel } = req;
      return await item.service.embed(reqWithoutEmbedModel, options);
    }

    return await item.service.embed(
      { embedModel: embedModelKey, ...req },
      options
    );
  }

  /**
   * Returns a composite ID built from the IDs of the underlying services.
   */
  getId(): string {
    return `MultiServiceRouter:${Array.from(this.services.values())
      .map((s) => s.service.getId())
      .join(',')}`;
  }

  /**
   * Returns the name of this router.
   */
  getName(): string {
    return 'MultiServiceRouter';
  }

  /**
   * Aggregates all available models across the underlying services.
   */
  getModelList(): AxAIModelList<TModelKey> {
    return Array.from(this.services)
      .filter(([, value]) => !value.isInternal)
      .map(([key, v]) => {
        if (v.model) {
          return { key, description: v.description, model: v.model };
        }
        if (v.embedModel) {
          return { key, description: v.description, embedModel: v.embedModel };
        }
        throw new Error(`Service ${key} has no model or embedModel`);
      });
  }

  /**
   * If a model key is provided, delegate to the corresponding service's features.
   * Otherwise, returns a default feature set.
   */
  getFeatures(model?: TModelKey): {
    functions: boolean;
    streaming: boolean;
    functionCot?: boolean;
  } {
    if (model) {
      const service = this.services.get(model);
      if (service) {
        return service.service.getFeatures(model);
      }
    }
    return { functions: false, streaming: false };
  }

  /**
   * Returns aggregated metrics from the underlying service.
   * Uses the metrics from the last service that was used,
   * or falls back to the first service if none has been used.
   */
  getMetrics(): AxAIServiceMetrics {
    let serviceInstance = this.lastUsedService;
    if (!serviceInstance) {
      const firstServiceEntry = this.services.values().next().value;
      if (firstServiceEntry) {
        // Check if it's the service directly or the wrapped object
        serviceInstance =
          'service' in firstServiceEntry
            ? firstServiceEntry.service
            : firstServiceEntry;
      }
    }

    if (!serviceInstance) {
      throw new Error('No service available to get metrics.');
    }
    return serviceInstance.getMetrics();
  }

  /**
   * Sets options on all underlying services.
   */
  setOptions(options: Readonly<AxAIServiceOptions>): void {
    for (const service of this.services.values()) {
      service.service.setOptions(options);
    }
    this.options = options;
  }

  /**
   * Returns the options from the last used service,
   * or falls back to the first service if none has been used.
   */
  getOptions(): Readonly<AxAIServiceOptions> {
    return this.options ?? {};
  }

  /**
   * Returns the logger from the last used service,
   * or falls back to the first service if none has been used.
   */
  getLogger(): AxLoggerFunction {
    let serviceInstance = this.lastUsedService;
    if (!serviceInstance) {
      const firstServiceEntry = this.services.values().next().value;
      if (firstServiceEntry) {
        serviceInstance = firstServiceEntry.service;
      }
    }

    if (!serviceInstance) {
      throw new Error('No service available to get logger.');
    }
    return serviceInstance.getLogger();
  }

  /**
   * Sets a service entry for a given key. This method is intended for testing purposes.
   * @param key - The model key
   * @param entry - The service entry to set
   */
  setServiceEntry(
    key: TModelKey,
    entry: {
      isInternal?: boolean;
      description: string;
      model?: string;
      embedModel?: string;
      service: AxAIService<unknown, unknown, TModelKey>;
    }
  ): void {
    this.services.set(key, entry);
  }
}
