import type { ReadableStream } from 'stream/web';

import { AxAIAnthropic, type AxAIAnthropicArgs } from './anthropic/api.js';
import type { AxAIAnthropicModel } from './anthropic/types.js';
import {
  AxAIAzureOpenAI,
  type AxAIAzureOpenAIArgs
} from './azure-openai/api.js';
import { AxAICohere, type AxAICohereArgs } from './cohere/api.js';
import type { AxAICohereEmbedModel, AxAICohereModel } from './cohere/types.js';
import { AxAIDeepSeek, type AxAIDeepSeekArgs } from './deepseek/api.js';
import type { AxAIDeepSeekModel } from './deepseek/types.js';
import {
  AxAIGoogleGemini,
  type AxAIGoogleGeminiArgs
} from './google-gemini/api.js';
import type {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel
} from './google-gemini/types.js';
import { AxAIGroq, type AxAIGroqArgs } from './groq/api.js';
import type { AxAIGroqModel } from './groq/types.js';
import {
  AxAIHuggingFace,
  type AxAIHuggingFaceArgs
} from './huggingface/api.js';
import type { AxAIHuggingFaceModel } from './huggingface/types.js';
import { AxAIMistral, type AxAIMistralArgs } from './mistral/api.js';
import type { AxAIMistralModel } from './mistral/types.js';
import { AxAIOllama, type AxAIOllamaArgs } from './ollama/api.js';
import {
  AxAIOpenAI,
  type AxAIOpenAIArgs as AxAIOpenAIArgs
} from './openai/api.js';
import type { AxAIOpenAIEmbedModel, AxAIOpenAIModel } from './openai/types.js';
import { AxAIReka, type AxAIRekaArgs } from './reka/api.js';
import { AxAITogether, type AxAITogetherArgs } from './together/api.js';
import type {
  AxAIModelMap,
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfoWithProvider
} from './types.js';

export type AxAIArgs =
  | AxAIOpenAIArgs
  | AxAIAzureOpenAIArgs
  | AxAITogetherArgs
  | AxAIAnthropicArgs
  | AxAIGroqArgs
  | AxAIGoogleGeminiArgs
  | AxAICohereArgs
  | AxAIHuggingFaceArgs
  | AxAIMistralArgs
  | AxAIDeepSeekArgs
  | AxAIOllamaArgs
  | AxAIRekaArgs;

export type AxAIModels =
  | AxAIOpenAIModel
  | AxAIAnthropicModel
  | AxAIGroqModel
  | AxAIGoogleGeminiModel
  | AxAICohereModel
  | AxAIHuggingFaceModel
  | AxAIMistralModel
  | AxAIDeepSeekModel
  | string;

export type AxAIEmbedModels =
  | AxAIOpenAIEmbedModel
  | AxAIGoogleGeminiEmbedModel
  | AxAICohereEmbedModel
  | string;

export class AxAI implements AxAIService {
  private ai: AxAIService;

  constructor(options: Readonly<AxAIArgs>) {
    switch (options.name) {
      case 'openai':
        this.ai = new AxAIOpenAI(options);
        break;
      case 'azure-openai':
        this.ai = new AxAIAzureOpenAI(options);
        break;
      case 'huggingface':
        this.ai = new AxAIHuggingFace(options);
        break;
      case 'groq':
        this.ai = new AxAIGroq(options);
        break;
      case 'together':
        this.ai = new AxAITogether(options);
        break;
      case 'cohere':
        this.ai = new AxAICohere(options);
        break;
      case 'google-gemini':
        this.ai = new AxAIGoogleGemini(options);
        break;
      case 'anthropic':
        this.ai = new AxAIAnthropic(options);
        break;
      case 'mistral':
        this.ai = new AxAIMistral(options);
        break;
      case 'deepseek':
        this.ai = new AxAIDeepSeek(options);
        break;
      case 'ollama':
        this.ai = new AxAIOllama(options);
        break;
      case 'reka':
        this.ai = new AxAIReka(options);
        break;
      default:
        throw new Error(`Unknown AI`);
    }
  }

  getName(): string {
    return this.ai.getName();
  }

  getModelInfo(): Readonly<AxModelInfoWithProvider> {
    return this.ai.getModelInfo();
  }

  getEmbedModelInfo(): Readonly<AxModelInfoWithProvider> | undefined {
    return this.ai.getEmbedModelInfo();
  }

  getModelConfig(): Readonly<AxModelConfig> {
    return this.ai.getModelConfig();
  }

  getFeatures(): { functions: boolean; streaming: boolean } {
    return this.ai.getFeatures();
  }

  getModelMap(): AxAIModelMap | undefined {
    return this.ai.getModelMap();
  }

  async chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    return await this.ai.chat(req, options);
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions & AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    return await this.ai.embed(req, options);
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.ai.setOptions(options);
  }
}
