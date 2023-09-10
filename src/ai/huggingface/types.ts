import { API } from '../../util/apicall';

/**
 * HuggingFace: API call details
 * @export
 */
export type HuggingFaceApiConfig = API;

export const apiURLHuggingFace = 'https://api-inference.huggingface.co/';

/**
 * HuggingFace: API types
 * @export
 */

export const enum HuggingFaceApi {
  Completion = 'models',
}

/**
 * HuggingFace: Models for text generation
 * @export
 */
export enum HuggingFaceModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf',
}

/**
 * HuggingFace: Model options for text generation
 * @export
 */
export type HuggingFaceOptions = {
  model: HuggingFaceModel;
  temperature: number;
  topP: number;
  topK?: number;
  maxNewTokens?: number;
  repetitionPenalty?: number;
  returnFullText?: boolean;
  numReturnSequences?: number;
  doSample?: boolean;
  maxTime?: number;
  useCache?: boolean;
  waitForModel?: boolean;
};

export type HuggingFaceRequest = {
  model: HuggingFaceModel.MetaLlama270BChatHF;
  inputs: string;
  parameters: {
    max_new_tokens?: number;
    repetition_penalty?: number;
    temperature: number;
    top_p: number;
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
