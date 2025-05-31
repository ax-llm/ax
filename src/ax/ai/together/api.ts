import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'

import { axModelInfoTogether } from './info.js'

type TogetherAIConfig = AxAIOpenAIConfig<string, unknown>

export const axAITogetherDefaultConfig = (): TogetherAIConfig =>
  structuredClone({
    // cspell:disable-next-line
    model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ...axBaseAIDefaultConfig(),
  })

export type AxAITogetherArgs = AxAIOpenAIArgs<'together', string, unknown>

export class AxAITogether extends AxAIOpenAIBase<string, unknown> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAITogetherArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set')
    }
    const _config = {
      ...axAITogetherDefaultConfig(),
      ...config,
    }

    modelInfo = [...axModelInfoTogether, ...(modelInfo ?? [])]

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
      apiURL: 'https://api.together.xyz/v1',
      modelInfo,
      models,
      supportFor,
    })

    super.setName('Together')
  }
}
