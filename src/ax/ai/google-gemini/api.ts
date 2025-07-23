import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import { randomUUID } from '../../util/crypto.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import type {
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxModelInfo,
  AxTokenUsage,
} from '../types.js';
import { axModelInfoGoogleGemini } from './info.js';
import {
  type AxAIGoogleGeminiBatchEmbedRequest,
  type AxAIGoogleGeminiBatchEmbedResponse,
  type AxAIGoogleGeminiChatRequest,
  type AxAIGoogleGeminiChatResponse,
  type AxAIGoogleGeminiChatResponseDelta,
  type AxAIGoogleGeminiConfig,
  type AxAIGoogleGeminiContent,
  type AxAIGoogleGeminiContentPart,
  AxAIGoogleGeminiEmbedModel,
  type AxAIGoogleGeminiGenerationConfig,
  AxAIGoogleGeminiModel,
  AxAIGoogleGeminiSafetyCategory,
  type AxAIGoogleGeminiSafetySettings,
  AxAIGoogleGeminiSafetyThreshold,
  type AxAIGoogleVertexBatchEmbedRequest,
  type AxAIGoogleVertexBatchEmbedResponse,
} from './types.js';

const safetySettings: AxAIGoogleGeminiSafetySettings = [
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryHarassment,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryHateSpeech,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategorySexuallyExplicit,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryDangerousContent,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
];

/**
 * AxAIGoogleGemini: Default Model options for text generation
 */
export const axAIGoogleGeminiDefaultConfig = (): AxAIGoogleGeminiConfig =>
  structuredClone<AxAIGoogleGeminiConfig>({
    model: AxAIGoogleGeminiModel.Gemini25Flash,
    embedModel: AxAIGoogleGeminiEmbedModel.TextEmbedding005,
    safetySettings,
    thinkingTokenBudgetLevels: {
      minimal: 200,
      low: 800,
      medium: 5000,
      high: 10000,
      highest: 24500,
    },
    ...axBaseAIDefaultConfig(),
  });

export const axAIGoogleGeminiDefaultCreativeConfig =
  (): AxAIGoogleGeminiConfig =>
    structuredClone<AxAIGoogleGeminiConfig>({
      model: AxAIGoogleGeminiModel.Gemini20Flash,
      embedModel: AxAIGoogleGeminiEmbedModel.TextEmbedding005,
      safetySettings,
      thinkingTokenBudgetLevels: {
        minimal: 200,
        low: 800,
        medium: 5000,
        high: 10000,
        highest: 24500,
      },
      ...axBaseAIDefaultCreativeConfig(),
    });

export interface AxAIGoogleGeminiOptionsTools {
  codeExecution?: boolean;
  googleSearchRetrieval?: {
    mode?: 'MODE_DYNAMIC';
    dynamicThreshold?: number;
  };
  googleSearch?: boolean;
  urlContext?: boolean;
}

export interface AxAIGoogleGeminiArgs<TModelKey> {
  name: 'google-gemini';
  apiKey?: string | (() => Promise<string>);
  projectId?: string;
  region?: string;
  endpointId?: string;
  config?: Readonly<Partial<AxAIGoogleGeminiConfig>>;
  options?: Readonly<AxAIServiceOptions & AxAIGoogleGeminiOptionsTools>;
  models?: AxAIInputModelList<
    AxAIGoogleGeminiModel,
    AxAIGoogleGeminiEmbedModel,
    TModelKey
  >;
  modelInfo?: AxModelInfo[];
}

