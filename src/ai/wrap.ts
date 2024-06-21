import type { ReadableStream } from 'stream/web';

import { AxAIAnthropic, type AxAIAnthropicArgs } from './anthropic/api.js';
import {
  AxAIAzureOpenAI,
  type AxAIAzureOpenAIArgs
} from './azure-openai/api.js';
import { AxAICohere, type AxAICohereArgs } from './cohere/api.js';
import { AxAIDeepSeek, type AxAIDeepSeekArgs } from './deepseek/api.js';
import {
  AxAIGoogleGemini,
  type AxAIGoogleGeminiArgs
} from './google-gemini/api.js';
import { AxAIGroq, type AxAIGroqArgs } from './groq/api.js';
import {
  AxAIHuggingFace,
  type AxAIHuggingFaceArgs
} from './huggingface/api.js';
import { AxAIMistral, type AxAIMistralArgs } from './mistral/api.js';
import { AxAIOllama, type AxAIOllamaArgs } from './ollama/api.js';
import {
  AxAIOpenAI,
  type AxAIOpenAIArgs as AxAIOpenAIArgs
} from './openai/api.js';
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
  | AxAIOllamaArgs;

export class AxAI implements AxAIService {
  private ai: AxAIService;

  constructor(args: Readonly<AxAIArgs>) {
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
