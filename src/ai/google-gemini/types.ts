/**
 * apiURLGoogleGemini: Base URL for Google Gemini API calls
 * @export
 */

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

export type GoogleGeminiPart = {
  text?: string;
  function_call?: {
    name: string;
    args: object;
  };
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
  parameters?: object;
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
  embedModel: GoogleGeminiEmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  stopSequences: string[];
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
