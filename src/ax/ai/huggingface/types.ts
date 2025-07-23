import type { AxModelConfig } from '../types.js';

/**
 * Defines the available Hugging Face models.
 */
export enum AxAIHuggingFaceModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf',
}

/**
 * Represents the configuration for the Hugging Face AI service.
 */
export type AxAIHuggingFaceConfig = AxModelConfig & {
  /** The model to use. */
  model: AxAIHuggingFaceModel;
  /** Whether to return the full text or only the generated text. */
  returnFullText?: boolean;
  /** Whether to use sampling. */
  doSample?: boolean;
  /** The maximum time to wait for the model to generate a response. */
  maxTime?: number;
  /** Whether to use the cache. */
  useCache?: boolean;
  /** Whether to wait for the model to be ready. */
  waitForModel?: boolean;
};

/**
 * Represents a request to the Hugging Face AI service.
 */
export type AxAIHuggingFaceRequest = {
  /** The model to use. */
  model: AxAIHuggingFaceModel;
  /** The input text. */
  inputs: string;
  /** The parameters for the request. */
  parameters: {
    max_new_tokens?: number;
    repetition_penalty?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    return_full_text?: boolean;
    num_return_sequences?: number;
    do_sample?: boolean;
    max_time?: number;
  };
  /** The options for the request. */
  options?: {
    use_cache?: boolean;
    wait_for_model?: boolean;
  };
};

/**
 * Represents a response from the Hugging Face AI service.
 */
export type AxAIHuggingFaceResponse = {
  /** The generated text. */
  generated_text: string;
};
