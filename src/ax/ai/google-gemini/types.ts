import type { AxModelConfig } from '../types.js';

/**
 * Defines the available Google Gemini models.
 */
export enum AxAIGoogleGeminiModel {
  Gemini25Pro = 'gemini-2.5-pro',
  Gemini25Flash = 'gemini-2.5-flash',
  Gemini25FlashLite = 'gemini-2.5-flash-lite-preview-06-17',
  Gemini20Flash = 'gemini-2.0-flash',
  Gemini20FlashLite = 'gemini-2.0-flash-lite-preview-02-05',
  Gemini1Pro = 'gemini-1.0-pro',
  Gemini15Flash = 'gemini-1.5-flash',
  Gemini15Flash002 = 'gemini-1.5-flash-002',
  Gemini15Flash8B = 'gemini-1.5-flash-8b',
  Gemini15Pro = 'gemini-1.5-pro',
}

/**
 * Defines the available Google Gemini embedding models.
 */
export enum AxAIGoogleGeminiEmbedModel {
  GeminiEmbedding = 'gemini-embedding-exp',
  TextEmbeddingLarge = 'text-embedding-large-exp-03-07',
  TextEmbedding004 = 'text-embedding-004',
  TextEmbedding005 = 'text-embedding-005',
}

/**
 * Defines the safety categories for Google Gemini.
 */
export enum AxAIGoogleGeminiSafetyCategory {
  HarmCategoryHarassment = 'HARM_CATEGORY_HARASSMENT',
  HarmCategoryHateSpeech = 'HARM_CATEGORY_HATE_SPEECH',
  HarmCategorySexuallyExplicit = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HarmCategoryDangerousContent = 'HARM_CATEGORY_DANGEROUS_CONTENT',
}

/**
 * Defines the safety thresholds for Google Gemini.
 */
export enum AxAIGoogleGeminiSafetyThreshold {
  BlockNone = 'BLOCK_NONE',
  BlockOnlyHigh = 'BLOCK_ONLY_HIGH',
  BlockMediumAndAbove = 'BLOCK_MEDIUM_AND_ABOVE',
  BlockLowAndAbove = 'BLOCK_LOW_AND_ABOVE',
  BlockDefault = 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
}

/**
 * Defines the embedding types for Google Gemini.
 */
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

/**
 * Represents the content of a message in a chat.
 */
export type AxAIGoogleGeminiContent = {
  /** The role of the sender. */
  role: 'user' | 'model';
  /** The parts of the content. */
  parts: AxAIGoogleGeminiContentPart[];
};

/**
 * Represents a part of the content of a message.
 */
export type AxAIGoogleGeminiContentPart = {
  /** Whether the part is a thought. */
  thought?: boolean;
  /** The metadata of the part. */
  metadata?: { videoMetadata: object };
} & (
  | { text: string }
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

/**
 * Represents a function declaration for a tool.
 */
export type AxAIGoogleGeminiToolFunctionDeclaration = {
  /** The name of the function. */
  name: string;
  /** The description of the function. */
  description?: string;
  /** The parameters of the function. */
  parameters?: object;
};

/**
 * Represents the Google Search retrieval tool.
 */
export type AxAIGoogleGeminiToolGoogleSearchRetrieval = {
  /** The dynamic retrieval configuration. */
  dynamic_retrieval_config: {
    mode?: 'MODE_DYNAMIC';
    dynamic_threshold?: number;
  };
};

/**
 * Represents a tool that the AI can use.
 */
export type AxAIGoogleGeminiTool = {
  /** The function declarations of the tool. */
  function_declarations?: AxAIGoogleGeminiToolFunctionDeclaration[];
  /** The code execution of the tool. */
  code_execution?: object;
  /** The Google Search retrieval of the tool. */
  google_search_retrieval?: AxAIGoogleGeminiToolGoogleSearchRetrieval;
  /** The Google Search of the tool. */
  google_search?: object;
  /** The URL context of the tool. */
  url_context?: object;
};

/**
 * Represents the tool configuration for a chat request.
 */
export type AxAIGoogleGeminiToolConfig = {
  /** The function calling configuration. */
  function_calling_config: {
    mode: 'ANY' | 'NONE' | 'AUTO';
    allowed_function_names?: string[];
  };
};

/**
 * Represents the generation configuration for a chat request.
 */
export type AxAIGoogleGeminiGenerationConfig = {
  /** The temperature of the sampling. */
  temperature?: number;
  /** The top-p value of the sampling. */
  topP?: number;
  /** The top-k value of the sampling. */
  topK?: number;
  /** The frequency penalty. */
  frequencyPenalty?: number;
  /** The number of candidates to generate. */
  candidateCount?: number;
  /** The maximum number of output tokens. */
  maxOutputTokens?: number;
  /** An array of stop sequences. */
  stopSequences?: readonly string[];
  /** The MIME type of the response. */
  responseMimeType?: string;
  /** The thinking configuration. */
  thinkingConfig?: {
    thinkingBudget?: number;
    includeThoughts?: boolean;
  };
};

/**
 * Represents the safety settings for a chat request.
 */
export type AxAIGoogleGeminiSafetySettings = {
  /** The category of the safety setting. */
  category: AxAIGoogleGeminiSafetyCategory;
  /** The threshold of the safety setting. */
  threshold: AxAIGoogleGeminiSafetyThreshold;
}[];

/**
 * Represents a chat request to the Google Gemini AI service.
 */
export type AxAIGoogleGeminiChatRequest = {
  /** The contents of the chat. */
  contents: AxAIGoogleGeminiContent[];
  /** The tools that the AI can use. */
  tools?: AxAIGoogleGeminiTool[];
  /** The tool configuration. */
  toolConfig?: AxAIGoogleGeminiToolConfig;
  /** The system instruction. */
  systemInstruction?: AxAIGoogleGeminiContent;
  /** The generation configuration. */
  generationConfig: AxAIGoogleGeminiGenerationConfig;
  /** The safety settings. */
  safetySettings?: AxAIGoogleGeminiSafetySettings;
};

/**
 * Represents a chat response from the Google Gemini AI service.
 */
export type AxAIGoogleGeminiChatResponse = {
  /** The candidates in the response. */
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
  }[];
  /** The token usage of the response. */
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount: number;
  };
};

