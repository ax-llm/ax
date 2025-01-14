import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import { AxAIOpenAI } from '../openai/api.js'
import type { AxAIOpenAIConfig } from '../openai/types.js'
import type { AxAIServiceOptions } from '../types.js'

export type AxAIOllamaAIConfig = AxAIOpenAIConfig

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

export type AxAIOllamaArgs = {
  name: 'ollama'
  model?: string
  embedModel?: string
  url?: string
  apiKey?: string
  config?: Readonly<Partial<AxAIOllamaAIConfig>>
  options?: Readonly<AxAIServiceOptions>
  modelMap?: Record<string, string>
}

/**
 * OllamaAI: AI Service
 */
export class AxAIOllama extends AxAIOpenAI {
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434/v1',
    config,
    options,
    modelMap,
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
      modelMap,
    })

    super.setName('Ollama')
  }
}
