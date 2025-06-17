import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js'
import type { AxAIServiceOptions, AxModelInfo } from '../types.js'

import { axModelInfoMistral } from './info.js'
import { AxAIMistralEmbedModels, AxAIMistralModel } from './types.js'

type AxAIMistralConfig = AxAIOpenAIConfig<
  AxAIMistralModel,
  AxAIMistralEmbedModels
>

export const axAIMistralDefaultConfig = (): AxAIMistralConfig =>
  structuredClone({
    model: AxAIMistralModel.MistralSmall,
    ...axBaseAIDefaultConfig(),
    topP: 1,
  })

export const axAIMistralBestConfig = (): AxAIMistralConfig =>
  structuredClone({
    ...axAIMistralDefaultConfig(),
    model: AxAIMistralModel.MistralLarge,
  })

export type AxAIMistralChatRequest = Omit<
  AxAIOpenAIChatRequest<AxAIMistralModel>,
  'max_completion_tokens'
> & {
  max_tokens?: number
}

export type AxAIMistralArgs = AxAIOpenAIArgs<
  'mistral',
  AxAIMistralModel,
  AxAIMistralEmbedModels
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number }
  modelInfo?: AxModelInfo[]
}

export class AxAIMistral extends AxAIOpenAIBase<
  AxAIMistralModel,
  AxAIMistralEmbedModels
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIMistralArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set')
    }
    const _config = {
      ...axAIMistralDefaultConfig(),
      ...config,
    }

    modelInfo = [...axModelInfoMistral, ...(modelInfo ?? [])]

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
    }

    // Chat request updater to add Grok's search parameters
    const chatReqUpdater = (
      req: AxAIMistralChatRequest
    ): AxAIMistralChatRequest => {
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
      const { max_completion_tokens, stream_options, ...result } =
        req as AxAIMistralChatRequest & { max_completion_tokens?: number, stream_options?: unknown }

      return {
        ...result,
        max_tokens: max_completion_tokens,
      }
    }

    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo,
      models,
      supportFor,
      chatReqUpdater,
    })

    super.setName('Mistral')
  }
}
