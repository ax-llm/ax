import { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import { OpenAIConfig } from '../openai/types.js';

type GroqAIConfig = Omit<
  OpenAIConfig,
  'model' | 'embedModel' | 'audioModel'
> & { model: string };
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

export interface GroqAIArgs {
  apiKey: string;
  config: Readonly<OpenAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GroqAI: AI Service
 * @export
 */
export class GroqAI extends OpenAI {
  constructor({ apiKey, config, options }: Readonly<GroqAIArgs>) {
    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.groq.com/openai/v1'
    });

    super.aiName = 'Groq';
  }
}
