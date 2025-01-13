import type { AxModelConfig } from '../types.js'

export enum AxAIHuggingFaceModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf',
}

export type AxAIHuggingFaceConfig = AxModelConfig & {
  model: AxAIHuggingFaceModel
  returnFullText?: boolean
  doSample?: boolean
  maxTime?: number
  useCache?: boolean
  waitForModel?: boolean
}

export type AxAIHuggingFaceRequest = {
  model: AxAIHuggingFaceModel | string
  inputs: string
  parameters: {
    max_new_tokens?: number
    repetition_penalty?: number
    temperature?: number
    top_p?: number
    top_k?: number
    return_full_text?: boolean
    num_return_sequences?: number
    do_sample?: boolean
    max_time?: number
  }
  options?: {
    use_cache?: boolean
    wait_for_model?: boolean
  }
}

export type AxAIHuggingFaceResponse = {
  generated_text: string
}
