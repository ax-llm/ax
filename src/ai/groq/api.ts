import { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import { OpenAIConfig } from '../openai/types.js';

type GroqAIConfig = OpenAIConfig;

/**
 * GroqAI: Default Model options for text generation
 * @export
 */
export const GroqDefaultConfig = (): GroqAIConfig => ({
  model: 'llama2-70b-4096',
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5
});

export interface GroqArgs {
  apiKey: string;
  config: Readonly<GroqAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GroqAI: AI Service
 * @export
 */
export class Groq extends OpenAI {
  constructor({ apiKey, config, options }: Readonly<GroqArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set');
    }
    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.groq.com/openai/v1'
    });

    super.name = 'Groq';
  }
}
