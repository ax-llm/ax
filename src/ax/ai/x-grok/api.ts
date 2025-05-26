import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'
import type { AxAIServiceOptions } from '../types.js'

import { axModelInfoGrok } from './info.js'
import { AxAIGrokEmbedModels, AxAIGrokModel } from './types.js'

export const axAIGrokDefaultConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    model: AxAIGrokModel.Grok3Mini,
    ...axBaseAIDefaultConfig(),
  })

export const axAIGrokBestConfig = (): AxAIOpenAIConfig<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> =>
  structuredClone({
    ...axAIGrokDefaultConfig(),
    model: AxAIGrokModel.Grok3,
  })

export type AxAIGrokArgs = AxAIOpenAIArgs<
  'grok',
  AxAIGrokModel,
  AxAIGrokEmbedModels
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number }
}

export class AxAIGrok extends AxAIOpenAIBase<
  AxAIGrokModel,
  AxAIGrokEmbedModels
> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIGrokArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Grok API key not set')
    }
    const _config = {
      ...axAIGrokDefaultConfig(),
      ...config,
    }

    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.x.ai/v1',
      modelInfo: axModelInfoGrok,
      models,
    })

    super.setName('Grok')
  }
}
