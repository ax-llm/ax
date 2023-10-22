import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { AITextCompletionRequest } from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfoTogether } from './info.js';
import {
  TogetherCompletionRequest,
  TogetherCompletionResponse,
  TogetherLanguageModel,
  TogetherOptions
} from './types.js';

export const TogetherDefaultOptions = (): TogetherOptions => ({
  model: TogetherLanguageModel.Llama270B,
  maxTokens: 500,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  repetitionPenalty: 1.5
});

/**
 * Together: AI Service
 * @export
 */

export class Together extends BaseAI<
  TogetherCompletionRequest,
  unknown,
  unknown,
  TogetherCompletionResponse,
  unknown,
  unknown
> {
  private options: TogetherOptions;

  constructor(
    apiKey: string,
    options: Readonly<TogetherOptions> = TogetherDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set');
    }
    super(
      'Together',
      'https://api.together.xyz/',
      { Authorization: `Bearer ${apiKey}` },
      modelInfoTogether,
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
  ): [API, TogetherCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: 'inference'
    };

    const reqValue: TogetherCompletionRequest = {
      model,
      prompt,
      max_tokens: req.modelConfig?.maxTokens ?? this.options.maxTokens,
      repetition_penalty:
        req.modelConfig?.presencePenalty ?? this.options.repetitionPenalty,
      temperature: req.modelConfig?.temperature ?? this.options.temperature,
      top_p: req.modelConfig?.topP ?? this.options.topP,
      top_k: req.modelConfig?.topK ?? this.options.topK,
      stop: this.options.stopSequences ?? config.stopSequences,
      stream_tokens: this.options.stream
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<TogetherCompletionResponse>
  ): TextResponse => {
    return {
      results: resp.output.choices.map((choice) => ({
        text: choice.text
      }))
    };
  };
}
