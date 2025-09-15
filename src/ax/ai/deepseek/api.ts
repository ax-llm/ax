import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

import { axModelInfoDeepSeek } from './info.js';
import { AxAIDeepSeekModel } from './types.js';

/**
 * Configuration type for DeepSeek AI models
 */
type DeepSeekConfig = AxAIOpenAIConfig<AxAIDeepSeekModel, undefined>;

/**
 * Creates the default configuration for DeepSeek AI with the chat model
 * @returns Default DeepSeek configuration with chat model settings
 */
export const axAIDeepSeekDefaultConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekChat,
    ...axBaseAIDefaultConfig(),
  });

/**
 * Creates a configuration optimized for code generation tasks using DeepSeek Coder
 * @returns DeepSeek configuration with creative settings for coding tasks
 */
export const axAIDeepSeekCodeConfig = (): DeepSeekConfig =>
  structuredClone({
    model: AxAIDeepSeekModel.DeepSeekCoder,
    ...axBaseAIDefaultCreativeConfig(),
  });

/**
 * Arguments type for initializing DeepSeek AI instances
 * @template TModelKey - The model key type for type safety
 */
export type AxAIDeepSeekArgs<TModelKey> = AxAIOpenAIArgs<
  'deepseek',
  AxAIDeepSeekModel,
  undefined,
  TModelKey
>;

/**
 * DeepSeek AI client implementation extending OpenAI base functionality
 * Provides access to DeepSeek's language models through OpenAI-compatible API
 * @template TModelKey - The model key type for type safety
 */
export class AxAIDeepSeek<TModelKey> extends AxAIOpenAIBase<
  AxAIDeepSeekModel,
  undefined,
  TModelKey
> {
  /**
   * Creates a new DeepSeek AI client instance
   * @param args - Configuration arguments for the DeepSeek client
   * @param args.apiKey - DeepSeek API key for authentication
   * @param args.config - Optional configuration overrides
   * @param args.options - Optional client options
   * @param args.models - Optional model definitions
   * @param args.modelInfo - Optional additional model information
   * @throws {Error} When API key is not provided or empty
   */
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
        media: {
          images: {
            supported: false,
            formats: [],
          },
          audio: {
            supported: false,
            formats: [],
          },
          files: {
            supported: false,
            formats: [],
            uploadMethod: 'none' as const,
          },
          urls: {
            supported: false,
            webSearch: false,
            contextFetching: false,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: false,
        multiTurn: true,
      },
      models,
    });

    super.setName('DeepSeek');
  }
}
