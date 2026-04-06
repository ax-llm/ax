import {
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js';
import type { AxAIServiceOptions } from '../types.js';

/**
 * Configuration type for Ollama AI service
 */
export type AxAIOllamaAIConfig = AxAIOpenAIConfig<string, string>;

type AxAIOllamaChatRequest = AxAIOpenAIChatRequest<string> & {
  think?: boolean;
};

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
  TModelKey,
  AxAIOllamaChatRequest
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

    const chatReqUpdater = (
      req: Readonly<AxAIOllamaChatRequest>,
      serviceOptions: Readonly<AxAIServiceOptions>
    ): AxAIOllamaChatRequest => {
      if (!serviceOptions.thinkingTokenBudget) {
        return req;
      }

      return {
        ...req,
        think: serviceOptions.thinkingTokenBudget !== 'none',
      };
    };

    super({
      apiKey,
      options,
      config: Config,
      apiURL: url,
      models,
      modelInfo: [],
      chatReqUpdater,
      supportFor: {
        functions: true,
        streaming: true,
        hasThinkingBudget: true,
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
        thinking: true,
        multiTurn: true,
      },
    });

    super.setName('Ollama');
  }
}
