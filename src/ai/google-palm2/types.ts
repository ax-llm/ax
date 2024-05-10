/**
 * GooglePalm2: API call details
 * @export
 */

export const apiURLGooglePalm2 =
  'https://us-central1-aiplatform.googleapis.com/v1/projects/';

/**
 * GooglePalm2: Models for text generation
 * @export
 */
export enum GooglePalm2Model {
  PaLMTextBison = `text-bison`,
  PaLMChatBison = `chat-bison`
}

/**
 * GooglePalm2: Models for use in embeddings
 * @export
 */
export enum GooglePalm2EmbedModels {
  PaLMTextEmbeddingGecko = 'textembedding-gecko'
}

export type GooglePalm2ChatRequest = {
  instances: {
    context: string;
    examples: { input: { content: string }; output: { content: string } }[];
    messages: { author: string; content: string }[];
  }[];
  parameters: {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  };
};

export type GooglePalm2ChatResponse = {
  predictions: {
    candidates: { content: string }[];
    citationMetadata: { citations: string[] }[];
    safetyAttributes: {
      blocked: false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scores: any[];
    };
  }[];
};

export type GooglePalm2EmbedRequest = {
  instances: { content: string }[];
};

export type GooglePalm2EmbedResponse = {
  model: string;
  predictions: {
    embeddings: { values: number[] };
  }[];
};

/**
 * GooglePalm2: Model options for text generation
 * @export
 */
export type GooglePalm2Config = {
  model: GooglePalm2Model;
  embedModel: GooglePalm2EmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
};
