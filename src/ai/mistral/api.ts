import type { AIServiceOptions } from '../../text/types.js';
import { BaseAIDefaultConfig } from '../base.js';
import { OpenAI } from '../openai/api.js';
import type { OpenAIConfig } from '../openai/types.js';

import { MistralModel } from './types.js';

type MistralConfig = OpenAIConfig;

/**
 * Mistral: Default Model options for text generation
 * @export
 */
export const MistralDefaultConfig = (): MistralConfig =>
  structuredClone({
    model: MistralModel.MistralSmall,
    ...BaseAIDefaultConfig()
  });

/**
 * Mistral: Default model options to use the more advanced model
 * @export
 */
export const MistralBestConfig = (): OpenAIConfig =>
  structuredClone({
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
