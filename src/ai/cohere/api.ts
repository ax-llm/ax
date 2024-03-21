import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoCohere } from './info.js';
import {
  type CohereCompletionRequest,
  type CohereCompletionResponse,
  type CohereConfig,
  CohereEmbedModel,
  type CohereEmbedRequest,
  type CohereEmbedResponse,
  CohereModel
} from './types.js';

/**
 * Cohere: Default Model config for text generation
 * @export
 */
export const CohereDefaultConfig = (): CohereConfig => ({
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
 * Cohere: Default model config for more creative text generation
 * @export
 */
export const CohereCreativeConfig = (): CohereConfig => ({
  ...CohereDefaultConfig(),
  temperature: 0.7,
  logitBias: undefined
});

export interface CohereArgs {
  apiKey: string;
  config: Readonly<CohereConfig>;
  options?: Readonly<AIServiceOptions>;
}

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
  private config: CohereConfig;

  constructor({
    apiKey,
    config = CohereDefaultConfig(),
    options
  }: Readonly<CohereArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }
    super({
      name: 'Cohere',
      apiURL: 'https://api.cohere.ai',
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoCohere,
      models: { model: config.model },
      supportFor: { functions: false },
      options
    });
    this.config = config;
  }

  override getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      endSequences: config.endSequences,
      stopSequences: config.stopSequences,
      returnLikelihoods: config.returnLikelihoods,
      logitBias: config.logitBias
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    config: Readonly<AIPromptConfig>
  ): [API, CohereCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
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
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      k: req.modelConfig?.topK ?? this.config.topK,
      p: req.modelConfig?.topP ?? this.config.topP,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      end_sequences: this.config.endSequences,
      stop_sequences: this.config.stopSequences ?? config.stopSequences,
      return_likelihoods: this.config.returnLikelihoods,
      logit_bias: this.config.logitBias
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, CohereEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    const apiConfig = {
      name: '/v1/embed'
    };

    const reqValue = {
      model,
      texts: req.texts ?? [],
      truncate: this.config.truncate ?? ''
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<CohereCompletionResponse>
  ): TextResponse => {
    return {
      results: resp.generations.map((generation) => ({
        content: generation.text
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
