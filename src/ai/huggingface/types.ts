import type { TextModelConfig } from '../types.js';

/**
 * HuggingFace: Models for text generation
 * @export
 */
export enum HuggingFaceModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf'
}

/**
 * HuggingFace: Model options for text generation
 * @export
 */
export type HuggingFaceConfig = TextModelConfig & {
  model: HuggingFaceModel;
  returnFullText?: boolean;
  doSample?: boolean;
  maxTime?: number;
  useCache?: boolean;
  waitForModel?: boolean;
};

export type HuggingFaceRequest = {
  model: HuggingFaceModel | string;
  inputs: string;
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
  options?: {
    use_cache?: boolean;
    wait_for_model?: boolean;
  };
};

export type HuggingFaceResponse = {
  generated_text: string;
};
