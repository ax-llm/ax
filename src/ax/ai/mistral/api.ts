import { axBaseAIDefaultConfig } from '../base.js'
import { AxAIOpenAI, type AxAIOpenAIArgs } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'
import type { AxAIServiceOptions } from '../types.js'

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
  AxAIMistralConfig,
  AxAIMistralModel | AxAIMistralEmbedModels
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number }
}

export class AxAIMistral extends AxAIOpenAI<
  Omit<AxAIMistralArgs, 'name'>,
  AxAIMistralModel | AxAIMistralEmbedModels
> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIMistralArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set')
    }
    const _config = {
      ...axAIMistralDefaultConfig(),
      ...config,
    }
    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo: axModelInfoMistral,
      models,
    })

    super.setName('Mistral')
  }
}
