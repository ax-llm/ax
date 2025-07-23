import type { AxModelConfig } from '../types.js';

/**
 * Defines the available Reka models.
 */
export enum AxAIRekaModel {
  RekaCore = 'reka-core',
  RekaFlash = 'reka-flash',
  RekaEdge = 'reka-edge',
}

/**
 * Represents the configuration for the Reka AI service.
 */
export type AxAIRekaConfig = Omit<AxModelConfig, 'topK'> & {
  /** The model to use. */
  model: AxAIRekaModel;
  /** An array of stop sequences. */
  stop?: readonly string[];
  /** Whether to use the search engine. */
  useSearchEngine?: boolean;
};

/**
 * Represents the token usage of a request.
 */
export type AxAIRekaUsage = {
  /** The number of input tokens. */
  input_tokens: number;
  /** The number of output tokens. */
  output_tokens: number;
};

/**
 * Represents a chat request to the Reka AI service.
 */
export type AxAIRekaChatRequest = {
  /** The model to use. */
  model: string;
  /** The messages in the chat. */
  messages: (
    | {
        role: 'user';
        content:
          | string
          | {
              type: 'text';
              text: string;
            }[];
      }
    | {
        role: 'assistant';
        content:
          | string
          | {
              type: 'text';
              text: string;
            }[];
      }
  )[];
  /** The token usage of the request. */
  usage?: AxAIRekaUsage;
  /** The format of the response. */
  response_format?: { type: string };
  /** The maximum number of tokens to generate. */
  max_tokens?: number;
  /** The temperature of the sampling. */
  temperature?: number;
  /** The top-p value of the sampling. */
  top_p?: number;
  /** The top-k value of the sampling. */
  top_k?: number;
  /** Whether to stream the response. */
  stream?: boolean;
  /** An array of stop sequences. */
  stop?: readonly string[];
  /** The presence penalty. */
  presence_penalty?: number;
  /** The frequency penalty. */
  frequency_penalty?: number;
  /** Whether to use the search engine. */
  use_search_engine?: boolean;
};

/**
 * Represents a chat response from the Reka AI service.
 */
export type AxAIRekaChatResponse = {
  /** The ID of the response. */
  id: string;
  /** The model used for the response. */
  model: string;
  /** The responses. */
  responses: {
    message: {
      content:
        | string
        | {
            type: 'text';
            text: string;
          };
    };
    finish_reason: 'stop' | 'length' | 'context';
  }[];
  /** The token usage of the response. */
  usage?: AxAIRekaUsage;
};

/**
 * Represents a delta in a streaming chat response from the Reka AI service.
 */
export type AxAIRekaChatResponseDelta = {
  /** The ID of the response. */
  id: string;
  /** The model used for the response. */
  model: string;
  /** The responses. */
  responses: {
    chunk: AxAIRekaChatResponse['responses'][0]['message'];
    finish_reason: AxAIRekaChatResponse['responses'][0]['finish_reason'];
  }[];
  /** The token usage of the response. */
  usage?: AxAIRekaUsage;
};
