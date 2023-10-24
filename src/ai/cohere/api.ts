import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import {
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoCohere } from './info.js';
import {
  CohereCompletionRequest,
  CohereCompletionResponse,
  CohereEmbedModel,
  CohereEmbedRequest,
  CohereEmbedResponse,
  CohereModel,
  CohereOptions
} from './types.js';

/**
 * Cohere: Default Model options for text generation
 * @export
 */
export const CohereDefaultOptions = (): CohereOptions => ({
  model: CohereModel.CommandNightly,
  embedModel: CohereEmbedModel.EmbedEnglishLightV20,
  maxTokens: 500,
  temperature: 0.1,
  topK: 40,
  topP: 0.9,
  frequencyPenalty: 0.8,
  logitBias: new Map([
    ['98', 9],
    ['5449', 9]
  ])
});

/**
 * Cohere: Default model options for more creative text generation
 * @export
 */
export const CohereCreativeOptions = (): CohereOptions => ({
  ...CohereDefaultOptions(),
  temperature: 0.7,
  logitBias: undefined
});

/**
 * Cohere: AI Service
 * @export
 */
export class Cohere extends BaseAI<
  CohereCompletionRequest,
  unknown,
  CohereEmbedRequest,
  CohereCompletionResponse,
  unknown,
  unknown,
  unknown,
  CohereEmbedResponse
> {
  private options: CohereOptions;

  constructor(
    apiKey: string,
    options: Readonly<CohereOptions> = CohereDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    super(
      'Cohere',
      'https://api.cohere.ai',
      { Authorization: `Bearer ${apiKey}` },
      modelInfoCohere,
      { model: options.model },
      otherOptions
    );
    this.options = options;
  }

  override getModelConfig(): TextModelConfig {
    const { options } = this;
    return {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      endSequences: options.endSequences,
      stopSequences: options.stopSequences,
      returnLikelihoods: options.returnLikelihoods,
      logitBias: options.logitBias
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, CohereCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: '/v1/generate'
    };

    const reqValue: CohereCompletionRequest = {
      model,
      prompt,
      max_tokens: req.modelConfig?.maxTokens ?? this.options.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.options.temperature,
      k: req.modelConfig?.topK ?? this.options.topK,
      p: req.modelConfig?.topP ?? this.options.topP,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.options.frequencyPenalty,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.options.presencePenalty,
      end_sequences: this.options.endSequences,
      stop_sequences: this.options.stopSequences ?? config.stopSequences,
      return_likelihoods: this.options.returnLikelihoods,
      logit_bias: this.options.logitBias
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, CohereEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.options.embedModel;

    const apiConfig = {
      name: '/v1/embed'
    };

    const reqValue = {
      model,
      texts: req.texts ?? [],
      truncate: this.options.truncate ?? ''
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<CohereCompletionResponse>
  ): TextResponse => {
    return {
      results: resp.generations.map((generation) => ({
        text: generation.text
      }))
    };
  };

  generateEmbedResp = (resp: Readonly<CohereEmbedResponse>): EmbedResponse => {
    return {
      remoteId: resp.id,
      embeddings: resp.embeddings
    };
  };
}
