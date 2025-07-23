import type { AxModelConfig } from '../types.js';

/**
 * Defines the available Cohere models for text generation.
 */
export enum AxAICohereModel {
  CommandRPlus = 'command-r-plus',
  CommandR = 'command-r',
  Command = 'command',
  CommandLight = 'command-light',
}

/**
 * Defines the available Cohere models for use in embeddings.
 */
export enum AxAICohereEmbedModel {
  EmbedEnglishV30 = 'embed-english-v3.0',
  EmbedEnglishLightV30 = 'embed-english-light-v3.0',
  EmbedMultiLingualV30 = 'embed-multilingual-v3.0',
  EmbedMultiLingualLightV30 = 'embed-multilingual-light-v3.0',
}

/**
 * Represents the configuration for the Cohere AI service.
 */
export type AxAICohereConfig = AxModelConfig & {
  /** The model to use. */
  model: AxAICohereModel;
  /** The embedding model to use. */
  embedModel?: AxAICohereEmbedModel;
};

/**
 * Represents the tool calls in a chat response from the Cohere AI service.
 */
export type AxAICohereChatResponseToolCalls = {
  name: string;
  parameters?: object;
}[];

/**
 * Represents the tool results in a chat request to the Cohere AI service.
 */
export type AxAICohereChatRequestToolResults = {
  call: AxAICohereChatResponseToolCalls[0];
  outputs: object[];
}[];

/**
 * Represents a chat request to the Cohere AI service.
 */
export type AxAICohereChatRequest = {
  /** The message to send. */
  message?: string;
  /** The preamble to the chat. */
  preamble?: string;
  /** The chat history. */
  chat_history: (
    | {
        role: 'CHATBOT';
        message: string;
        tool_calls?: AxAICohereChatResponseToolCalls;
      }
    | {
        role: 'SYSTEM';
        message: string;
      }
    | {
        role: 'USER';
        message: string;
      }
    | {
        role: 'TOOL';
        message?: string;
        tool_results: AxAICohereChatRequestToolResults;
      }
  )[];

  /** The model to use. */
  model: AxAICohereModel;
  /** The maximum number of tokens to generate. */
  max_tokens?: number;
  /** The temperature of the sampling. */
  temperature?: number;
  /** The top-k value of the sampling. */
  k?: number;
  /** The top-p value of the sampling. */
  p?: number;
  /** The frequency penalty. */
  frequency_penalty?: number;
  /** The presence penalty. */
  presence_penalty?: number;
  /** An array of end sequences. */
  end_sequences?: readonly string[];
  /** An array of stop sequences. */
  stop_sequences?: string[];
  /** The tools that the AI can use. */
  tools?: {
    name: string;
    description: string;
    parameter_definitions: Record<
      string,
      {
        description: string;
        type: string;
        required: boolean;
      }
    >;
  }[];
  /** The tool results. */
  tool_results?: AxAICohereChatRequestToolResults;
};

/**
 * Represents a chat response from the Cohere AI service.
 */
export type AxAICohereChatResponse = {
  /** The ID of the response. */
  response_id: string;
  /** The metadata of the response. */
  meta: {
    billed_units: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  /** The ID of the generation. */
  generation_id: string;
  /** The text of the response. */
  text: string;
  /** The reason the response finished. */
  finish_reason:
    | 'COMPLETE'
    | 'ERROR'
    | 'ERROR_TOXIC'
    | 'ERROR_LIMIT'
    | 'USER_CANCEL'
    | 'MAX_TOKENS';
  /** The tool calls in the response. */
  tool_calls: AxAICohereChatResponseToolCalls;
};

/**
 * Represents a delta in a streaming chat response from the Cohere AI service.
 */
export type AxAICohereChatResponseDelta = AxAICohereChatResponse & {
  /** The type of the event. */
  event_type:
    | 'stream-start'
    | 'text-generation'
    | 'tool-calls-generation'
    | 'stream-end';
};

/**
 * Represents an embedding request to the Cohere AI service.
 */
export type AxAICohereEmbedRequest = {
  /** The texts to embed. */
  texts: readonly string[];
  /** The embedding model to use. */
  model: AxAICohereEmbedModel;
  /** The truncation strategy to use. */
  truncate: string;
};

/**
 * Represents an embedding response from the Cohere AI service.
 */
export type AxAICohereEmbedResponse = {
  /** The ID of the response. */
  id: string;
  /** The texts that were embedded. */
  texts: string[];
  /** The model used for the embedding. */
  model: AxAICohereEmbedModel;
  /** The embeddings. */
  embeddings: number[][];
};
