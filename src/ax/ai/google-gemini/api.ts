import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import { randomUUID } from '../../util/crypto.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';

/**
 * Check if a model is a Gemini 3 model
 */
const isGemini3Model = (model: string): boolean => model.includes('gemini-3');

/**
 * Check if a model is Gemini 3 Pro
 */
const isGemini3Pro = (model: string): boolean =>
  model.includes('gemini-3') && model.includes('pro');

import type {
  AxAIInputModelList,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxChatResponseResult,
  AxContextCacheInfo,
  AxContextCacheOperation,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxModelInfo,
  AxPreparedChatRequest,
  AxThoughtBlockItem,
  AxTokenUsage,
} from '../types.js';
import { axModelInfoGoogleGemini } from './info.js';
import {
  type AxAIGoogleGeminiBatchEmbedRequest,
  type AxAIGoogleGeminiBatchEmbedResponse,
  type AxAIGoogleGeminiCacheCreateRequest,
  type AxAIGoogleGeminiCacheResponse,
  type AxAIGoogleGeminiCacheUpdateRequest,
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
  type AxAIGoogleGeminiThinkingLevel,
  type AxAIGoogleGeminiThinkingLevelMapping,
  type AxAIGoogleGeminiToolGoogleMaps,
  type AxAIGoogleVertexBatchEmbedRequest,
  type AxAIGoogleVertexBatchEmbedResponse,
  GEMINI_CONTEXT_CACHE_SUPPORTED_MODELS,
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

  // Gemini does not support type unions (type as an array).
  // Convert to a single concrete type, preferring 'object' for flexible
  // json/object types (e.g. json[] signature produces items with
  // type: ["object","array","string","number","boolean","null"]).
  if (Array.isArray(cleaned.type)) {
    cleaned.type = cleaned.type.includes('object')
      ? 'object'
      : (cleaned.type[0] ?? 'string');
  }

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
    // Default mapping for Gemini 3+ models (thinkingTokenBudget → thinkingLevel)
    // Note: 'none' always maps to 'minimal' for Gemini 3+ (which can't disable thinking)
    thinkingLevelMapping: {
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      highest: 'high', // Gemini caps at 'high'
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
      // Default mapping for Gemini 3+ models (thinkingTokenBudget → thinkingLevel)
      // Note: 'none' always maps to 'minimal' for Gemini 3+ (which can't disable thinking)
      thinkingLevelMapping: {
        minimal: 'minimal',
        low: 'low',
        medium: 'medium',
        high: 'high',
        highest: 'high', // Gemini caps at 'high'
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
  private models?: AxAIInputModelList<
    AxAIGoogleGeminiModel,
    AxAIGoogleGeminiEmbedModel,
    any
  >;

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

    // Validate Gemini 3 thinking configuration
    const model = this.config.model;
    if (isGemini3Model(model)) {
      // Gemini 3 models don't support numeric thinkingBudget, only thinkingLevel
      if (
        this.config.thinking?.thinkingTokenBudget !== undefined &&
        typeof this.config.thinking.thinkingTokenBudget === 'number'
      ) {
        throw new Error(
          `Gemini 3 models (${model}) do not support numeric thinkingTokenBudget. ` +
            `Use thinkingLevel ('low', 'medium', 'high') instead, or pass thinkingTokenBudget as a string level via options.`
        );
      }

      // Gemini 3 Pro only supports 'low' and 'high' thinkingLevel
      if (isGemini3Pro(model) && this.config.thinking?.thinkingLevel) {
        const level = this.config.thinking.thinkingLevel;
        if (level !== 'low' && level !== 'high') {
          throw new Error(
            `Gemini 3 Pro (${model}) only supports thinkingLevel 'low' or 'high', got '${level}'. ` +
              `Use 'low' for less thinking or 'high' for more thinking.`
          );
        }
      }
    }
  }

  /**
   * Set the models array for model-key lookups.
   * Called by the outer class after normalizing models.
   */
  setModels(
    models: AxAIInputModelList<
      AxAIGoogleGeminiModel,
      AxAIGoogleGeminiEmbedModel,
      any
    >
  ): void {
    this.models = models;
  }

  /**
   * Get effective thinkingLevelMapping and thinkingTokenBudgetLevels for a model.
   * Merges base config with model-key overrides.
   * @param model - The model name (e.g., 'gemini-3-flash-preview')
   */
  private getEffectiveMappings(model: string): {
    thinkingLevelMapping: AxAIGoogleGeminiThinkingLevelMapping;
    thinkingTokenBudgetLevels: AxAIGoogleGeminiConfig['thinkingTokenBudgetLevels'];
  } {
    // Find model entry by model name (after resolution from key)
    const modelEntry = this.models?.find(
      (m) => (m as any).model === model
    ) as any;

    return {
      thinkingLevelMapping: {
        ...this.config.thinkingLevelMapping,
        ...(modelEntry?.thinkingLevelMapping ?? {}),
      },
      thinkingTokenBudgetLevels: {
        ...this.config.thinkingTokenBudgetLevels,
        ...(modelEntry?.thinkingTokenBudgetLevels ?? {}),
      },
    };
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

    const contents: AxAIGoogleGeminiContent[] = [];
    const chatPrompt = req.chatPrompt.filter((p) => p.role !== 'system');

    for (let i = 0; i < chatPrompt.length; i++) {
      const msg = chatPrompt[i];
      switch (msg.role) {
        case 'user': {
          const parts: AxAIGoogleGeminiContentPart[] = Array.isArray(
            msg.content
          )
            ? msg.content.map((c, idx) => {
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
                      `Chat prompt content type not supported (index: ${idx})`
                    );
                }
              })
            : [{ text: msg.content }];
          contents.push({
            role: 'user' as const,
            parts,
          });
          break;
        }

        case 'assistant': {
          const parts: AxAIGoogleGeminiContentPart[] = [];

          // Handle thought blocks - now stored as array
          const thoughtBlocks = (msg as any).thoughtBlocks as
            | AxThoughtBlockItem[]
            | undefined;
          const hasFunctionCalls =
            msg.functionCalls && msg.functionCalls.length > 0;

          // Get first thought block's data and signature (for Google's API format)
          const firstThoughtBlock = thoughtBlocks?.[0];
          const combinedThoughtData =
            thoughtBlocks?.map((b) => b.data).join('') ?? '';
          const firstSignature = firstThoughtBlock?.signature;

          if (combinedThoughtData) {
            parts.push({
              // Only mark as thought if there are no function calls
              // Otherwise it's just text context for the function call
              ...(hasFunctionCalls ? {} : { thought: true }),
              text: combinedThoughtData,
              // Only attach signature to text if there are no function calls
              // Gemini requires signature on the first function call if present
              ...(firstSignature && !hasFunctionCalls
                ? { thought_signature: firstSignature }
                : {}),
            });
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

              const part: AxAIGoogleGeminiContentPart = {
                functionCall: {
                  name: f.function.name,
                  args: args,
                },
              };

              // Attach signature ONLY to the first function call
              if (firstSignature && index === 0) {
                part.thought_signature = firstSignature;
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

          contents.push({
            role: 'model' as const,
            parts,
          });
          break;
        }

        case 'function': {
          const parts: AxAIGoogleGeminiContentPart[] = [];

          // Handle consecutive function responses
          // We need to group them into a single user turn
          let currentMsg = msg as any;
          let currentIndex = i;

          while (true) {
            if (!('functionId' in currentMsg)) {
              throw new Error(
                `Chat prompt functionId is empty (index: ${currentIndex})`
              );
            }

            parts.push({
              functionResponse: {
                name: currentMsg.functionId,
                response: { result: currentMsg.result },
              },
            });

            // Check next message
            if (
              currentIndex + 1 < chatPrompt.length &&
              chatPrompt[currentIndex + 1].role === 'function'
            ) {
              currentIndex++;
              currentMsg = chatPrompt[currentIndex];
            } else {
              break;
            }
          }

          // Update outer loop index
          i = currentIndex;

          contents.push({
            role: 'user' as const,
            parts,
          });
          break;
        }

        default:
          throw new Error(`Invalid role: ${JSON.stringify(msg)} (index: ${i})`);
      }
    }

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

        // Only include supported fields for Gemini function declarations
        // Exclude 'cache' and other unsupported fields
        return {
          name: fn.name,
          description: fn.description,
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
    // thinkingLevel is only supported by Gemini 3+ models
    // Gemini 2.5 and older models use numeric thinkingBudget instead
    if (this.config.thinking?.thinkingLevel && isGemini3Model(model)) {
      thinkingConfig.thinkingLevel = this.config.thinking.thinkingLevel;
    }

    // Then, override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      //The thinkingBudget must be an integer in the range 0 to 24576
      const effectiveMappings = this.getEffectiveMappings(model);
      const levels = effectiveMappings.thinkingTokenBudgetLevels;
      const isGemini3 = isGemini3Model(model);

      if (isGemini3) {
        // Gemini 3 uses thinkingLevel instead of numeric thinkingBudget
        // Gemini 3 Flash: supports minimal, low, medium, high
        // Gemini 3 Pro: supports only low, high
        const isPro = isGemini3Pro(model);
        const mapping = effectiveMappings.thinkingLevelMapping;

        if (config.thinkingTokenBudget === 'none') {
          // Gemini 3+ cannot disable thinking - 'minimal' is the lowest level
          // Map 'none' to 'minimal'. Note: includeThoughts is controlled separately by showThoughts option.
          thinkingConfig.thinkingLevel =
            mapping?.minimal ?? ('minimal' as AxAIGoogleGeminiThinkingLevel);
        } else {
          // Use configurable mapping
          const levelToMap =
            config.thinkingTokenBudget as keyof AxAIGoogleGeminiThinkingLevelMapping;
          let mappedLevel = mapping?.[levelToMap];

          // Fallback to defaults if not configured
          if (!mappedLevel) {
            mappedLevel =
              levelToMap === 'highest'
                ? 'high'
                : (levelToMap as AxAIGoogleGeminiThinkingLevel);
          }

          thinkingConfig.thinkingLevel = mappedLevel;
        }

        // Pro only supports 'low' and 'high' - validate/adjust
        if (isPro && thinkingConfig.thinkingLevel) {
          const level = thinkingConfig.thinkingLevel;
          if (level !== 'low' && level !== 'high') {
            // Adjust: minimal -> low, medium -> high
            thinkingConfig.thinkingLevel = level === 'minimal' ? 'low' : 'high';
          }
        }
      } else {
        // Non-Gemini 3 models use numeric thinkingBudget
        switch (config.thinkingTokenBudget) {
          case 'none':
            thinkingConfig.thinkingBudget = 0;
            thinkingConfig.includeThoughts = false;
            delete thinkingConfig.thinkingLevel;
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
    }

    // If thinkingLevel is set, remove thinkingBudget as they cannot be used together
    if (thinkingConfig.thinkingLevel) {
      delete thinkingConfig.thinkingBudget;
    }

    // Clean up thinking parameters for incompatible models
    // thinkingLevel is only supported by Gemini 3+ models
    if (!isGemini3Model(model)) {
      delete thinkingConfig.thinkingLevel;
    }
    // thinkingBudget is not supported by Gemini 3+ models (which use thinkingLevel instead)
    if (isGemini3Model(model)) {
      delete thinkingConfig.thinkingBudget;
    }

    // Validate: maxTokens cannot be set when thinkingLevel is used (Gemini limitation)
    const effectiveMaxTokens =
      req.modelConfig?.maxTokens ?? this.config.maxTokens;
    if (thinkingConfig.thinkingLevel && effectiveMaxTokens !== undefined) {
      throw new Error(
        `Cannot set maxTokens when using thinkingLevel with Gemini models. ` +
          `When thinking is enabled, the model manages output tokens automatically. ` +
          `Remove the maxTokens setting or disable thinking.`
      );
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

    // Gemini 3+ models require a minimum temperature of 1.0
    if (
      isGemini3Model(model as string) &&
      (generationConfig.temperature === undefined ||
        generationConfig.temperature < 1)
    ) {
      generationConfig.temperature = 1;
    }

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
              // Google returns thoughtSignature in camelCase
              const thoughtSignature =
                (part as any).thoughtSignature || part.thought_signature;
              // Initialize thoughtBlocks array if needed
              if (!result.thoughtBlocks) {
                result.thoughtBlocks = [];
              }
              result.thoughtBlocks.push({
                data: part.text,
                encrypted: false,
                ...(thoughtSignature ? { signature: thoughtSignature } : {}),
              });
            } else {
              result.content = part.text;
            }
            continue;
          }

          if ('functionCall' in part) {
            // Check for thought signature on function call part
            // Google returns thoughtSignature in camelCase
            const thoughtSignature =
              (part as any).thoughtSignature || part.thought_signature;
            if (thoughtSignature) {
              if (!result.thoughtBlocks || result.thoughtBlocks.length === 0) {
                result.thoughtBlocks = [
                  {
                    data: '', // No text data for signature-only thought
                    encrypted: false,
                    signature: thoughtSignature,
                  },
                ];
              } else {
                // Update the last block's signature if missing
                const lastBlock =
                  result.thoughtBlocks[result.thoughtBlocks.length - 1];
                if (lastBlock && !lastBlock.signature) {
                  lastBlock.signature = thoughtSignature;
                }
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
        // Map cached content token count to cacheReadTokens for cost tracking
        ...(resp.usageMetadata.cachedContentTokenCount !== undefined
          ? { cacheReadTokens: resp.usageMetadata.cachedContentTokenCount }
          : {}),
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

  // ============================================================================
  // Context Caching Methods
  // ============================================================================

  /**
   * Check if context caching is supported for a given model.
   */
  supportsContextCache = (model: AxAIGoogleGeminiModel): boolean => {
    const modelStr = model as string;
    return GEMINI_CONTEXT_CACHE_SUPPORTED_MODELS.some(
      (m) => modelStr.includes(m) || m.includes(modelStr)
    );
  };

  /**
   * Build a context cache creation operation.
   */
  buildCacheCreateOp = (
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    options: Readonly<AxAIServiceOptions>
  ): AxContextCacheOperation | undefined => {
    const model = req.model;
    const ttlSeconds = options.contextCache?.ttlSeconds ?? 3600;

    // Extract cacheable content from the request (system prompt + marked content)
    const { systemInstruction, contents } = this.extractCacheableContent(
      req.chatPrompt
    );

    // If no cacheable content, return undefined
    if (!systemInstruction && (!contents || contents.length === 0)) {
      return undefined;
    }

    // Build the cache creation request
    const cacheRequest: AxAIGoogleGeminiCacheCreateRequest = {
      model: this.isVertex ? model : `models/${model}`,
      ttl: `${ttlSeconds}s`,
      displayName: `ax-cache-${Date.now()}`,
    };

    if (systemInstruction) {
      cacheRequest.systemInstruction = systemInstruction;
    }

    if (contents && contents.length > 0) {
      cacheRequest.contents = contents;
    }

    // Build API endpoint
    let apiPath: string;
    if (this.isVertex) {
      apiPath = '/cachedContents';
    } else {
      apiPath = '/cachedContents';
      // Add API key for non-Vertex
      const keyValue =
        typeof this.apiKey === 'function' ? 'ASYNC_KEY' : this.apiKey;
      apiPath += `?key=${keyValue}`;
    }

    return {
      type: 'create',
      apiConfig: { name: apiPath },
      request: cacheRequest,
      parseResponse: (response: unknown): AxContextCacheInfo | undefined => {
        const resp = response as AxAIGoogleGeminiCacheResponse;
        if (!resp?.name) return undefined;
        return {
          name: resp.name,
          expiresAt: resp.expireTime,
          tokenCount: resp.usageMetadata?.totalTokenCount,
        };
      },
    };
  };

  /**
   * Build a cache TTL update operation.
   */
  buildCacheUpdateTTLOp = (
    cacheName: string,
    ttlSeconds: number
  ): AxContextCacheOperation => {
    const updateRequest: AxAIGoogleGeminiCacheUpdateRequest = {
      ttl: `${ttlSeconds}s`,
    };

    // API path uses the cache name directly
    let apiPath = `/${cacheName}`;
    if (!this.isVertex && this.apiKey) {
      const keyValue =
        typeof this.apiKey === 'function' ? 'ASYNC_KEY' : this.apiKey;
      apiPath += `?key=${keyValue}`;
    }

    return {
      type: 'update',
      apiConfig: {
        name: apiPath,
        headers: { 'Content-Type': 'application/json' },
      },
      request: updateRequest,
      parseResponse: (response: unknown): AxContextCacheInfo | undefined => {
        const resp = response as AxAIGoogleGeminiCacheResponse;
        if (!resp?.name) return undefined;
        return {
          name: resp.name,
          expiresAt: resp.expireTime,
          tokenCount: resp.usageMetadata?.totalTokenCount,
        };
      },
    };
  };

  /**
   * Build a cache deletion operation.
   */
  buildCacheDeleteOp = (cacheName: string): AxContextCacheOperation => {
    let apiPath = `/${cacheName}`;
    if (!this.isVertex && this.apiKey) {
      const keyValue =
        typeof this.apiKey === 'function' ? 'ASYNC_KEY' : this.apiKey;
      apiPath += `?key=${keyValue}`;
    }

    return {
      type: 'delete',
      apiConfig: {
        name: apiPath,
        headers: { 'Content-Type': 'application/json' },
      },
      request: {},
      parseResponse: (): undefined => undefined,
    };
  };

  /**
   * Prepare a chat request that uses an existing cache.
   */
  prepareCachedChatReq = async (
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    _options: Readonly<AxAIServiceOptions>,
    existingCacheName: string
  ): Promise<AxPreparedChatRequest<AxAIGoogleGeminiChatRequest>> => {
    const model = req.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;

    // Build the base request but only with non-cached content
    const { dynamicContents, dynamicSystemInstruction } =
      this.extractDynamicContent(req.chatPrompt);

    // Build API config (same as regular chat)
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

    // Build the generation config using existing logic
    const generationConfig: AxAIGoogleGeminiGenerationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
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
    };

    // Gemini 3+ models require a minimum temperature of 1.0
    if (
      isGemini3Model(model as string) &&
      (generationConfig.temperature === undefined ||
        generationConfig.temperature < 1)
    ) {
      generationConfig.temperature = 1;
    }

    const safetySettings = this.config.safetySettings;

    // Build the request with cachedContent reference
    const chatRequest: AxAIGoogleGeminiChatRequest = {
      contents: dynamicContents,
      cachedContent: existingCacheName,
      generationConfig,
      safetySettings,
    };

    // Only include systemInstruction if there's dynamic system content
    if (dynamicSystemInstruction) {
      chatRequest.systemInstruction = dynamicSystemInstruction;
    }

    return {
      apiConfig,
      request: chatRequest,
    };
  };

  /**
   * Extract cacheable content from chat prompt.
   * Uses breakpoint semantics: includes all content from the start up to and
   * including the last message with cache: true. System prompts are always included.
   */
  private extractCacheableContent(
    chatPrompt: AxInternalChatRequest<AxAIGoogleGeminiModel>['chatPrompt']
  ): {
    systemInstruction?: AxAIGoogleGeminiContent;
    contents?: AxAIGoogleGeminiContent[];
  } {
    let systemInstruction: AxAIGoogleGeminiContent | undefined;
    const contents: AxAIGoogleGeminiContent[] = [];

    // Find the last message with cache: true (the breakpoint)
    let breakpointIndex = -1;
    for (let i = chatPrompt.length - 1; i >= 0; i--) {
      const msg = chatPrompt[i];
      if ('cache' in msg && msg.cache) {
        breakpointIndex = i;
        break;
      }
    }

    // Extract all messages from start up to and including the breakpoint
    for (let i = 0; i < chatPrompt.length; i++) {
      const msg = chatPrompt[i];

      // Always cache system prompts
      if (msg.role === 'system') {
        systemInstruction = {
          role: 'user' as const,
          parts: [{ text: msg.content }],
        };
        continue;
      }

      // For other messages, include only if before or at breakpoint
      if (breakpointIndex >= 0 && i <= breakpointIndex) {
        if (msg.role === 'user') {
          const parts: AxAIGoogleGeminiContentPart[] = [];
          if (typeof msg.content === 'string') {
            parts.push({ text: msg.content });
          } else if (Array.isArray(msg.content)) {
            for (const c of msg.content) {
              switch (c.type) {
                case 'text':
                  parts.push({ text: c.text });
                  break;
                case 'image':
                  parts.push({
                    inlineData: { mimeType: c.mimeType, data: c.image },
                  });
                  break;
                case 'audio':
                  parts.push({
                    inlineData: {
                      mimeType: `audio/${c.format ?? 'mp3'}`,
                      data: c.data,
                    },
                  });
                  break;
                case 'file':
                  if ('fileUri' in c) {
                    parts.push({
                      fileData: { mimeType: c.mimeType, fileUri: c.fileUri },
                    });
                  } else {
                    parts.push({
                      inlineData: { mimeType: c.mimeType, data: c.data },
                    });
                  }
                  break;
              }
            }
          }
          if (parts.length > 0) {
            contents.push({ role: 'user' as const, parts });
          }
        } else if (msg.role === 'assistant' && msg.content) {
          contents.push({
            role: 'model' as const,
            parts: [{ text: msg.content }],
          });
        }
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Extract dynamic (non-cached) content from chat prompt.
   * Excludes: system prompts (always cached) + messages/parts marked with cache: true.
   */
  private extractDynamicContent(
    chatPrompt: AxInternalChatRequest<AxAIGoogleGeminiModel>['chatPrompt']
  ): {
    dynamicContents: AxAIGoogleGeminiContent[];
    dynamicSystemInstruction?: AxAIGoogleGeminiContent;
  } {
    const dynamicSystemInstruction: AxAIGoogleGeminiContent | undefined =
      undefined;
    const dynamicContents: AxAIGoogleGeminiContent[] = [];

    for (const msg of chatPrompt) {
      // System prompts are always cached, so skip them
      if (msg.role === 'system') {
        continue;
      }

      // Skip messages marked with cache: true (they're in the cache)
      if ('cache' in msg && msg.cache) {
        continue;
      }

      // Otherwise include as dynamic content
      if (msg.role === 'user') {
        const parts: AxAIGoogleGeminiContentPart[] = [];
        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            // Skip cached parts
            if ('cache' in c && c.cache) {
              continue;
            }
            switch (c.type) {
              case 'text':
                parts.push({ text: c.text });
                break;
              case 'image':
                parts.push({
                  inlineData: { mimeType: c.mimeType, data: c.image },
                });
                break;
              case 'audio':
                parts.push({
                  inlineData: {
                    mimeType: `audio/${c.format ?? 'mp3'}`,
                    data: c.data,
                  },
                });
                break;
              case 'file':
                if ('fileUri' in c) {
                  parts.push({
                    fileData: { mimeType: c.mimeType, fileUri: c.fileUri },
                  });
                } else {
                  parts.push({
                    inlineData: { mimeType: c.mimeType, data: c.data },
                  });
                }
                break;
            }
          }
        }
        if (parts.length > 0) {
          dynamicContents.push({ role: 'user' as const, parts });
        }
      } else if (msg.role === 'assistant') {
        const parts: AxAIGoogleGeminiContentPart[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.functionCalls) {
          for (const f of msg.functionCalls) {
            let args: object;
            if (typeof f.function.params === 'string') {
              try {
                args = JSON.parse(f.function.params);
              } catch {
                args = {};
              }
            } else {
              args = f.function.params ?? {};
            }
            parts.push({ functionCall: { name: f.function.name, args } });
          }
        }
        if (parts.length > 0) {
          dynamicContents.push({ role: 'model' as const, parts });
        }
      } else if (msg.role === 'function') {
        dynamicContents.push({
          role: 'user' as const,
          parts: [
            {
              functionResponse: {
                name: msg.functionId,
                response: { result: msg.result },
              },
            },
          ],
        });
      }
    }

    return { dynamicContents, dynamicSystemInstruction };
  }
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
        structuredOutputs: mi?.supported?.structuredOutputs ?? false,
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
          supported: aiImpl.supportsContextCache(model),
          types: ['persistent'] as ('ephemeral' | 'persistent')[],
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

      // Extract per-model thinkingLevelMapping if provided
      if (cfg.thinkingLevelMapping) {
        out.thinkingLevelMapping = cfg.thinkingLevelMapping;
      }

      // Extract per-model thinkingTokenBudgetLevels if provided
      if (cfg.thinkingTokenBudgetLevels) {
        out.thinkingTokenBudgetLevels = cfg.thinkingTokenBudgetLevels;
      }

      return out as typeof item;
    });

    // Pass normalized models to impl for model-key lookup
    if (normalizedModels) {
      aiImpl.setModels(normalizedModels);
    } else if (models) {
      aiImpl.setModels(models);
    }

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
