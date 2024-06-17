import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

export type AxOllamaAIConfig = AxOpenAIConfig;

export const axOllamaDefaultConfig = (): Omit<AxOllamaAIConfig, 'model'> =>
  structuredClone({
    ...axBaseAIDefaultConfig()
  });

export const axOllamaDefaultCreativeConfig = (): Omit<
  AxOllamaAIConfig,
  'model'
> =>
  structuredClone({
    ...axBaseAIDefaultCreativeConfig()
  });

export type AxOllamaArgs = {
  model: string;
  url?: string;
  apiKey?: string;
  config?: Readonly<Omit<AxOllamaAIConfig, 'model'>>;
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
    config = axOllamaDefaultConfig(),
    options
  }: Readonly<AxOllamaArgs>) {
    super({
      apiKey,
      options,
      config: { ...config, model },
      apiURL: new URL('/v1', url).href
    });

    super.setName('Ollama');
  }
}
