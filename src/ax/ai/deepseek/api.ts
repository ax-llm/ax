import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import { AxAIOpenAI } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/types.js';
import type { AxAIServiceOptions } from '../types.js';

import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

type DeepSeekConfig = AxAIOpenAIConfig;

export const axAIDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekChat,
    ...axBaseAIDefaultConfig()
  });

export const axAIDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekCoder,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxAIDeepSeekArgs {
  name: 'deepseek';
  apiKey: string;
  config?: Readonly<Partial<DeepSeekConfig>>;
  options?: Readonly<AxAIServiceOptions>;
}

export class AxAIDeepSeek extends AxAIOpenAI<AxAIDeepSeekModel, string> {
  constructor({
    apiKey,
    config,
    options
  }: Readonly<Omit<AxAIDeepSeekArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }
    const _config = {
      ...axAIDeepSeekDefaultConfig(),
      ...config
    };
    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo: axModelInfoDeepSeek
    });

    super.setName('DeepSeek');
  }
}
