import { axBaseAIDefaultConfig } from '../base.js';
import { AxAIOpenAI } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoMistral } from './info.js';
import { AxAIMistralModel } from './types.js';

type MistralConfig = AxAIOpenAIConfig;

export const axAIMistralDefaultConfig = (): MistralConfig =>
  structuredClone({
    model: AxAIMistralModel.MistralSmall,
    ...axBaseAIDefaultConfig()
  });

export const axAIMistralBestConfig = (): AxAIOpenAIConfig =>
  structuredClone({
    ...axAIMistralDefaultConfig(),
    model: AxAIMistralModel.MistralLarge
  });

export interface AxAIMistralArgs {
  name: 'mistral';
  apiKey: string;
  config?: Readonly<Partial<MistralConfig>>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxAIMistral extends AxAIOpenAI {
  constructor({
    apiKey,
    config,
    options
  }: Readonly<Omit<AxAIMistralArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set');
    }
    const _config = {
      ...axAIMistralDefaultConfig(),
      ...config
    };
    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo: axModelInfoMistral
    });

    super.setName('Mistral');
  }
}
