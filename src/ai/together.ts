import { AIPromptConfig, AIServiceOptions } from '../text/types.js';
import { API, apiCall } from '../util/apicall.js';

import { BaseAI } from './base.js';
import { TextModelConfig, TextModelInfo, TextResponse } from './types.js';

type TogetherAPI = API & {
  headers: { Authorization: string; accept: string; 'content-type': string };
};

const apiURL = 'https://api.together.xyz/';

const enum apiTypes {
  Inference = 'inference',
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

const modelInfo: TextModelInfo[] = [
  {
    name: TogetherLanguageModel.Llama27B,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama27BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
  },
  {
    name: TogetherLanguageModel.Llama213B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama213BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
  },
  {
    name: TogetherLanguageModel.Llama270B,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.Llama270BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
  },
  {
    name: TogetherChatModel.RedPajamaIncite7BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
  },
  {
    name: TogetherChatModel.GPTNeoXTChatBase20B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 2048,
  },
  {
    name: TogetherChatModel.Falcon7BInstruct,
    currency: 'usd',
    promptTokenCostPer1K: 0.006,
    completionTokenCostPer1K: 0.006,
    maxTokens: 2048,
  },
  // {
  //   id: TogetherLanguageModel.TogetherComputerMPT30BInstruct,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.LMSysVicuna7BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.000252,
  //   completionTokenCostPer1K: 0.000252,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.LMsysVicuna13BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.003,
  //   completionTokenCostPer1K: 0.003,
  //   maxTokens: 2048,
  // },
  // {
  //   id: TogetherChatModel.MosaiclMPT7BChat,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.001,
  //   completionTokenCostPer1K: 0.001,
  //   maxTokens: 2048,
  // },

  // {
  //   id: TogetherChatModel.TatsuLabAlpaca7BWdiff,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  // },
];

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

export const TogetherDefaultOptions = (): TogetherOptions => ({
  model: TogetherLanguageModel.Llama270B,
  maxTokens: 1000,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  repetitionPenalty: 1.5,
});

type TogetherRequest = {
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

type TogetherAITextResponse = {
  status: string;
  prompt: string[];
  model: string;
  model_owner: string;
  tags: Record<string, unknown>;
  num_returns: number;
  args: TogetherRequest;
  subjobs: string[];
  output: {
    choices: { finish_reason: string; index: number; text: string }[];
    raw_compute_time: number;
    result_type: string;
  };
};

const generateReq = (
  prompt: string,
  opt: Readonly<TogetherOptions>,
  stopSequences?: readonly string[]
): TogetherRequest => ({
  stream_tokens: opt.stream,
  model: opt.model,
  prompt,
  max_tokens: opt.maxTokens,
  stop: stopSequences,
  temperature: opt.temperature,
  top_p: opt.topP,
  top_k: opt.topK,
  repetition_penalty: opt.repetitionPenalty,
});

export class Together extends BaseAI {
  private apiKey: string;
  private options: TogetherOptions;

  constructor(
    apiKey: string,
    options: Readonly<TogetherOptions> = TogetherDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Together',
      modelInfo,
      {
        model: options.model as string,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Together API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stream: options.stream,
    } as TextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<TextResponse> {
    const res = await apiCall<
      TogetherAPI,
      TogetherRequest,
      TogetherAITextResponse
    >(
      {
        key: this.apiKey,
        name: apiTypes.Inference,
        url: apiURL,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
      },
      generateReq(prompt, this.options, options?.stopSequences)
    );

    const {
      output: { choices },
    } = res;

    return {
      results: choices.map((v) => ({
        text: v.text,
        finishReason: v.finish_reason,
      })),
    };
  }
}
