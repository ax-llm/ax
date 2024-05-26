import type { AIPromptConfig, AIServiceOptions } from '../../text/types.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest
} from '../../types/index.js';
import type { API } from '../../util/apicall.js';
import { BaseAI } from '../base.js';
import type {
  EmbedResponse,
  TextModelConfig,
  TextResponse,
  TextResponseResult,
  TokenUsage
} from '../types.js';

import { modelInfoGoogleGemini } from './info.js';
import {
  type GoogleGeminiBatchEmbedRequest,
  type GoogleGeminiBatchEmbedResponse,
  type GoogleGeminiChatRequest,
  type GoogleGeminiChatResponse,
  type GoogleGeminiConfig,
  GoogleGeminiEmbedModels,
  GoogleGeminiModel
} from './types.js';

/**
 * GoogleGemini: Default Model options for text generation
 * @export
 */
export const GoogleGeminiDefaultOptions = (): GoogleGeminiConfig => ({
  model: GoogleGeminiModel.Gemini15Flash,
  embedModel: GoogleGeminiEmbedModels.Embedding001,
  maxTokens: 500,
  temperature: 0.45,
  topP: 1,
  topK: 40,
  stopSequences: []
});

export interface GoogleGeminiArgs {
  apiKey: string;
  config: Readonly<GoogleGeminiConfig>;
  options?: Readonly<AIServiceOptions>;
}

/**
 * GoogleGemini: AI Service
 * @export
 */
export class GoogleGemini extends BaseAI<
  GoogleGeminiChatRequest,
  GoogleGeminiBatchEmbedRequest,
  GoogleGeminiChatResponse,
  unknown,
  GoogleGeminiBatchEmbedResponse
> {
  private config: GoogleGeminiConfig;
  private apiKey: string;

  constructor({
    apiKey,
    config = GoogleGeminiDefaultOptions(),
    options
  }: Readonly<GoogleGeminiArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('GoogleGemini AI API key not set');
    }

    super({
      name: 'GoogleGeminiAI',
      apiURL: 'https://generativelanguage.googleapis.com/v1beta',
      headers: {},
      modelInfo: modelInfoGoogleGemini,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: true }
    });
    this.config = config;
    this.apiKey = apiKey;
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

  override generateChatReq = (
    req: Readonly<AITextChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AIPromptConfig>
  ): [API, GoogleGeminiChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: `/models/${model}:generateContent?key=${this.apiKey}`
    };

    const systemPrompts = req.chatPrompt
      .filter((p) => p.role === 'system')
      .map((p) => p.content);

    const systemInstruction =
      systemPrompts.length > 0
        ? {
            role: 'user' as const,
            parts: [{ text: systemPrompts.join(' ') }]
          }
        : undefined;

    const contents = req.chatPrompt
      .filter((p) => p.role !== 'system')
      .map(({ role, ...prompt }, i) => {
        if (role === 'user') {
          if (!prompt.content) {
            throw new Error(`Chat prompt content is empty (index: ${i})`);
          }
          return {
            role: 'user' as const,
            parts: [{ text: prompt.content }]
          };
        }

        if (role === 'assistant') {
          const text = prompt.content ? [{ text: prompt.content }] : [];

          let functionCalls: {
            functionCall: {
              name: string;
              args: object;
            };
          }[] = [];

          if ('functionCalls' in prompt) {
            functionCalls =
              prompt.functionCalls?.map((f) => {
                const args =
                  typeof f.function.arguments === 'string'
                    ? JSON.parse(f.function.arguments)
                    : f.function.arguments;
                return {
                  functionCall: {
                    name: f.function.name,
                    args: args
                  }
                };
              }) ?? [];
          }
          return {
            role: 'model' as const,
            parts: text ? text : functionCalls
          };
        }

        if (role === 'function') {
          if ('functionId' in prompt) {
            return {
              role: 'function' as const,
              parts: [
                {
                  functionResponse: {
                    name: prompt.functionId,
                    response: { result: prompt.content }
                  }
                }
              ]
            };
          }
          throw new Error(`Chat prompt functionId is empty (index: ${i})`);
        }

        throw new Error(
          `Chat prompt role not supported: ${role} (index: ${i})`
        );
      });

    const tools = req.functions
      ? [
          {
            functionDeclarations: req.functions ?? []
          }
        ]
      : undefined;

    let tool_config;
    if (req.functionCall) {
      if (req.functionCall === 'none') {
        tool_config = { function_calling_config: { mode: 'NONE' as const } };
      } else if (req.functionCall === 'auto') {
        tool_config = { function_calling_config: { mode: 'AUTO' as const } };
      } else if (req.functionCall === 'required') {
        tool_config = {
          function_calling_config: { mode: 'ANY' as const }
        };
      } else {
        tool_config = {
          function_calling_config: {
            mode: 'ANY' as const,
            allowed_function_names: [req.functionCall.function.name]
          }
        };
      }
    }

    const generationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      topP: req.modelConfig?.topP ?? this.config.topP,
      topK: req.modelConfig?.topK ?? this.config.topK,
      candidateCount: 1,
      stopSequences: req.modelConfig?.stop ?? this.config.stopSequences
    };

    const reqValue: GoogleGeminiChatRequest = {
      contents,
      tools,
      tool_config,
      systemInstruction,
      generationConfig
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AITextEmbedRequest>
  ): [API, GoogleGeminiBatchEmbedRequest] => {
    const model = req.embedModelInfo?.name ?? this.config.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    const apiConfig = {
      name: `/models/${model}:batchEmbedText?key=${this.apiKey}`
    };

    const reqValue: GoogleGeminiBatchEmbedRequest = {
      requests: req.texts.map((text) => ({ model, text }))
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<GoogleGeminiChatResponse>
  ): TextResponse => {
    const results: TextResponseResult[] = resp.candidates.map((candidate) => {
      const result: TextResponseResult = { content: null };

      switch (candidate.finishReason) {
        case 'MAX_TOKENS':
          result.finishReason = 'length';
          break;
        case 'STOP':
          result.finishReason = 'stop';
          break;
        case 'SAFETY':
          result.finishReason = 'error';
          break;
        case 'RECITATION':
          result.finishReason = 'error';
          break;
      }

      for (const part of candidate.content.parts) {
        if ('text' in part) {
          result.content = part.text;
          continue;
        }
        if ('functionCall' in part) {
          result.functionCalls = [
            {
              id: part.functionCall.name,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: part.functionCall.args
              }
            }
          ];
        }
      }
      return result;
    });

    let modelUsage: TokenUsage | undefined;
    if (resp.usageMetadata) {
      modelUsage = {
        totalTokens: resp.usageMetadata.totalTokenCount,
        promptTokens: resp.usageMetadata.promptTokenCount,
        completionTokens: resp.usageMetadata.candidatesTokenCount
      };
    }
    return {
      results,
      modelUsage
    };
  };

  override generateEmbedResp = (
    resp: Readonly<GoogleGeminiBatchEmbedResponse>
  ): EmbedResponse => {
    const embeddings = resp.embeddings.map((embedding) => embedding.value);

    return {
      embeddings
    };
  };
}
