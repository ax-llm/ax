import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { apiCall } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoAnthropic } from './info.js';
import { generateReq } from './req.js';
import {
  AnthropicApi,
  AnthropicApiConfig,
  AnthropicCompletionRequest,
  AnthropicCompletionResponse,
  AnthropicModel,
  AnthropicOptions,
  apiURLAnthropic,
} from './types.js';

/**
 * Anthropic: Default Model options for text generation
 * @export
 */
export const AnthropicDefaultOptions = (): AnthropicOptions => ({
  model: AnthropicModel.Claude2,
  maxTokens: 1000,
  temperature: 0,
  topP: 1,
});

/**
 * Anthropic: AI Service
 * @export
 */
export class Anthropic extends BaseAI {
  private apiKey: string;
  private options: AnthropicOptions;

  constructor(
    apiKey: string,
    options: Readonly<AnthropicOptions> = AnthropicDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    super(
      'Anthropic',
      modelInfoAnthropic,
      {
        model: options.model,
      },
      otherOptions
    );

    if (!apiKey || apiKey === '') {
      throw new Error('Anthropic API key not set');
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
      AnthropicCompletionRequest,
      AnthropicCompletionResponse,
      AnthropicApiConfig
    >(
      {
        key: this.apiKey,
        name: AnthropicApi.Completion,
        url: apiURLAnthropic,
        headers: { 'Anthropic-Version': '2023-06-01' },
      },
      generateReq(prompt, this.options, options?.stopSequences)
    );

    const { completion: text, stop_reason: finishReason } = res;
    return { results: [{ text, finishReason: finishReason ?? '' }] };
  }
}
