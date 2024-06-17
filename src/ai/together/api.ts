import { axBaseAIDefaultConfig } from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoTogether } from './info.js';

type TogetherAIConfig = AxOpenAIConfig;

export const axTogetherDefaultConfig = (): TogetherAIConfig =>
  structuredClone({
    model: 'llama2-70b-4096',
    ...axBaseAIDefaultConfig()
  });

export interface AxTogetherArgs {
  apiKey: string;
  config: Readonly<TogetherAIConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxTogether extends AxOpenAI {
  constructor({
    apiKey,
    config = axTogetherDefaultConfig(),
    options
  }: Readonly<AxTogetherArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set');
    }
    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.together.xyz/v1',
      modelInfo: axModelInfoTogether
    });

    super.setName('Together');
  }
}
