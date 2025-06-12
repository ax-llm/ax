import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js'
import { type AxAIOpenAIResponsesConfig } from '@ax-llm/ax/index.js'

import { AxBaseAI } from '../base.js'
import type { AxAIFeatures } from '../base.js'
import type {
  AxAIInputModelList,
  AxAIServiceOptions,
  AxModelInfo,
} from '../types.js'

import type {
  AxAIOpenAIEmbedRequest,
  AxAIOpenAIEmbedResponse,
} from './chat_types.js'
import { AxAIOpenAIEmbedModel } from './chat_types.js'
import { axModelInfoOpenAI } from './info.js'
import { AxAIOpenAIResponsesImpl } from './responses_api.js'
import type {
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
} from './responses_types.js'
import { AxAIOpenAIResponsesModel } from './responses_types.js'

// Helper functions to create default configurations
export const axAIOpenAIResponsesDefaultConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  model: AxAIOpenAIResponsesModel.GPT4O,
  embedModel: AxAIOpenAIEmbedModel.TextEmbeddingAda002,
  temperature: 0.7,
  topP: 1,
  stream: true,
  //   reasoningEffort: 'medium',
})

export const axAIOpenAIResponsesBestConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIResponsesDefaultConfig(),
  model: AxAIOpenAIResponsesModel.GPT4O,
  temperature: 0.5,
})

export const axAIOpenAIResponsesCreativeConfig = (): AxAIOpenAIResponsesConfig<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIResponsesDefaultConfig(),
  model: AxAIOpenAIResponsesModel.GPT4O,
  temperature: 0.9,
})

// Arguments for AxAIOpenAIResponsesBase constructor
interface AxAIOpenAIResponsesBaseArgs<
  TModel,
  TEmbedModel,
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> {
  apiKey: string
  config: AxAIOpenAIResponsesConfig<TModel, TEmbedModel>
  options?: {
    streamingUsage?: boolean
  } & AxAIServiceOptions
  apiURL?: string
  modelInfo?: ReadonlyArray<AxModelInfo>
  models?: AxAIInputModelList<TModel, TEmbedModel>
  responsesReqUpdater?: (
    req: Readonly<TResponsesReq>
  ) => Readonly<TResponsesReq>
  supportFor?: AxAIFeatures | ((model: TModel) => AxAIFeatures)
}

/**
 * Base class for OpenAI AI services using the /v1/responses API endpoint
 */
export class AxAIOpenAIResponsesBase<
  TModel,
  TEmbedModel,
  TResponsesReq extends AxAIOpenAIResponsesRequest<TModel>,
> extends AxBaseAI<
  TModel,
  TEmbedModel,
  AxAIOpenAIResponsesRequest<TModel>,
  AxAIOpenAIEmbedRequest<TEmbedModel>,
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesResponseDelta,
  AxAIOpenAIEmbedResponse
> {
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo = [],
    models,
    responsesReqUpdater,
    supportFor = { functions: true, streaming: true },
  }: Readonly<
    AxAIOpenAIResponsesBaseArgs<TModel, TEmbedModel, TResponsesReq>
  >) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set')
    }

    const aiImpl = new AxAIOpenAIResponsesImpl<
      TModel,
      TEmbedModel,
      TResponsesReq
    >(config, options?.streamingUsage ?? true, responsesReqUpdater)

    // Convert models to the expected format if needed
    const formattedModels = models as
      | AxAIInputModelList<TModel, TEmbedModel>
      | undefined

    super(aiImpl, {
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo,
      defaults: {
        model: config.model,
        embedModel: config.embedModel,
      },
      options,
      supportFor,
      models: formattedModels,
    })
  }
}

/**
 * Ready-to-use implementation of the OpenAI Responses API client
 * This class uses OpenAI's /v1/responses API endpoint which supports text, image, and audio inputs
 */

export interface AxAIOpenAIResponsesArgs<
  TName = 'openai-responses',
  TModel = AxAIOpenAIResponsesModel,
  TEmbedModel = AxAIOpenAIEmbedModel,
  TChatReq extends
    AxAIOpenAIResponsesRequest<TModel> = AxAIOpenAIResponsesRequest<TModel>,
> extends Omit<
    AxAIOpenAIResponsesBaseArgs<TModel, TEmbedModel, TChatReq>,
    'config' | 'supportFor' | 'modelInfo'
  > {
  name: TName
  modelInfo?: AxModelInfo[]
  config?: Partial<
    AxAIOpenAIResponsesBaseArgs<TModel, TEmbedModel, TChatReq>['config']
  >
}

export class AxAIOpenAIResponses extends AxAIOpenAIResponsesBase<
  AxAIOpenAIResponsesModel,
  AxAIOpenAIEmbedModel,
  AxAIOpenAIResponsesRequest<AxAIOpenAIResponsesModel>
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIOpenAIResponsesArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set')
    }

    // Use the original OpenAI model info since it contains both chat and embed models
    modelInfo = [...axModelInfoOpenAI, ...(modelInfo ?? [])]

    const supportFor = (model: AxAIOpenAIResponsesModel) => {
      const mi = getModelInfo<AxAIOpenAIResponsesModel, AxAIOpenAIEmbedModel>({
        model,
        modelInfo,
        models,
      })
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
      }
    }

    super({
      apiKey,
      config: {
        ...axAIOpenAIResponsesDefaultConfig(),
        ...config,
      },
      options,
      modelInfo,
      models,
      supportFor,
    })
  }
}
