import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js'

import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'
import type { AxAIServiceOptions, AxModelInfo } from '../types.js'

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
  modelInfo?: AxModelInfo[]
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
    modelInfo,
  }: Readonly<Omit<AxAIGrokArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Grok API key not set')
    }

    const _config = {
      ...axAIGrokDefaultConfig(),
      ...config,
    }

    modelInfo = [...axModelInfoGrok, ...(modelInfo ?? [])]

    const supportFor = (model: AxAIGrokModel) => {
      const mi = getModelInfo<AxAIGrokModel, AxAIGrokEmbedModels>({
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
      config: _config,
      options,
      apiURL: 'https://api.x.ai/v1',
      modelInfo,
      models,
      supportFor,
    })

    super.setName('Grok')
  }
}
