import { AIPromptConfig, AIServiceOptions } from '../text/types';
import { API, apiCall } from '../util/apicall';

import { BaseAI } from './base';
import {
  EmbedResponse,
  TextModelConfig,
  TextModelInfo,
  TextResponse,
} from './types';

type CohereAPI = API;

const apiURL = 'https://api.cohere.ai/v1/';

const enum apiTypes {
  Completion = 'generate',
  Embed = 'embed',
}

/**
 * Cohere: Models for text generation
 * @export
 */
export enum CohereModel {
  Command = 'command',
  CommandNightly = 'command-nightly',
  CommandXLarge = 'command-xlarge',
  CommandLight = 'command-light',
}

/**
 * Cohere: Models for use in embeddings
 * @export
 */
export enum CohereEmbedModel {
  EmbedEnglishLightV20 = 'embed-english-light-v2.0',
  EmbedEnglishV20 = 'embed-english-v2.0',
  EmbedMultiLingualV20 = 'embed-multilingual-v2.0',
}

/**
 * Cohere: Specify how and if the token likelihoods are returned with the response.
 * @export
 */
export enum CohereReturnLikelihoods {
  GENERATION = 'GENERATION',
  ALL = 'ALL',
  NONE = 'NONE',
}

const modelInfo: TextModelInfo[] = [
  {
    name: CohereModel.Command,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereModel.CommandXLarge,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedEnglishLightV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedEnglishV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedMultiLingualV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
];

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereOptions = {
  model: CohereModel;
  embedModel: CohereEmbedModel;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  returnLikelihoods?: CohereReturnLikelihoods;
  logitBias?: Map<string, number>;
};

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

type CohereRequest = {
  prompt: string;
  model: CohereModel | string;
  max_tokens: number;
  temperature: number;
  k: number;
  p: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  end_sequences?: readonly string[];
  stop_sequences?: string[];
  return_likelihoods?: CohereReturnLikelihoods;
  logit_bias?: Map<string, number>;
};

type CohereAITextResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

type CohereEmbedRequest = {
  texts: readonly string[];
  model: CohereModel | string;
  truncate: string;
};

type CohereEmbedResponse = {
  id: string;
  texts: string[];
  model: string;
  embeddings: number[][];
};

const generateReq = (
  prompt: string,
  opt: Readonly<CohereOptions>,
  stopSequences?: readonly string[]
): CohereRequest => ({
  prompt,
  model: opt.model,
  max_tokens: opt.maxTokens,
  temperature: opt.temperature,
  k: opt.topK,
  p: opt.topP,
  frequency_penalty: opt.frequencyPenalty,
  presence_penalty: opt.presencePenalty,
  end_sequences: stopSequences,
  stop_sequences: opt.stopSequences,
  return_likelihoods: opt.returnLikelihoods,
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
      modelInfo,
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
    const res = await apiCall<CohereAPI, CohereRequest, CohereAITextResponse>(
      {
        key: this.apiKey,
        name: apiTypes.Completion,
        url: apiURL,
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
      CohereAPI,
      CohereEmbedRequest,
      CohereEmbedResponse
    >(
      {
        key: this.apiKey,
        name: apiTypes.Embed,
        url: apiURL,
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
