import type { AxModelConfig } from '../types.js';

export enum AxAIGoogleGeminiModel {
  Gemini3Flash = 'gemini-3-flash-preview',
  Gemini3Pro = 'gemini-3-pro-preview',
  Gemini3ProImage = 'gemini-3-pro-image-preview',
  Gemini25Pro = 'gemini-2.5-pro',
  Gemini25Flash = 'gemini-2.5-flash',
  Gemini25FlashLite = 'gemini-2.5-flash-lite',
  Gemini20Flash = 'gemini-2.0-flash',
  Gemini20FlashLite = 'gemini-2.0-flash-lite',
  Gemini20ProExp = 'gemini-2.0-pro-exp-02-05',
  Gemini20FlashThinkingExp = 'gemini-2.0-flash-thinking-exp-01-21',
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Flash002 = 'gemini-1.5-flash-002',
  Gemini15Flash8B = 'gemini-1.5-flash-8b',
  Gemini15Pro = 'gemini-1.5-pro',
  GeminiFlashLatest = 'gemini-flash-latest',
  GeminiFlashLiteLatest = 'gemini-flash-lite-latest',
  GeminiProLatest = 'gemini-pro-latest',
}

export enum AxAIGoogleGeminiEmbedModel {
  GeminiEmbedding001 = 'gemini-embedding-001',
  GeminiEmbedding = 'gemini-embedding-exp',
  TextEmbeddingLarge = 'text-embedding-large-exp-03-07',
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

export type AxAIGoogleGeminiContent = {
  role: 'user' | 'model';
  parts: AxAIGoogleGeminiContentPart[];
};

// Part type with common fields intersected with a union of data fields
export type AxAIGoogleGeminiContentPart = {
  thought?: boolean;
  thought_signature?: string;
  metadata?: { videoMetadata: object };
} & (
  | { text: string; thought?: boolean }
  | { thought: string }
  | {
      inlineData: {
        mimeType: string;
        data: string;
      };
    }
  | {
      functionCall: {
        name: string;
        args: object;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: object;
      };
    }
  | {
      fileData: {
        mimeType: string;
        fileUri: string;
      };
    }
  | { executableCode: object }
  | { codeExecutionResult: object }
);

export type AxAIGoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: object;
};

export type AxAIGoogleGeminiToolGoogleSearchRetrieval = {
  dynamic_retrieval_config: {
    mode?: 'MODE_DYNAMIC';
    dynamic_threshold?: number;
  };
};

export type AxAIGoogleGeminiToolGoogleMaps = {
  enableWidget?: boolean;
};

export type AxAIGoogleGeminiTool = {
  function_declarations?: AxAIGoogleGeminiToolFunctionDeclaration[];
  code_execution?: object;
  google_search_retrieval?: AxAIGoogleGeminiToolGoogleSearchRetrieval;
  google_search?: object;
  url_context?: object;
  google_maps?: AxAIGoogleGeminiToolGoogleMaps;
};

export type AxAIGoogleGeminiToolConfig = {
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO';
    allowed_function_names?: string[];
  };
  retrievalConfig?: AxAIGoogleGeminiRetrievalConfig;
};

export type AxAIGoogleGeminiThinkingLevel =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high';

export type AxAIGoogleGeminiGenerationConfig = {
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  candidateCount?: number;
  maxOutputTokens?: number;
  stopSequences?: readonly string[];
  responseMimeType?: string;
  responseSchema?: object;
  thinkingConfig?: {
    thinkingBudget?: number;
    thinkingLevel?: AxAIGoogleGeminiThinkingLevel;
    includeThoughts?: boolean;
  };
};

export type AxAIGoogleGeminiRetrievalConfig = {
  latLng?: { latitude: number; longitude: number };
};

export type AxAIGoogleGeminiSafetySettings = {
  category: AxAIGoogleGeminiSafetyCategory;
  threshold: AxAIGoogleGeminiSafetyThreshold;
}[];

export type AxAIGoogleGeminiChatRequest = {
  contents: AxAIGoogleGeminiContent[];
  tools?: AxAIGoogleGeminiTool[];
  toolConfig?: AxAIGoogleGeminiToolConfig;
  systemInstruction?: AxAIGoogleGeminiContent;
  generationConfig: AxAIGoogleGeminiGenerationConfig;
  safetySettings?: AxAIGoogleGeminiSafetySettings;
  /** Reference to a cached content resource (for explicit context caching) */
  cachedContent?: string;
};

