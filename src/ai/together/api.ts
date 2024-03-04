import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import { AITextCompletionRequest } from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { TextModelConfig, TextResponse } from '../types.js';

import { modelInfo } from './info.js';
import {
  TogetherCompletionRequest,
  TogetherCompletionResponse,
  TogetherConfig
} from './types.js';

export const TogetherDefaultConfig = (): TogetherConfig => ({
  model: 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO',
  maxTokens: 500,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  repetitionPenalty: 1.5
});

export interface TogetherArgs {
  apiKey: string;
  config?: Readonly<TogetherConfig>;
  options?: Readonly<AIServiceOptions>;
}

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
  unknown,
  unknown,
  unknown
> {
  private config: TogetherConfig;

  constructor({
    apiKey,
    config = TogetherDefaultConfig(),
    options
  }: Readonly<TogetherArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Together API key not set');
    }
    super(
      'Together',
      'https://api.together.xyz/',
      { Authorization: `Bearer ${apiKey}` },
      modelInfo,
      { model: config.model as string },
      options
    );
    this.config = config;
  }

  getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, TogetherCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
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
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      repetition_penalty:
        req.modelConfig?.presencePenalty ?? this.config.repetitionPenalty,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP,
      top_k: req.modelConfig?.topK ?? this.config.topK,
      stop: this.config.stopSequences ?? config.stopSequences,
      stream_tokens: this.config.stream
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
