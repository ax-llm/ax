import { AxRateLimiterTokenUsage } from '../../util/rate-limit.js'
import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'
import type { AxAIServiceOptions, AxRateLimiterFunction } from '../types.js'

import { axModelInfoGroq } from './info.js'
import { AxAIGroqModel } from './types.js'

type AxAIGroqAIConfig = AxAIOpenAIConfig<AxAIGroqModel, undefined>

const axAIGroqDefaultConfig = (): AxAIGroqAIConfig =>
  structuredClone({
    model: AxAIGroqModel.Llama33_70B,
    ...axBaseAIDefaultConfig(),
  })

export type AxAIGroqArgs = AxAIOpenAIArgs<'groq', AxAIGroqModel, undefined> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number }
}

export class AxAIGroq extends AxAIOpenAIBase<AxAIGroqModel, undefined> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIGroqArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set')
    }
    const _config = {
      ...axAIGroqDefaultConfig(),
      ...config,
    }

    const _options = {
      ...options,
      streamingUsage: false,
    }

    super({
      apiKey,
      config: _config,
      options: _options,
      modelInfo: axModelInfoGroq,
      apiURL: 'https://api.groq.com/openai/v1',
      models,
    })

    super.setName('Groq')
    this.setOptions(_options)
  }

  override setOptions = (options: Readonly<AxAIServiceOptions>) => {
    const rateLimiter = this.newRateLimiter(options)
    super.setOptions({ ...options, rateLimiter })
  }

  private newRateLimiter = (options: Readonly<AxAIGroqArgs['options']>) => {
    if (options?.rateLimiter) {
      return options.rateLimiter
    }

    const tokensPerMin = options?.tokensPerMinute ?? 4800
    const rt = new AxRateLimiterTokenUsage(tokensPerMin, tokensPerMin / 60, {
      debug: options?.debug,
    })

    const rtFunc: AxRateLimiterFunction = async (func, info) => {
      const totalTokens = info.modelUsage?.tokens?.totalTokens || 0
      await rt.acquire(totalTokens)
      return await func()
    }

    return rtFunc
  }
}
