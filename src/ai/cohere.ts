import {
  AIPromptConfig,
  EmbedResponse,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../text/types.js';

import { BaseAI } from './base.js';
import { API, apiCall } from './util.js';

type CohereAPI = API;

const apiURL = 'https://api.cohere.ai/v1/';

const enum apiTypes {
  Generate = 'generate',
  Embed = 'embed',
}

/**
 * Cohere: Models for text generation
 * @export
 */
export enum CohereGenerateModel {
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
    id: CohereGenerateModel.Command,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: CohereGenerateModel.CommandXLarge,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: CohereGenerateModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: CohereEmbedModel.EmbedEnglishLightV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: CohereEmbedModel.EmbedEnglishV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
    oneTPM: 1,
  },
  {
    id: CohereEmbedModel.EmbedMultiLingualV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
    oneTPM: 1,
  },
];

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereOptions = {
  model: CohereGenerateModel;
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
  model: CohereGenerateModel.CommandNightly,
  embedModel: CohereEmbedModel.EmbedEnglishLightV20,
  maxTokens: 2000,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  frequencyPenalty: 0.2,
});

/**
 * Cohere: Default model options for more creative text generation
 * @export
 */
export const CohereCreativeOptions = (): CohereOptions => ({
  ...CohereDefaultOptions(),
  temperature: 0.7,
});

type CohereGenerateRequest = {
  prompt: string;
  model: CohereGenerateModel | string;
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

type CohereAIGenerateTextResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

type CohereEmbedRequest = {
  texts: readonly string[];
  model: CohereGenerateModel | string;
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
): CohereGenerateRequest => ({
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
    options: Readonly<CohereOptions> = CohereDefaultOptions()
  ) {
    super('Cohere', modelInfo, {
      model: options.model,
      embedModel: options.embedModel,
    });

    if (apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): GenerateTextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      logitBias: options.logitBias,
    } as GenerateTextModelConfig;
  }

  async generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      CohereAPI,
      CohereGenerateRequest,
      CohereAIGenerateTextResponse
    >(
      {
        key: this.apiKey,
        name: apiTypes.Generate,
        url: apiURL,
      },
      generateReq(prompt, this.options, md?.stopSequences)
    );

    const { id, generations } = res;

    return {
      sessionID,
      remoteID: id,
      results: generations.map(({ id, text }) => ({ id, text })),
    };
  }

  async embed(
    textToEmbed: readonly string[] | string,
    sessionID?: string
  ): Promise<EmbedResponse> {
    const texts = typeof textToEmbed === 'string' ? [textToEmbed] : textToEmbed;

    if (texts.length > 96) {
      throw { message: 'Cohere limits embeddings input to 96 strings' };
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw { message: 'Cohere limits embeddings input to 512 characters' };
    }

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
      sessionID,
      remoteID: id,
      texts,
      embedding: embeddings.at(0) || [],
    };
  }
}
