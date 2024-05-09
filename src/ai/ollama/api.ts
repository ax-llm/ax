import type { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

type OllamaAIConfig = OpenAIConfig;

/**
 * OllamaAI: Default Model options for text generation
 * @export
 */
export const OllamaDefaultConfig = (): Omit<OllamaAIConfig, 'model'> => ({
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5
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
