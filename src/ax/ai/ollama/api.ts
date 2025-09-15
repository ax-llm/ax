import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

/**
 * Configuration type for Ollama AI service
 */
export type AxAIOllamaAIConfig = AxAIOpenAIConfig<string, string>;

/**
 * Creates default configuration for Ollama AI service
 * @returns Default configuration object with nous-hermes2 model and all-minilm embed model
 */
export const axAIOllamaDefaultConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  });

/**
 * Creates default creative configuration for Ollama AI service
 * @returns Creative configuration object with nous-hermes2 model and all-minilm embed model
 */
export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaAIConfig =>
  structuredClone({
    ...axBaseAIDefaultCreativeConfig(),
    model: 'nous-hermes2',
    embedModel: 'all-minilm',
  });

/**
 * Arguments type for initializing Ollama AI service
 * @template TModelKey - Type for model key
 */
export type AxAIOllamaArgs<TModelKey> = AxAIOpenAIArgs<
  'ollama',
  string,
  string,
  TModelKey
> & {
  model?: string;
  embedModel?: string;
  url?: string;
};

/**
 * Ollama AI service implementation that extends OpenAI base functionality
 * Provides access to locally hosted Ollama models with OpenAI-compatible API
 * @template TModelKey - Type for model key
 */
export class AxAIOllama<TModelKey> extends AxAIOpenAIBase<
  string,
  string,
  TModelKey
> {
  /**
   * Creates a new Ollama AI service instance
   * @param args - Configuration arguments for the Ollama service
   * @param args.apiKey - API key for authentication (defaults to 'not-set')
   * @param args.url - Base URL for the Ollama API (defaults to 'http://localhost:11434/v1')
   * @param args.config - Additional configuration options
   * @param args.options - Service options
   * @param args.models - Available models configuration
   */
  constructor({
    apiKey = 'not-set',
    url = 'http://localhost:11434/v1',
    config,
    options,
    models,
  }: Readonly<Omit<AxAIOllamaArgs<TModelKey>, 'name'>>) {
    const Config = {
      ...axAIOllamaDefaultConfig(),
      ...config,
    };
    super({
      apiKey,
      options,
      config: Config,
      apiURL: url,
      models,
      modelInfo: [],
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
    });

    super.setName('Ollama');
  }
}