export type AxAIGoogleGeminiChatResponse = {
  candidates: {
    content: AxAIGoogleGeminiContent;

    finishReason:
      | 'STOP'
      | 'MAX_TOKENS'
      | 'SAFETY'
      | 'RECITATION'
      | 'OTHER'
      | 'BLOCKLIST'
      | 'PROHIBITED_CONTENT'
      | 'SPII'
      | 'MALFORMED_FUNCTION_CALL'
      | 'UNEXPECTED_TOOL_CALL'
      | 'FINISH_REASON_UNSPECIFIED';
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
    groundingMetadata?: {
      groundingChunks?: {
        maps?: {
          title?: string;
          uri?: string;
        };
      }[];
      googleMapsWidgetContextToken?: string;
    };
  }[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount: number;
    /** Number of tokens in the cached content (from explicit caching) */
    cachedContentTokenCount?: number;
  };
};

export type AxAIGoogleGeminiChatResponseDelta = AxAIGoogleGeminiChatResponse;

export type AxAIGoogleGeminiThinkingConfig = {
  thinkingTokenBudget?: number;
  thinkingLevel?: AxAIGoogleGeminiThinkingLevel;
  includeThoughts?: boolean;
};

export type AxAIGoogleGeminiThinkingTokenBudgetLevels = {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
  highest?: number;
};

/**
 * AxAIGoogleGeminiConfig: Configuration options for Google Gemini API
 */
export type AxAIGoogleGeminiConfig = AxModelConfig & {
  model: AxAIGoogleGeminiModel;
  embedModel?: AxAIGoogleGeminiEmbedModel;
  safetySettings?: AxAIGoogleGeminiSafetySettings;
  embedType?: AxAIGoogleGeminiEmbedTypes;
  dimensions?: number;
  autoTruncate?: boolean;
  thinking?: AxAIGoogleGeminiThinkingConfig;
  thinkingTokenBudgetLevels?: AxAIGoogleGeminiThinkingTokenBudgetLevels;
  urlContext?: string;
  responseFormat?: 'json_object';
};

/**
 * AxAIGoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
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
 */
export type AxAIGoogleGeminiBatchEmbedResponse = {
  embeddings: {
    values: number[];
  }[];
};

/**
 * AxAIGoogleVertexBatchEmbedRequest: Structure for making an embedding request to the Google Vertex API.
 */
export type AxAIGoogleVertexBatchEmbedRequest = {
  instances: {
    content: string;
    task_type?: AxAIGoogleGeminiEmbedTypes;
  }[];
  parameters: {
    autoTruncate?: boolean;
    outputDimensionality?: number;
  };
};

/**
 * AxAIGoogleVertexBatchEmbedResponse: Structure for handling responses from the Google Vertex API embedding requests.
 */
export type AxAIGoogleVertexBatchEmbedResponse = {
  predictions: {
    embeddings: {
      values: number[];
    };
  }[];
};

// ============================================================================
// Context Cache Types (for explicit caching support)
// ============================================================================

/**
 * Request to create a context cache in Vertex AI / Gemini API.
 */
export type AxAIGoogleGeminiCacheCreateRequest = {
  /** The model to associate with the cache */
  model: string;
  /** Display name for the cache (optional) */
  displayName?: string;
  /** System instruction to cache */
  systemInstruction?: AxAIGoogleGeminiContent;
  /** Content parts to cache */
  contents?: AxAIGoogleGeminiContent[];
  /** Tools to cache */
  tools?: AxAIGoogleGeminiTool[];
  /** Tool configuration to cache */
  toolConfig?: AxAIGoogleGeminiToolConfig;
  /** TTL duration string (e.g., "3600s" for 1 hour) */
  ttl?: string;
  /** Absolute expiration time (ISO 8601) */
  expireTime?: string;
};

/**
 * Response from creating/getting a context cache.
 */
export type AxAIGoogleGeminiCacheResponse = {
  /** Resource name of the cached content (e.g., "projects/.../locations/.../cachedContents/...") */
  name: string;
  /** Display name */
  displayName?: string;
  /** Model associated with the cache */
  model: string;
  /** When the cache was created (ISO 8601) */
  createTime: string;
  /** When the cache was last updated (ISO 8601) */
  updateTime: string;
  /** When the cache expires (ISO 8601) */
  expireTime: string;
  /** Token count of cached content */
  usageMetadata?: {
    totalTokenCount: number;
  };
};

/**
 * Request to update a context cache (e.g., extend TTL).
 */
export type AxAIGoogleGeminiCacheUpdateRequest = {
  /** TTL duration string (e.g., "3600s" for 1 hour) */
  ttl?: string;
  /** Absolute expiration time (ISO 8601) */
  expireTime?: string;
};

/**
 * Models that support explicit context caching.
 */
export const GEMINI_CONTEXT_CACHE_SUPPORTED_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
] as const;
