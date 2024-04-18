import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextCompletionRequest,
  AITextEmbedRequest
} from '../../tracing/types.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type { EmbedResponse, TextModelConfig, TextResponse } from '../types.js';

import { modelInfoGoogleGemini } from './info.js';
import {
  apiURLGoogleGemini,
  type GoogleGeminiChatRequest,
  type GoogleGeminiChatResponse,
  type GoogleGeminiCompletionRequest,
  type GoogleGeminiCompletionResponse,
  type GoogleGeminiConfig,
  type GoogleGeminiEmbedRequest,
  type GoogleGeminiEmbedResponse,
  GoogleGeminiModel
} from './types.js';

/**
 * GoogleGemini: Default Model options for text generation
 * @export
 */
export const GoogleGeminiDefaultOptions = (): GoogleGeminiConfig => ({
  model: GoogleGeminiModel.Gemini_1_0_Pro,
  embedModel: GoogleGeminiModel.Gemini_1_0_Pro,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1,
  topK: 40,
  stopSequences: []
});

export interface GoogleGeminiArgs {
  apiKey: string;
  projectId: string;
  config: Readonly<GoogleGeminiConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GoogleGemini: AI Service
 * @export
 */
export class GoogleGemini extends BaseAI<
  GoogleGeminiCompletionRequest,
  GoogleGeminiChatRequest,
  GoogleGeminiEmbedRequest,
  GoogleGeminiCompletionResponse,
  unknown,
  GoogleGeminiChatResponse,
  unknown,
  GoogleGeminiEmbedResponse
> {
  private config: GoogleGeminiConfig;

  constructor({
    apiKey,
    projectId,
    config = GoogleGeminiDefaultOptions(),
    options
  }: Readonly<GoogleGeminiArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('GoogleGemini AI API key not set');
    }

    const apiURL = new URL(
      `${projectId}/locations/us-central1/publishers/google/models/${config.model}:predict`,
      apiURLGoogleGemini
    ).href;

    super({
      name: 'GoogleGeminiAI',
      apiURL,
      headers: { Authorization: `Bearer ${apiKey}` },
      modelInfo: modelInfoGoogleGemini,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: true }
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

  generateCompletionReq = (
    req: Readonly<AITextCompletionRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GoogleGeminiCompletionRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const prompt = `${req.systemPrompt || ''} ${req.prompt || ''}`.trim();

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleGeminiCompletionRequest = {
      contents: [
        {
          role: 'USER',
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      tools: req.functions
        ? [
            {
              functionDeclarations: req.functions ?? []
            }
          ]
        : undefined,
      generationConfig: {
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        topP: req.modelConfig?.topP ?? this.config.topP,
        topK: req.modelConfig?.topK ?? this.config.topK,
        candidateCount: 1
      }
    };

    return [apiConfig, reqValue];
  };

  generateCompletionResp = (
    resp: Readonly<GoogleGeminiCompletionResponse>
  ): TextResponse => {
    const results =
      resp.candidates.at(0)?.content.parts.map((part, index) => ({
        id: `${index}`,
        content: part.text || '',
        ...(part.function_call
          ? {
              functionCalls: [
                {
                  id: `${index}`,
                  type: 'function' as const,
                  function: {
                    name: part.function_call.name,
                    args: part.function_call.args
                  }
                }
              ]
            }
          : {})
      })) ?? [];
    return {
      results
    };
  };

  generateChatReq = (
    req: Readonly<AITextChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GoogleGeminiChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleGeminiChatRequest = {
      contents: req.chatPrompt.map((prompt) => ({
        role: prompt.role as 'USER' | 'MODEL',
        parts: [{ text: prompt.content ?? undefined }]
      })),
      tools: req.functions
        ? [
            {
              functionDeclarations: req.functions ?? []
            }
          ]
        : undefined,
      generationConfig: {
        maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        topP: req.modelConfig?.topP ?? this.config.topP,
        topK: req.modelConfig?.topK ?? this.config.topK,
        candidateCount: 1,
        stopSequences: req.modelConfig?.stop ?? this.config.stopSequences
      }
    };

    return [apiConfig, reqValue];
  };

  generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, GoogleGeminiEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: `/v1/models/${model}:predict`
    };

    const reqValue: GoogleGeminiEmbedRequest = {
      contents: req.texts.map((text) => ({
        role: 'USER',
        parts: [{ text }]
      }))
    };

    return [apiConfig, reqValue];
  };

  generateChatResp = (
    resp: Readonly<GoogleGeminiChatResponse>
  ): TextResponse => {
    const results =
      resp.candidates.at(0)?.content.parts.map((part, index) => ({
        id: `${index}`,
        content: part.text || '',
        ...(part.function_call
          ? {
              functionCalls: [
                {
                  id: `${index}`,
                  type: 'function' as const,
                  function: {
                    name: part.function_call.name,
                    args: part.function_call.args
                  }
                }
              ]
            }
          : {})
      })) ?? [];

    return {
      results
    };
  };

  generateEmbedResp = (
    resp: Readonly<GoogleGeminiEmbedResponse>
  ): EmbedResponse => {
    const embeddings = resp.predictions.map(
      (prediction) => prediction.embeddings.values
    );

    return {
      embeddings
    };
  };
}
