import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'

import { axModelInfoDeepSeek } from './info.js'
import { AxAIDeepSeekModel } from './types.js'

type DeepSeekConfig = AxAIOpenAIConfig<AxAIDeepSeekModel, undefined>

export const axAIDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekChat,
    ...axBaseAIDefaultConfig(),
  })

export const axAIDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekCoder,
    ...axBaseAIDefaultCreativeConfig(),
  })

export type AxAIDeepSeekArgs = AxAIOpenAIArgs<
  'deepseek',
  AxAIDeepSeekModel,
  undefined
>

export class AxAIDeepSeek extends AxAIOpenAIBase<AxAIDeepSeekModel, undefined> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIDeepSeekArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set')
    }
    const _config = {
      ...axAIDeepSeekDefaultConfig(),
      ...config,
    }
    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo: axModelInfoDeepSeek,
      models,
    })

    super.setName('DeepSeek')
  }
}
