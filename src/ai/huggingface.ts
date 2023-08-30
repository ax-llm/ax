import {
  AIPromptConfig,
  AIServiceOptions,
  GenerateTextModelConfig,
  GenerateTextResponse,
  TextModelInfo,
} from '../text/types.js';

import { API, apiCall } from '../util/apicall.js';
import { BaseAI } from './base.js';

/**
 * HuggingFace: API call details
 * @export
 */
export type HuggingFaceAPI = API;

const apiURL = 'https://api-inference.huggingface.co/';

/**
 * HuggingFace: API types
 * @export
 */

const enum apiType {
  Generate = 'models',
}

/**
 * HuggingFace: Models for text generation
 * @export
 */
export enum HuggingFaceGenerateModel {
  MetaLlama270BChatHF = 'meta-llama/Llama-2-70b-chat-hf',
}

/**
 * HuggingFace: Model information
 * @export
 */
export const HuggingFaceModelInfo: TextModelInfo[] = [
  {
    name: HuggingFaceGenerateModel.MetaLlama270BChatHF,
    currency: 'usd',
    promptTokenCostPer1K: 0.0,
    completionTokenCostPer1K: 0.0,
    maxTokens: 4000,
  },
];

/**
 * HuggingFace: Model options for text generation
 * @export
 */
export type HuggingFaceOptions = {
  model: HuggingFaceGenerateModel;
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

/**
 * HuggingFace: Default Model options for text generation
 * @export
 */
export const HuggingFaceDefaultOptions = (): HuggingFaceOptions => ({
  model: HuggingFaceGenerateModel.MetaLlama270BChatHF,
  maxNewTokens: 1000,
  temperature: 0,
  topP: 1,
});

/**
 * HuggingFace: Default model options for more creative text generation
 * @export
 */
export const HuggingFaceCreativeOptions = (): HuggingFaceOptions => ({
  ...HuggingFaceDefaultOptions(),
  model: HuggingFaceGenerateModel.MetaLlama270BChatHF,
  temperature: 0.9,
});

type HuggingFaceGenerateRequest = {
  model: HuggingFaceGenerateModel.MetaLlama270BChatHF;
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

type HuggingFaceGenerateTextResponse = {
  generated_text: string;
};

const generateReq = (
  prompt: string,
  opt: Readonly<HuggingFaceOptions>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _stopSequences: readonly string[]
): HuggingFaceGenerateRequest => {
  return {
    model: opt.model,
    inputs: prompt,
    parameters: {
      max_new_tokens: opt.maxNewTokens,
      repetition_penalty: opt.repetitionPenalty,
      temperature: opt.temperature,
      top_p: opt.topP,
      top_k: opt.topK,
      return_full_text: opt.returnFullText,
      num_return_sequences: opt.numReturnSequences,
      do_sample: opt.doSample,
      max_time: opt.maxTime,
    },
    options: {
      use_cache: opt.useCache,
      wait_for_model: opt.waitForModel,
    },
  };
};

/**
 * HuggingFace: AI Service
 * @export
 */
export class HuggingFace extends BaseAI {
  private apiKey: string;
  private options: HuggingFaceOptions;

  constructor(
    apiKey: string,
    options: Readonly<HuggingFaceOptions> = HuggingFaceDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Hugging Face',
      HuggingFaceModelInfo,
      {
        model: options.model,
      },
      otherOptions
    );

    if (apiKey === '') {
      throw new Error('Hugging Face API key not set');
    }
    this.apiKey = apiKey;
    this.options = options;
  }

  getModelConfig(): GenerateTextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxNewTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
    } as GenerateTextModelConfig;
  }

  async _generate(
    prompt: string,
    options?: Readonly<AIPromptConfig>
  ): Promise<GenerateTextResponse> {
    const res = await apiCall<
      HuggingFaceAPI,
      HuggingFaceGenerateRequest,
      HuggingFaceGenerateTextResponse
    >(
      this.createAPI(apiType.Generate),
      generateReq(prompt, this.options, options?.stopSequences ?? [])
    );

    return {
      results: [{ text: res.generated_text }],
    };
  }

  private createAPI(name: apiType): HuggingFaceAPI {
    return {
      url: new URL(`${name}/${this.options.model}`, apiURL).href,
      key: this.apiKey,
      name,
    };
  }
}
