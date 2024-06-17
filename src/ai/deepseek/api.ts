import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import { AxOpenAI } from '../openai/api.js';
import type { AxOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoDeepSeek } from './info.js';
import { AxDeepSeekModel } from './types.js';

type DeepSeekConfig = AxOpenAIConfig;

export const axDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxDeepSeekModel.DeepSeekChat,
    ...axBaseAIDefaultConfig()
  });

export const axDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxDeepSeekModel.DeepSeekCoder,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxDeepSeekArgs {
  apiKey: string;
  config: Readonly<DeepSeekConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxDeepSeek extends AxOpenAI {
  constructor({
    apiKey,
    config = axDeepSeekDefaultConfig(),
    options
  }: Readonly<AxDeepSeekArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }

    super({
      apiKey,
      config,
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo: axModelInfoDeepSeek
    });

    super.setName('DeepSeek');
  }
}
