import type { AxModelConfig } from '../types.js';

export enum AxAIGoogleGeminiModel {
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Flash8B = 'gemini-1.5-flash-8b',
  Gemini15Pro = 'gemini-1.5-pro',
  Gemma2 = 'gemma-2-27b-it',
  AQA = 'aqa'
}

export enum AxAIGoogleGeminiEmbedModel {
  TextEmbedding004 = 'text-embedding-004'
}

export enum AxAIGoogleGeminiSafetyCategory {
  HarmCategoryHarassment = 'HARM_CATEGORY_HARASSMENT',
  HarmCategoryHateSpeech = 'HARM_CATEGORY_HATE_SPEECH',
  HarmCategorySexuallyExplicit = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HarmCategoryDangerousContent = 'HARM_CATEGORY_DANGEROUS_CONTENT'
}

export enum AxAIGoogleGeminiSafetyThreshold {
  BlockNone = 'BLOCK_NONE',
  BlockOnlyHigh = 'BLOCK_ONLY_HIGH',
  BlockMediumAndAbove = 'BLOCK_MEDIUM_AND_ABOVE',
  BlockLowAndAbove = 'BLOCK_LOW_AND_ABOVE',
  BlockDefault = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
}

export type AxAIGoogleGeminiContent =
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

export type AxAIGoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: object;
};

export type AxAIGoogleGeminiTool = {
  functionDeclarations?: AxAIGoogleGeminiToolFunctionDeclaration[];
  codeExecution?: object;
};

export type AxAIGoogleGeminiToolConfig = {
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO';
    allowed_function_names?: string[];
  };
};

export type AxAIGoogleGeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: readonly string[];
};

export type AxAIGoogleGeminiSafetySettings = {
  category: AxAIGoogleGeminiSafetyCategory;
  threshold: AxAIGoogleGeminiSafetyThreshold;
}[];

export type AxAIGoogleGeminiChatRequest = {
  contents: AxAIGoogleGeminiContent[];
  tools?: AxAIGoogleGeminiTool[];
  tool_config?: AxAIGoogleGeminiToolConfig;
  systemInstruction?: AxAIGoogleGeminiContent;
  generationConfig: AxAIGoogleGeminiGenerationConfig;
  safetySettings?: AxAIGoogleGeminiSafetySettings;
};

export type AxAIGoogleGeminiChatResponse = {
  candidates: {
    content: AxAIGoogleGeminiContent;

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

export type AxAIGoogleGeminiChatResponseDelta = AxAIGoogleGeminiChatResponse;

/**
 * AxAIGoogleGeminiConfig: Configuration options for Google Gemini API
 * @export
 */
export type AxAIGoogleGeminiConfig = AxModelConfig & {
  model: AxAIGoogleGeminiModel | string;
  embedModel?: AxAIGoogleGeminiEmbedModel;
  safetySettings?: AxAIGoogleGeminiSafetySettings;
};

/**
 * AxAIGoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
 * @export
 */
export type AxAIGoogleGeminiBatchEmbedRequest = {
  requests: {
    model: string;
    content: {
      parts: { text: string }[];
    };
  }[];
};

/**
 * AxAIGoogleGeminiEmbedResponse: Structure for handling responses from the Google Gemini API embedding requests.
 * @export
 */
export type AxAIGoogleGeminiBatchEmbedResponse = {
  embeddings: {
    value: number[];
  }[];
};
