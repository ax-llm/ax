// ReadableStream is available globally in modern browsers and Node.js 16+

import { AxAIAnthropic, type AxAIAnthropicArgs } from './anthropic/api.js';
import type { AxAIAnthropicModel } from './anthropic/types.js';
import {
  AxAIAzureOpenAI,
  type AxAIAzureOpenAIArgs,
} from './azure-openai/api.js';
import { AxAICohere, type AxAICohereArgs } from './cohere/api.js';
import type { AxAICohereEmbedModel, AxAICohereModel } from './cohere/types.js';
import { AxAIDeepSeek, type AxAIDeepSeekArgs } from './deepseek/api.js';
import type { AxAIDeepSeekModel } from './deepseek/types.js';
import {
  AxAIGoogleGemini,
  type AxAIGoogleGeminiArgs,
} from './google-gemini/api.js';
import type {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import { AxAIGroq, type AxAIGroqArgs } from './groq/api.js';
import type { AxAIGroqModel } from './groq/types.js';
import {
  AxAIHuggingFace,
  type AxAIHuggingFaceArgs,
} from './huggingface/api.js';
import type { AxAIHuggingFaceModel } from './huggingface/types.js';
import { AxAIMistral, type AxAIMistralArgs } from './mistral/api.js';
import type { AxAIMistralModel } from './mistral/types.js';
import { AxAIOllama, type AxAIOllamaArgs } from './ollama/api.js';
import { AxAIOpenAI, type AxAIOpenAIArgs } from './openai/api.js';
import type {
  AxAIOpenAIEmbedModel,
  AxAIOpenAIModel,
} from './openai/chat_types.js';
import {
  AxAIOpenAIResponses,
  type AxAIOpenAIResponsesArgs,
} from './openai/responses_api_base.js';
import type { AxAIOpenAIResponsesModel } from './openai/responses_types.js';
import { AxAIReka, type AxAIRekaArgs } from './reka/api.js';
import { AxAITogether, type AxAITogetherArgs } from './together/api.js';
import type {
  AxAIModelList,
  AxAIService,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxLoggerFunction,
} from './types.js';
import { AxAIGrok, type AxAIGrokArgs } from './x-grok/api.js';
import type { AxAIGrokModel } from './x-grok/types.js';
import { AxAIWebLLM, type AxAIWebLLMArgs } from './webllm/api.js';
import type { AxAIWebLLMModel } from './webllm/types.js';

export type AxAIArgs<TModelKey> =
  | AxAIOpenAIArgs<'openai', AxAIOpenAIModel, AxAIOpenAIEmbedModel, TModelKey>
  | AxAIOpenAIResponsesArgs<
      'openai-responses',
      AxAIOpenAIResponsesModel,
      AxAIOpenAIEmbedModel,
      TModelKey
    >
  | AxAIAzureOpenAIArgs<TModelKey>
  | AxAITogetherArgs<TModelKey>
  | AxAIAnthropicArgs<TModelKey>
  | AxAIGroqArgs<TModelKey>
  | AxAIGoogleGeminiArgs<TModelKey>
  | AxAICohereArgs<TModelKey>
  | AxAIHuggingFaceArgs<TModelKey>
  | AxAIMistralArgs<TModelKey>
  | AxAIDeepSeekArgs<TModelKey>
  | AxAIOllamaArgs<TModelKey>
  | AxAIRekaArgs<TModelKey>
  | AxAIGrokArgs<TModelKey>
  | AxAIWebLLMArgs<TModelKey>;

export type AxAIModels =
  | AxAIOpenAIModel
  | AxAIAnthropicModel
  | AxAIGroqModel
  | AxAIGoogleGeminiModel
  | AxAICohereModel
  | AxAIHuggingFaceModel
  | AxAIMistralModel
  | AxAIDeepSeekModel
  | AxAIGrokModel
  | AxAIWebLLMModel;

export type AxAIEmbedModels =
  | AxAIOpenAIEmbedModel
  | AxAIGoogleGeminiEmbedModel
  | AxAICohereEmbedModel;

// Helper to extract both model keys and enum values from model configurations
type ExtractModelKeysAndValues<T> = T extends readonly {
  key: infer K;
  model: infer M;
}[]
  ? K | M
  : never;

// Helper to infer TModelKey from args - now includes both keys and enum values
type InferTModelKey<T> = T extends { models: infer M }
  ? ExtractModelKeysAndValues<M>
  : string;

/**
 * Factory function for creating an `AxAI` instance with proper type inference.
 *
 * This function allows for the creation of an `AxAI` instance by providing the necessary configuration options.
 * It automatically infers the model key type from the provided options, ensuring type safety.
 *
 * @example
 * ```typescript
 * import { createAxAI } from './ax';
 *
 * const ai = createAxAI({
 *   name: 'openai',
 *   apiKey: 'YOUR_API_KEY',
 *   // other options...
 * });
 *
 * const response = await ai.chat({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello, world!' }],
 * });
 * ```
 *
 * @template T - The type of the AI arguments, extending `AxAIArgs<any>`.
 * @param {T} options - The configuration options for the AI service.
 * @returns {AxAI<InferTModelKey<T>>} An instance of the `AxAI` class.
 */
export function createAxAI<const T extends AxAIArgs<any>>(
  options: T
): AxAI<InferTModelKey<T>> {
  return new AxAI(options) as any;
}

/**
 * The `AxAI` class is a wrapper for various AI services, providing a unified interface for chat and embedding operations.
 *
 * It uses a factory pattern to instantiate the appropriate AI service based on the provided options.
 *
 * @template TModelKey - The type of the model key, which can be a string or an enum.
 */
export class AxAI<TModelKey = string>
  implements AxAIService<any, any, TModelKey>
{
  private ai: AxAIService<any, any, TModelKey>;

  /**
   * Static factory method for creating an `AxAI` instance with automatic type inference.
   *
   * @example
   * ```typescript
   * import { AxAI } from './ax';
   *
   * const ai = AxAI.create({
   *   name: 'openai',
   *   apiKey: 'YOUR_API_KEY',
   *   // other options...
   * });
   * ```
   *
   * @template T - The type of the AI arguments, extending `AxAIArgs<any>`.
   * @param {T} options - The configuration options for the AI service.
   * @returns {AxAI<InferTModelKey<T>>} An instance of the `AxAI` class.
   */
  static create<const T extends AxAIArgs<any>>(
    options: T
  ): AxAI<InferTModelKey<T>> {
    return new AxAI(options) as any;
  }

  /**
   * Creates an instance of the `AxAI` class.
   *
   * @param {Readonly<AxAIArgs<TModelKey>>} options - The configuration options for the AI service.
   */
  constructor(options: Readonly<AxAIArgs<TModelKey>>) {
    switch (options.name) {
      case 'openai':
        this.ai = new AxAIOpenAI<TModelKey>(options);
        break;
      case 'openai-responses':
        this.ai = new AxAIOpenAIResponses<TModelKey>(options);
        break;
      case 'azure-openai':
        this.ai = new AxAIAzureOpenAI<TModelKey>(options);
        break;
      case 'grok':
        this.ai = new AxAIGrok<TModelKey>(options);
        break;
      case 'huggingface':
        this.ai = new AxAIHuggingFace<TModelKey>(options);
        break;
      case 'groq':
        this.ai = new AxAIGroq<TModelKey>(options);
        break;
      case 'together':
        this.ai = new AxAITogether<TModelKey>(options);
        break;
      case 'cohere':
        this.ai = new AxAICohere<TModelKey>(options);
        break;
      case 'google-gemini':
        this.ai = new AxAIGoogleGemini<TModelKey>(options);
        break;
      case 'anthropic':
        this.ai = new AxAIAnthropic<TModelKey>(options);
        break;
      case 'mistral':
        this.ai = new AxAIMistral<TModelKey>(options);
        break;
      case 'deepseek':
        this.ai = new AxAIDeepSeek<TModelKey>(options);
        break;
      case 'ollama':
        this.ai = new AxAIOllama<TModelKey>(options);
        break;
      case 'reka':
        this.ai = new AxAIReka<TModelKey>(options);
        break;
      case 'webllm':
        this.ai = new AxAIWebLLM<TModelKey>(options);
        break;
      default:
        throw new Error('Unknown AI');
    }
  }

  /**
   * Returns the name of the AI service.
   * @returns {string} The name of the AI service.
   */
  getName(): string {
    return this.ai.getName();
  }

  /**
   * Returns the ID of the AI service instance.
   * @returns {string} The ID of the AI service instance.
   */
  getId(): string {
    return this.ai.getId();
  }

  /**
   * Returns the features supported by the AI service for a given model.
   * @param {string} [model] - The model to check for features.
   * @returns {{ functions: boolean; streaming: boolean }} The supported features.
   */
  getFeatures(model?: string): { functions: boolean; streaming: boolean } {
    return this.ai.getFeatures(model);
  }

  /**
   * Returns the list of available models.
   * @returns {AxAIModelList<TModelKey> | undefined} The list of available models.
   */
  getModelList() {
    return this.ai.getModelList() as AxAIModelList<TModelKey> | undefined;
  }

  /**
   * Returns the last used chat model.
   * @returns {string | undefined} The last used chat model.
   */
  getLastUsedChatModel() {
    return this.ai.getLastUsedChatModel();
  }

  /**
   * Returns the last used embedding model.
   * @returns {string | undefined} The last used embedding model.
   */
  getLastUsedEmbedModel() {
    return this.ai.getLastUsedEmbedModel();
  }

  /**
   * Returns the configuration of the last used model.
   * @returns {unknown} The configuration of the last used model.
   */
  getLastUsedModelConfig() {
    return this.ai.getLastUsedModelConfig();
  }

  /**
   * Returns the metrics for the AI service.
   * @returns {AxAIServiceMetrics} The metrics for the AI service.
   */
  getMetrics(): AxAIServiceMetrics {
    return this.ai.getMetrics();
  }

  /**
   * Performs a chat completion request.
   * @param {Readonly<AxChatRequest<TModelKey>>} req - The chat request.
   * @param {Readonly<AxAIServiceOptions>} [options] - The options for the request.
   * @returns {Promise<AxChatResponse | ReadableStream<AxChatResponse>>} The chat response or a stream of chat responses.
   */
  async chat(
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    return await this.ai.chat(req, options);
  }

  /**
   * Performs an embedding request.
   * @param {Readonly<AxEmbedRequest<TModelKey>>} req - The embedding request.
   * @param {Readonly<AxAIServiceOptions>} [options] - The options for the request.
   * @returns {Promise<AxEmbedResponse>} The embedding response.
   */
  async embed(
    req: Readonly<AxEmbedRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse> {
    return await this.ai.embed(req, options);
  }

  /**
   * Sets the options for the AI service.
   * @param {Readonly<AxAIServiceOptions>} options - The options to set.
   */
  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.ai.setOptions(options);
  }

  /**
   * Returns the options for the AI service.
   * @returns {Readonly<AxAIServiceOptions>} The options for the AI service.
   */
  getOptions(): Readonly<AxAIServiceOptions> {
    return this.ai.getOptions();
  }

  /**
   * Returns the logger function for the AI service.
   * @returns {AxLoggerFunction} The logger function.
   */
  getLogger(): AxLoggerFunction {
    return this.ai.getLogger();
  }
}
