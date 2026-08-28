import { getModelInfo } from '../../dsp/modelinfo.js';
import type { AxAPI } from '../../util/apicall.js';
import { AxAIRefusalError } from '../../util/apicall.js';
import { randomUUID } from '../../util/crypto.js';
import { axFetchJsonSpeech } from '../audio/api.js';
import { axAudioMimeType } from '../audio/util.js';
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { resolveVertexAIHost } from '../vertex.js';

/**
 * Check if a model is a Gemini 3 model
 */
const isGemini3Model = (model: string): boolean => model.includes('gemini-3');

/**
 * Gemini 3.7 Flash, 3.6 Flash, and 3.5 Flash-Lite use server-managed
 * sampling and ignore temperature, topP, and topK.
 */
const usesServerManagedSampling = (model: string): boolean =>
  model === 'gemini-3.7-flash' ||
  model === 'gemini-3.6-flash' ||
  model === 'gemini-3.5-flash-lite';

import type {
  AxAICredentialProvider,
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
  AxSpeechRequest,
  AxSpeechResponse,
  AxThoughtBlockItem,
  AxTokenUsage,
  AxTranscriptionRequest,
  AxTranscriptionResponse,
} from '../types.js';
import { axModelInfoGoogleGemini } from './info.js';
import {
  axCreateGeminiLiveAudioApi,
  axMapGeminiLiveAudioPart,
  axResolveGeminiLiveAudioConfig,
  axShouldUseGeminiLiveAudio,
} from './live_audio.js';
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

type AxGeminiLogicalThinkingLevel =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'highest';

type AxGemini3ThinkingFamily = 'full' | 'no-minimal' | 'image' | 'legacy-pro';

const axGeminiLogicalThinkingLevels = new Set<AxGeminiLogicalThinkingLevel>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'highest',
]);

const getGemini3ThinkingFamily = (
  model: string
): AxGemini3ThinkingFamily | undefined => {
  const normalized = model.toLowerCase();
  if (!isGemini3Model(normalized)) return undefined;
  if (normalized.includes('-image')) return 'image';
  if (normalized.includes('gemini-3-pro')) return 'legacy-pro';
  if (
    normalized.includes('gemini-3.7-flash') ||
    normalized.includes('gemini-3.1-pro')
  ) {
    return 'no-minimal';
  }
  return 'full';
};

const clampGemini3ThinkingLevel = (
  model: string,
  level: AxAIGoogleGeminiThinkingLevel
): AxAIGoogleGeminiThinkingLevel => {
  switch (getGemini3ThinkingFamily(model)) {
    case 'image':
      return level === 'minimal' || level === 'low' ? 'minimal' : 'high';
    case 'legacy-pro':
      return level === 'minimal' || level === 'low' ? 'low' : 'high';
    case 'no-minimal':
      return level === 'minimal' ? 'low' : level;
    case 'full':
    case undefined:
      return level;
  }
};

