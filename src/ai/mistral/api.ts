import type { AIServiceOptions } from '../../text/types.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

import { MistralModel } from './types.js';

type MistralConfig = OpenAIConfig;

/**
 * Mistral: Default Model options for text generation
 * @export
 */
export const MistralDefaultConfig = (): MistralConfig => ({
  model: MistralModel.MistralSmall,
  stream: false,
  suffix: null,
  maxTokens: 500,
  temperature: 0.1,
  topP: 0.9
});

/**
 * Mistral: Default model options to use the more advanced model
 * @export
 */
export const MistralBestConfig = (): OpenAIConfig => ({
  ...MistralDefaultConfig(),
  model: MistralModel.MistralLarge
});

export interface MistralArgs {
  apiKey: string;
  config: Readonly<MistralConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * Mistral: AI Service
 * @export
 */
export class Mistral extends OpenAI {
  constructor({
    apiKey,
    config = MistralDefaultConfig(),
    options
  }: Readonly<MistralArgs>) {
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
