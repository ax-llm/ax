/**
 * Google: API call details
 * @export
 */

export const apiURLGoogle =
  'https://us-central1-aiplatform.googleapis.com/v1/projects/';

/**
 * Google: Models for text generation
 * @export
 */
export enum GoogleModel {
  PaLMTextBison = `text-bison`,
  PaLMChatBison = `chat-bison`,
}

/**
 * Google: Models for use in embeddings
 * @export
 */
export enum GoogleEmbedModels {
  PaLMTextEmbeddingGecko = 'textembedding-gecko',
}

export type GoogleCompletionRequest = {
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

export type GoogleCompletionResponse = {
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

export type GoogleChatRequest = {
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

export type GoogleChatResponse = {
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

export type GoogleEmbedRequest = {
  instances: { content: string }[];
};

export type GoogleEmbedResponse = {
  model: string;
  predictions: {
    embeddings: { values: number[] };
  }[];
};
