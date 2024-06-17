import type { API } from '../../util/apicall.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig
} from '../base.js';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxTokenUsage
} from '../types.js';

import { axModelInfoGoogleGemini } from './info.js';
import {
  type AxGoogleGeminiBatchEmbedRequest,
  type AxGoogleGeminiBatchEmbedResponse,
  type AxGoogleGeminiChatRequest,
  type AxGoogleGeminiChatResponse,
  type AxGoogleGeminiChatResponseDelta,
  type AxGoogleGeminiConfig,
  AxGoogleGeminiEmbedModels,
  AxGoogleGeminiModel,
  AxGoogleGeminiSafetyCategory,
  type AxGoogleGeminiSafetySettings,
  AxGoogleGeminiSafetyThreshold
} from './types.js';

const safetySettings: AxGoogleGeminiSafetySettings = [
  {
    category: AxGoogleGeminiSafetyCategory.HarmCategoryHarassment,
    threshold: AxGoogleGeminiSafetyThreshold.BlockNone
  },
  {
    category: AxGoogleGeminiSafetyCategory.HarmCategoryHateSpeech,
    threshold: AxGoogleGeminiSafetyThreshold.BlockNone
  },
  {
    category: AxGoogleGeminiSafetyCategory.HarmCategorySexuallyExplicit,
    threshold: AxGoogleGeminiSafetyThreshold.BlockNone
  },
  {
    category: AxGoogleGeminiSafetyCategory.HarmCategoryDangerousContent,
    threshold: AxGoogleGeminiSafetyThreshold.BlockNone
  }
];

/**
 * AxGoogleGemini: Default Model options for text generation
 * @export
 */
export const axGoogleGeminiDefaultConfig = (): AxGoogleGeminiConfig =>
  structuredClone({
    model: AxGoogleGeminiModel.Gemini15Pro,
    embedModel: AxGoogleGeminiEmbedModels.Embedding001,
    safetySettings,
    ...axBaseAIDefaultConfig()
  });

export const axGoogleGeminiDefaultCreativeConfig = (): AxGoogleGeminiConfig =>
  structuredClone({
    model: AxGoogleGeminiModel.Gemini15Flash,
    embedModel: AxGoogleGeminiEmbedModels.Embedding001,
    safetySettings,
    ...axBaseAIDefaultCreativeConfig()
  });

export interface AxGoogleGeminiArgs {
  apiKey: string;
  projectId?: string;
  region?: string;
  config: Readonly<AxGoogleGeminiConfig>;
  options?: Readonly<AxAIServiceOptions>;
}

/**
 * AxGoogleGemini: AI Service
 * @export
 */
export class AxGoogleGemini extends AxBaseAI<
  AxGoogleGeminiChatRequest,
  AxGoogleGeminiBatchEmbedRequest,
  AxGoogleGeminiChatResponse,
  AxGoogleGeminiChatResponseDelta,
  AxGoogleGeminiBatchEmbedResponse
> {
  private config: AxGoogleGeminiConfig;
  private apiKey: string;

  constructor({
    apiKey,
    projectId,
    region,
    config = axGoogleGeminiDefaultConfig(),
    options
  }: Readonly<AxGoogleGeminiArgs>) {
    if (!apiKey || apiKey === '') {
      throw new Error('GoogleGemini AI API key not set');
    }

    let apiURL = 'https://generativelanguage.googleapis.com/v1beta';

    if (projectId && region) {
      apiURL = `POST https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/{REGION}/publishers/google/`;
    }

    super({
      name: 'GoogleGeminiAI',
      apiURL,
      headers: {},
      modelInfo: axModelInfoGoogleGemini,
      models: { model: config.model, embedModel: config.embedModel },
      options,
      supportFor: { functions: true, streaming: true }
    });
    this.config = config;
    this.apiKey = apiKey;
  }

  override getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK
    } as AxModelConfig;
  }

  override generateChatReq = (
    req: Readonly<AxChatRequest>
  ): [API, AxGoogleGeminiChatRequest] => {
    const model = req.modelInfo?.name ?? this.config.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    const apiConfig = {
      name: stream
        ? `/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`
        : `/models/${model}:generateContent?key=${this.apiKey}`
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

    // eslint-disable-next-line @typescript-eslint/naming-convention
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
      stopSequences: req.modelConfig?.stopSequences ?? this.config.stopSequences
    };

    const safetySettings = this.config.safetySettings;

    const reqValue: AxGoogleGeminiChatRequest = {
      contents,
      tools,
      tool_config,
      systemInstruction,
      generationConfig,
      safetySettings
    };

    return [apiConfig, reqValue];
  };

  override generateEmbedReq = (
    req: Readonly<AxEmbedRequest>
  ): [API, AxGoogleGeminiBatchEmbedRequest] => {
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

    const reqValue: AxGoogleGeminiBatchEmbedRequest = {
      requests: req.texts.map((text) => ({ model, text }))
    };

    return [apiConfig, reqValue];
  };

  override generateChatResp = (
    resp: Readonly<AxGoogleGeminiChatResponse>
  ): AxChatResponse => {
    const results: AxChatResponseResult[] = resp.candidates.map((candidate) => {
      const result: AxChatResponseResult = { content: null };

      switch (candidate.finishReason) {
        case 'MAX_TOKENS':
          result.finishReason = 'length';
          break;
        case 'STOP':
          result.finishReason = 'stop';
          break;
        case 'SAFETY':
          throw new Error('Finish reason: SAFETY');
        case 'RECITATION':
          throw new Error('Finish reason: RECITATION');
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

    let modelUsage: AxTokenUsage | undefined;
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

  override generateChatStreamResp = (
    resp: Readonly<AxGoogleGeminiChatResponseDelta>
  ): AxChatResponse => {
    return this.generateChatResp(resp);
  };

  override generateEmbedResp = (
    resp: Readonly<AxGoogleGeminiBatchEmbedResponse>
  ): AxEmbedResponse => {
    const embeddings = resp.embeddings.map((embedding) => embedding.value);

    return {
      embeddings
    };
  };
}