/**
 * Represents a delta in a streaming chat response from the Google Gemini AI service.
 */
export type AxAIGoogleGeminiChatResponseDelta = AxAIGoogleGeminiChatResponse;

/**
 * Represents the thinking configuration for the Google Gemini AI service.
 */
export type AxAIGoogleGeminiThinkingConfig = {
  /** The token budget for thinking. */
  thinkingTokenBudget?: number;
  /** Whether to include thoughts in the response. */
  includeThoughts?: boolean;
};

/**
 * Represents the token budget levels for thinking.
 */
export type AxAIGoogleGeminiThinkingTokenBudgetLevels = {
  /** The minimal token budget. */
  minimal?: number;
  /** The low token budget. */
  low?: number;
  /** The medium token budget. */
  medium?: number;
  /** The high token budget. */
  high?: number;
  /** The highest token budget. */
  highest?: number;
};

/**
 * Represents the configuration for the Google Gemini AI service.
 */
export type AxAIGoogleGeminiConfig = AxModelConfig & {
  /** The model to use. */
  model: AxAIGoogleGeminiModel;
  /** The embedding model to use. */
  embedModel?: AxAIGoogleGeminiEmbedModel;
  /** The safety settings. */
  safetySettings?: AxAIGoogleGeminiSafetySettings;
  /** The embedding type. */
  embedType?: AxAIGoogleGeminiEmbedTypes;
  /** The dimensions of the embedding. */
  dimensions?: number;
  /** Whether to automatically truncate the input. */
  autoTruncate?: boolean;
  /** The thinking configuration. */
  thinking?: AxAIGoogleGeminiThinkingConfig;
  /** The token budget levels for thinking. */
  thinkingTokenBudgetLevels?: AxAIGoogleGeminiThinkingTokenBudgetLevels;
  /** The URL context. */
  urlContext?: string;
};

/**
 * Represents a batch embedding request to the Google Gemini API.
 */
export type AxAIGoogleGeminiBatchEmbedRequest = {
  /** The requests to embed. */
  requests: {
    model: string;
    content: {
      parts: { text: string }[];
    };
  }[];
};

/**
 * Represents a batch embedding response from the Google Gemini API.
 */
export type AxAIGoogleGeminiBatchEmbedResponse = {
  /** The embeddings. */
  embeddings: {
    values: number[];
  }[];
};

/**
 * Represents a batch embedding request to the Google Vertex API.
 */
export type AxAIGoogleVertexBatchEmbedRequest = {
  /** The instances to embed. */
  instances: {
    content: string;
    task_type?: AxAIGoogleGeminiEmbedTypes;
  }[];
  /** The parameters for the embedding. */
  parameters: {
    autoTruncate?: boolean;
    outputDimensionality?: number;
  };
};

/**
 * Represents a batch embedding response from the Google Vertex API.
 */
export type AxAIGoogleVertexBatchEmbedResponse = {
  /** The predictions. */
  predictions: {
    embeddings: {
      values: number[];
    };
  }[];
};
