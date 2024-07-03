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
import { AxAITogether, type AxAITogetherArgs } from './together/api.js';
import type {
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo
} from './types.js';

export type AxAIModelMap<T> = Record<string, T>;

export interface AxAIOptions<TM = string, TEM = string> {
  modelMap?: AxAIModelMap<TM>;
  embedModelMap?: AxAIModelMap<TEM>;
}

export type AxAIArgs =
  | (AxAIOpenAIArgs & AxAIOptions<AxAIOpenAIModel, AxAIOpenAIEmbedModel>)
  | (AxAIAzureOpenAIArgs & AxAIOptions<AxAIOpenAIModel, AxAIOpenAIEmbedModel>)
  | (AxAITogetherArgs & AxAIOptions<string, string>)
  | (AxAIAnthropicArgs & AxAIOptions<AxAIAnthropicModel, AxAIAnthropicModel>)
  | (AxAIGroqArgs & AxAIOptions<AxAIGroqModel, AxAIGroqModel>)
  | (AxAIGoogleGeminiArgs &
      AxAIOptions<AxAIGoogleGeminiModel, AxAIGoogleGeminiEmbedModel>)
  | (AxAICohereArgs & AxAIOptions<AxAICohereModel, AxAICohereEmbedModel>)
  | (AxAIHuggingFaceArgs &
      AxAIOptions<AxAIHuggingFaceModel, AxAIHuggingFaceModel>)
  | (AxAIMistralArgs & AxAIOptions<AxAIMistralModel, AxAIMistralModel>)
  | (AxAIDeepSeekArgs & AxAIOptions<AxAIDeepSeekModel, AxAIDeepSeekModel>)
  | (AxAIOllamaArgs & AxAIOptions<string, string>);

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
  private options: AxAIOptions;

  constructor(options: Readonly<AxAIArgs>) {
    const { modelMap, embedModelMap, ...args } = options;
    this.options = { modelMap, embedModelMap };

    switch (args.name) {
      case 'openai':
        this.ai = new AxAIOpenAI(args);
        break;
      case 'azure-openai':
        this.ai = new AxAIAzureOpenAI(args);
        break;
      case 'huggingface':
        this.ai = new AxAIHuggingFace(args);
        break;
      case 'groq':
        this.ai = new AxAIGroq(args);
        break;
      case 'together':
        this.ai = new AxAITogether(args);
        break;
      case 'cohere':
        this.ai = new AxAICohere(args);
        break;
      case 'google-gemini':
        this.ai = new AxAIGoogleGemini(args);
        break;
      case 'anthropic':
        this.ai = new AxAIAnthropic(args);
        break;
      case 'mistral':
        this.ai = new AxAIMistral(args);
        break;
      case 'deepseek':
        this.ai = new AxAIDeepSeek(args);
        break;
      case 'ollama':
        this.ai = new AxAIOllama(args);
        break;
      default:
        throw new Error(`Unknown AI`);
    }
  }
  getName(): string {
    return this.ai.getName();
  }

  getModelInfo(): Readonly<AxModelInfo & { provider: string }> {
    return this.ai.getModelInfo();
  }

  getEmbedModelInfo(): Readonly<AxModelInfo> | undefined {
    return this.ai.getEmbedModelInfo();
  }

  getModelConfig(): Readonly<AxModelConfig> {
    return this.ai.getModelConfig();
  }

  getFeatures(): { functions: boolean; streaming: boolean } {
    return this.ai.getFeatures();
  }

  async chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (this.options?.modelMap && req.model) {
      const model = this.options.modelMap[req.model];
      if (!model || model.length === 0) {
        throw new Error(`Model not found in model map: ${req.model}`);
      }
      return await this.ai.chat({ ...req, model }, options);
    }
    return await this.ai.chat(req, options);
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions & AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    if (this.options?.embedModelMap && req.embedModel) {
      const embedModel = this.options.embedModelMap[req.embedModel];
      if (!embedModel || embedModel.length === 0) {
        throw new Error(
          `Model not found in embed model map: ${req.embedModel}`
        );
      }
      return await this.ai.embed({ ...req, embedModel }, options);
    }
    return await this.ai.embed(req, options);
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.ai.setOptions(options);
  }
}