class AxAIGoogleGeminiImpl
  implements
    AxAIServiceImpl<
      AxAIGoogleGeminiModel,
      AxAIGoogleGeminiEmbedModel,
      AxAIGoogleGeminiChatRequest,
      AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
      AxAIGoogleGeminiChatResponse,
      AxAIGoogleGeminiChatResponseDelta,
      AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined;

  constructor(
    private config: AxAIGoogleGeminiConfig,
    private isVertex: boolean,
    private endpointId?: string,
    private apiKey?: string | (() => Promise<string>),
    private options?: AxAIGoogleGeminiArgs<any>['options']
  ) {
    if (!this.isVertex && this.config.autoTruncate) {
      throw new Error('Auto truncate is not supported for GoogleGemini');
    }
  }

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed;
  }

  getModelConfig(): AxModelConfig {
    const { config } = this;
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      stream: config.stream,
      n: config.n,
    } as AxModelConfig;
  }

  createChatReq = async (
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    config: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, AxAIGoogleGeminiChatRequest]> => {
    const model = req.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    let apiConfig: AxAPI;
    if (this.endpointId) {
      apiConfig = {
        name: stream
          ? `/${this.endpointId}:streamGenerateContent?alt=sse`
          : `/${this.endpointId}:generateContent`,
      };
    } else {
      apiConfig = {
        name: stream
          ? `/models/${model}:streamGenerateContent?alt=sse`
          : `/models/${model}:generateContent`,
      };
    }

    if (!this.isVertex) {
      const pf = stream ? '&' : '?';
      const keyValue =
        typeof this.apiKey === 'function' ? await this.apiKey() : this.apiKey;
      apiConfig.name += `${pf}key=${keyValue}`;
    }

    const systemPrompts = req.chatPrompt
      .filter((p) => p.role === 'system')
      .map((p) => p.content);

    const systemInstruction =
      systemPrompts.length > 0
        ? {
            role: 'user' as const,
            parts: [{ text: systemPrompts.join(' ') }],
          }
        : undefined;

    const contents: AxAIGoogleGeminiContent[] = req.chatPrompt
      .filter((p) => p.role !== 'system')
      .map((msg, i) => {
        switch (msg.role) {
          case 'user': {
            const parts: AxAIGoogleGeminiContentPart[] = Array.isArray(
              msg.content
            )
              ? msg.content.map((c, i) => {
                  switch (c.type) {
                    case 'text':
                      return { text: c.text };
                    case 'image':
                      return {
                        inlineData: { mimeType: c.mimeType, data: c.image },
                      };
                    default:
                      throw new Error(
                        `Chat prompt content type not supported (index: ${i})`
                      );
                  }
                })
              : [{ text: msg.content }];
            return {
              role: 'user' as const,
              parts,
            };
          }

          case 'assistant': {
            let parts: AxAIGoogleGeminiContentPart[] = [];

            if (msg.functionCalls) {
              parts = msg.functionCalls.map((f) => {
                const args =
                  typeof f.function.params === 'string'
                    ? JSON.parse(f.function.params)
                    : f.function.params;
                return {
                  functionCall: {
                    name: f.function.name,
                    args: args,
                  },
                };
              });

              if (!parts) {
                throw new Error('Function call is empty');
              }

              return {
                role: 'model' as const,
                parts,
              };
            }

            if (!msg.content) {
              throw new Error('Assistant content is empty');
            }

            parts = [{ text: msg.content }];
            return {
              role: 'model' as const,
              parts,
            };
          }

          case 'function': {
            if (!('functionId' in msg)) {
              throw new Error(`Chat prompt functionId is empty (index: ${i})`);
            }
            const parts: AxAIGoogleGeminiContentPart[] = [
              {
                functionResponse: {
                  name: msg.functionId,
                  response: { result: msg.result },
                },
              },
            ];

            return {
              role: 'user' as const,
              parts,
            };
          }

          default:
            throw new Error(
              `Invalid role: ${JSON.stringify(msg)} (index: ${i})`
            );
        }
      });

    let tools: AxAIGoogleGeminiChatRequest['tools'] | undefined = [];

    if (req.functions && req.functions.length > 0) {
      tools.push({ function_declarations: req.functions });
    }

    if (this.options?.codeExecution) {
      tools.push({ code_execution: {} });
    }

    if (this.options?.googleSearchRetrieval) {
      tools.push({
        google_search_retrieval: {
          dynamic_retrieval_config: this.options.googleSearchRetrieval,
        },
      });
    }

    if (this.options?.googleSearch) {
      tools.push({ google_search: {} });
    }

    if (this.options?.urlContext) {
      tools.push({ url_context: {} });
    }

    if (tools.length === 0) {
      tools = undefined;
    }

    let toolConfig:
      | {
          function_calling_config: {
            mode: 'NONE' | 'AUTO' | 'ANY';
            allowedFunctionNames?: string[];
          };
        }
      | undefined;

    if (req.functionCall) {
      if (req.functionCall === 'none') {
        toolConfig = { function_calling_config: { mode: 'NONE' as const } };
      } else if (req.functionCall === 'auto') {
        toolConfig = { function_calling_config: { mode: 'AUTO' as const } };
      } else if (req.functionCall === 'required') {
        toolConfig = {
          function_calling_config: { mode: 'ANY' as const },
        };
      } else {
        const allowedFunctionNames = req.functionCall.function?.name
          ? {
              allowedFunctionNames: [req.functionCall.function.name],
            }
          : {};
        toolConfig = {
          function_calling_config: { mode: 'ANY' as const },
          ...allowedFunctionNames,
        };
      }
    } else if (tools && tools.length > 0) {
      toolConfig = { function_calling_config: { mode: 'AUTO' as const } };
    }

    const thinkingConfig: AxAIGoogleGeminiGenerationConfig['thinkingConfig'] =
      {};

    if (this.config.thinking?.includeThoughts) {
      thinkingConfig.includeThoughts = true;
    }

    if (this.config.thinking?.thinkingTokenBudget) {
      thinkingConfig.thinkingBudget = this.config.thinking.thinkingTokenBudget;
    }

    // Then, override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      //The thinkingBudget must be an integer in the range 0 to 24576
      const levels = this.config.thinkingTokenBudgetLevels;

      switch (config.thinkingTokenBudget) {
        case 'none':
          thinkingConfig.thinkingBudget = 0; // Explicitly set to 0
          thinkingConfig.includeThoughts = false; // When thinkingTokenBudget is 'none', disable showThoughts
          break;
        case 'minimal':
          thinkingConfig.thinkingBudget = levels?.minimal ?? 200;
          break;
        case 'low':
          thinkingConfig.thinkingBudget = levels?.low ?? 800;
          break;
        case 'medium':
          thinkingConfig.thinkingBudget = levels?.medium ?? 5000;
          break;
        case 'high':
          thinkingConfig.thinkingBudget = levels?.high ?? 10000;
          break;
        case 'highest':
          thinkingConfig.thinkingBudget = levels?.highest ?? 24500;
          break;
      }
    }

    if (config?.showThoughts !== undefined) {
      // Only override includeThoughts if thinkingTokenBudget is not 'none'
      if (config?.thinkingTokenBudget !== 'none') {
        thinkingConfig.includeThoughts = config.showThoughts;
      }
    }

    const generationConfig: AxAIGoogleGeminiGenerationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      topP: req.modelConfig?.topP ?? this.config.topP,
      topK: req.modelConfig?.topK ?? this.config.topK,
      frequencyPenalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      candidateCount: 1,
      stopSequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      responseMimeType: 'text/plain',

      ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
    };

    const safetySettings = this.config.safetySettings;

    const reqValue: AxAIGoogleGeminiChatRequest = {
      contents,
      tools,
      toolConfig,
      systemInstruction,
      generationConfig,
      safetySettings,
    };

    return [apiConfig, reqValue];
  };

  createEmbedReq = async (
    req: Readonly<AxInternalEmbedRequest<AxAIGoogleGeminiEmbedModel>>
  ): Promise<
    [
      AxAPI,
      AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
    ]
  > => {
    const model = req.embedModel;

    if (!model) {
      throw new Error('Embed model not set');
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty');
    }

    let apiConfig: AxAPI;
    let reqValue:
      | AxAIGoogleGeminiBatchEmbedRequest
      | AxAIGoogleVertexBatchEmbedRequest;

    if (this.isVertex) {
      if (this.endpointId) {
        apiConfig = {
          name: `/${this.endpointId}:predict`,
        };
      } else {
        apiConfig = {
          name: `/models/${model}:predict`,
        };
      }

      reqValue = {
        instances: req.texts.map((text) => ({
          content: text,
          ...(this.config.embedType && { taskType: this.config.embedType }),
        })),
        parameters: {
          autoTruncate: this.config.autoTruncate,
          outputDimensionality: this.config.dimensions,
        },
      };
    } else {
      const keyValue =
        typeof this.apiKey === 'function' ? this.apiKey() : this.apiKey;
      apiConfig = {
        name: `/models/${model}:batchEmbedContents?key=${keyValue}`,
      };

      reqValue = {
        requests: req.texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.config.dimensions,
          ...(this.config.embedType && { taskType: this.config.embedType }),
        })),
      };
    }

    return [apiConfig, reqValue];
  };

  createChatResp = (
    resp: Readonly<AxAIGoogleGeminiChatResponse>
  ): AxChatResponse => {
    const results: AxChatResponseResult[] = resp.candidates?.map(
      (candidate) => {
        const result: AxChatResponseResult = { index: 0 };

        switch (candidate.finishReason) {
          case 'MAX_TOKENS':
            result.finishReason = 'length';
            break;
          case 'STOP':
            result.finishReason = 'stop';
            break;
          case 'SAFETY':
            throw new AxAIRefusalError(
              'Content was blocked due to safety settings',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'RECITATION':
            throw new AxAIRefusalError(
              'Content was blocked due to recitation policy',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'MALFORMED_FUNCTION_CALL':
            throw new AxAIRefusalError(
              'Function call was malformed and blocked',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'UNEXPECTED_TOOL_CALL':
            throw new AxAIRefusalError(
              'Unexpected tool call',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'FINISH_REASON_UNSPECIFIED':
            throw new AxAIRefusalError(
              'Finish reason unspecified',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'BLOCKLIST':
            throw new AxAIRefusalError(
              'Content was blocked due to blocklist',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'PROHIBITED_CONTENT':
            throw new AxAIRefusalError(
              'Content was blocked due to prohibited content',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'SPII':
            throw new AxAIRefusalError(
              'Content was blocked due to SPII',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
          case 'OTHER':
            throw new AxAIRefusalError(
              'Other finish reason',
              undefined, // model not available in candidate
              undefined // requestId not available
            );
        }

        if (!candidate.content || !candidate.content.parts) {
          return result;
        }

        for (const part of candidate.content.parts) {
          if ('text' in part) {
            if ('thought' in part && part.thought) {
              result.thought = part.text;
            } else {
              result.content = part.text;
            }
            continue;
          }

          if ('functionCall' in part) {
            result.functionCalls = [
              {
                id: randomUUID(),
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  params: part.functionCall.args,
                },
              },
            ];
          }
        }
        return result;
      }
    );

    if (resp.usageMetadata) {
      this.tokensUsed = {
        totalTokens: resp.usageMetadata.totalTokenCount,
        promptTokens: resp.usageMetadata.promptTokenCount,
        completionTokens: resp.usageMetadata.candidatesTokenCount,
        thoughtsTokens: resp.usageMetadata.thoughtsTokenCount,
      };
    }
    return { results };
  };

  createChatStreamResp = (
    resp: Readonly<AxAIGoogleGeminiChatResponseDelta>
  ): AxChatResponse => {
    return this.createChatResp(resp);
  };

  createEmbedResp = (
    resp: Readonly<
      AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse
    >
  ): AxEmbedResponse => {
    let embeddings: number[][];
    if (this.isVertex) {
      embeddings = (resp as AxAIGoogleVertexBatchEmbedResponse).predictions.map(
        (prediction) => prediction.embeddings.values
      );
    } else {
      embeddings = (resp as AxAIGoogleGeminiBatchEmbedResponse).embeddings.map(
        (embedding) => embedding.values
      );
    }

    return {
      embeddings,
    };
  };
}

// Helper type to extract model keys from the models array
type ExtractModelKeys<T> = T extends readonly { key: infer K }[] ? K : never;

export class AxAIGoogleGemini<TModelKey = string> extends AxBaseAI<
  AxAIGoogleGeminiModel,
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiChatRequest,
  AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
  AxAIGoogleGeminiChatResponse,
  AxAIGoogleGeminiChatResponseDelta,
  AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse,
  TModelKey
> {
  // Static factory method for automatic type inference
  static create<const T extends AxAIGoogleGeminiArgs<any>>(
    options: T
  ): T extends { models: infer M }
    ? AxAIGoogleGemini<ExtractModelKeys<M>>
    : AxAIGoogleGemini<string> {
    return new AxAIGoogleGemini(options) as any;
  }

  constructor({
    apiKey,
    projectId,
    region,
    endpointId,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIGoogleGeminiArgs<TModelKey>, 'name'>>) {
    const isVertex = projectId !== undefined && region !== undefined;

    let apiURL: string;
    let headers: () => Promise<Record<string, string>>;

    if (isVertex) {
      if (!apiKey) {
        throw new Error('GoogleGemini Vertex API key not set');
      }
      if (typeof apiKey !== 'function') {
        throw new Error(
          'GoogleGemini Vertex API key must be a function for token-based authentication'
        );
      }

      let path: string;
      if (endpointId) {
        path = 'endpoints';
      } else {
        path = 'publishers/google';
      }

      const tld = region === 'global' ? 'aiplatform' : `${region}-aiplatform`;
      apiURL = `https://${tld}.googleapis.com/v1/projects/${projectId}/locations/${region}/${path}`;
      headers = async () => ({
        Authorization: `Bearer ${typeof apiKey === 'function' ? await apiKey() : apiKey}`,
      });
    } else {
      if (!apiKey) {
        throw new Error('GoogleGemini AI API key not set');
      }
      apiURL = 'https://generativelanguage.googleapis.com/v1beta';
      headers = async () => ({});
    }

    const Config = {
      ...axAIGoogleGeminiDefaultConfig(),
      ...config,
    };

    const aiImpl = new AxAIGoogleGeminiImpl(
      Config,
      isVertex,
      endpointId,
      apiKey,
      options
    );

    modelInfo = [...axModelInfoGoogleGemini, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIGoogleGeminiModel) => {
      const mi = getModelInfo<
        AxAIGoogleGeminiModel,
        AxAIGoogleGeminiEmbedModel,
        TModelKey
      >({
        model,
        modelInfo,
        models,
      });
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
        functionCot: false,
      };
    };

    super(aiImpl, {
      name: 'GoogleGeminiAI',
      apiURL,
      headers,
      modelInfo,
      defaults: {
        model: Config.model as AxAIGoogleGeminiModel,
        embedModel: Config.embedModel as AxAIGoogleGeminiEmbedModel,
      },
      options,
      supportFor,
      models,
    });
  }
}
