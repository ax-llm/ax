import type { AxModelConfig } from '../types.js';

export enum AxGoogleGeminiModel {
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Pro = 'gemini-1.5-pro'
}

export enum AxGoogleGeminiEmbedModels {
  Embedding001 = 'embedding-001'
}

export enum AxGoogleGeminiSafetyCategory {
  HarmCategoryHarassment = 'HARM_CATEGORY_HARASSMENT',
  HarmCategoryHateSpeech = 'HARM_CATEGORY_HATE_SPEECH',
  HarmCategorySexuallyExplicit = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HarmCategoryDangerousContent = 'HARM_CATEGORY_DANGEROUS_CONTENT'
}

export enum AxGoogleGeminiSafetyThreshold {
  BlockNone = 'BLOCK_NONE',
  BlockOnlyHigh = 'BLOCK_ONLY_HIGH',
  BlockMediumAndAbove = 'BLOCK_MEDIUM_AND_ABOVE',
  BlockLowAndAbove = 'BLOCK_LOW_AND_ABOVE',
  BlockDefault = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
}

export type AxGoogleGeminiContent =
  | {
      role: 'user';
      parts: (
        | {
            text: string;
          }
        | {
            inlineData: {
              mimeType: string;
              data: string;
            };
          }
        | {
            fileData: {
              mimeType: string;
              fileUri: string;
            };
          }
      )[];
    }
  | {
      role: 'model';
      parts:
        | {
            text: string;
          }[]
        | {
            functionCall: {
              name: string;
              args: object;
            };
          }[];
    }
  | {
      role: 'function';
      parts: {
        functionResponse: {
          name: string;
          response: object;
        };
      }[];
    };

export type AxGoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: object;
};

export type AxGoogleGeminiTool = {
  functionDeclarations: AxGoogleGeminiToolFunctionDeclaration[];
};

export type AxGoogleGeminiToolConfig = {
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO';
    allowed_function_names?: string[];
  };
};

export type AxGoogleGeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: readonly string[];
};

export type AxGoogleGeminiSafetySettings = {
  category: AxGoogleGeminiSafetyCategory;
  threshold: AxGoogleGeminiSafetyThreshold;
}[];

export type AxGoogleGeminiChatRequest = {
  contents: AxGoogleGeminiContent[];
  tools?: AxGoogleGeminiTool[];
  tool_config?: AxGoogleGeminiToolConfig;
  systemInstruction?: AxGoogleGeminiContent;
  generationConfig: AxGoogleGeminiGenerationConfig;
  safetySettings?: AxGoogleGeminiSafetySettings;
};

export type AxGoogleGeminiChatResponse = {
  candidates: {
    content: AxGoogleGeminiContent;

    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    citationMetadata: {
      citations: {
        startIndex: number;
        endIndex: number;
        uri: string;
        title: string;
        license: string;
        publicationDate: {
          year: number;
          month: number;
          day: number;
        };
      }[];
    };
  }[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
};

export type AxGoogleGeminiChatResponseDelta = AxGoogleGeminiChatResponse;

/**
 * AxGoogleGeminiConfig: Configuration options for Google Gemini API
 * @export
 */
export type AxGoogleGeminiConfig = AxModelConfig & {
  model: AxGoogleGeminiModel | string;
  embedModel: AxGoogleGeminiEmbedModels;
  safetySettings?: AxGoogleGeminiSafetySettings;
};

/**
 * AxGoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
 * @export
 */
export type AxGoogleGeminiBatchEmbedRequest = {
  requests: {
    model: string;
    text: string;
  }[];
};

/**
 * AxGoogleGeminiEmbedResponse: Structure for handling responses from the Google Gemini API embedding requests.
 * @export
 */
export type AxGoogleGeminiBatchEmbedResponse = {
  embeddings: {
    value: number[];
  }[];
};
