import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { API, apiCall } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGoogle } from './info.js';
import { generateChatReq, generateReq } from './req.js';
import {
  apiURLGoogle,
  GoogleChatRequest,
  GoogleChatResponse,
  GoogleCompletionRequest,
  GoogleCompletionResponse,
  GoogleEmbedModels,
  GoogleEmbedRequest,
  GoogleEmbedResponse,
  GoogleModel,
} from './types.js';

/**
 * Google: Model options for text generation
 * @export
 */
export type GoogleOptions = {
  model: GoogleModel;
  embedModel: GoogleEmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
};

/**
 * Google: Default Model options for text generation
 * @export
 */
export const GoogleDefaultOptions = (): GoogleOptions => ({
  model: GoogleModel.PaLMTextBison,
  embedModel: GoogleEmbedModels.PaLMTextEmbeddingGecko,
  maxTokens: 300,
  temperature: 0.45,
  topP: 1,
  topK: 40,
});

/**
 * Google: Default model options for more creative text generation
 * @export
 */
export const GoogleCreativeOptions = (): GoogleOptions => ({
  ...GoogleDefaultOptions(),
  model: GoogleModel.PaLMTextBison,
  temperature: 0.9,
});

/**
 * Google: Default model options for more fast text generation
 * @export
 */
export const GoogleFastOptions = (): GoogleOptions => ({
  ...GoogleDefaultOptions(),
  model: GoogleModel.PaLMTextBison,
  temperature: 0.45,
});

/**
 * Google: AI Service
 * @export
 */
export class Google extends BaseAI {
  private apiKey: string;
  private apiURL: string;
  private options: GoogleOptions;

  constructor(
    apiKey: string,
    projectId: string,
    options: Readonly<GoogleOptions> = GoogleDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Google',
      modelInfoGoogle,
      {
        model: options.model,
        embedModel: options.embedModel,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Google API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;

    this.apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${options.model}:predict`,
      apiURLGoogle
    ).href;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
    } as TextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    if (
      [GoogleModel.PaLMChatBison].includes(this.options.model as GoogleModel)
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
      GoogleCompletionRequest,
      GoogleCompletionResponse
    >(
      this.createAPI(),
      generateReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { predictions } = res;
    const promptTokens = prompt.length;
    const completionTokens = predictions.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any, { content: v }: Readonly<{ content: any }>) => a + v.length,
      0
    );
    const totalTokens = promptTokens + completionTokens;

    return {
      results: predictions.map((p) => ({ id: '', text: p.content })),
      modelUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };
  }

  private async _generateChat(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<GoogleChatRequest, GoogleChatResponse>(
      this.createAPI(),
      generateChatReq(prompt, this.options, options?.stopSequences ?? [])
    );

    const { predictions } = res;
    const promptTokens = prompt.length;
    const completionTokens = predictions
      .map((p) => p.candidates.map((c) => c.content))
      .flat()
      .reduce((a, v) => a + v.length, 0);
    const totalTokens = promptTokens + completionTokens;

    return {
      results: predictions.map((p) => ({
        id: '',
        text: p.candidates[0].content,
      })),
      modelUsage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };
  }

  async _embed(
    textToEmbed: Readonly<string[] | string>
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const embedReq = { instances: [{ content: texts.at(0) ?? '' }] };
    const res = await apiCall<GoogleEmbedRequest, GoogleEmbedResponse>(
      this.createAPI(),
      embedReq
    );

    const { predictions } = res;
    const promptTokens = texts.at(0)?.length ?? 0;

    return {
      texts,
      embedding: predictions.at(0)?.embeddings.values ?? [],
      modelUsage: {
        promptTokens,
        completionTokens: 0,
        totalTokens: promptTokens,
      },
    };
  }

  private createAPI(): API {
    return {
      url: this.apiURL,
      key: this.apiKey,
    };
  }
}
