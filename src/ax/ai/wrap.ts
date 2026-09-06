import { AxOpenAIChatSession } from './openai/chat_session.js';
import { axIsGPT6Astra } from './openai/model_family.js';
import { axAIOpenAIResponsesDefaultConfig } from './openai/responses_api_base.js';
import { AxAIOpenAIResponsesClient } from './openai/responses_client.js';
import type { AxChatSession } from './session.js';
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
import type {
  AxAIOpenAIResponsesConfig,
  AxAIOpenAIResponsesModel,
} from './openai/responses_types.js';
import {
  type AxAIDeploymentProfileArgs,
  AxAIOpenAIProfile,
  AxAIOpenAIResponsesProfile,
  axGetAIProfile,
} from './provider_profiles.js';
import type {
  AxAIInputModelList,
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
  private responsesClient?: AxAIOpenAIResponsesClient;
  private responsesAI?: AxAIService<any, any, TModelKey>;
  private sessionConfig?: AxAIOpenAIResponsesConfig<string, string>;
  private sessionModels?: AxAIInputModelList<string, string, TModelKey>;
  private defaultModel?: string;
  private lastSessionModel?: string;

  // Static factory method for automatic type inference
  static create<const T extends AxAIArgs<any>>(
    options: T
  ): AxAI<InferTModelKey<T>> {
    return new AxAI(options) as any;
  }

  private constructor(options: Readonly<AxAIArgs<TModelKey>>) {
    const profile = axGetAIProfile(options.name);
    this.defaultModel = options.config?.model as string | undefined;
    if (profile.id === 'openai-responses' || profile.id === 'openai') {
      this.sessionConfig = options.config as AxAIOpenAIResponsesConfig<
        string,
        string
      >;
      this.sessionModels = options.models as AxAIInputModelList<
        string,
        string,
        TModelKey
      >;
      const config = options.config as
        | {
            model?: string;
            maxTokens?: number;
            reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
            systemPrompt?: string;
            serviceTier?: string;
          }
        | undefined;
      this.responsesClient = new AxAIOpenAIResponsesClient({
        apiKey: 'apiKey' in options ? options.apiKey : undefined,
        credentialProvider:
          'credentialProvider' in options
            ? options.credentialProvider
            : undefined,
        apiURL:
          'apiURL' in options ? (options.apiURL as string) : profile.baseURL,
        defaults: {
          model: config?.model ?? axAIOpenAIResponsesDefaultConfig().model,
          max_output_tokens: config?.maxTokens,
          instructions: config?.systemPrompt,
          service_tier:
            config?.serviceTier === 'standard'
              ? 'default'
              : config?.serviceTier,
          ...(config?.reasoningEffort
            ? { reasoning: { effort: config.reasoningEffort } }
            : {}),
        },
        options: () => this.ai.getOptions(),
        estimateCost: (usage) => this.ai.getEstimatedCost(usage),
      });
    }
    if (profile.id === 'openai') {
      this.responsesAI = new AxAIOpenAIResponses<TModelKey>({
        ...options,
        name: 'openai-responses',
      } as any);
    }
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
    const resolved = this.resolveModel(model);
    const features =
      (axIsGPT6Astra(resolved) ? this.responsesAI : undefined)?.getFeatures(
        resolved
      ) ?? this.ai.getFeatures(resolved);
    return this.responsesClient && axIsGPT6Astra(resolved)
      ? {
          ...features,
          functions: true,
          asyncTools: true,
          reasoningUpdates: true,
          nativeSteering: !!this.getOptions().webSocket,
        }
      : features;
  }

  getModelList() {
    return this.ai.getModelList() as AxAIModelList<TModelKey> | undefined;
  }

  getLastUsedChatModel() {
    return (
      this.lastSessionModel ??
      this.responsesAI?.getLastUsedChatModel() ??
      this.ai.getLastUsedChatModel()
    );
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
    return modelUsage
      ? this.ai.getEstimatedCost(modelUsage)
      : this.ai.getEstimatedCost() +
          (this.responsesAI?.getEstimatedCost() ?? 0) +
          (this.responsesClient?.getEstimatedCost() ?? 0);
  }

  async chat(
    req: Readonly<AxChatRequest<TModelKey>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const resolved = this.resolveModel(req.model);
    const service = axIsGPT6Astra(resolved)
      ? (this.responsesAI ?? this.ai)
      : this.ai;
    return await service.chat(req, options);
  }

  private resolveModel(model?: unknown): string | undefined {
    const name = model === undefined ? this.defaultModel : String(model);
    const entry = this.getModelList()?.find(
      (entry) => String(entry.key) === name
    );
    return entry && 'model' in entry ? entry.model : name;
  }

  async openChatSession(
    req: Readonly<AxChatRequest<TModelKey>>,
    options: Readonly<AxAIServiceOptions> = {}
  ): Promise<AxChatSession> {
    const model = this.resolveModel(req.model);
    if (!this.responsesClient || !axIsGPT6Astra(model))
      throw new Error(
        'The selected provider/model does not support chat sessions'
      );
    const alias = this.sessionModels?.find((entry) => entry.key === req.model);
    const defined = <T extends object>(value: T | undefined) =>
      Object.fromEntries(
        Object.entries(value ?? {}).filter(([, item]) => item !== undefined)
      );
    const aliasOptions = alias
      ? {
          thinkingTokenBudget: alias.thinkingTokenBudget,
          showThoughts: alias.showThoughts,
          serviceTier: alias.serviceTier,
          debug: alias.debug,
          beta: alias.beta,
        }
      : undefined;
    this.lastSessionModel = model;
    return await new AxOpenAIChatSession(
      this.responsesClient,
      {
        ...req,
        model,
        modelConfig: { ...alias?.modelConfig, ...defined(req.modelConfig) },
      },
      { ...this.getOptions(), ...defined(aliasOptions), ...defined(options) },
      this.sessionConfig
    ).start();
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
    this.responsesAI?.setOptions(options);
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return this.ai.getOptions();
  }

  getLogger(): AxLoggerFunction {
    return this.ai.getLogger();
  }
}
