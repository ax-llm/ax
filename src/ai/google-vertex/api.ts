import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGoogleVertex } from './info.js';
import {
  apiURLGoogleVertex,
  GoogleVertexChatRequest,
  GoogleVertexChatResponse,
  GoogleVertexCompletionRequest,
  GoogleVertexCompletionResponse,
  GoogleVertexConfig,
  GoogleVertexEmbedModels,
  GoogleVertexEmbedRequest,
  GoogleVertexEmbedResponse,
  GoogleVertexModel
} from './types.js';

/**
 * GoogleVertex: Default Model options for text generation
 * @export
 */
export const GoogleVertexDefaultOptions = (): GoogleVertexConfig => ({
  model: GoogleVertexModel.PaLMTextBison,
  embedModel: GoogleVertexEmbedModels.PaLMTextEmbeddingGecko,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1,
  topK: 40
});

/**
 * GoogleVertex: Default model options for more creative text generation
 * @export
 */
export const GoogleVertexCreativeOptions = (): GoogleVertexConfig => ({
  ...GoogleVertexDefaultOptions(),
  model: GoogleVertexModel.PaLMTextBison,
  temperature: 0.9
});

/**
 * GoogleVertex: Default model options for more fast text generation
 * @export
 */
export const GoogleVertexFastOptions = (): GoogleVertexConfig => ({
  ...GoogleVertexDefaultOptions(),
  model: GoogleVertexModel.PaLMTextBison,
  temperature: 0.45
});

export interface GoogleVertexArgs {
  apiKey: string;
  projectId: string;
  config: Readonly<GoogleVertexConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GoogleVertex: AI Service
 * @export
 */
export class GoogleVertex extends BaseAI<
  GoogleVertexCompletionRequest,
  GoogleVertexChatRequest,
  GoogleVertexEmbedRequest,
  GoogleVertexCompletionResponse,
  unknown,
  GoogleVertexChatResponse,
  unknown,
  GoogleVertexEmbedResponse
> {
  private config: GoogleVertexConfig;

  constructor({
    apiKey,
    projectId,
    config = GoogleVertexDefaultOptions(),
    options
  }: Readonly<GoogleVertexArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('GoogleVertex AI API key not set');
    }

    const apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${config.model}:predict`,
      apiURLGoogleVertex
    ).href;

    super(
      'GoogleVertexAI',
      apiURL,
      { Authorization: `Bearer ${apiKey}` },
      modelInfoGoogleVertex,
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
  ): [API, GoogleVertexCompletionRequest] => {
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

    const reqValue: GoogleVertexCompletionRequest = {
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
    resp: Readonly<GoogleVertexCompletionResponse>
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
  ): [API, GoogleVertexChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleVertexChatRequest = {
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
  ): [API, GoogleVertexEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleVertexEmbedRequest = {
      instances: req.texts.map((text) => ({ content: text }))
    };

    return [apiConfig, reqValue];
  };

  generateChatResp = (
    resp: Readonly<GoogleVertexChatResponse>
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
    resp: Readonly<GoogleVertexEmbedResponse>
  ): EmbedResponse => {
    const embeddings = resp.predictions.map(
      (prediction) => prediction.embeddings.values
    );

    return {
      embeddings
    };
  };
}
