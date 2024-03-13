import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGooglePalm2 } from './info.js';
import {
  apiURLGooglePalm2,
  GooglePalm2ChatRequest,
  GooglePalm2ChatResponse,
  GooglePalm2CompletionRequest,
  GooglePalm2CompletionResponse,
  GooglePalm2Config,
  GooglePalm2EmbedModels,
  GooglePalm2EmbedRequest,
  GooglePalm2EmbedResponse,
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
  GooglePalm2CompletionRequest,
  GooglePalm2ChatRequest,
  GooglePalm2EmbedRequest,
  GooglePalm2CompletionResponse,
  unknown,
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

    super(
      'GooglePalm2AI',
      apiURL,
      { Authorization: `Bearer ${apiKey}` },
      modelInfoGooglePalm2,
      { model: config.model, embedModel: config.embedModel },
      options
    );
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

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GooglePalm2CompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GooglePalm2CompletionRequest = {
      instances: [{ prompt }],
      parameters: {
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        topP: req.modelConfig?.topP ?? this.config.topP,
        topK: req.modelConfig?.topK ?? this.config.topK
      }
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<GooglePalm2CompletionResponse>
  ): TextResponse => {
    const results = resp.predictions.map((prediction) => ({
      text: prediction.content,
      safetyAttributes: prediction.safetyAttributes
    }));

    return {
      results
    };
  };

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
            content: v.text
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
      text: prediction.candidates[0]?.content || '',
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
