/**
 * GoogleVertex: API call details
 * @export
 */

export const apiURLGoogleVertex =
  'https://us-central1-aiplatform.googleapis.com/v1/projects/';

/**
 * GoogleVertex: Models for text generation
 * @export
 */
export enum GoogleVertexModel {
  PaLMTextBison = `text-bison`,
  PaLMChatBison = `chat-bison`
}

/**
 * GoogleVertex: Models for use in embeddings
 * @export
 */
export enum GoogleVertexEmbedModels {
  PaLMTextEmbeddingGecko = 'textembedding-gecko'
}

export type GoogleVertexCompletionRequest = {
  instances: {
    prompt: string;
  }[];
  parameters: {
    maxOutputTokens: number;
    temperature: number;
    topP: number;
    topK: number;
  };
};

export type GoogleVertexCompletionResponse = {
  predictions: {
    content: string;
    safetyAttributes: {
      blocked: false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scores: any[];
    };
  }[];
};

export type GoogleVertexChatRequest = {
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

export type GoogleVertexChatResponse = {
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

export type GoogleVertexEmbedRequest = {
  instances: { content: string }[];
};

export type GoogleVertexEmbedResponse = {
  model: string;
  predictions: {
    embeddings: { values: number[] };
  }[];
};

/**
 * GoogleVertex: Model options for text generation
 * @export
 */
export type GoogleVertexConfig = {
  model: GoogleVertexModel;
  embedModel: GoogleVertexEmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
};
