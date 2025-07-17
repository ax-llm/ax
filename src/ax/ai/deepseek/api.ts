import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

type DeepSeekConfig = AxAIOpenAIConfig<AxAIDeepSeekModel, undefined>;

export const axAIDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekChat,
    ...axBaseAIDefaultConfig(),
  });

export const axAIDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekCoder,
    ...axBaseAIDefaultCreativeConfig(),
  });

export type AxAIDeepSeekArgs<TModelKey> = AxAIOpenAIArgs<
  'deepseek',
  AxAIDeepSeekModel,
  undefined,
  TModelKey
>;

export class AxAIDeepSeek<TModelKey> extends AxAIOpenAIBase<
  AxAIDeepSeekModel,
  undefined,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIDeepSeekArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('DeepSeek API key not set');
    }
    const Config = {
      ...axAIDeepSeekDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoDeepSeek, ...(modelInfo ?? [])];

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.deepseek.com',
      modelInfo,
      supportFor: {
        functions: true,
        streaming: true,
        hasThinkingBudget: false,
        hasShowThoughts: false,
      },
      models,
    });

    super.setName('DeepSeek');
  }
}
