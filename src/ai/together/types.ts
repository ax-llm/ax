export const apiURLTogether = 'https://api.together.xyz/';

export const enum TogetherApi {
  Completion = 'inference',
}

/**
 * Together: Models for text generation
 * @export
 */
export enum TogetherChatModel {
  Llama27BChat = 'togethercomputer/llama-2-7b-chat',
  Llama213BChat = 'togethercomputer/llama-2-13b-chat',
  Llama270BChat = 'togethercomputer/llama-2-70b-chat',

  RedPajamaIncite7BChat = 'togethercomputer/RedPajama-INCITE-7B-Chat',
  GPTNeoXTChatBase20B = 'togethercomputer/GPT-NeoXT-Chat-Base-20B',
  // LMSysVicuna7BDeltaV11 = 'lmsys/vicuna-7b-delta-v1.1',
  // LMsysVicuna13BDeltaV11 = 'lmsys/vicuna-13b-delta-v1.1',
  // MosaiclMPT7BChat = 'mosaicml/mpt-7b-chat',
  // MosaiclMPT30BChat = 'togethercomputer/mpt-30b-chat',
  // TatsuLabAlpaca7BWdiff = 'tatsu-lab/alpaca-7b-wdiff',
  Falcon7BInstruct = 'togethercomputer/falcon-7b-instruct',
}

export enum TogetherLanguageModel {
  Llama27B = 'togethercomputer/llama-2-7b',
  Llama213B = 'togethercomputer/llama-2-13b',
  Llama270B = 'togethercomputer/llama-2-70b',
  // TogetherComputerMPT30BInstruct = 'togethercomputer/mpt-30b-instruct',
}
// TogetherComputerRedPajamaInciteInstruct3BV1 = 'togethercomputer/RedPajama-INCITE-Instruct-3B-v1',
// TogetherComputerRedPajamaIncite7BInstruct = 'togethercomputer/RedPajama-INCITE-7B-Instruct',
// TogetherComputerGPTJT6BV1 = 'togethercomputer/GPT-JT-6B-v1',
// GoogleFlanT5XL = 'google/flan-t5-xl',
// GoogleFlanT5XXL = 'google/flan-t5-xxl',
// MosaicmlMPT7B = 'mosaicml/mpt-7b',
// MosaicmlMPT7BInstruct = 'mosaicml/mpt-7b-instruct',
// TIIUAEFalcon7B = 'tiiuae/falcon-7b',
// TIIUAEFalcon40B = 'tiiuae/falcon-40b',

export enum TogetherCodeModel {}
// SalesforceCodeGen27B = 'Salesforce/codegen2-7B',
// SalesforceCodeGen216B = 'Salesforce/codegen2-16B',

export type TogetherCompletionRequest = {
  model: TogetherChatModel | TogetherLanguageModel | TogetherCodeModel | string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  logprobs?: number;
  stop?: readonly string[];
  stream_tokens?: boolean;
};

export type TogetherCompletionResponse = {
  status: string;
  prompt: string[];
  model: string;
  model_owner: string;
  tags: Record<string, unknown>;
  num_returns: number;
  args: TogetherCompletionRequest;
  subjobs: string[];
  output: {
    choices: { finish_reason: string; index: number; text: string }[];
    raw_compute_time: number;
    result_type: string;
  };
};

export type TogetherOptions = {
  model: TogetherChatModel | TogetherLanguageModel | TogetherCodeModel | string;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK?: number;
  repetitionPenalty?: number;
  stopSequences?: string[];
  stream?: boolean;
};
