import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { AITextCompletionRequest } from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoAnthropic } from './info.js';
import {
  AnthropicCompletionRequest,
  AnthropicCompletionResponse,
  AnthropicModel,
  AnthropicOptions
} from './types.js';

/**
 * Anthropic: Default Model options for text generation
 * @export
 */
export const AnthropicDefaultOptions = (): AnthropicOptions => ({
  model: AnthropicModel.Claude2,
  maxTokens: 500,
  temperature: 0,
  topP: 1
});

export class Anthropic extends BaseAI<
  AnthropicCompletionRequest,
  unknown,
  unknown,
  AnthropicCompletionResponse,
  unknown,
  unknown,
  unknown,
  unknown
> {
  private options: AnthropicOptions;

  constructor(
    apiKey: string,
    options: Readonly<AnthropicOptions> = AnthropicDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('Anthropic API key not set');
    }
    super(
      'Together',
      'https://api.anthropic.com/',
      { 'Anthropic-Version': '2023-06-01', Authorization: `Bearer ${apiKey}` },
      modelInfoAnthropic,
      { model: options.model as string },
      otherOptions
    );

    this.options = options;
  }

  getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      stream: options.stream
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,

    config: Readonly<AIPromptConfig>
  ): [API, AnthropicCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: 'v1/complete'
    };

    const reqValue: AnthropicCompletionRequest = {
      model,
      prompt,
      max_tokens_to_sample:
        req.modelConfig?.maxTokens ?? this.options.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.options.temperature,
      top_p: req.modelConfig?.topP ?? this.options.topP,
      top_k: req.modelConfig?.topK ?? this.options.topK,
      stop_sequences: this.options.stopSequences ?? config.stopSequences,
      stream: this.options.stream
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<AnthropicCompletionResponse>
  ): TextResponse => {
    return {
      results: [
        {
          text: resp.completion
        }
      ]
    };
  };
}
