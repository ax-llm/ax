import { axBaseAIDefaultConfig } from '../base.js'
import { AxAIOpenAI, type AxAIOpenAIArgs } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'

import { axModelInfoTogether } from './info.js'

type TogetherAIConfig = AxAIOpenAIConfig<string, undefined>

export const axAITogetherDefaultConfig = (): TogetherAIConfig =>
  structuredClone({
    // cspell:disable-next-line
    model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ...axBaseAIDefaultConfig(),
  })

export type AxAITogetherArgs = AxAIOpenAIArgs<
  'together',
  TogetherAIConfig,
  string
>

export class AxAITogether extends AxAIOpenAI<
  Omit<AxAITogetherArgs, 'name'>,
  string
> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAITogetherArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set')
    }
    const _config = {
      ...axAITogetherDefaultConfig(),
      ...config,
    }
    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.together.xyz/v1',
      modelInfo: axModelInfoTogether,
      models,
    })

    super.setName('Together')
  }
}
