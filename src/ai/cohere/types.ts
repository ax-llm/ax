import type { TextModelConfig } from '../types.js';

/**
 * Cohere: Models for text generation
 * @export
 */
export enum CohereModel {
  CommandRPlus = 'command-r-plus',
  CommandR = 'command-r',
  Command = 'command',
  CommandLight = 'command-light'
}

/**
 * Cohere: Models for use in embeddings
 * @export
 */
export enum CohereEmbedModel {
  EmbedEnglishV30 = 'embed-english-v3.0',
  EmbedEnglishLightV30 = 'embed-english-light-v3.0',
  EmbedMultiLingualV30 = 'embed-multilingual-v3.0',
  EmbedMultiLingualLightV30 = 'embed-multilingual-light-v3.0'
}

/**
 * Cohere: Model options for text generation
 * @export
 */
export type CohereConfig = TextModelConfig & {
  model: CohereModel;
  embedModel: CohereEmbedModel;
};

export type CohereChatRequest = {
  message: string;
  preamble?: string;
  chat_history: { role: 'CHATBOT' | 'SYSTEM' | 'USER'; message: string }[];
  model: CohereModel | string;
  max_tokens?: number;
  temperature: number;
  k?: number;
  p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  end_sequences?: readonly string[];
  stop_sequences?: string[];
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
  tool_results?: {
    call: {
      name: string;
      parameters: object;
    };
    outputs: object[];
  }[];
};

export type CohereChatResponse = {
  generation_id: string;
  text: string;
  finish_reason:
    | 'COMPLETE'
    | 'ERROR'
    | 'ERROR_TOXIC'
    | 'ERROR_LIMIT'
    | 'USER_CANCEL'
    | 'MAX_TOKENS';
  tool_calls: {
    name: string;
    parameters: object;
  }[];
};

export type CohereEmbedRequest = {
  texts: readonly string[];
  model: CohereModel | string;
  truncate: string;
};

export type CohereEmbedResponse = {
  id: string;
  texts: string[];
  model: string;
  embeddings: number[][];
};
