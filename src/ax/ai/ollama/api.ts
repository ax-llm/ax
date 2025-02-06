import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import { AxAIOpenAI, type AxAIOpenAIArgs } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'

export type AxAIOllamaAIConfig = AxAIOpenAIConfig<string, undefined>

export const axAIOllamaDefaultConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  })

export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultCreativeConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  })

export type AxAIOllamaArgs = AxAIOpenAIArgs<
  'ollama',
  AxAIOllamaAIConfig,
  string
> & {
  model?: string
  embedModel?: string
  url?: string
}

/**
 * OllamaAI: AI Service
 */
export class AxAIOllama extends AxAIOpenAI<
  Omit<AxAIOllamaArgs, 'name'>,
  string
> {
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434/v1',
    config,
    options,
    models,
  }: Readonly<Omit<AxAIOllamaArgs, 'name'>>) {
    const _config = {
      ...axAIOllamaDefaultConfig(),
      ...config,
    }
    super({
      apiKey,
      options,
      config: _config,
      apiURL: url,
      models,
    })

    super.setName('Ollama')
  }
}
