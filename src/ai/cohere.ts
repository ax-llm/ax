import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  TextModelInfo,
} from '../text/types.js';

import { API, apiCall } from './util.js';

type CohereAPI = API & {
  headers: { 'Cohere-Version': string };
};

const apiURL = 'https://api.cohere.ai/';

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
};

/**
 * Cohere: Default Model options for text generation
 * @export
 */
export const CohereDefaultOptions = (): CohereOptions => ({
  model: CohereGenerateModel.Command,
  embedModel: CohereEmbedModel.EmbedEnglishLightV20,
  maxTokens: 500,
  temperature: 0,
  topK: 0,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
});

/**
 * Cohere: Default model options for more creative text generation
 * @export
 */
export const CohereCreativeOptions = (): CohereOptions => ({
  ...CohereDefaultOptions(),
  temperature: 0.9,
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
  embeddings: number[];
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
export class Cohere implements AIService {
  private apiKey: string;
  private options: CohereOptions;

  constructor(
    apiKey: string,
    options: Readonly<CohereOptions> = CohereDefaultOptions()
  ) {
    if (apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  name(): string {
    return 'Cohere';
  }

  generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `Cohere model information not found: ${this.options.model}`
      );
    }

    prompt = prompt.trim();
    const res = apiCall<
      CohereAPI,
      CohereGenerateRequest,
      CohereAIGenerateTextResponse
    >(
      {
        key: this.apiKey,
        name: apiTypes.Generate,
        url: apiURL,
        headers: { 'Cohere-Version': '2022-12-06' },
      },
      generateReq(prompt, this.options, md?.stopSequences)
    );

    return res.then(({ id, generations: gens }) => ({
      id,
      sessionID,
      query: prompt,
      values: gens,
      usage: [{ model }],
      value() {
        return (this as { values: { text: string }[] }).values[0].text;
      },
    }));
  }

  embed(texts: readonly string[], sessionID?: string): Promise<EmbedResponse> {
    if (texts.length > 96) {
      throw new Error('Cohere limits embeddings input to 96 strings');
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw new Error('Cohere limits embeddings input to 512 characters');
    }

    const model = modelInfo.find((v) => v.id === this.options.embedModel);
    if (!model) {
      throw new Error(
        `Cohere model information not found: ${this.options.embedModel}`
      );
    }

    const res = apiCall<CohereAPI, CohereEmbedRequest, CohereEmbedResponse>(
      {
        key: this.apiKey,
        name: apiTypes.Embed,
        url: apiURL,
        headers: { 'Cohere-Version': '2022-12-06' },
      },
      { texts, model: this.options.embedModel, truncate: 'NONE' }
    );

    return res.then(({ id, embeddings }) => ({
      id,
      sessionID,
      texts,
      usage: {
        model,
      },
      embeddings,
    }));
  }
}
