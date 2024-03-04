/**
 * Cohere: Models for text generation
 * @export
 */
export enum CohereModel {
  Command = 'command',
  CommandNightly = 'command-nightly',
  CommandXLarge = 'command-xlarge',
  CommandLight = 'command-light'
}

/**
 * Cohere: Models for use in embeddings
 * @export
 */
export enum CohereEmbedModel {
  EmbedEnglishLightV20 = 'embed-english-light-v2.0',
  EmbedEnglishV20 = 'embed-english-v2.0',
  EmbedMultiLingualV20 = 'embed-multilingual-v2.0'
}

/**
 * Cohere: Specify how and if the token likelihoods are returned with the response.
 * @export
 */
export enum CohereReturnLikelihoods {
  GENERATION = 'GENERATION',
  ALL = 'ALL',
  NONE = 'NONE'
}

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereConfig = {
  model: CohereModel;
  embedModel: CohereEmbedModel;
  maxTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  endSequences?: string[];
  returnLikelihoods?: CohereReturnLikelihoods;
  logitBias?: Map<string, number>;
  truncate?: string;
};

export type CohereCompletionRequest = {
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

export type CohereCompletionResponse = {
  id: string;
  prompt: string;
  generations: { id: string; text: string }[];
};

export type CohereEmbedRequest = {
  texts: readonly string[];
  model: CohereModel | string;
  truncate: string;
};

export type CohereEmbedResponse = {
  id: string;
  texts: string[];
  model: string;
  embeddings: number[][];
};
