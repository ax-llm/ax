import {
  AIService,
  AIGenerateTextResponse,
  EmbedResponse,
  PromptConfig,
} from '../text';

import { API, apiCall } from './util';

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
  CommandXLargeNightly = 'command-xlarge-nightly',
  XLarge = 'xlarge',
  Medium = 'medium',
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

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereOptions = {
  model: CohereGenerateModel | string;
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
  model: CohereGenerateModel.CommandXLargeNightly,
  maxTokens: 300,
  temperature: 0.45,
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
  end_sequences?: string[];
  stop_sequences?: string[];
  return_likelihoods?: CohereReturnLikelihoods;
};

type CohereAIGenerateTextResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

type CohereEmbedRequest = {
  texts: string[];
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
  stopSequences?: string[]
): CohereGenerateRequest => ({
  prompt: prompt,
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
    md?: PromptConfig,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
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
      id: id,
      sessionID: sessionID,
      query: prompt,
      values: gens,
      value() {
        return (this as any).values[0].text;
      },
    }));
  }

  embed(texts: string[], sessionID?: string): Promise<EmbedResponse> {
    if (texts.length > 96) {
      throw new Error('Cohere limits embeddings input to 96 strings');
    }

    const overLimit = texts.filter((v) => v.length > 512);
    if (overLimit.length !== 0) {
      throw new Error('Cohere limits embeddings input to 512 characters');
    }

    const res = apiCall<CohereAPI, CohereEmbedRequest, CohereEmbedResponse>(
      {
        key: this.apiKey,
        name: apiTypes.Embed,
        url: apiURL,
        headers: { 'Cohere-Version': '2022-12-06' },
      },
      { texts, model: this.options.model, truncate: 'NONE' }
    );

    return res.then(({ id, embeddings }) => ({
      id: id,
      sessionID,
      texts,
      model: this.options.model,
      embeddings,
    }));
  }
}
