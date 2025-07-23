import { axBaseAIDefaultConfig } from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

import { axModelInfoTogether } from './info.js';

type TogetherAIConfig = AxAIOpenAIConfig<string, unknown>;

export const axAITogetherDefaultConfig = (): TogetherAIConfig =>
  structuredClone({
    // cspell:disable-next-line
    model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ...axBaseAIDefaultConfig(),
  });

export type AxAITogetherArgs<TModelKey> = AxAIOpenAIArgs<
  'together',
  string,
  unknown,
  TModelKey
>;

/**
 * Represents the Together AI service.
 *
 * @template TModelKey - The type of the model key.
 */
export class AxAITogether<TModelKey> extends AxAIOpenAIBase<
  string,
  unknown,
  TModelKey
> {
  /**
   * Creates an instance of the `AxAITogether` class.
   *
   * @param {Readonly<Omit<AxAITogetherArgs<TModelKey>, 'name'>>} params - The parameters for creating the instance.
   */
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAITogetherArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set');
    }
    const Config = {
      ...axAITogetherDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoTogether, ...(modelInfo ?? [])];

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
    };

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.together.xyz/v1',
      modelInfo,
      models,
      supportFor,
    });

    super.setName('Together');
  }
}
