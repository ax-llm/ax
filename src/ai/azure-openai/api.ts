import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { API, apiCall } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { modelInfoOpenAI } from '../openai/info.js';
import {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAICompletionRequest,
  OpenAICompletionResponse,
  OpenAIEmbedModels,
  OpenAIEmbedRequest,
  OpenAIEmbedResponse,
  OpenAIModel,
  OpenAIOptions,
} from '../openai/types.js';
import { generateChatReq, generateReq } from '../openai/util.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

/**
 * AzureOpenAI: API call details
 * @export
 */
export type AzureOpenAIApiConfig = API & {
  headers: { 'api-key'?: string };
};

export const enum AzureOpenAIApi {
  Completion = '/completions',
  Chat = '/chat/completions',
  Embed = '/embeddings',
  Transcribe = '/audio/transcriptions',
}

/**
 * AzureOpenAI: Default Model options for text generation
 * @export
 */
export const AzureOpenAIDefaultOptions = (): OpenAIOptions => ({
  model: OpenAIModel.GPT35Turbo,
  embedModel: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
});

/**
 * AzureOpenAI: Default model options for more creative text generation
 * @export
 */
export const AzureOpenAICreativeOptions = (): OpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.9,
});

/**
 * AzureOpenAI: Default model options for more fast text generation
 * @export
 */
export const AzureOpenAIFastOptions = (): OpenAIOptions => ({
  ...AzureOpenAIDefaultOptions(),
  model: OpenAIModel.GPT35Turbo,
  temperature: 0.45,
});

/**
 * AzureOpenAI: AI Service
 * @export
 */
export class AzureOpenAI extends BaseAI {
  private apiKey: string;
  private apiURL: string;
  private options: OpenAIOptions;

  constructor(
    apiKey: string,
    host: string,
    deploymentName: string,
    options: Readonly<OpenAIOptions> = AzureOpenAIDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Azure OpenAI',
      modelInfoOpenAI,
      {
        model: options.model,
        embedModel: options.embedModel,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Azure OpenAPI API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;

    if (!host.includes('://')) {
      host = `https://${host}.openai.azure.com/`;
    }
    this.apiURL = new URL(`/openai/deployments/${deploymentName}`, host).href;
  }

  getModelConfig(): TextModelConfig {
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

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    if (
      [OpenAIModel.GPT35Turbo, OpenAIModel.GPT4].includes(
        this.options.model as OpenAIModel
      )
    ) {
      return await this._generateChat(prompt, options);
    }
    return await this._generateDefault(prompt, options);
  }

  private async _generateDefault(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      AzureOpenAIApiConfig,
      OpenAICompletionRequest,
      OpenAICompletionResponse
    >(
      this.createAPI(AzureOpenAIApi.Completion),
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
      AzureOpenAIApiConfig,
      OpenAIChatRequest,
      OpenAIChatResponse
    >(
      this.createAPI(AzureOpenAIApi.Chat),
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
    textToEmbed: Readonly<string[] | string>
  ): Promise<EmbedResponse> {
    const texts: readonly string[] =
      typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { input: texts, model: this.options.embedModel };
    const res = await apiCall<
      AzureOpenAIApiConfig,
      OpenAIEmbedRequest,
      OpenAIEmbedResponse
    >(this.createAPI(AzureOpenAIApi.Embed), embedReq);

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

  private createAPI(name: AzureOpenAIApi): AzureOpenAIApiConfig {
    return {
      url: this.apiURL,
      name,
      headers: {
        'api-key': this.apiKey,
      },
    };
  }
}
