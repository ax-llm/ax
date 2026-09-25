import type { AxModelConfig, AxServiceTier } from '../types.js';

export enum AxAIGoogleGeminiModel {
  Gemini38Flash = 'gemini-3.8-flash',
  Gemini37Flash = 'gemini-3.7-flash',
  Gemini36Flash = 'gemini-3.6-flash',
  Gemini35Flash = 'gemini-3.5-flash',
  Gemini35FlashLite = 'gemini-3.5-flash-lite',
  Gemini31Pro = 'gemini-3.1-pro-preview',
  Gemini31FlashLite = 'gemini-3.1-flash-lite',
  /** @deprecated Shut down by Google on 2026-05-25; use `Gemini31FlashLite`. */
  Gemini3FlashLite = 'gemini-3.1-flash-lite-preview',
  Gemini3Flash = 'gemini-3-flash-preview',
  Gemini3Pro = 'gemini-3.1-pro-preview',
  // Google shut down the -preview ids these two members once named (on
  // 2026-06-25); each now points at its GA successor.
  Gemini3ProImage = 'gemini-3-pro-image',
  Gemini31FlashImage = 'gemini-3.1-flash-image',
  Gemini31FlashLiteImage = 'gemini-3.1-flash-lite-image',
  Gemini38Live = 'gemini-3.8-live',
  Gemini38LiveExtendedThinking = 'gemini-3.8-live-extended-thinking',
  Gemini31FlashLive = 'gemini-3.1-flash-live-preview',
  // Text-to-speech for `speak()`.
  Gemini38FlashTTS = 'gemini-3.8-flash-tts',
  Gemini38FlashLiteTTS = 'gemini-3.8-flash-lite-tts',
  Gemini31FlashTTS = 'gemini-3.1-flash-tts-preview',
  // Speech-to-text for `transcribe()`.
  Gemini35Transcribe = 'gemini-3.5-transcribe',
  NanoBanana2 = 'nano-banana-2',
  /** @deprecated Shut down by Google on 2026-08-31; use `gemini-robotics-er-2-preview`. */
  GeminiRoboticsER16 = 'gemini-robotics-er-1.6-preview',
  Gemini25Pro = 'gemini-2.5-pro',
  Gemini25Flash = 'gemini-2.5-flash',
  Gemini25FlashNativeAudio = 'gemini-2.5-flash-native-audio-preview-12-2025',
  Gemini25FlashLite = 'gemini-2.5-flash-lite',
  /** @deprecated Shut down by Google on 2026-06-01; use `Gemini36Flash`. */
  Gemini20Flash = 'gemini-2.0-flash',
  /** @deprecated Shut down by Google on 2026-06-01; use `Gemini31FlashLite`. */
  Gemini20FlashLite = 'gemini-2.0-flash-lite',
  /** @deprecated Shut down by Google; use `Gemini36Flash`. */
  Gemini20ProExp = 'gemini-2.0-pro-exp-02-05',
  /** @deprecated Shut down by Google; use `Gemini36Flash`. */
  Gemini20FlashThinkingExp = 'gemini-2.0-flash-thinking-exp-01-21',
  /** @deprecated Shut down by Google; use `Gemini36Flash`. */
  Gemini1Pro = 'gemini-1.0-pro',
  /** @deprecated Shut down by Google; use `Gemini36Flash`. */
  Gemini15Flash = 'gemini-1.5-flash',
  /** @deprecated Shut down by Google; use `Gemini36Flash`. */
  Gemini15Flash002 = 'gemini-1.5-flash-002',
  /** @deprecated Shut down by Google; use `Gemini31FlashLite`. */
  Gemini15Flash8B = 'gemini-1.5-flash-8b',
  /** @deprecated Shut down by Google; use `Gemini31Pro`. */
  Gemini15Pro = 'gemini-1.5-pro',
  GeminiFlashLatest = 'gemini-flash-latest',
  GeminiFlashLiteLatest = 'gemini-flash-lite-latest',
  GeminiProLatest = 'gemini-pro-latest',
}

export enum AxAIGoogleGeminiEmbedModel {
  GeminiEmbedding2 = 'gemini-embedding-2',
  GeminiEmbedding001 = 'gemini-embedding-001',
  /** @deprecated Shut down by Google on 2025-10-30; use `GeminiEmbedding2`. */
  GeminiEmbedding = 'gemini-embedding-exp',
  TextEmbeddingLarge = 'text-embedding-large-exp-03-07',
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
        id?: string;
        name: string;
        args: object;
      };
    }
  | {
      functionResponse: {
        id?: string;
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
  // Dedicated speech-to-text models (gemini-3.5-transcribe) answer with this.
  | { audioTranscription: { text: string } }
  | { executableCode: object }
  | { codeExecutionResult: object }
);

export type AxAIGoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  /** OpenAPI Schema subset: rejects `additionalProperties` and type unions. */
  parameters?: object;
  /** Full JSON Schema. Mutually exclusive with `parameters`. */
  parametersJsonSchema?: object;
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
  responseJsonSchema?: object;
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
  service_tier?: 'standard' | 'flex' | 'priority';
};

export type AxAIGoogleGeminiChatResponse = {
  responseId?: string;
  modelVersion?: string;
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
        retrievedContext?: {
          title?: string;
          uri?: string;
          /** File Search multimodal (May 2026): id of the file/media chunk. */
          media_id?: string;
          /** File Search multimodal (May 2026): page numbers cited within the source. */
          page_numbers?: number[];
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
    /** Service tier that actually handled the request. */
    serviceTier?: 'unspecified' | 'standard' | 'flex' | 'priority';
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
 * Maps thinkingTokenBudget string levels to Gemini 3 thinkingLevel values.
 * The mapped result is clamped to the levels supported by the resolved model.
 */
export type AxAIGoogleGeminiThinkingLevelMapping = {
  minimal?: AxAIGoogleGeminiThinkingLevel;
  low?: AxAIGoogleGeminiThinkingLevel;
  medium?: AxAIGoogleGeminiThinkingLevel;
  high?: AxAIGoogleGeminiThinkingLevel;
  highest?: AxAIGoogleGeminiThinkingLevel;
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
  /** Maps thinkingTokenBudget levels to Gemini 3+ thinkingLevel values */
  thinkingLevelMapping?: AxAIGoogleGeminiThinkingLevelMapping;
  urlContext?: string;
  responseFormat?: 'json_object';
  /** Inference service tier used by the Gemini API. */
  serviceTier?: AxServiceTier;
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

/**
 * AxAIGoogleVertexEmbedContentRequest: Structure for a single-text Vertex `:embedContent` request.
 */
export type AxAIGoogleVertexEmbedContentRequest = {
  content: {
    parts: { text: string }[];
  };
  outputDimensionality?: number;
};

/**
 * AxAIGoogleVertexEmbedContentResponse: Structure for handling a Vertex `:embedContent` response.
 */
export type AxAIGoogleVertexEmbedContentResponse = {
  embedding: {
    values: number[];
  };
  usageMetadata?: {
    promptTokenCount?: number;
    totalTokenCount?: number;
  };
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
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview-customtools',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
] as const;