const resolveGeminiThinkingConfig = ({
  model,
  direct,
  logicalLevel,
  showThoughts,
  thinkingLevelMapping,
  thinkingTokenBudgetLevels,
}: {
  model: string;
  direct?: AxAIGoogleGeminiConfig['thinking'];
  logicalLevel?: AxAIServiceOptions['thinkingTokenBudget'] | number;
  showThoughts?: boolean;
  thinkingLevelMapping?: AxAIGoogleGeminiThinkingLevelMapping;
  thinkingTokenBudgetLevels?: AxAIGoogleGeminiConfig['thinkingTokenBudgetLevels'];
}): NonNullable<AxAIGoogleGeminiGenerationConfig['thinkingConfig']> => {
  const thinkingConfig: NonNullable<
    AxAIGoogleGeminiGenerationConfig['thinkingConfig']
  > = {};
  const gemini3Family = getGemini3ThinkingFamily(model);

  if (direct?.thinkingTokenBudget !== undefined) {
    if (gemini3Family) {
      throw new Error(
        `Gemini 3 models (${model}) do not support numeric thinkingTokenBudget. ` +
          `Use a logical thinkingTokenBudget level or thinkingLevel instead.`
      );
    }
    thinkingConfig.thinkingBudget =
      model.includes('gemini-2.5-pro') && direct.thinkingTokenBudget === 0
        ? (thinkingTokenBudgetLevels?.minimal ?? 200)
        : direct.thinkingTokenBudget;
  }

  if (direct?.thinkingLevel !== undefined && gemini3Family) {
    thinkingConfig.thinkingLevel = clampGemini3ThinkingLevel(
      model,
      direct.thinkingLevel
    );
  }

  if (direct?.includeThoughts !== undefined) {
    thinkingConfig.includeThoughts = direct.includeThoughts;
  }

  if (logicalLevel !== undefined) {
    if (typeof logicalLevel === 'number') {
      if (gemini3Family) {
        throw new Error(
          `Gemini 3 models (${model}) do not support numeric thinkingTokenBudget. ` +
            `Use a logical thinkingTokenBudget level instead.`
        );
      }
      thinkingConfig.thinkingBudget =
        model.includes('gemini-2.5-pro') && logicalLevel === 0
          ? (thinkingTokenBudgetLevels?.minimal ?? 200)
          : logicalLevel;
      delete thinkingConfig.thinkingLevel;
    } else {
      if (!axGeminiLogicalThinkingLevels.has(logicalLevel)) {
        throw new Error(
          `Unsupported Gemini thinkingTokenBudget level '${String(logicalLevel)}'`
        );
      }

      if (gemini3Family) {
        const mappingKey = logicalLevel === 'none' ? 'minimal' : logicalLevel;
        const defaultLevel =
          mappingKey === 'highest'
            ? 'high'
            : (mappingKey as AxAIGoogleGeminiThinkingLevel);
        const mappedLevel = thinkingLevelMapping?.[mappingKey] ?? defaultLevel;
        thinkingConfig.thinkingLevel = clampGemini3ThinkingLevel(
          model,
          mappedLevel
        );
        delete thinkingConfig.thinkingBudget;
      } else {
        const minimum = thinkingTokenBudgetLevels?.minimal ?? 200;
        const budgets: Record<AxGeminiLogicalThinkingLevel, number> = {
          none: model.includes('gemini-2.5-pro') ? minimum : 0,
          minimal: minimum,
          low: thinkingTokenBudgetLevels?.low ?? 800,
          medium: thinkingTokenBudgetLevels?.medium ?? 5000,
          high: thinkingTokenBudgetLevels?.high ?? 10000,
          highest: thinkingTokenBudgetLevels?.highest ?? 24500,
        };
        thinkingConfig.thinkingBudget = budgets[logicalLevel];
        delete thinkingConfig.thinkingLevel;
      }
    }
  }

  if (showThoughts !== undefined) {
    thinkingConfig.includeThoughts = showThoughts;
  }
  if (logicalLevel === 'none') {
    thinkingConfig.includeThoughts = false;
  }

  if (thinkingConfig.thinkingLevel !== undefined) {
    delete thinkingConfig.thinkingBudget;
  }
  return thinkingConfig;
};

export { axAIGoogleGeminiLiveAudioDefaultConfig } from './live_audio.js';

const getVertexGeminiAPIVersion = (
  _model: string,
  beta?: boolean
): 'v1' | 'v1beta1' => (beta ? 'v1beta1' : 'v1');

/**
 * Clean function schema for Gemini API compatibility by removing unsupported fields.
 * Gemini structured outputs support `additionalProperties` and nullable type
 * unions such as `["string", "null"]`.
 */
