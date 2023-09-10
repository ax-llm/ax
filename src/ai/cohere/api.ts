import { AIPromptConfig, AIServiceOptions } from '../../text/types';
import { apiCall } from '../../util/apicall';
import { BaseAI } from '../base';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types';

import { modelInfoCohere } from './info';
import { generateReq } from './req';
import {
  apiURLCohere,
  CohereApi,
  CohereApiConfig,
  CohereCompletionRequest,
  CohereCompletionResponse,
  CohereEmbedModel,
  CohereEmbedRequest,
  CohereEmbedResponse,
  CohereModel,
  CohereOptions,
} from './types';

/**
 * Cohere: Default Model options for text generation
 * @export
 */
export const CohereDefaultOptions = (): CohereOptions => ({
  model: CohereModel.CommandNightly,
  embedModel: CohereEmbedModel.EmbedEnglishLightV20,
  maxTokens: 2000,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  frequencyPenalty: 0.8,
  logitBias: new Map([
    ['98', 9],
    ['5449', 9],
  ]),
});

/**
 * Cohere: Default model options for more creative text generation
 * @export
 */
export const CohereCreativeOptions = (): CohereOptions => ({
  ...CohereDefaultOptions(),
  temperature: 0.7,
  logitBias: undefined,
});

/**
 * Cohere: AI Service
 * @export
 */
export class Cohere extends BaseAI {
  private apiKey: string;
  private options: CohereOptions;

  constructor(
    apiKey: string,
    options: Readonly<CohereOptions> = CohereDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Cohere',
      modelInfoCohere,
      {
        model: options.model,
        embedModel: options.embedModel,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      logitBias: options.logitBias,
    } as TextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      CohereApiConfig,
      CohereCompletionRequest,
      CohereCompletionResponse
    >(
      {
        key: this.apiKey,
        name: CohereApi.Completion,
        url: apiURLCohere,
      },
      generateReq(prompt, this.options, options?.stopSequences)
    );

    const { id, generations } = res;

    return {
      remoteId: id,
      results: generations.map(({ id, text }) => ({ id, text })),
    };
  }

  async _embed(
    textToEmbed: readonly string[] | string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    const res = await apiCall<
      CohereApiConfig,
      CohereEmbedRequest,
      CohereEmbedResponse
    >(
      {
        key: this.apiKey,
        name: CohereApi.Embed,
        url: apiURLCohere,
      },
      { texts, model: this.options.embedModel, truncate: 'NONE' }
    );

    const { id, embeddings } = res;
    return {
      remoteId: id,
      texts,
      embedding: embeddings.at(0) || [],
    };
  }
}
