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
  type AxAIGoogleGeminiRetrievalConfig,
  AxAIGoogleGeminiSafetyCategory,
  type AxAIGoogleGeminiSafetySettings,
  AxAIGoogleGeminiSafetyThreshold,
  type AxAIGoogleGeminiToolGoogleMaps,
  type AxAIGoogleVertexBatchEmbedRequest,
  type AxAIGoogleVertexBatchEmbedResponse,
} from './types.js';

/**
 * Clean function schema for Gemini API compatibility by removing unsupported fields
 * Gemini doesn't support: additionalProperties, default, optional, maximum, oneOf, anyOf
 */
const cleanSchemaForGemini = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const cleaned = { ...schema };

  // Remove unsupported fields
  delete cleaned.additionalProperties;
  delete cleaned.default;
  delete cleaned.optional;
  delete cleaned.maximum;
  delete cleaned.oneOf;
  delete cleaned.anyOf;

  // Recursively clean properties
  if (cleaned.properties && typeof cleaned.properties === 'object') {
    cleaned.properties = Object.fromEntries(
      Object.entries(cleaned.properties).map(([key, value]) => [
        key,
        cleanSchemaForGemini(value),
      ])
    );
  }

  // Recursively clean items (for arrays)
  if (cleaned.items) {
    cleaned.items = cleanSchemaForGemini(cleaned.items);
  }

  return cleaned;
};

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
  googleMaps?: AxAIGoogleGeminiToolGoogleMaps;
  retrievalConfig?: AxAIGoogleGeminiRetrievalConfig;
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
                    case 'audio':
                      return {
                        inlineData: {
                          mimeType: `audio/${c.format ?? 'mp3'}`,
                          data: c.data,
                        },
                      };
                    case 'file':
                      // Support both inline data and fileUri formats
                      if ('fileUri' in c) {
                        return {
                          fileData: {
                            mimeType: c.mimeType,
                            fileUri: c.fileUri,
                          },
                        };
                      } else {
                        return {
                          inlineData: { mimeType: c.mimeType, data: c.data },
                        };
                      }
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
            const parts: AxAIGoogleGeminiContentPart[] = [];

            // Handle thought blocks
            const thoughtBlock = (msg as any).thoughtBlock;
            let signatureHandled = false;

            if (thoughtBlock?.data) {
              parts.push({
                thought: true,
                text: thoughtBlock.data,
                ...(thoughtBlock.signature
                  ? { thoughtSignature: thoughtBlock.signature }
                  : {}),
              });
              if (thoughtBlock.signature) {
                signatureHandled = true;
              }
            }

            if (msg.functionCalls) {
              const fcParts = msg.functionCalls.map((f, index) => {
                let args: any;
                if (typeof f.function.params === 'string') {
                  const raw = f.function.params;
                  if (raw.trim().length === 0) {
                    args = {};
                  } else {
                    try {
                      args = JSON.parse(raw);
                    } catch {
                      throw new Error(
                        `Failed to parse function params JSON: ${raw}`
                      );
                    }
                  }
                } else {
                  args = f.function.params;
                }

                // Attach signature to the first function call if not already handled in a thought block
                const part: AxAIGoogleGeminiContentPart = {
                  functionCall: {
                    name: f.function.name,
                    args: args,
                  },
                };

                if (
                  index === 0 &&
                  !signatureHandled &&
                  thoughtBlock &&
                  thoughtBlock.signature
                ) {
                  part.thoughtSignature = thoughtBlock.signature;
                  signatureHandled = true;
                }

                return part;
              });
              parts.push(...fcParts);
            }

            if (msg.content) {
              parts.push({ text: msg.content });
            }

            if (parts.length === 0) {
              throw new Error('Assistant content is empty');
            }

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
      // Clean function schemas for Gemini compatibility
      const cleanedFunctions = req.functions.map((fn) => {
        const dummyParameters = {
          type: 'object',
          properties: {
            dummy: {
              type: 'string',
              description: 'An optional dummy parameter, do not use',
            },
          },
          required: [],
        } as const;

        let parameters = fn.parameters
          ? cleanSchemaForGemini(fn.parameters)
          : undefined;

        // If parameters are missing or an empty object, supply a dummy parameter
        if (
          parameters === undefined ||
          (parameters &&
            typeof parameters === 'object' &&
            Object.keys(parameters).length === 0)
        ) {
          parameters = { ...dummyParameters } as any;
        } else if (
          parameters &&
          typeof parameters === 'object' &&
          (parameters as any).type === 'object' &&
          (!('properties' in (parameters as any)) ||
            !(parameters as any).properties ||
            Object.keys((parameters as any).properties).length === 0)
        ) {
          // If parameters exist but have empty properties, add a dummy property
          parameters = {
            ...(parameters as any),
            properties: {
              dummy: {
                type: 'string',
                description: 'An optional dummy parameter, do not use',
              },
            },
            required: [],
          } as any;
        }

        return {
          ...fn,
          parameters,
        };
      });
      tools.push({ function_declarations: cleanedFunctions });
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

    if (this.options?.googleMaps) {
      const gm = this.options.googleMaps;
      const mapsToolCfg =
        gm?.enableWidget !== undefined ? { enableWidget: gm.enableWidget } : {};
      tools.push({ google_maps: mapsToolCfg } as any);
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
          retrieval_config?: {
            lat_lng?: { latitude: number; longitude: number };
            enable_widget?: boolean;
          };
        }
      | undefined;

    // Detect if we declared any functions for Gemini (function_declarations tool)
    const hasFunctionDeclarations = Array.isArray(tools)
      ? tools.some(
          (t: any) =>
            t &&
            Array.isArray(t.function_declarations) &&
            t.function_declarations.length > 0
        )
      : false;

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
    } else if (hasFunctionDeclarations) {
      // Only set default function_calling_config when we actually provide function_declarations
      toolConfig = {
        function_calling_config: { mode: 'AUTO' as const },
      } as any;
    }

    // Merge retrievalConfig if provided
    if (this.options?.retrievalConfig) {
      toolConfig = {
        ...(toolConfig ?? {}),
        retrievalConfig: {
          ...(this.options.retrievalConfig.latLng
            ? { latLng: this.options.retrievalConfig.latLng }
            : {}),
        },
      } as any;
    }

    const thinkingConfig: AxAIGoogleGeminiGenerationConfig['thinkingConfig'] =
      {};

    if (this.config.thinking?.includeThoughts) {
      thinkingConfig.includeThoughts = true;
    }

    if (this.config.thinking?.thinkingTokenBudget) {
      thinkingConfig.thinkingBudget = this.config.thinking.thinkingTokenBudget;
    }
    if (this.config.thinking?.thinkingLevel) {
      thinkingConfig.thinkingLevel = this.config.thinking.thinkingLevel;
    }

    // Then, override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      //The thinkingBudget must be an integer in the range 0 to 24576
      const levels = this.config.thinkingTokenBudgetLevels;
      const isGemini3 = model.includes('gemini-3');

      switch (config.thinkingTokenBudget) {
        case 'none':
          thinkingConfig.thinkingBudget = 0; // Explicitly set to 0
          thinkingConfig.includeThoughts = false; // When thinkingTokenBudget is 'none', disable showThoughts
          delete thinkingConfig.thinkingLevel;
          break;
        case 'minimal':
          thinkingConfig.thinkingBudget = levels?.minimal ?? 200;
          if (isGemini3) thinkingConfig.thinkingLevel = 'low';
          break;
        case 'low':
          thinkingConfig.thinkingBudget = levels?.low ?? 800;
          if (isGemini3) thinkingConfig.thinkingLevel = 'low';
          break;
        case 'medium':
          thinkingConfig.thinkingBudget = levels?.medium ?? 5000;
          if (isGemini3) thinkingConfig.thinkingLevel = 'high';
          break;
        case 'high':
          thinkingConfig.thinkingBudget = levels?.high ?? 10000;
          if (isGemini3) thinkingConfig.thinkingLevel = 'high';
          break;
        case 'highest':
          thinkingConfig.thinkingBudget = levels?.highest ?? 24500;
          if (isGemini3) thinkingConfig.thinkingLevel = 'high';
          break;
      }
    }

    // If thinkingLevel is set, remove thinkingBudget as they cannot be used together in Gemini 3
    if (thinkingConfig.thinkingLevel) {
      delete thinkingConfig.thinkingBudget;
    }

    if (config?.showThoughts !== undefined) {
      // Only override includeThoughts if thinkingTokenBudget is not 'none'
      if (config?.thinkingTokenBudget !== 'none') {
        thinkingConfig.includeThoughts = config.showThoughts;
      }
    }

    const generationConfig: AxAIGoogleGeminiGenerationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      ...(req.modelConfig?.temperature !== undefined
        ? { temperature: req.modelConfig.temperature }
        : {}),
      ...(req.modelConfig?.topP !== undefined
        ? { topP: req.modelConfig.topP }
        : {}),
      topK: req.modelConfig?.topK ?? this.config.topK,
      frequencyPenalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      candidateCount: 1,
      stopSequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      responseMimeType: 'text/plain',

      ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
    };

    // Handle structured output
    if (req.responseFormat) {
      generationConfig.responseMimeType = 'application/json';
      if (
        req.responseFormat.type === 'json_schema' &&
        req.responseFormat.schema
      ) {
        // Gemini expects the schema directly, not wrapped in { type: 'json_schema', schema: ... } like OpenAI
        // Also need to clean it for Gemini compatibility
        const schema =
          req.responseFormat.schema.schema || req.responseFormat.schema;
        generationConfig.responseSchema = cleanSchemaForGemini(schema);
      }
    } else if (this.config.responseFormat) {
      // Fallback to config-level response format if present
      if (this.config.responseFormat === 'json_object') {
        generationConfig.responseMimeType = 'application/json';
      }
    }

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
    let mapsWidgetToken: string | undefined;
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
            if (
              ('thought' in part && part.thought) ||
              (part as any).thought === true
            ) {
              result.thought = part.text;
              result.thoughtBlock = {
                data: part.text,
                encrypted: false,
                ...(part.thoughtSignature
                  ? { signature: part.thoughtSignature }
                  : {}),
              };
            } else {
              result.content = part.text;
            }
            continue;
          }

          if ('functionCall' in part) {
            // Check for thought signature on function call part
            if (part.thoughtSignature) {
              if (!result.thoughtBlock) {
                result.thoughtBlock = {
                  data: '', // No text data for signature-only thought
                  encrypted: false,
                  signature: part.thoughtSignature,
                };
              } else {
                // If thought block exists, just update signature if missing?
                // Or assume the text part handled it.
                // For now, ensure signature is captured.
                result.thoughtBlock.signature = part.thoughtSignature;
              }
            }

            result.functionCalls = [
              ...(result.functionCalls ?? []),
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
        // Map citation metadata to normalized citations
        const cms = candidate.citationMetadata?.citations;
        if (Array.isArray(cms) && cms.length) {
          const toIso = (d?: { year: number; month: number; day: number }) =>
            d
              ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
              : undefined;
          result.citations = cms
            .filter((c) => typeof c?.uri === 'string')
            .map((c) => ({
              url: c.uri,
              title: c.title,
              license: c.license,
              publicationDate: toIso(c.publicationDate),
            }));
        }
        // Map Google Maps grounding metadata
        const gm = (candidate as any).groundingMetadata;
        if (gm) {
          if (Array.isArray(gm.groundingChunks)) {
            const mapsCitations = gm.groundingChunks
              .map((ch: any) => ch?.maps)
              .filter((m: any) => m && typeof m.uri === 'string')
              .map((m: any) => ({
                url: m.uri as string,
                title: m.title as string | undefined,
              }));
            if (mapsCitations.length) {
              result.citations = [
                ...(result.citations ?? []),
                ...mapsCitations,
              ];
            }
          }
          if (typeof gm.googleMapsWidgetContextToken === 'string') {
            mapsWidgetToken = gm.googleMapsWidgetContextToken;
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
    const response: AxChatResponse = { results };
    if (mapsWidgetToken) {
      (response as any).providerMetadata = {
        ...(response as any).providerMetadata,
        google: {
          ...((response as any).providerMetadata?.google ?? {}),
          mapsWidgetContextToken: mapsWidgetToken,
        },
      };
    }
    return response;
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
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        media: {
          images: {
            supported: true,
            formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            maxSize: 20 * 1024 * 1024, // 20MB
            detailLevels: ['high', 'low', 'auto'] as (
              | 'high'
              | 'low'
              | 'auto'
            )[],
          },
          audio: {
            supported: true,
            formats: ['wav', 'mp3', 'aac', 'ogg'],
            maxDuration: 9.5 * 60, // 9.5 minutes for cloud storage
          },
          files: {
            supported: true,
            formats: [
              'application/pdf',
              'text/plain',
              'text/csv',
              'text/html',
              'text/xml',
            ],
            maxSize: 2 * 1024 * 1024 * 1024, // 2GB
            uploadMethod: 'cloud' as 'inline' | 'upload' | 'cloud' | 'none',
          },
          urls: {
            supported: true,
            webSearch: true,
            contextFetching: true,
          },
        },
        caching: {
          supported: false,
          types: [],
        },
        thinking: mi?.supported?.thinkingBudget ?? false,
        multiTurn: true,
      };
    };

    // Normalize per-model presets: allow provider-specific config on each model list item
    const normalizedModels = models?.map((item) => {
      const anyItem = item as any;
      const cfg = anyItem?.config as
        | Partial<AxAIGoogleGeminiConfig>
        | undefined;
      if (!cfg) return item;

      // Extract AxModelConfig-compatible fields and merge into modelConfig
      const modelConfig: Partial<AxModelConfig> = {};
      if (cfg.maxTokens !== undefined) modelConfig.maxTokens = cfg.maxTokens;
      if (cfg.temperature !== undefined)
        modelConfig.temperature = cfg.temperature;
      if (cfg.topP !== undefined) modelConfig.topP = cfg.topP;
      if (cfg.topK !== undefined) modelConfig.topK = cfg.topK as number;
      if (cfg.presencePenalty !== undefined)
        modelConfig.presencePenalty = cfg.presencePenalty as number;
      if (cfg.frequencyPenalty !== undefined)
        modelConfig.frequencyPenalty = cfg.frequencyPenalty as number;
      if (cfg.stopSequences !== undefined)
        modelConfig.stopSequences = cfg.stopSequences as string[];
      if ((cfg as any).endSequences !== undefined)
        (modelConfig as any).endSequences = (cfg as any).endSequences;
      if (cfg.stream !== undefined) modelConfig.stream = cfg.stream as boolean;
      if (cfg.n !== undefined) modelConfig.n = cfg.n as number;

      const out: any = { ...anyItem };
      if (Object.keys(modelConfig).length > 0) {
        out.modelConfig = { ...(anyItem.modelConfig ?? {}), ...modelConfig };
      }

      // Map exact numeric thinking budget to the closest supported level
      const numericBudget = cfg.thinking?.thinkingTokenBudget;
      if (typeof numericBudget === 'number') {
        const levels = Config.thinkingTokenBudgetLevels;
        const candidates = [
          ['minimal', levels?.minimal ?? 200],
          ['low', levels?.low ?? 800],
          ['medium', levels?.medium ?? 5000],
          ['high', levels?.high ?? 10000],
          ['highest', levels?.highest ?? 24500],
        ] as const;
        let bestName: 'minimal' | 'low' | 'medium' | 'high' | 'highest' =
          'minimal';
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const [name, value] of candidates) {
          const diff = Math.abs(numericBudget - value);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestName = name as typeof bestName;
          }
        }
        out.thinkingTokenBudget = bestName;
      }
      // If includeThoughts is provided (with or without numeric budget), map to showThoughts
      if (cfg.thinking?.includeThoughts !== undefined) {
        out.showThoughts = !!cfg.thinking.includeThoughts;
      }

      return out as typeof item;
    });

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
      models: normalizedModels ?? models,
    });
  }
}
