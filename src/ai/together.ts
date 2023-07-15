import {
  AIGenerateTextResponse,
  AIPromptConfig,
  AIService,
  EmbedResponse,
  TextModelInfo,
} from '../text/types.js';

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
  TogetherComputerRedPajamaInciteChat3BV1 = 'togethercomputer/RedPajama-INCITE-Chat-3B-v1',
  TogetherComputerRedPajamaIncite7BChat = 'togethercomputer/RedPajama-INCITE-7B-Chat',
  TogetherComputerGPTNeoXTChatBase20B = 'togethercomputer/GPT-NeoXT-Chat-Base-20B',
  LMSysVicuna7BDeltaV11 = 'lmsys/vicuna-7b-delta-v1.1',
  LMsysVicuna13BDeltaV11 = 'lmsys/vicuna-13b-delta-v1.1',
  MosaiclMPT7BChat = 'mosaicml/mpt-7b-chat',
  MosaiclMPT30BChat = 'mosaicml/mpt-30b-chat',
  TatsuLabAlpaca7BWdiff = 'tatsu-lab/alpaca-7b-wdiff',
}

export enum TogetherLanguageModel {}
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
    id: TogetherChatModel.TogetherComputerRedPajamaInciteChat3BV1,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.TogetherComputerRedPajamaIncite7BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.TogetherComputerGPTNeoXTChatBase20B,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.LMSysVicuna7BDeltaV11,
    currency: 'usd',
    promptTokenCostPer1K: 0.000252,
    completionTokenCostPer1K: 0.000252,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.LMsysVicuna13BDeltaV11,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.003,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.MosaiclMPT7BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.MosaiclMPT30BChat,
    currency: 'usd',
    promptTokenCostPer1K: 0.006,
    completionTokenCostPer1K: 0.006,
    maxTokens: 2048,
    oneTPM: 1,
  },
  {
    id: TogetherChatModel.TatsuLabAlpaca7BWdiff,
    currency: 'usd',
    promptTokenCostPer1K: 0.006,
    completionTokenCostPer1K: 0.006,
    maxTokens: 2048,
    oneTPM: 1,
  },
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
  model: TogetherChatModel.TogetherComputerRedPajamaInciteChat3BV1,
  maxTokens: 1000,
  temperature: 0,
  topP: 1,
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

export class Together implements AIService {
  private apiKey: string;
  private options: TogetherOptions;

  constructor(
    apiKey: string,
    options: Readonly<TogetherOptions> = TogetherDefaultOptions()
  ) {
    if (apiKey === '') {
      throw new Error('Together API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  name(): string {
    return 'Together';
  }

  generate(
    prompt: string,
    md?: Readonly<AIPromptConfig>,
    sessionID?: string
  ): Promise<AIGenerateTextResponse<string>> {
    const model = modelInfo.find((v) => v.id === this.options.model);
    if (!model) {
      throw new Error(
        `Together model information not found: ${this.options.model}`
      );
    }

    prompt = prompt.trim();
    const res = apiCall<
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

    return res.then(({ output: { choices } }) => ({
      id: '',
      sessionID,
      query: prompt,
      values: choices.map((v) => ({ id: '', text: v.text.trim() })),
      usage: [{ model }],
      value() {
        return (this as { values: { text: string }[] }).values[0].text;
      },
    }));
  }

  embed(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _texts: readonly string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sessionID?: string
  ): Promise<EmbedResponse> {
    throw new Error('Method not implemented.');
  }
}
