import type { AIServiceOptions } from '../../text/types.js';
import { BaseAIDefaultConfig, BaseAIDefaultCreativeConfig } from '../base.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

export type OllamaAIConfig = OpenAIConfig;

/**
 * OllamaAI: Default Model options for text generation
 * @export
 */
export const OllamaDefaultConfig = (): Omit<OllamaAIConfig, 'model'> =>
  structuredClone({
    ...BaseAIDefaultConfig()
  });

export const OllamaDefaultCreativeConfig = (): Omit<OllamaAIConfig, 'model'> =>
  structuredClone({
    ...BaseAIDefaultCreativeConfig()
  });

export type OllamaArgs = {
  model: string;
  url?: string;
  apiKey?: string;
  config?: Readonly<Omit<OllamaAIConfig, 'model'>>;
  options?: Readonly<AIServiceOptions>;
};

/**
 * OllamaAI: AI Service
 * @export
 */
export class Ollama extends OpenAI {
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434',
    model,
    config = OllamaDefaultConfig(),
    options
  }: Readonly<OllamaArgs>) {
    super({
      apiKey,
      options,
      config: { ...config, model },
      apiURL: new URL('/v1', url).href
    });

    super.setName('Ollama');
  }
}
