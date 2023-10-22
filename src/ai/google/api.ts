import { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGoogle } from './info.js';
import {
  apiURLGoogle,
  GoogleChatRequest,
  GoogleChatResponse,
  GoogleCompletionRequest,
  GoogleCompletionResponse,
  GoogleEmbedModels,
  GoogleEmbedRequest,
  GoogleEmbedResponse,
  GoogleModel
} from './types.js';

/**
 * Google: Model options for text generation
 * @export
 */
export type GoogleOptions = {
  model: GoogleModel;
  embedModel: GoogleEmbedModels;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
};

/**
 * Google: Default Model options for text generation
 * @export
 */
export const GoogleDefaultOptions = (): GoogleOptions => ({
  model: GoogleModel.PaLMTextBison,
  embedModel: GoogleEmbedModels.PaLMTextEmbeddingGecko,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1,
  topK: 40
});

/**
 * Google: Default model options for more creative text generation
 * @export
 */
export const GoogleCreativeOptions = (): GoogleOptions => ({
  ...GoogleDefaultOptions(),
  model: GoogleModel.PaLMTextBison,
  temperature: 0.9
});

/**
 * Google: Default model options for more fast text generation
 * @export
 */
export const GoogleFastOptions = (): GoogleOptions => ({
  ...GoogleDefaultOptions(),
  model: GoogleModel.PaLMTextBison,
  temperature: 0.45
});

/**
 * Google: AI Service
 * @export
 */
/**
 * Google: AI Service
 * @export
 */
export class Google extends BaseAI<
  GoogleCompletionRequest,
  GoogleChatRequest,
  GoogleEmbedRequest,
  GoogleCompletionResponse,
  GoogleChatResponse,
  GoogleEmbedResponse
> {
  private options: GoogleOptions;

  constructor(
    apiKey: string,
    projectId: string,
    options: Readonly<GoogleOptions> = GoogleDefaultOptions(),
    otherOptions?: Readonly<AIServiceOptions>
  ) {
    if (!apiKey || apiKey === '') {
      throw new Error('Google AI API key not set');
    }

    const apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${options.model}:predict`,
      apiURLGoogle
    ).href;

    super(
      'GoogleAI',
      apiURL,
      { Authorization: `Bearer ${apiKey}` },
      modelInfoGoogle,
      { model: options.model, embedModel: options.embedModel },
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
      topK: options.topK
    } as TextModelConfig;
  }

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GoogleCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;
    const functionsList = req.functions
      ? `Functions:\n${JSON.stringify(req.functions, null, 2)}\n`
      : '';
    const prompt = `${functionsList} ${req.systemPrompt || ''} ${
      req.prompt || ''
    }`.trim();

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleCompletionRequest = {
      instances: [{ prompt }],
      parameters: {
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.options.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.options.temperature,
        topP: req.modelConfig?.topP ?? this.options.topP,
        topK: req.modelConfig?.topK ?? this.options.topK
      }
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<GoogleCompletionResponse>
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
  ): [API, GoogleChatRequest] => {
    const model = req.modelInfo?.name ?? this.options.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleChatRequest = {
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
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.options.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.options.temperature,
        topP: req.modelConfig?.topP ?? this.options.topP,
        topK: req.modelConfig?.topK ?? this.options.topK
      }
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, GoogleEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.options.embedModel;

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleEmbedRequest = {
      instances: req.texts.map((text) => ({ content: text }))
    };

    return [apiConfig, reqValue];
  };

  generateChatResp = (resp: Readonly<GoogleChatResponse>): TextResponse => {
    const results = resp.predictions.map((prediction, index) => ({
      id: `${index}`,
      text: prediction.candidates[0]?.content || '',
      safetyAttributes: prediction.safetyAttributes
    }));

    return {
      results
    };
  };

  generateEmbedResp = (resp: Readonly<GoogleEmbedResponse>): EmbedResponse => {
    const embeddings = resp.predictions.map(
      (prediction) => prediction.embeddings.values
    );

    return {
      embeddings
    };
  };
}
