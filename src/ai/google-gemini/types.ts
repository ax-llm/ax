/**
 * apiURLGoogleGemini: Base URL for Google Gemini API calls
 * @export
 */

import type { TextModelConfig } from '../types.js';

/**
 * GoogleGeminiModel: Enum for specifying the model version
 * @export
 */
export enum GoogleGeminiModel {
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Pro = 'gemini-1.5-pro'
}

/**
 * GoogleGeminiEmbedModels: Enum for specifying embedding models
 * @export
 */
export enum GoogleGeminiEmbedModels {
  Embedding001 = 'embedding-001'
}

export enum GoogleGeminiSafetyCategory {
  HarmCategoryHarassment = 'HARM_CATEGORY_HARASSMENT',
  HarmCategoryHateSpeech = 'HARM_CATEGORY_HATE_SPEECH',
  HarmCategorySexuallyExplicit = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HarmCategoryDangerousContent = 'HARM_CATEGORY_DANGEROUS_CONTENT'
}

export enum GoogleGeminiSafetyThreshold {
  BlockNone = 'BLOCK_NONE',
  BlockOnlyHigh = 'BLOCK_ONLY_HIGH',
  BlockMediumAndAbove = 'BLOCK_MEDIUM_AND_ABOVE',
  BlockLowAndAbove = 'BLOCK_LOW_AND_ABOVE',
  BlockDefault = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
}

export type GoogleGeminiContent =
  | {
      role: 'user';
      parts:
        | {
            text: string;
          }[]
        | {
            fileData: {
              mimeType: string;
              fileUri: string;
            };
          }[];
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

export type GoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: object;
};

export type GoogleGeminiTool = {
  functionDeclarations: GoogleGeminiToolFunctionDeclaration[];
};

export type GoogleGeminiToolConfig = {
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO';
    allowed_function_names?: string[];
  };
};

export type GoogleGeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: readonly string[];
};

export type GoogleGeminiSafetySettings = {
  category: GoogleGeminiSafetyCategory;
  threshold: GoogleGeminiSafetyThreshold;
}[];

export type GoogleGeminiChatRequest = {
  contents: GoogleGeminiContent[];
  tools?: GoogleGeminiTool[];
  tool_config?: GoogleGeminiToolConfig;
  systemInstruction?: GoogleGeminiContent;
  generationConfig: GoogleGeminiGenerationConfig;
  safetySettings?: GoogleGeminiSafetySettings;
};

export type GoogleGeminiChatResponse = {
  candidates: {
    content: GoogleGeminiContent;

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

/**
 * GoogleGeminiConfig: Configuration options for Google Gemini API
 * @export
 */
export type GoogleGeminiConfig = TextModelConfig & {
  model: GoogleGeminiModel;
  embedModel: GoogleGeminiEmbedModels;
  safetySettings: GoogleGeminiSafetySettings;
};

/**
 * GoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
 * @export
 */
export type GoogleGeminiBatchEmbedRequest = {
  requests: {
    model: string;
    text: string;
  }[];
};

/**
 * GoogleGeminiEmbedResponse: Structure for handling responses from the Google Gemini API embedding requests.
 * @export
 */
export type GoogleGeminiBatchEmbedResponse = {
  embeddings: {
    value: number[];
  }[];
};
