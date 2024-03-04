/**
 * apiURLGoogleGemini: Base URL for Google Gemini API calls
 * @export
 */
export const apiURLGoogleGemini =
  'https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{REGION}/publishers/google/models/gemini-1.0-pro:streamGenerateContent';

/**
 * GoogleGeminiModel: Enum for specifying the model version
 * @export
 */
export enum GoogleGeminiModel {
  Gemini_1_0_Pro = 'gemini-1.0-pro'
}

/**
 * GoogleGeminiEmbedModels: Enum for specifying embedding models
 * @export
 */
export enum GoogleGeminiEmbedModels {}
// Assuming embedding models would be specified here, similar to GoogleVertexEmbedModels

export type GoogleGeminiPart = {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  videoMetadata?: {
    startOffset: {
      seconds: number;
      nanos: number;
    };
    endOffset: {
      seconds: number;
      nanos: number;
    };
  };
};

export type GoogleGeminiContent = {
  role: 'USER' | 'MODEL';
  parts: GoogleGeminiPart[];
};

export type GoogleGeminiToolFunctionDeclaration = {
  name: string;
  description?: string;
  parameters: any; // OpenAPI Object Schema, needs to be defined based on external specification
};

export type GoogleGeminiTool = {
  functionDeclarations: GoogleGeminiToolFunctionDeclaration[];
};

export type GoogleGeminiSafetySetting = {
  category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | string; // Assuming other categories can be added here
  threshold:
    | 'BLOCK_NONE'
    | 'BLOCK_LOW_AND_ABOVE'
    | 'BLOCK_MED_AND_ABOVE'
    | 'BLOCK_ONLY_HIGH';
};

export type GoogleGeminiGenerationConfig = {
  temperature: number;
  topP: number;
  topK: number;
  candidateCount: number;
  maxOutputTokens: number;
  stopSequences: readonly string[];
};

export type GoogleGeminiChatRequest = {
  contents: GoogleGeminiContent[];
  tools?: GoogleGeminiTool[];
  safetySettings?: GoogleGeminiSafetySetting[];
  generationConfig: GoogleGeminiGenerationConfig;
};

export type GoogleGeminiChatResponse = {
  candidates: {
    content: {
      parts: GoogleGeminiPart[];
    };
    finishReason:
      | 'FINISH_REASON_UNSPECIFIED'
      | 'FINISH_REASON_STOP'
      | 'FINISH_REASON_MAX_TOKENS'
      | 'FINISH_REASON_SAFETY'
      | 'FINISH_REASON_RECITATION'
      | 'FINISH_REASON_OTHER';
    safetyRatings: {
      category: string;
      probability:
        | 'HARM_PROBABILITY_UNSPECIFIED'
        | 'NEGLIGIBLE'
        | 'LOW'
        | 'MEDIUM'
        | 'HIGH';
      blocked: boolean;
    }[];
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
export type GoogleGeminiConfig = {
  model: GoogleGeminiModel;
  embedModel: GoogleGeminiModel;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  stopSequences: string[];
};

/**
 * GoogleGeminiCompletionRequest: Structure for making a completion request to the Google Gemini API
 * @export
 */
export type GoogleGeminiCompletionRequest = {
  contents: [
    {
      role: 'USER' | 'MODEL';
      parts: {
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        fileData?: {
          mimeType: string;
          fileUri: string;
        };
        videoMetadata?: {
          startOffset: {
            seconds: number;
            nanos: number;
          };
          endOffset: {
            seconds: number;
            nanos: number;
          };
        };
      }[];
    }
  ];
  tools?: {
    functionDeclarations: {
      name: string;
      description?: string;
      parameters: unknown;
    }[];
  }[];
  safetySettings?: {
    category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | string; // Enum values for HarmCategory
    threshold:
      | 'BLOCK_NONE'
      | 'BLOCK_LOW_AND_ABOVE'
      | 'BLOCK_MED_AND_ABOVE'
      | 'BLOCK_ONLY_HIGH';
  }[];
  generationConfig: {
    temperature: number;
    topP: number;
    topK: number;
    candidateCount: number;
    maxOutputTokens: number;
    stopSequences?: string[];
  };
};

/**
 * GoogleGeminiCompletionResponse: Structure for handling responses from the Google Gemini API completion requests
 * @export
 */
export type GoogleGeminiCompletionResponse = {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
    finishReason:
      | 'FINISH_REASON_UNSPECIFIED'
      | 'FINISH_REASON_STOP'
      | 'FINISH_REASON_MAX_TOKENS'
      | 'FINISH_REASON_SAFETY'
      | 'FINISH_REASON_RECITATION'
      | 'FINISH_REASON_OTHER';
    safetyRatings: [
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | string; // Enum values for HarmCategory
        probability:
          | 'HARM_PROBABILITY_UNSPECIFIED'
          | 'NEGLIGIBLE'
          | 'LOW'
          | 'MEDIUM'
          | 'HIGH';
        blocked: boolean;
      }
    ];
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
 * GoogleGeminiEmbedRequest: Structure for making an embedding request to the Google Gemini API.
 * @export
 */
export type GoogleGeminiEmbedRequest = {
  contents: {
    role: 'USER' | 'MODEL'; // Assuming embedding might also consider the role for context
    parts: {
      // Assuming text is the primary content for embeddings as per documentation
      text: string; // The text for which embeddings are requested
      // For embedding, typically, the focus is on text, but including provisions for multimedia embedding if supported
      inlineData?: {
        mimeType: string; // MIME type of the inline data
        data: string; // Base64 encoded data
      };
      fileData?: {
        mimeType: string; // MIME type of the file data
        fileUri: string; // URI for the file data
      };
    }[];
  }[];
};

/**
 * GoogleGeminiEmbedResponse: Structure for handling responses from the Google Gemini API embedding requests.
 * @export
 */
export type GoogleGeminiEmbedResponse = {
  model: string; // Model used for generating embeddings, providing context for interpreting the embeddings
  predictions: [
    {
      embeddings: {
        values: number[]; // The embedding vector
      };
    }
  ];
};
