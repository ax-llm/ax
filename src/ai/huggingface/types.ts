import type { AxModelConfig } from '../types.js';

export enum AxHuggingFaceModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf'
}

export type AxHuggingFaceConfig = AxModelConfig & {
  model: AxHuggingFaceModel;
  returnFullText?: boolean;
  doSample?: boolean;
  maxTime?: number;
  useCache?: boolean;
  waitForModel?: boolean;
};

export type AxHuggingFaceRequest = {
  model: AxHuggingFaceModel | string;
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

export type AxHuggingFaceResponse = {
  generated_text: string;
};
