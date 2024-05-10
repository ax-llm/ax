import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGooglePalm2 } from './info.js';
import {
  apiURLGooglePalm2,
  type GooglePalm2ChatRequest,
  type GooglePalm2ChatResponse,
  type GooglePalm2Config,
  GooglePalm2EmbedModels,
  type GooglePalm2EmbedRequest,
  type GooglePalm2EmbedResponse,
  GooglePalm2Model
} from './types.js';

/**
 * GooglePalm2: Default Model options for text generation
 * @export
 */
export const GooglePalm2DefaultOptions = (): GooglePalm2Config => ({
  model: GooglePalm2Model.PaLMTextBison,
  embedModel: GooglePalm2EmbedModels.PaLMTextEmbeddingGecko,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1,
  topK: 40
});

/**
 * GooglePalm2: Default model options for more creative text generation
 * @export
 */
export const GooglePalm2CreativeOptions = (): GooglePalm2Config => ({
  ...GooglePalm2DefaultOptions(),
  model: GooglePalm2Model.PaLMTextBison,
  temperature: 0.9
});

/**
 * GooglePalm2: Default model options for more fast text generation
 * @export
 */
export const GooglePalm2FastOptions = (): GooglePalm2Config => ({
  ...GooglePalm2DefaultOptions(),
  model: GooglePalm2Model.PaLMTextBison,
  temperature: 0.45
});

export interface GooglePalm2Args {
  apiKey: string;
  projectId: string;
  config: Readonly<GooglePalm2Config>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GooglePalm2: AI Service
 * @export
 */
export class GooglePalm2 extends BaseAI<
  GooglePalm2ChatRequest,
  GooglePalm2EmbedRequest,
  GooglePalm2ChatResponse,
  unknown,
  GooglePalm2EmbedResponse
> {
  private config: GooglePalm2Config;

  constructor({
    apiKey,
    projectId,
    config = GooglePalm2DefaultOptions(),
    options
  }: Readonly<GooglePalm2Args>) {
    if (!apiKey || apiKey === '') {
      throw new Error('GooglePalm2 AI API key not set');
    }

    const apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${config.model}:predict`,
      apiURLGooglePalm2
    ).href;

    super({
      name: 'GooglePalm2AI',
      apiURL,
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoGooglePalm2,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: false }
    });
    this.config = config;
  }

  override getModelConfig(): TextModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK
    } as TextModelConfig;
  }

  generateChatReq = (
    req: Readonly<AITextChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GooglePalm2ChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GooglePalm2ChatRequest = {
      instances: [
        {
          context: req.functions
            ? `Functions:\n${JSON.stringify(req.functions, null, 2)}`
            : '',
          examples: [], // You might need to adjust how you get examples
          messages: req.chatPrompt.map((v) => ({
            author: v.role,
            content: v.content ?? ''
          }))
        }
      ],
      parameters: {
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        topP: req.modelConfig?.topP ?? this.config.topP,
        topK: req.modelConfig?.topK ?? this.config.topK
      }
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, GooglePalm2EmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GooglePalm2EmbedRequest = {
      instances: req.texts.map((text) => ({ content: text }))
    };

    return [apiConfig, reqValue];
  };

  generateChatResp = (
    resp: Readonly<GooglePalm2ChatResponse>
  ): TextResponse => {
    const results = resp.predictions.map((prediction, index) => ({
      id: `${index}`,
      content: prediction.candidates[0]?.content ?? '',
      safetyAttributes: prediction.safetyAttributes
    }));

    return {
      results
    };
  };

  generateEmbedResp = (
    resp: Readonly<GooglePalm2EmbedResponse>
  ): EmbedResponse => {
    const embeddings = resp.predictions.map(
      (prediction) => prediction.embeddings.values
    );

    return {
      embeddings
    };
  };
}
