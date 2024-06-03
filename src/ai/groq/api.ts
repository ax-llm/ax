import type { AIServiceOptions } from '../../text/types.js';
import { BaseAIDefaultConfig } from '../base.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

type GroqAIConfig = OpenAIConfig;

/**
 * GroqAI: Default Model options for text generation
 * @export
 */
export const GroqDefaultConfig = (): GroqAIConfig =>
  structuredClone({
    model: 'llama2-70b-4096',
    ...BaseAIDefaultConfig()
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
  constructor({
    apiKey,
    config = GroqDefaultConfig(),
    options
  }: Readonly<GroqArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Groq API key not set');
    }
    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.groq.com/openai/v1'
    });

    super.setName('Groq');
  }
}
