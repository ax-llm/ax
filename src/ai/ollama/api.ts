import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

export type AxOllamaAIConfig = AxOpenAIConfig;

export const axOllamaDefaultConfig = (): AxOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm'
  });

export const axOllamaDefaultCreativeConfig = (): AxOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultCreativeConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm'
  });

export type AxOllamaArgs = {
  model?: string;
  embedModel?: string;
  url?: string;
  apiKey?: string;
  config?: Readonly<AxOllamaAIConfig>;
  options?: Readonly<AxAIServiceOptions>;
};

/**
 * OllamaAI: AI Service
 * @export
 */
export class AxOllama extends AxOpenAI {
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434',
    model,
    embedModel,
    config = axOllamaDefaultConfig(),
    options
  }: Readonly<AxOllamaArgs>) {
    super({
      apiKey,
      options,
      config: {
        ...config,
        ...(model ? { model } : {}),
        ...(embedModel ? { embedModel } : {})
      },
      apiURL: new URL('/v1', url).href
    });

    super.setName('Ollama');
  }
}
