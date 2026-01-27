// ReadableStream is available globally in modern browsers and Node.js 16+

import { AxAIAnthropic, type AxAIAnthropicArgs } from './anthropic/api.js';
import type { AxAIAnthropicModel } from './anthropic/types.js';
import {
  AxAIAzureOpenAI,
  type AxAIAzureOpenAIArgs,
} from './azure-openai/api.js';
import type { AxAIFeatures } from './base.js';
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
import { AxAIOpenRouter, type AxAIOpenRouterArgs } from './openrouter/api.js';
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
import { AxAIWebLLM, type AxAIWebLLMArgs } from './webllm/api.js';
import type { AxAIWebLLMModel } from './webllm/types.js';
import { AxAIGrok, type AxAIGrokArgs } from './x-grok/api.js';
import type { AxAIGrokModel } from './x-grok/types.js';

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
  | AxAIOpenRouterArgs<TModelKey>
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
 * Factory function for creating AI service instances with full type safety.
 *
 * This is the recommended way to create AI instances. It automatically selects
 * the appropriate provider implementation based on the `name` field and provides
 * type-safe access to provider-specific models.
 *
 * **Supported Providers:**
 * - `'openai'` - OpenAI (GPT-4, GPT-4o, o1, o3, etc.)
 * - `'openai-responses'` - OpenAI Responses API (for web search, file search)
 * - `'anthropic'` - Anthropic (Claude 3.5 Sonnet, Claude 3 Opus, etc.)
 * - `'google-gemini'` - Google (Gemini 1.5 Pro, Gemini 2.0 Flash, etc.)
 * - `'azure-openai'` - Azure OpenAI Service
 * - `'groq'` - Groq (Llama, Mixtral with fast inference)
 * - `'cohere'` - Cohere (Command R+, embeddings)
 * - `'mistral'` - Mistral AI (Mistral Large, Codestral)
 * - `'deepseek'` - DeepSeek (DeepSeek-V3, DeepSeek-R1)
 * - `'together'` - Together AI (various open models)
 * - `'openrouter'` - OpenRouter (unified API for many providers)
 * - `'ollama'` - Ollama (local models)
 * - `'huggingface'` - Hugging Face Inference API
 * - `'reka'` - Reka AI
 * - `'grok'` - xAI Grok
 * - `'webllm'` - WebLLM (browser-based inference)
 *
 * @param options - Provider-specific configuration. Must include `name` to identify the provider.
 * @param options.name - The provider identifier (see list above)
 * @param options.apiKey - API key for the provider (not needed for Ollama/WebLLM)
 * @param options.config - Optional default model configuration (maxTokens, temperature, etc.)
 * @param options.models - Optional custom model aliases for type-safe model selection
 *
 * @returns A configured AI service instance ready for chat completions and embeddings
 *
 * @see {@link AxModelConfig} for model configuration options
 * @see {@link AxAIServiceOptions} for runtime options like streaming and function calling
 *
 * @example Basic OpenAI setup
 * ```typescript
 * const ai = ai({
 *   name: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY
 * });
 * ```
 *
 * @example Anthropic with custom defaults
 * ```typescript
 * const ai = ai({
 *   name: 'anthropic',
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   config: {
 *     model: 'claude-sonnet-4-20250514',
 *     maxTokens: 4096,
 *     temperature: 0.7
 *   }
 * });
 * ```
 *
 * @example Google Gemini with model aliases
 * ```typescript
 * const ai = ai({
 *   name: 'google-gemini',
 *   apiKey: process.env.GOOGLE_API_KEY,
 *   models: [
 *     { key: 'fast', model: 'gemini-2.0-flash' },
 *     { key: 'smart', model: 'gemini-1.5-pro' }
 *   ]
 * });
 * // Now use ai with model: 'fast' or model: 'smart'
 * ```
 *
 * @example Local models with Ollama
 * ```typescript
 * const ai = ai({
 *   name: 'ollama',
 *   config: { model: 'llama3.2' }
 * });
 * ```
 */
export function ai<const T extends AxAIArgs<any>>(
  options: T
): AxAI<InferTModelKey<T>> {
  return AxAI.create(options);
}

export class AxAI<TModelKey = string>
  implements AxAIService<any, any, TModelKey>
{
  private ai: AxAIService<any, any, TModelKey>;

  // Static factory method for automatic type inference
  static create<const T extends AxAIArgs<any>>(
    options: T
  ): AxAI<InferTModelKey<T>> {
    return new AxAI(options) as any;
  }

  /**
   * @deprecated Use `AxAI.create()` or `ai()` function instead for better type safety.
   * This constructor will be removed in v15.0.0.
   *
   * Migration timeline:
   * - v13.0.24+: Deprecation warnings (current)
   * - v14.0.0: Runtime console warnings
   * - v15.0.0: Complete removal
   *
   * @example
   * ```typescript
   * // Instead of: new AxAI({ name: 'openai', apiKey: '...' })
   * // Use: AxAI.create({ name: 'openai', apiKey: '...' })
   * // Or: ai({ name: 'openai', apiKey: '...' })
   * ```
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
      case 'openrouter':
        this.ai = new AxAIOpenRouter<TModelKey>(options);
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

  getName(): string {
    return this.ai.getName();
  }

  getId(): string {
    return this.ai.getId();
  }

  getFeatures(model?: string): AxAIFeatures {
    return this.ai.getFeatures(model);
  }

  getModelList() {
    return this.ai.getModelList() as AxAIModelList<TModelKey> | undefined;
  }

  getLastUsedChatModel() {
    return this.ai.getLastUsedChatModel();
  }

  getLastUsedEmbedModel() {
    return this.ai.getLastUsedEmbedModel();
  }

  getLastUsedModelConfig() {
    return this.ai.getLastUsedModelConfig();
  }

  getMetrics(): AxAIServiceMetrics {
    return this.ai.getMetrics();
  }

  async chat(
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    return await this.ai.chat(req, options);
  }

  async embed(
    req: Readonly<AxEmbedRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxEmbedResponse> {
    return await this.ai.embed(req, options);
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.ai.setOptions(options);
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.ai.getOptions();
  }

  getLogger(): AxLoggerFunction {
    return this.ai.getLogger();
  }
}
