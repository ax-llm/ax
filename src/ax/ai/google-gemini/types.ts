import type { AxModelConfig } from '../types.js'

export enum AxAIGoogleGeminiModel {
  Gemini20Pro = 'gemini-2.0-pro-exp-02-05',
  Gemini20Flash = 'gemini-2.0-flash',
  Gemini20FlashLite = 'gemini-2.0-flash-lite-preview-02-05',
  Gemini20FlashThinking = 'gemini-2.0-flash-thinking-exp-01-21',
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Flash002 = 'gemini-1.5-flash-002',
  Gemini15Flash8B = 'gemini-1.5-flash-8b',
  Gemini15Pro = 'gemini-1.5-pro',
  Gemma2 = 'gemma-2-27b-it',
  AQA = 'aqa',
}

export enum AxAIGoogleGeminiEmbedModel {
  GeminiEmbedding = 'gemini-embedding-exp-03-07',
  TextEmbedding004 = 'text-embedding-004',
  TextEmbedding005 = 'text-embedding-005',
}

export enum AxAIGoogleGeminiSafetyCategory {
  HarmCategoryHarassment = 'HARM_CATEGORY_HARASSMENT',
  HarmCategoryHateSpeech = 'HARM_CATEGORY_HATE_SPEECH',
  HarmCategorySexuallyExplicit = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HarmCategoryDangerousContent = 'HARM_CATEGORY_DANGEROUS_CONTENT',
}

export enum AxAIGoogleGeminiSafetyThreshold {
  BlockNone = 'BLOCK_NONE',
  BlockOnlyHigh = 'BLOCK_ONLY_HIGH',
  BlockMediumAndAbove = 'BLOCK_MEDIUM_AND_ABOVE',
  BlockLowAndAbove = 'BLOCK_LOW_AND_ABOVE',
  BlockDefault = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
}

export enum AxAIGoogleGeminiEmbedTypes {
  SemanticSimilarity = 'SEMANTIC_SIMILARITY',
  Classification = 'CLASSIFICATION',
  Clustering = 'CLUSTERING',
  RetrievalDocument = 'RETRIEVAL_DOCUMENT',
  RetrievalQuery = 'RETRIEVAL_QUERY',
  QuestionAnswering = 'QUESTION_ANSWERING',
  FactVerification = 'FACT_VERIFICATION',
  CodeRetrievalQuery = 'CODE_RETRIEVAL_QUERY',
}

export type AxAIGoogleGeminiContent =
  | {
      role: 'user'
      parts: (
        | {
            text: string
          }
        | {
            inlineData: {
              mimeType: string
              data: string
            }
          }
        | {
            fileData: {
              mimeType: string
              fileUri: string
            }
          }
      )[]
    }
  | {
      role: 'model'
      parts:
        | {
            text: string
          }[]
        | {
            functionCall: {
              name: string
              args: object
            }
          }[]
    }
  | {
      role: 'function'
      parts: {
        functionResponse: {
          name: string
          response: object
        }
      }[]
    }

export type AxAIGoogleGeminiToolFunctionDeclaration = {
  name: string
  description?: string
  parameters?: object
}

export type AxAIGoogleGeminiToolGoogleSearchRetrieval = {
  dynamic_retrieval_config: {
    mode?: 'MODE_DYNAMIC'
    dynamic_threshold?: number
  }
}

export type AxAIGoogleGeminiTool = {
  function_declarations?: AxAIGoogleGeminiToolFunctionDeclaration[]
  code_execution?: object
  google_search_retrieval?: AxAIGoogleGeminiToolGoogleSearchRetrieval
}

export type AxAIGoogleGeminiToolConfig = {
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO'
    allowed_function_names?: string[]
  }
}

export type AxAIGoogleGeminiGenerationConfig = {
  temperature?: number
  topP?: number
  topK?: number
  candidateCount?: number
  maxOutputTokens?: number
  stopSequences?: readonly string[]
}

export type AxAIGoogleGeminiSafetySettings = {
  category: AxAIGoogleGeminiSafetyCategory
  threshold: AxAIGoogleGeminiSafetyThreshold
}[]

export type AxAIGoogleGeminiChatRequest = {
  contents: AxAIGoogleGeminiContent[]
  tools?: AxAIGoogleGeminiTool[]
  toolConfig?: AxAIGoogleGeminiToolConfig
  systemInstruction?: AxAIGoogleGeminiContent
  generationConfig: AxAIGoogleGeminiGenerationConfig
  safetySettings?: AxAIGoogleGeminiSafetySettings
}

export type AxAIGoogleGeminiChatResponse = {
  candidates: {
    content: AxAIGoogleGeminiContent

    finishReason:
      | 'STOP'
      | 'MAX_TOKENS'
      | 'SAFETY'
      | 'RECITATION'
      | 'OTHER'
      | 'MALFORMED_FUNCTION_CALL'
    citationMetadata: {
      citations: {
        startIndex: number
        endIndex: number
        uri: string
        title: string
        license: string
        publicationDate: {
          year: number
          month: number
          day: number
        }
      }[]
    }
  }[]
  usageMetadata: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

export type AxAIGoogleGeminiChatResponseDelta = AxAIGoogleGeminiChatResponse

/**
 * AxAIGoogleGeminiConfig: Configuration options for Google Gemini API
 */
export type AxAIGoogleGeminiConfig = AxModelConfig & {
  model: AxAIGoogleGeminiModel
  embedModel?: AxAIGoogleGeminiEmbedModel
  safetySettings?: AxAIGoogleGeminiSafetySettings
  embedType?: AxAIGoogleGeminiEmbedTypes
  dimensions?: number
}

/**
 * AxAIGoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
 */
export type AxAIGoogleGeminiBatchEmbedRequest = {
  requests: {
    model: string
    content: {
      parts: { text: string }[]
    }
  }[]
}

/**
 * AxAIGoogleGeminiEmbedResponse: Structure for handling responses from the Google Gemini API embedding requests.
 */
export type AxAIGoogleGeminiBatchEmbedResponse = {
  embeddings: {
    values: number[]
  }[]
}

/**
 * AxAIGoogleVertexBatchEmbedRequest: Structure for making an embedding request to the Google Vertex API.
 */
export type AxAIGoogleVertexBatchEmbedRequest = {
  instances: {
    content: string
  }[]
}

/**
 * AxAIGoogleVertexBatchEmbedResponse: Structure for handling responses from the Google Vertex API embedding requests.
 */
export type AxAIGoogleVertexBatchEmbedResponse = {
  predictions: {
    embeddings: {
      values: number[]
    }
  }[]
}