const cleanSchemaForGemini = (schema: any): any => {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const cleaned = { ...schema };
  const isNullableUnion =
    Array.isArray(cleaned.type) &&
    cleaned.type.length === 2 &&
    cleaned.type.includes('null');

  // Remove unsupported fields
  delete cleaned.default;
  delete cleaned.optional;
  delete cleaned.oneOf;
  delete cleaned.anyOf;

  // Gemini does not support type unions (type as an array).
  // Preserve nullable unions, which Gemini supports for optional fields.
  // Convert to a single concrete type, preferring 'object' for flexible
  // json/object types (e.g. json[] signature produces items with
  // type: ["object","array","string","number","boolean","null"]).
  if (Array.isArray(cleaned.type) && !isNullableUnion) {
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

const resolveFunctionResponseName = (
  chatPrompt: AxInternalChatRequest<AxAIGoogleGeminiModel>['chatPrompt'],
  currentIndex: number,
  functionId: string
): string => {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = chatPrompt[i];
    if (msg?.role !== 'assistant' || !msg.functionCalls) {
      continue;
    }

    const matchingCall = msg.functionCalls.find(
      (call) => call.id === functionId
    );
    if (matchingCall?.function?.name) {
      return matchingCall.function.name;
    }
  }

  return functionId;
};

type GeminiFunctionResultMessage = Extract<
  AxInternalChatRequest<AxAIGoogleGeminiModel>['chatPrompt'][number],
  { role: 'function' }
>;

const mapFunctionResultParts = (
  chatPrompt: AxInternalChatRequest<AxAIGoogleGeminiModel>['chatPrompt'],
  index: number,
  msg: GeminiFunctionResultMessage
): AxAIGoogleGeminiContentPart[] => {
  const raw = msg.protocolResult?.value as
    | { structuredContent?: Record<string, unknown> }
    | undefined;
  const parts: AxAIGoogleGeminiContentPart[] = [
    {
      functionResponse: {
        name: resolveFunctionResponseName(chatPrompt, index, msg.functionId),
        response: {
          result: msg.result,
          ...(raw?.structuredContent
            ? { structuredContent: raw.structuredContent }
            : {}),
        },
      },
    },
  ];
  for (const content of msg.content ?? []) {
    if (content.type === 'text') {
      parts.push({ text: content.text });
    } else if (content.type === 'image') {
      parts.push({
        inlineData: { mimeType: content.mimeType, data: content.image },
      });
    } else if (content.type === 'audio') {
      parts.push({
        inlineData: {
          mimeType: content.mimeType ?? 'application/octet-stream',
          data: content.data,
        },
      });
    } else if (content.type === 'file') {
      parts.push({
        inlineData: { mimeType: content.mimeType, data: content.data },
      });
    } else {
      parts.push({
        text:
          content.cachedContent ??
          [content.title, content.description, content.url]
            .filter(Boolean)
            .join('\n'),
      });
    }
  }
  return parts;
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
    // 'none' starts at minimal, is model-clamped, and always hides thoughts.
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
      // 'none' starts at minimal, is model-clamped, and always hides thoughts.
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
  credentialProvider?: AxAICredentialProvider;
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
    private vertexConfig: { projectId: string; region: string } | undefined,
    private endpointId?: string,
    private apiKey?: string | (() => Promise<string>),
    private credentialProvider?: AxAICredentialProvider,
    private options?: AxAIGoogleGeminiArgs<any>['options'],
    private vertexApiURLForModel?: (model: string, beta?: boolean) => string
  ) {
    if (!this.isVertex && this.config.autoTruncate) {
      throw new Error('Auto truncate is not supported for GoogleGemini');
    }

    resolveGeminiThinkingConfig({
      model: this.config.model,
      direct: this.config.thinking,
      thinkingLevelMapping: this.config.thinkingLevelMapping,
      thinkingTokenBudgetLevels: this.config.thinkingTokenBudgetLevels,
    });
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

  private get isVertex(): boolean {
    return this.vertexConfig !== undefined;
  }

  private getVertexApiURL(model: string, beta?: boolean): string | undefined {
    return this.isVertex ? this.vertexApiURLForModel?.(model, beta) : undefined;
  }

  async transcribe(
    req: Readonly<AxTranscriptionRequest<AxAIGoogleGeminiModel>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxTranscriptionResponse> {
    const model = req.model ?? AxAIGoogleGeminiModel.Gemini25Flash;
    const keyValue =
      typeof this.apiKey === 'function' ? await this.apiKey() : this.apiKey;
    const url = this.isVertex
      ? `${this.getVertexApiURL(model as string, options?.beta)}/models/${model}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType:
                  req.audio.mimeType ??
                  axAudioMimeType(req.audio.format, req.audio.sampleRate),
                data: req.audio.data,
              },
            },
            {
              text:
                req.prompt ??
                'Generate a transcript of the speech in this audio.',
            },
          ],
        },
      ],
    };

    const staticHeaders = {
      'Content-Type': 'application/json',
      ...(this.isVertex && keyValue
        ? { Authorization: `Bearer ${keyValue}` }
        : !this.isVertex && keyValue
          ? { 'x-goog-api-key': keyValue }
          : {}),
    };
    const response = await (options?.fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: this.credentialProvider
        ? {
            ...staticHeaders,
            ...(await this.credentialProvider({
              profile: 'google-gemini',
              operation: 'transcribe',
              method: 'POST',
              url,
            })),
          }
        : staticHeaders,
      body: JSON.stringify(body),
      signal: options?.abortSignal,
    });
    if (!response.ok) {
      throw new Error(
        `Gemini transcription failed: ${response.status} ${response.statusText}`
      );
    }
    const json = (await response.json()) as AxAIGoogleGeminiChatResponse;
    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((part) => ('text' in part ? part.text : ''))
        .join('')
        .trim() ?? '';
    return { text };
  }

  async speak(
    req: Readonly<AxSpeechRequest<AxAIGoogleGeminiModel>>,
    options?: Readonly<AxAIServiceOptions>
  ): Promise<AxSpeechResponse> {
    const model =
      req.model ?? ('gemini-2.5-flash-preview-tts' as AxAIGoogleGeminiModel);
    const keyValue =
      typeof this.apiKey === 'function' ? await this.apiKey() : this.apiKey;
    const url = this.isVertex
      ? `${this.getVertexApiURL(model as string, options?.beta)}/models/${model}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const voice =
      typeof req.voice === 'object' ? req.voice.id : (req.voice ?? 'Kore');
    return await axFetchJsonSpeech({
      url,
      headers: {
        ...(this.isVertex && keyValue
          ? { Authorization: `Bearer ${keyValue}` }
          : !this.isVertex && keyValue
            ? { 'x-goog-api-key': keyValue }
            : {}),
        ...(this.credentialProvider
          ? await this.credentialProvider({
              profile: 'google-gemini',
              operation: 'speak',
              method: 'POST',
              url,
            })
          : {}),
      },
      body: {
        contents: [{ role: 'user', parts: [{ text: req.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      },
      format: req.format ?? 'wav',
      transcript: req.text,
      fetch: options?.fetch,
      abortSignal: options?.abortSignal,
    });
  }

  /**
   * Resolve the Vertex `cachedContents` resource context. Vertex caches live
   * at `/projects/{p}/locations/{r}/cachedContents` (no `publishers/google`
   * segment, unlike chat URLs).
   *
   * @see https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-create#location_support.
   *
   * Returns `undefined` for non-Vertex providers.
   */
  private getVertexCacheContext():
    | {
        baseUrl: string;
        parent: string;
        modelResource: (model: string) => string;
      }
    | undefined {
    if (!this.vertexConfig) return undefined;
    const { projectId, region } = this.vertexConfig;
    const host = resolveVertexAIHost(region);
    const baseUrl = `https://${host}/v1`;
    const parent = `projects/${projectId}/locations/${region}`;
    return {
      baseUrl,
      parent,
      modelResource: (model) => `${parent}/publishers/google/models/${model}`,
    };
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

  private hasProviderDeclaredTools(): boolean {
    return Boolean(
      this.options?.codeExecution ||
        this.options?.googleSearchRetrieval ||
        this.options?.googleSearch ||
        this.options?.googleMaps ||
        this.options?.urlContext
    );
  }

  /**
   * Gemini tools/toolConfig are prefix state rather than ordinary dynamic prompt
   * content. Whether they belong in explicit cached content depends on the
   * cache breakpoint: breakpoints at or after "functions" cache them, while the
   * "system" breakpoint keeps them request-time.
   */
  private buildToolState(
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    config?: Readonly<AxAIServiceOptions>
  ): {
    tools?: AxAIGoogleGeminiChatRequest['tools'];
    toolConfig?: AxAIGoogleGeminiChatRequest['toolConfig'];
    cacheableTools: boolean;
  } {
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

    let toolConfig: AxAIGoogleGeminiChatRequest['toolConfig'];

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
        } as AxAIGoogleGeminiChatRequest['toolConfig'];
      }
    } else if (hasFunctionDeclarations) {
      // Only set default function_calling_config when we actually provide function_declarations
      toolConfig = {
        function_calling_config: { mode: 'AUTO' as const },
      } as AxAIGoogleGeminiChatRequest['toolConfig'];
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
      } as AxAIGoogleGeminiChatRequest['toolConfig'];
    }

    const hasCacheMarkedFunctions =
      req.functions?.some((fn) => fn.cache) ?? false;
    const hasToolState =
      Boolean(tools && tools.length > 0) || Boolean(toolConfig);
    // Gemini explicit cache treats tools/toolConfig as immutable prefix state.
    // If they are present while explicit caching is enabled, they must be part
    // of the cached resource rather than re-declared on generateContent.
    const cacheableProviderTools =
      Boolean(config?.contextCache) && hasToolState;

    return {
      tools,
      toolConfig,
      cacheableTools: hasCacheMarkedFunctions || cacheableProviderTools,
    };
  }

  createChatReq = async (
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    config: Readonly<AxAIServiceOptions>
  ): Promise<[AxAPI, AxAIGoogleGeminiChatRequest]> => {
    const model = req.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;
    const liveAudio = axResolveGeminiLiveAudioConfig(
      this.config.audio,
      req.modelConfig?.audio
    );
    const useLiveAudio = axShouldUseGeminiLiveAudio(
      model,
      this.config.audio,
      req.modelConfig?.audio
    );

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty');
    }

    if (useLiveAudio && this.config.serviceTier) {
      throw new Error(
        'Gemini inference service tiers are not supported by the Live API'
      );
    }

    let apiConfig: AxAPI;
    if (useLiveAudio) {
      if (this.isVertex) {
        throw new Error(
          'Gemini Live audio currently supports Google AI API-key WebSocket sessions only'
        );
      }
      apiConfig = { name: 'gemini-live-audio' };
    } else if (this.endpointId) {
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

    if (!useLiveAudio && this.isVertex) {
      apiConfig.url = this.getVertexApiURL(model as string, config?.beta);
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
                        mimeType:
                          c.mimeType ?? axAudioMimeType(c.format, c.sampleRate),
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

          const assistantAudioTranscript = msg.audio?.transcript;
          if (msg.content || assistantAudioTranscript) {
            parts.push({ text: msg.content ?? assistantAudioTranscript ?? '' });
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

            parts.push(
              ...mapFunctionResultParts(chatPrompt, currentIndex, currentMsg)
            );

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

    const { tools, toolConfig } = this.buildToolState(req, config);

    const effectiveMappings = this.getEffectiveMappings(model);
    const thinkingConfig = resolveGeminiThinkingConfig({
      model,
      direct: this.config.thinking,
      logicalLevel: config?.thinkingTokenBudget,
      showThoughts: config?.showThoughts,
      ...effectiveMappings,
    });

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

    const serverManagedSampling = usesServerManagedSampling(model as string);
    const generationConfig: AxAIGoogleGeminiGenerationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      ...(!serverManagedSampling
        ? {
            temperature:
              req.modelConfig?.temperature ?? this.config.temperature,
          }
        : {}),
      ...(!serverManagedSampling && req.modelConfig?.topP !== undefined
        ? { topP: req.modelConfig.topP }
        : {}),
      ...(!serverManagedSampling
        ? { topK: req.modelConfig?.topK ?? this.config.topK }
        : {}),
      frequencyPenalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      candidateCount: req.modelConfig?.n ?? this.config.n ?? 1,
      stopSequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      responseMimeType: 'text/plain',

      ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
    };

    // Gemini 3+ models require a minimum temperature of 1.0
    if (
      !serverManagedSampling &&
      isGemini3Model(model as string) &&
      (generationConfig.temperature === undefined ||
        generationConfig.temperature < 1)
    ) {
      generationConfig.temperature = 1;
    }

    if (useLiveAudio && (req.responseFormat || this.config.responseFormat)) {
      throw new Error(
        'Gemini Live audio models do not support structured response formats with audio output'
      );
    }

    // Handle structured output
    if (req.responseFormat) {
      if (
        req.responseFormat.type === 'json_schema' &&
        req.responseFormat.schema
      ) {
        // Gemini's live REST endpoint accepts full JSON Schema through
        // responseJsonSchema; responseSchema is the older Gemini schema subset.
        const schema =
          req.responseFormat.schema.schema || req.responseFormat.schema;
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseJsonSchema = cleanSchemaForGemini(schema);
      } else {
        generationConfig.responseMimeType = 'application/json';
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
      ...(this.config.serviceTier
        ? { service_tier: this.config.serviceTier }
        : {}),
    };

    if (useLiveAudio) {
      const keyValue =
        typeof this.apiKey === 'function' ? await this.apiKey() : this.apiKey;
      if (!keyValue) {
        throw new Error('GoogleGemini AI API key not set');
      }
      apiConfig = axCreateGeminiLiveAudioApi({
        model,
        request: reqValue,
        apiKey: keyValue,
        audio: liveAudio!,
      });
    }

    return [apiConfig, reqValue];
  };

  createEmbedReq = async (
    req: Readonly<AxInternalEmbedRequest<AxAIGoogleGeminiEmbedModel>>,
    config?: Readonly<AxAIServiceOptions>
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

      apiConfig.url = this.getVertexApiURL(model as string, config?.beta);

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
      apiConfig = {
        name: `/models/${model}:batchEmbedContents`,
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

          const audio = axMapGeminiLiveAudioPart(part);
          if (audio) {
            result.audio = audio;
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
            const fileSearchCitations = gm.groundingChunks
              .map((ch: any) => ch?.retrievedContext)
              .filter(
                (r: any) =>
                  r &&
                  (typeof r.uri === 'string' || typeof r.media_id === 'string')
              )
              .map((r: any) => ({
                url: (r.uri as string) ?? '',
                title: r.title as string | undefined,
                ...(typeof r.media_id === 'string'
                  ? { mediaId: r.media_id }
                  : {}),
                ...(Array.isArray(r.page_numbers)
                  ? { pageNumbers: r.page_numbers as number[] }
                  : {}),
              }));
            if (fileSearchCitations.length) {
              result.citations = [
                ...(result.citations ?? []),
                ...fileSearchCitations,
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
      const cachedTokens = resp.usageMetadata.cachedContentTokenCount ?? 0;
      const serviceTier =
        resp.usageMetadata.serviceTier === 'unspecified'
          ? 'standard'
          : resp.usageMetadata.serviceTier;
      this.tokensUsed = {
        totalTokens: resp.usageMetadata.totalTokenCount,
        // Subtract cached tokens so promptTokens represents only uncached input,
        // matching Anthropic's convention where cache tokens are reported separately.
        promptTokens: resp.usageMetadata.promptTokenCount - cachedTokens,
        completionTokens: resp.usageMetadata.candidatesTokenCount,
        thoughtsTokens: resp.usageMetadata.thoughtsTokenCount,
        ...(cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {}),
        ...(serviceTier ? { serviceTier } : {}),
      };
    }
    const response: AxChatResponse = {
      results,
      ...(resp.responseId ? { remoteId: resp.responseId } : {}),
      ...(resp.modelVersion
        ? { providerMetadata: { google: { modelVersion: resp.modelVersion } } }
        : {}),
    };
    if (mapsWidgetToken) {
      response.providerMetadata = {
        ...response.providerMetadata,
        google: {
          ...(response.providerMetadata?.google ?? {}),
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
    const { tools, toolConfig, cacheableTools } = this.buildToolState(
      req,
      options
    );

    // Extract cacheable content from the request (system prompt + marked content)
    const { systemInstruction, contents } = this.extractCacheableContent(
      req.chatPrompt
    );

    // If no cacheable content, return undefined
    if (
      !systemInstruction &&
      (!contents || contents.length === 0) &&
      !cacheableTools
    ) {
      return undefined;
    }
    // Build the cache creation request
    const vertexCtx = this.getVertexCacheContext();
    const cacheRequest: AxAIGoogleGeminiCacheCreateRequest = {
      model: vertexCtx ? vertexCtx.modelResource(model) : `models/${model}`,
      ttl: `${ttlSeconds}s`,
      displayName: `ax-cache-${Date.now()}`,
    };

    if (systemInstruction) {
      cacheRequest.systemInstruction = systemInstruction;
    }

    if (contents && contents.length > 0) {
      cacheRequest.contents = contents;
    }

    if (cacheableTools) {
      if (tools && tools.length > 0) {
        cacheRequest.tools = tools;
      }
      if (toolConfig) {
        cacheRequest.toolConfig = toolConfig;
      }
    }

    // Build API endpoint
    let apiPath: string;
    if (vertexCtx) {
      apiPath = `/${vertexCtx.parent}/cachedContents`;
    } else {
      apiPath = '/cachedContents';
    }

    return {
      type: 'create',
      apiConfig: {
        name: apiPath,
        ...(vertexCtx ? { url: vertexCtx.baseUrl } : {}),
      },
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

  getContextCacheToolState = (
    req: Readonly<AxInternalChatRequest<AxAIGoogleGeminiModel>>,
    options: Readonly<AxAIServiceOptions>
  ) => {
    const { tools, toolConfig, cacheableTools } = this.buildToolState(
      req,
      options
    );

    if (!cacheableTools) {
      return undefined;
    }

    const cacheableFunctions = req.functions?.map(
      ({ cache: _cache, ...fn }) => fn
    );
    const hasFunctionState =
      Boolean(cacheableFunctions && cacheableFunctions.length > 0) ||
      Boolean(req.functionCall);

    if (hasFunctionState) {
      return {
        functions: cacheableFunctions,
        functionCall: req.functionCall,
      };
    }

    if (tools || toolConfig) {
      return {
        functions: [
          {
            name: '__gemini_tool_state__',
            description: JSON.stringify({
              tools,
              toolConfig,
            }),
          },
        ],
      };
    }

    return undefined;
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

    const query = new URLSearchParams({ updateMask: 'ttl' });
    const apiPath = `/${cacheName}?${query.toString()}`;

    const vertexCtx = this.getVertexCacheContext();
    return {
      type: 'update',
      apiConfig: {
        name: apiPath,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        ...(vertexCtx ? { url: vertexCtx.baseUrl } : {}),
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
    const apiPath = `/${cacheName}`;

    const vertexCtx = this.getVertexCacheContext();
    return {
      type: 'delete',
      apiConfig: {
        name: apiPath,
        headers: { 'Content-Type': 'application/json' },
        ...(vertexCtx ? { url: vertexCtx.baseUrl } : {}),
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
    options: Readonly<AxAIServiceOptions>,
    existingCacheName: string
  ): Promise<AxPreparedChatRequest<AxAIGoogleGeminiChatRequest>> => {
    const model = req.model;
    const stream = req.modelConfig?.stream ?? this.config.stream;
    const { tools, toolConfig, cacheableTools } = this.buildToolState(
      req,
      options
    );
    // Gemini explicit caches lock systemInstruction, tools, and toolConfig
    // into the cached prefix. When we reference a named cache here, we assume
    // that cached resource was created with compatible tool state already.

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

    // Build the generation config using existing logic
    const serverManagedSampling = usesServerManagedSampling(model as string);
    const effectiveMappings = this.getEffectiveMappings(model);
    const thinkingConfig = resolveGeminiThinkingConfig({
      model,
      direct: this.config.thinking,
      logicalLevel: options.thinkingTokenBudget,
      showThoughts: options.showThoughts,
      ...effectiveMappings,
    });
    const generationConfig: AxAIGoogleGeminiGenerationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      ...(!serverManagedSampling
        ? {
            temperature:
              req.modelConfig?.temperature ?? this.config.temperature,
          }
        : {}),
      ...(!serverManagedSampling && req.modelConfig?.topP !== undefined
        ? { topP: req.modelConfig.topP }
        : {}),
      ...(!serverManagedSampling
        ? { topK: req.modelConfig?.topK ?? this.config.topK }
        : {}),
      frequencyPenalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      candidateCount: req.modelConfig?.n ?? this.config.n ?? 1,
      stopSequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
      responseMimeType: 'text/plain',
      ...(Object.keys(thinkingConfig).length > 0 ? { thinkingConfig } : {}),
    };

    // Gemini 3+ models require a minimum temperature of 1.0
    if (
      !serverManagedSampling &&
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
      ...(this.config.serviceTier
        ? { service_tier: this.config.serviceTier }
        : {}),
    };

    if (!cacheableTools) {
      if (tools && tools.length > 0) {
        chatRequest.tools = tools;
      }
      if (toolConfig) {
        chatRequest.toolConfig = toolConfig;
      }
    }

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
                      mimeType:
                        c.mimeType ?? axAudioMimeType(c.format, c.sampleRate),
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
        } else if (msg.role === 'assistant') {
          const parts: AxAIGoogleGeminiContentPart[] = [];

          // Handle thought blocks for Gemini 3+ thought signature round-tripping
          const thoughtBlocks = (msg as any).thoughtBlocks as
            | AxThoughtBlockItem[]
            | undefined;
          const hasFunctionCalls =
            msg.functionCalls && msg.functionCalls.length > 0;
          const firstSignature = thoughtBlocks?.[0]?.signature;
          const combinedThoughtData =
            thoughtBlocks?.map((b) => b.data).join('') ?? '';

          if (combinedThoughtData) {
            parts.push({
              ...(hasFunctionCalls ? {} : { thought: true }),
              text: combinedThoughtData,
              ...(firstSignature && !hasFunctionCalls
                ? { thought_signature: firstSignature }
                : {}),
            });
          }

          if (msg.functionCalls) {
            for (const [index, f] of msg.functionCalls.entries()) {
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
              const part: AxAIGoogleGeminiContentPart = {
                functionCall: { name: f.function.name, args },
              };
              if (firstSignature && index === 0) {
                part.thought_signature = firstSignature;
              }
              parts.push(part);
            }
          }

          if (msg.content) {
            parts.push({ text: msg.content });
          }

          if (parts.length > 0) {
            contents.push({
              role: 'model' as const,
              parts,
            });
          }
        } else if (msg.role === 'function') {
          contents.push({
            role: 'user' as const,
            parts: mapFunctionResultParts(chatPrompt, i, msg),
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
    let breakpointIndex = -1;

    for (let i = chatPrompt.length - 1; i >= 0; i--) {
      const msg = chatPrompt[i];
      if ('cache' in msg && msg.cache) {
        breakpointIndex = i;
        break;
      }
    }

    for (let i = 0; i < chatPrompt.length; i++) {
      const msg = chatPrompt[i];
      // System prompts are always cached, so skip them
      if (msg.role === 'system') {
        continue;
      }

      // Skip the cached prefix up to and including the breakpoint.
      if (breakpointIndex >= 0 && i <= breakpointIndex) {
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
                    mimeType:
                      c.mimeType ?? axAudioMimeType(c.format, c.sampleRate),
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

        // Handle thought blocks for Gemini 3+ thought signature round-tripping
        const thoughtBlocks = (msg as any).thoughtBlocks as
          | AxThoughtBlockItem[]
          | undefined;
        const hasFunctionCalls =
          msg.functionCalls && msg.functionCalls.length > 0;
        const firstSignature = thoughtBlocks?.[0]?.signature;
        const combinedThoughtData =
          thoughtBlocks?.map((b) => b.data).join('') ?? '';

        if (combinedThoughtData) {
          parts.push({
            ...(hasFunctionCalls ? {} : { thought: true }),
            text: combinedThoughtData,
            ...(firstSignature && !hasFunctionCalls
              ? { thought_signature: firstSignature }
              : {}),
          });
        }

        if (msg.functionCalls) {
          for (const [index, f] of msg.functionCalls.entries()) {
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
            const part: AxAIGoogleGeminiContentPart = {
              functionCall: { name: f.function.name, args },
            };
            // Attach signature only to the first function call
            if (firstSignature && index === 0) {
              part.thought_signature = firstSignature;
            }
            parts.push(part);
          }
        }

        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (parts.length > 0) {
          dynamicContents.push({ role: 'model' as const, parts });
        }
      } else if (msg.role === 'function') {
        dynamicContents.push({
          role: 'user' as const,
          parts: mapFunctionResultParts(chatPrompt, i, msg),
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
    credentialProvider,
    projectId,
    region,
    endpointId,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIGoogleGeminiArgs<TModelKey>, 'name'>>) {
    const vertexConfig =
      projectId !== undefined && region !== undefined
        ? { projectId, region }
        : undefined;
    const Config = {
      ...axAIGoogleGeminiDefaultConfig(),
      ...config,
    };

    if (vertexConfig && Config.serviceTier) {
      throw new Error(
        'Gemini inference service tiers are not supported by Vertex AI'
      );
    }

    let apiURL: string;
    let headers: () => Promise<Record<string, string>>;
    let buildVertexApiURL:
      | ((model: string, beta?: boolean) => string)
      | undefined;

    if (vertexConfig) {
      const { projectId, region } = vertexConfig;
      if (!apiKey && !credentialProvider) {
        throw new Error(
          'GoogleGemini Vertex API key or credential provider not set'
        );
      }
      if (apiKey && typeof apiKey !== 'function') {
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

      const host = resolveVertexAIHost(region);
      buildVertexApiURL = (model: string, beta?: boolean) =>
        `https://${host}/${getVertexGeminiAPIVersion(model, beta)}/projects/${projectId}/locations/${region}/${path}`;
      apiURL = buildVertexApiURL(Config.model);
      headers = async () => ({
        ...(apiKey
          ? {
              Authorization: `Bearer ${
                typeof apiKey === 'function' ? await apiKey() : apiKey
              }`,
            }
          : {}),
      });
    } else {
      if (!apiKey && !credentialProvider) {
        throw new Error(
          'GoogleGemini AI API key or credential provider not set'
        );
      }
      apiURL = 'https://generativelanguage.googleapis.com/v1beta';
      headers = async () => ({
        ...(apiKey
          ? {
              'x-goog-api-key':
                typeof apiKey === 'function' ? await apiKey() : apiKey,
            }
          : {}),
      });
    }

    const aiImpl = new AxAIGoogleGeminiImpl(
      Config,
      vertexConfig,
      endpointId,
      apiKey,
      credentialProvider,
      options,
      buildVertexApiURL
    );

    modelInfo = [...axModelInfoGoogleGemini, ...(modelInfo ?? [])];

    const supportFor = (model: AxAIGoogleGeminiModel) => {
      const isLiveAudioModel = axShouldUseGeminiLiveAudio(model, {
        output: { enabled: true },
      });
      const mi = getModelInfo<
        AxAIGoogleGeminiModel,
        AxAIGoogleGeminiEmbedModel,
        TModelKey
      >({
        model,
        modelInfo,
        models,
      });
      const nativeStructuredOutputs = mi?.supported?.structuredOutputs ?? true;
      const structuredOutputModes =
        mi?.supported?.structuredOutputModes ??
        (nativeStructuredOutputs
          ? (['native', 'function'] as const)
          : (['function'] as const));
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.supported?.thinkingBudget ?? false,
        hasShowThoughts: mi?.supported?.showThoughts ?? false,
        structuredOutputs: structuredOutputModes.includes('native'),
        structuredOutputModes,
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
            formats: isLiveAudioModel
              ? ['pcm16', 'pcm']
              : ['wav', 'mp3', 'aac', 'ogg'],
            maxDuration: 9.5 * 60, // 9.5 minutes for cloud storage
            output: {
              supported: isLiveAudioModel,
              formats: ['pcm16'],
              sampleRate: 24_000,
              voices: ['Kore'],
            },
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
        const presetModel = String(anyItem.model ?? Config.model);
        if (isGemini3Model(presetModel)) {
          throw new Error(
            `Gemini 3 models (${presetModel}) do not support numeric thinkingTokenBudget. ` +
              `Use a logical thinkingTokenBudget level instead.`
          );
        }
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
      credentialProvider,
      profile: 'google-gemini',
      supportFor,
      models: normalizedModels ?? models,
    });
  }
}
