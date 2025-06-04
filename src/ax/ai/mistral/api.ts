import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/chat_types.js'
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
  })

export const axAIMistralBestConfig = (): AxAIMistralConfig =>
  structuredClone({
    ...axAIMistralDefaultConfig(),
    model: AxAIMistralModel.MistralLarge,
  })

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

    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo,
      models,
      supportFor,
    })

    super.setName('Mistral')
  }
}
