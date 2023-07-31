import {
  AIPromptConfig,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../text/types.js';

import { BaseAI } from './base.js';
import { API, apiCall } from './util.js';

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
    id: TogetherLanguageModel.Llama27B,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.Llama27BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherLanguageModel.Llama213B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.Llama213BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherLanguageModel.Llama270B,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.Llama270BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4000,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.RedPajamaIncite7BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.GPTNeoXTChatBase20B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.Falcon7BInstruct,
    currency: 'usd',
    promptTokenCostPer1K: 0.006,
    completionTokenCostPer1K: 0.006,
    maxTokens: 2048,
    oneTPM: 1,
  },
  // {
  //   id: TogetherLanguageModel.TogetherComputerMPT30BInstruct,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  //   oneTPM: 1,
  // },
  // {
  //   id: TogetherChatModel.LMSysVicuna7BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.000252,
  //   completionTokenCostPer1K: 0.000252,
  //   maxTokens: 2048,
  //   oneTPM: 1,
  // },
  // {
  //   id: TogetherChatModel.LMsysVicuna13BDeltaV11,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.003,
  //   completionTokenCostPer1K: 0.003,
  //   maxTokens: 2048,
  //   oneTPM: 1,
  // },
  // {
  //   id: TogetherChatModel.MosaiclMPT7BChat,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.001,
  //   completionTokenCostPer1K: 0.001,
  //   maxTokens: 2048,
  //   oneTPM: 1,
  // },

  // {
  //   id: TogetherChatModel.TatsuLabAlpaca7BWdiff,
  //   currency: 'usd',
  //   promptTokenCostPer1K: 0.006,
  //   completionTokenCostPer1K: 0.006,
  //   maxTokens: 2048,
  //   oneTPM: 1,
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

type TogetherGenerateRequest = {
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

type TogetherAIGenerateTextResponse = {
  status: string;
  prompt: string[];
  model: string;
  model_owner: string;
  tags: Record<string, unknown>;
  num_returns: number;
  args: TogetherGenerateRequest;
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
): TogetherGenerateRequest => ({
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
    options: Readonly<TogetherOptions> = TogetherDefaultOptions()
  ) {
    super('Together', modelInfo, {
      model: options.model as string,
    });

    if (apiKey === '') {
      throw new Error('Together API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): GenerateTextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stream: options.stream,
    } as GenerateTextModelConfig;
  }

  async generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<GenerateTextResponse> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `Together model information not found: ${this.options.model}`
      );
    }

    const res = await apiCall<
      TogetherAPI,
      TogetherGenerateRequest,
      TogetherAIGenerateTextResponse
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
      generateReq(prompt, this.options, md?.stopSequences)
    );

    const {
      output: { choices },
    } = res;

    return {
      sessionID,
      results: choices.map((v) => ({
        text: v.text,
        finishReason: v.finish_reason,
      })),
    };
  }
}
