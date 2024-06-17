import { axBaseAIDefaultConfig } from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoMistral } from './info.js';
import { AxMistralModel } from './types.js';

type MistralConfig = AxOpenAIConfig;

export const axMistralDefaultConfig = (): MistralConfig =>
  structuredClone({
    model: AxMistralModel.MistralSmall,
    ...axBaseAIDefaultConfig()
  });

export const axMistralBestConfig = (): AxOpenAIConfig =>
  structuredClone({
    ...axMistralDefaultConfig(),
    model: AxMistralModel.MistralLarge
  });

export interface AxMistralArgs {
  apiKey: string;
  config: Readonly<MistralConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxMistral extends AxOpenAI {
  constructor({
    apiKey,
    config = axMistralDefaultConfig(),
    options
  }: Readonly<AxMistralArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set');
    }

    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo: axModelInfoMistral
    });

    super.setName('Mistral');
  }
}
