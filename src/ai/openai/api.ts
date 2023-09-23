import {
  AIPromptConfig,
  AIServiceOptions,
  AITranscribeConfig,
} from '../../text/types.js';
import { apiCall, apiCallWithUpload } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import {
  EmbedResponse,
  TextModelConfig,
  TextResponse,
  TranscriptResponse,
} from '../types.js';

import { modelInfoOpenAI } from './info.js';
import { generateAudioReq, generateChatReq, generateReq } from './req.js';
import {
  apiURLOpenAI,
  OpenAIApi,
  OpenAIApiConfig,
  OpenAIAudioModel,
  OpenAIAudioRequest,
  OpenAIAudioResponse,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAIEmbedModels,
  OpenAIEmbedRequest,
  OpenAIEmbedResponse,
  OpenAIModel,
  OpenAIOptions,
} from './types.js';

/**
 * OpenAI: Default Model options for text generation
 * @export
 */
export const OpenAIDefaultOptions = (): OpenAIOptions => ({
  model: OpenAIModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  audioModel: OpenAIAudioModel.Whisper1,
  suffix: null,
  maxTokens: 2500,
  temperature: 0.1,
  topP: 0.9,
  frequencyPenalty: 0.5,
  logitBias: new Map([
    ['90', 70],
    ['1298', 70],
  ]),
});

/**
 * OpenAI: Default model options to use the more advanced model
 * @export
 */
export const OpenAIBestModelOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIModel.GPT4,
});

/**
 * OpenAI: Default model options for more creative text generation
 * @export
 */
export const OpenAICreativeOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.9,
  logitBias: undefined,
});

/**
 * OpenAI: Default model options for more fast text generation
 * @export
 */
export const OpenAIFastOptions = (): OpenAIOptions => ({
  ...OpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.45,
});

/**
 * OpenAI: AI Service
 * @export
 */
export class OpenAI extends BaseAI {
  private apiKey: string;
  private orgId?: string;
  private options: OpenAIOptions;

  constructor(
    apiKey: string,
    options: Readonly<OpenAIOptions> = OpenAIDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'OpenAI',
      modelInfoOpenAI,
      { model: options.model, embedModel: options.embedModel },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('OpenAI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  override getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      n: options.n,
      stream: options.stream,
      logprobs: options.logprobs,
      echo: options.echo,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      bestOf: options.bestOf,
      logitBias: options.logitBias,
    } as TextModelConfig;
  }

  override async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    return [
      OpenAIModel.GPT35Turbo,
      OpenAIModel.GPT35Turbo16K,
      OpenAIModel.GPT4,
    ].includes(this.options.model as OpenAIModel)
      ? await this._generateChat(prompt, options)
      : await this._generateDefault(prompt, options);
  }

  private async _generateDefault(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      OpenAICompletionRequest,
      OpenAICompletionResponse,
      OpenAIApiConfig
    >(
      this.createAPI(OpenAIApi.Completion),
      generateReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { id, choices: c, usage: u } = res;
    return {
      remoteId: id.toString(),
      results: c.map((v) => ({
        id: v.index.toString(),
        text: v.text,
        finishReason: v.finish_reason,
      })),
      modelUsage: u
        ? {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          }
        : undefined,
    };
  }

  private async _generateChat(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      OpenAIChatRequest,
      OpenAIChatResponse,
      OpenAIApiConfig
    >(
      this.createAPI(OpenAIApi.Chat),
      generateChatReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { id, choices: c, usage: u } = res;
    return {
      remoteId: id.toString(),
      results: c.map((v) => ({
        id: v.index.toString(),
        text: v.message.content,
        finishReason: v.finish_reason,
      })),
      modelUsage: u
        ? {
            promptTokens: u.prompt_tokens,
            completionTokens: u.completion_tokens,
            totalTokens: u.total_tokens,
          }
        : undefined,
    };
  }

  async _embed(
    textToEmbed: readonly string[] | string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      OpenAIEmbedRequest,
      OpenAIEmbedResponse,
      OpenAIApiConfig
    >(this.createAPI(OpenAIApi.Embed), embedReq);

    const { data, usage: u } = res;
    return {
      texts,
      embedding: data.at(0)?.embedding || [],
      modelUsage: {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      },
    };
  }

  async _transcribe(
    file: string,
    prompt?: string,
    options?: Readonly<AITranscribeConfig>
  ): Promise<TranscriptResponse> {
    const res = await apiCallWithUpload<
      OpenAIApiConfig,
      OpenAIAudioRequest,
      OpenAIAudioResponse
    >(
      this.createAPI(OpenAIApi.Transcribe),
      generateAudioReq(this.options, prompt, options?.language),
      file
    );

    const { duration, segments } = res;
    return {
      duration,
      segments: segments.map((v) => ({
        id: v.id,
        start: v.start,
        end: v.end,
        text: v.text,
      })),
    };
  }

  private createAPI(name: Readonly<string>): OpenAIApiConfig {
    return {
      url: apiURLOpenAI,
      key: this.apiKey,
      name,
      headers: {
        ...(this.orgId ? { 'OpenAI-Organization': this.orgId } : null),
      },
    };
  }
}
