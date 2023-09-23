import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { apiCall } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoTogether } from './info.js';
import { generateReq } from './req.js';
import {
  apiURLTogether,
  TogetherApi,
  TogetherCompletionRequest,
  TogetherCompletionResponse,
  TogetherLanguageModel,
  TogetherOptions,
} from './types.js';

export const TogetherDefaultOptions = (): TogetherOptions => ({
  model: TogetherLanguageModel.Llama270B,
  maxTokens: 1000,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  repetitionPenalty: 1.5,
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
      modelInfoTogether,
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
      TogetherCompletionRequest,
      TogetherCompletionResponse
    >(
      {
        key: this.apiKey,
        name: TogetherApi.Completion,
        url: apiURLTogether,
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
