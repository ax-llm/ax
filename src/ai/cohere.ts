import axios, { AxiosResponse } from 'axios';
import {
  AIService,
  GenerateResponse,
  EmbedResponse,
  PromptMetadata,
} from '../text';

const enum CohereAPI {
  Generate = 'generate',
  Embed = 'embed',
}

/**
 * Cohere: Models for text generation
 * @export
 */
export const enum CohereGenerateModels {
  CommandXLargeNightly = 'command-xlarge-nightly',
  XLarge = 'xlarge',
  Medium = 'medium',
}

/**
 * Cohere: Specify how and if the token likelihoods are returned with the response.
 * @export
 */
export const enum CohereReturnLikelihoods {
  GENERATION = 'GENERATION',
  ALL = 'ALL',
  NONE = 'NONE',
}

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereGenerateOptions = {
  model: CohereGenerateModels | string;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stopSequences: string[];
  returnLikelihoods: CohereReturnLikelihoods;
};

/**
 * Cohere: Default Model options for text generation
 * @export
 */
export const CohereDefaultGenerateOptions = (): CohereGenerateOptions => ({
  model: CohereGenerateModels.CommandXLargeNightly,
  maxTokens: 300,
  temperature: 0.45,
  topK: 0,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stopSequences: [],
  returnLikelihoods: CohereReturnLikelihoods.NONE,
});

/**
 * Cohere: Default model options for more creative text generation
 * @export
 */
export const CohereCreativeGenerateOptions = (): CohereGenerateOptions => ({
  ...CohereDefaultGenerateOptions(),
  temperature: 0.9,
});

type CohereGenerateRequest = {
  prompt: string;
  model: CohereGenerateModels | string;
  max_tokens: number;
  temperature: number;
  k: number;
  p: number;
  frequency_penalty: number;
  presence_penalty: number;
  end_sequences: string[];
  stop_sequences: string[];
  return_likelihoods: CohereReturnLikelihoods;
};

type CohereGeneration = { id: string; text: string };

type CohereGenerateResponse = {
  id: string;
  prompt: string;
  generations: CohereGeneration[];
};

type CohereEmbedRequest = {
  texts: string[];
  model: CohereGenerateModels | string;
  truncate: string;
};

type CohereEmbedResponse = {
  id: string;
  texts: string[];
  model: string;
  embeddings: number[];
};

const generateData = (
  prompt: string,
  stopSequences: string[],
  opt: Readonly<CohereGenerateOptions>
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
 * Cohere: Various options that can be set on the AI Service
 * @export
 */
export type CohereOptions = {
  generateOptions?: CohereGenerateOptions;
};

/**
 * Cohere: AI Service
 * @export
 */
export class Cohere implements AIService {
  private apiKey: string;
  private generateOptions: CohereGenerateOptions =
    CohereDefaultGenerateOptions();

  constructor(apiKey: string, options?: Readonly<CohereOptions>) {
    if (apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    this.apiKey = apiKey;

    if (options?.generateOptions) {
      this.generateOptions = options.generateOptions;
    }
  }

  name(): string {
    return 'Cohere';
  }

  generate(
    prompt: string,
    md?: PromptMetadata,
    sessionID?: string
  ): Promise<GenerateResponse> {
    const text = prompt.trim();
    const stopSeq = md?.stopSequences || [];
    const opts = this.generateOptions;

    const res = this.apiCall<CohereGenerateRequest, CohereGenerateResponse>(
      CohereAPI.Generate,
      generateData(text, stopSeq, opts)
    );

    return res.then(({ data: { id, generations: gens } }) => ({
      id: id,
      sessionID: sessionID,
      query: prompt,
      values: gens,
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

    const { model } = this.generateOptions;
    const req = { texts, model, truncate: 'NONE' };
    const res = this.apiCall<CohereEmbedRequest, CohereEmbedResponse>(
      CohereAPI.Embed,
      req
    );

    return res.then(({ data: { id, embeddings } }) => ({
      id: id,
      sessionID,
      texts,
      model,
      embeddings,
    }));
  }

  /** @ignore */
  private apiCall<T1, T2>(
    api: CohereAPI,
    data: T1
  ): Promise<AxiosResponse<T2, any>> {
    const headers = {
      Authorization: `BEARER ${this.apiKey}`,
      'Cohere-Version': '2022-12-06',
    };

    const options = {
      headers,
    };

    return axios.post(`https://api.cohere.ai/${api}`, data, options);
  }
}
