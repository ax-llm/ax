// ReadableStream is available globally in modern browsers and Node.js 16+

import { AxAIAnthropic, type AxAIAnthropicArgs } from './anthropic/api.js';
import type { AxAIAnthropicModel } from './anthropic/types.js';
import type { AxAIFeatures } from './base.js';
import type { AxAICohereEmbedModel, AxAICohereModel } from './cohere/types.js';
import type { AxAIDeepSeekModel } from './deepseek/types.js';
import {
  AxAIGoogleGemini,
  type AxAIGoogleGeminiArgs,
} from './google-gemini/api.js';
import type {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import type { AxAIMistralModel } from './mistral/types.js';
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
import {
  type AxAIDeploymentProfileArgs,
  AxAIOpenAIProfile,
  AxAIOpenAIResponsesProfile,
  axGetAIProfile,
} from './provider_profiles.js';
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
  AxModelUsage,
  AxSpeechRequest,
  AxSpeechResponse,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
} from './types.js';
// axir-nonportable:start webllm
import { AxAIWebLLM, type AxAIWebLLMArgs } from './webllm/api.js';
import type { AxAIWebLLMModelId } from './webllm/types.js';
// axir-nonportable:end webllm
import type { AxAIGrokModel } from './x-grok/types.js';

export type AxAIArgs<TModelKey> =
  | AxAIOpenAIArgs<'openai', AxAIOpenAIModel, AxAIOpenAIEmbedModel, TModelKey>
  | AxAIOpenAIResponsesArgs<
      'openai-responses',
      AxAIOpenAIResponsesModel,
      AxAIOpenAIEmbedModel,
      TModelKey
    >
  | AxAIAnthropicArgs<TModelKey>
  | AxAIGoogleGeminiArgs<TModelKey>
  | AxAIDeploymentProfileArgs<TModelKey>
  // axir-nonportable:start webllm
  | AxAIWebLLMArgs<TModelKey>;
// axir-nonportable:end webllm

export type AxAIModels =
  | AxAIOpenAIModel
  | AxAIAnthropicModel
  | AxAIGoogleGeminiModel
  | AxAICohereModel
  | AxAIMistralModel
  | AxAIDeepSeekModel
  // axir-nonportable:start webllm
  | AxAIWebLLMModelId
  // axir-nonportable:end webllm
  | AxAIGrokModel;

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
 * - `'cohere'` - Cohere (Command R+, embeddings)
 * - `'mistral'` - Mistral AI (Mistral Large, Codestral)
 * - `'deepseek'` - DeepSeek (DeepSeek-V4-Flash, DeepSeek-V4-Pro)
 * - `'deepseek-responses'` - DeepSeek's stateless Responses API
 * - `'reka'` - Reka AI
 * - `'grok'` - xAI Grok
 * // axir-nonportable:start webllm
 * - `'webllm'` - WebLLM browser runtime with a caller-supplied MLCEngine
 * // axir-nonportable:end webllm
 *
 * @param options - Provider-specific configuration. Must include `name` to identify the provider.
 * @param options.name - The provider identifier (see list above)
 * @param options.apiKey - API key for the provider
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
 * @example OpenAI-compatible endpoint
 * ```typescript
 * const ai = ai({
 *   name: 'openai',
 *   apiKey: process.env.PROVIDER_API_KEY,
 *   apiURL: 'https://example.com/v1',
 *   config: { model: 'provider/model-name' }
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

  private constructor(options: Readonly<AxAIArgs<TModelKey>>) {
    const profile = axGetAIProfile(options.name);
    switch (profile.transport) {
      case 'openai-chat':
        if (profile.id === 'openai') {
          this.ai = new AxAIOpenAI<TModelKey>(options as any);
        } else {
          this.ai = new AxAIOpenAIProfile<TModelKey>(options as any);
        }
        break;
      case 'openai-responses':
        if (profile.id === 'openai-responses') {
          this.ai = new AxAIOpenAIResponses<TModelKey>(options as any);
        } else {
          this.ai = new AxAIOpenAIResponsesProfile<TModelKey>(options as any);
        }
        break;
      case 'anthropic-messages':
        this.ai = new AxAIAnthropic<TModelKey>(options as any);
        break;
      case 'gemini-generate-content':
        this.ai = new AxAIGoogleGemini<TModelKey>(options as any);
        break;
      // axir-nonportable:start webllm
      case 'webllm':
        this.ai = new AxAIWebLLM<TModelKey>(options as any);
        break;
      // axir-nonportable:end webllm
      default:
        throw new Error(`Unsupported AI transport: ${profile.transport}`);
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

  getEstimatedCost(modelUsage?: AxModelUsage): number {
    return this.ai.getEstimatedCost(modelUsage);
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

  async transcribe(
    req: Readonly<AxTranscriptionRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    return await this.ai.transcribe(req, options);
  }

  async speak(
    req: Readonly<AxSpeechRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    return await this.ai.speak(req, options);
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
