import type { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

import { MistralModel } from './types.js';

type MistralAIConfig = OpenAIConfig;

/**
 * MistralAI: Default Model options for text generation
 * @export
 */
export const MistralDefaultConfig = (): MistralAIConfig => ({
  model: MistralModel.MistralMedium,
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5
});

export interface MistralArgs {
  apiKey: string;
  config: Readonly<MistralAIConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * MistralAI: AI Service
 * @export
 */
export class Mistral extends OpenAI {
  constructor({ apiKey, config, options }: Readonly<MistralArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set');
    }
    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.mistral.ai/v1'
    });

    super.setName('Mistral');
  }
}
