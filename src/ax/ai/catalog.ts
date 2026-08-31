import { axModelInfoAnthropic } from './anthropic/info.js';
import { AxAIAnthropicModel } from './anthropic/types.js';
import { axModelInfoCohere } from './cohere/info.js';
import { AxAICohereModel } from './cohere/types.js';
import { axModelInfoDeepSeek } from './deepseek/info.js';
import { AxAIDeepSeekModel } from './deepseek/types.js';
import { axModelInfoGoogleGemini } from './google-gemini/info.js';
import { axIsGeminiLiveAudioModel } from './google-gemini/live_audio.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import { axModelInfoMistral } from './mistral/info.js';
import { AxAIMistralModel } from './mistral/types.js';
import { AxAIOpenAIEmbedModel, AxAIOpenAIModel } from './openai/chat_types.js';
import {
  axModelInfoOpenAI,
  axModelInfoOpenAIResponses,
} from './openai/info.js';
import { axIsOpenAIRealtimeModel } from './openai/realtime.js';
import { AxAIOpenAIResponsesModel } from './openai/responses_types.js';
import {
  type AxAIProfileSummary,
  axAIProfiles,
  axResolveAIProfileFeatures,
} from './provider_profiles.js';
import { axModelInfoReka } from './reka/info.js';
import { AxAIRekaModel } from './reka/types.js';
import type {
  AxAIServiceOptions,
  AxModelInfo,
  AxServiceTier,
} from './types.js';
// axir-nonportable:start webllm
import { axModelInfoWebLLM } from './webllm/info.js';
import { AxAIWebLLMModel } from './webllm/types.js';
import type { AxAIArgs } from './wrap.js';
// axir-nonportable:end webllm
import { axIsGrokVoiceModel } from './x-grok/api.js';
import { axModelInfoGrok } from './x-grok/info.js';
import { AxAIGrokModel } from './x-grok/types.js';

export type AxAIModelCatalogProviderName = AxAIArgs<string>['name'];

/** Portable thinking levels accepted by Ax for a catalog provider or model. */
export type AxAIModelCatalogThinkingLevel = NonNullable<
  AxAIServiceOptions['thinkingTokenBudget']
>;

export type AxAIModelCatalogModelCapabilities = {
  thinkingBudget: boolean;
  /** Portable Ax thinking levels accepted for this model. Levels may collapse onto the same provider-native value. */
  thinkingLevels: AxAIModelCatalogThinkingLevel[];
  showThoughts: boolean;
  structuredOutputs: boolean;
  temperature: boolean;
  topP: boolean;
  audioInput: boolean;
  audioOutput: boolean;
  /** Verified explicit request tiers. `auto` remains available as the provider-delegated policy. */
  serviceTiers: AxServiceTier[];
};

export type AxAIModelCatalogProviderCapabilities = {
  thinking: boolean;
  /** Portable Ax thinking levels accepted by the provider's default model. */
  thinkingLevels: AxAIModelCatalogThinkingLevel[];
  /** Verified explicit request tiers for the provider's default deployment profile. */
  serviceTiers: AxServiceTier[];
};

export type AxAIModelCatalogAudioSupport = {
  input?: boolean;
  output?: boolean;
};

export type AxAIModelCatalogModelType =
  | 'text'
  | 'embeddings'
  | 'code'
  | 'audio';

export type AxAIModelCatalogFilter = 'all' | AxAIModelCatalogModelType;

export type AxAIModelCatalogModel = AxModelInfo & {
  provider: AxAIModelCatalogProviderName;
  audio?: AxAIModelCatalogAudioSupport;
  type: AxAIModelCatalogModelType;
  isDefault: boolean;
  capabilities: AxAIModelCatalogModelCapabilities;
};

export type AxAIModelCatalogProvider = {
  name: AxAIModelCatalogProviderName;
  displayName: string;
  defaultModel?: string;
  defaultEmbedModel?: string;
  isDynamic: boolean;
  capabilities: AxAIModelCatalogProviderCapabilities;
  models: AxAIModelCatalogModel[];
};

export type AxAIModelCatalogOptions = {
  type?: AxAIModelCatalogFilter | readonly AxAIModelCatalogFilter[];
};

type AxAIModelCatalogModelInfo = AxModelInfo & {
  audio?: AxAIModelCatalogAudioSupport;
};

type AxAIModelCatalogProviderDefinition = Omit<
  AxAIModelCatalogProvider,
  'models' | 'name'
> & {
  modelInfo: readonly AxAIModelCatalogModelInfo[];
};

// Keep this keyed by AxAIArgs['name'] so new ai(...) providers must add catalog metadata.
const axKnownModelCatalogProviderDefinitions = {
  openai: {
    displayName: 'OpenAI',
    defaultModel: AxAIOpenAIModel.GPT5Mini,
    defaultEmbedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    isDynamic: false,
    modelInfo: axModelInfoOpenAI,
  },
  'openai-responses': {
    displayName: 'OpenAI Responses',
    defaultModel: AxAIOpenAIResponsesModel.GPT4O,
    defaultEmbedModel: AxAIOpenAIEmbedModel.TextEmbeddingAda002,
    isDynamic: false,
    modelInfo: axModelInfoOpenAIResponses,
  },
  'azure-openai': {
    displayName: 'Azure OpenAI',
    isDynamic: true,
    modelInfo: [],
  },
  anthropic: {
    displayName: 'Anthropic',
    defaultModel: AxAIAnthropicModel.Claude37Sonnet,
    isDynamic: false,
    modelInfo: axModelInfoAnthropic,
  },
  'google-gemini': {
    displayName: 'Google Gemini',
    defaultModel: AxAIGoogleGeminiModel.Gemini25Flash,
    defaultEmbedModel: AxAIGoogleGeminiEmbedModel.GeminiEmbedding2,
    isDynamic: false,
    modelInfo: axModelInfoGoogleGemini,
  },
  cohere: {
    displayName: 'Cohere',
    defaultModel: AxAICohereModel.CommandRPlus,
    isDynamic: false,
    modelInfo: axModelInfoCohere,
  },
  deepseek: {
    displayName: 'DeepSeek',
    defaultModel: AxAIDeepSeekModel.DeepSeekV4Flash,
    isDynamic: false,
    modelInfo: axModelInfoDeepSeek,
  },
  'deepseek-responses': {
    displayName: 'DeepSeek Responses',
    defaultModel: AxAIDeepSeekModel.DeepSeekV4Flash,
    isDynamic: false,
    modelInfo: axModelInfoDeepSeek,
  },
  mistral: {
    displayName: 'Mistral AI',
    defaultModel: AxAIMistralModel.MistralSmall,
    isDynamic: false,
    modelInfo: axModelInfoMistral,
  },
  reka: {
    displayName: 'Reka',
    defaultModel: AxAIRekaModel.RekaCore,
    isDynamic: false,
    modelInfo: axModelInfoReka,
  },
  grok: {
    displayName: 'xAI Grok',
    defaultModel: AxAIGrokModel.Grok46,
    isDynamic: false,
    modelInfo: axModelInfoGrok,
  },
  // axir-nonportable:start webllm
  webllm: {
    displayName: 'WebLLM',
    defaultModel: AxAIWebLLMModel.Llama32_3B_Instruct,
    isDynamic: false,
    modelInfo: axModelInfoWebLLM,
  },
  // axir-nonportable:end webllm
} as const;

const axAIModelCatalogProviderDefinitions = {
  ...Object.fromEntries(
    axAIProfiles().map((profile) => [
      profile.id,
      {
        displayName: profile.name,
        isDynamic: true,
        modelInfo: [],
      },
    ])
  ),
  ...axKnownModelCatalogProviderDefinitions,
} as unknown as Record<
  AxAIModelCatalogProviderName,
  AxAIModelCatalogProviderDefinition
>;

const axAIModelCatalogProfiles = new Map(
  axAIProfiles().map((profile) => [profile.id, profile] as const)
);

const axAIModelCatalogThinkingLevels = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'highest',
] as const satisfies readonly AxAIModelCatalogThinkingLevel[];

const axProfileModelRule = (
  profile: Readonly<AxAIProfileSummary>,
  model: string
) =>
  profile.modelRules.find(
    (rule) =>
      (rule.match.exact?.includes(model) ?? false) ||
      (rule.match.prefix?.some((prefix) => model.startsWith(prefix)) ??
        false) ||
      (rule.match.contains?.some((part) =>
        model.toLowerCase().includes(part.toLowerCase())
      ) ??
        false)
  );

const axThinkingLevelsFor = (
  profile: Readonly<AxAIProfileSummary>,
  model: string,
  supported: boolean
): AxAIModelCatalogThinkingLevel[] => {
  if (!supported) return [];

  const unsupported = axProfileModelRule(profile, model)?.request
    ?.unsupportedThinkingLevels;
  return axAIModelCatalogThinkingLevels.filter(
    (level) => !Object.hasOwn(unsupported ?? {}, level)
  );
};

const axServiceTiersFor = (
  provider: AxAIModelCatalogProviderName,
  model: Readonly<AxAIModelCatalogModelInfo>,
  type: AxAIModelCatalogModelType
): AxServiceTier[] => {
  if (type === 'embeddings') return [];

  if (
    (provider === 'openai' && axIsOpenAIRealtimeModel(model.name)) ||
    (provider === 'google-gemini' && axIsGeminiLiveAudioModel(model.name)) ||
    (provider === 'grok' && axIsGrokVoiceModel(model.name))
  ) {
    return [];
  }

  if (model.supported?.serviceTiers !== undefined) {
    return [...model.supported.serviceTiers];
  }

  return [
    ...(axResolveAIProfileFeatures(provider, model.name).serviceTiers ?? []),
  ];
};

const axProviderCapabilities = (
  profile: Readonly<AxAIProfileSummary>,
  defaultModel: string | undefined
): AxAIModelCatalogProviderCapabilities => {
  const model = defaultModel ?? profile.defaultModel ?? '';
  const features = axResolveAIProfileFeatures(profile.id, model);

  return {
    thinking: features.thinking,
    thinkingLevels: axThinkingLevelsFor(
      profile,
      model,
      features.hasThinkingBudget ?? false
    ),
    serviceTiers: [...(features.serviceTiers ?? [])],
  };
};

const axCloneModelInfo = (
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModelInfo => {
  const clone: AxAIModelCatalogModelInfo = { ...model };

  if (model.aliases) {
    clone.aliases = [...model.aliases];
  }
  if (model.supported) {
    clone.supported = {
      ...model.supported,
      ...(model.supported.structuredOutputModes
        ? {
            structuredOutputModes: [...model.supported.structuredOutputModes],
          }
        : undefined),
      ...(model.supported.serviceTiers
        ? { serviceTiers: [...model.supported.serviceTiers] }
        : undefined),
    };
  }
  if (model.notSupported) {
    clone.notSupported = { ...model.notSupported };
  }
  if (model.audio) {
    clone.audio = { ...model.audio };
  }

  return clone;
};

const axModelCapabilities = (
  provider: AxAIModelCatalogProviderName,
  profile: Readonly<AxAIProfileSummary>,
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModelCapabilities => {
  const type = axModelType(model);
  const name = model.name.toLowerCase();
  const thinkingBudget = model.supported?.thinkingBudget ?? false;

  return {
    thinkingBudget,
    thinkingLevels: axThinkingLevelsFor(profile, model.name, thinkingBudget),
    showThoughts: model.supported?.showThoughts ?? false,
    structuredOutputs: model.supported?.structuredOutputs ?? false,
    temperature: !(model.notSupported?.temperature ?? false),
    topP: !(model.notSupported?.topP ?? false),
    audioInput: model.audio?.input ?? type === 'audio',
    audioOutput:
      model.audio?.output ??
      (type === 'audio' &&
        !name.includes('whisper') &&
        !name.includes('transcription')),
    serviceTiers: axServiceTiersFor(provider, model, type),
  };
};

const axModelType = (
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModelType => {
  const name = model.name.toLowerCase();

  if (
    model.audio?.input ||
    model.audio?.output ||
    name.includes('audio') ||
    name.includes('realtime') ||
    name.includes('voice') ||
    name.includes('whisper') ||
    name.includes('native-audio')
  ) {
    return 'audio';
  }

  if (name.includes('embedding') || name.includes('embed')) {
    return 'embeddings';
  }

  if (
    name.includes('code') ||
    name.includes('codex') ||
    name.includes('coder') ||
    name.includes('codestral')
  ) {
    return 'code';
  }

  return 'text';
};

const axModelCatalogFilterSet = (
  type: AxAIModelCatalogOptions['type']
): Set<AxAIModelCatalogFilter> | undefined => {
  if (type === undefined) return;

  const filters = Array.isArray(type) ? type : [type];
  if (filters.includes('all')) return;

  return new Set(filters);
};

const axMatchesModelCatalogFilter = (
  model: Readonly<AxAIModelCatalogModel>,
  filters: ReadonlySet<AxAIModelCatalogFilter> | undefined
): boolean => {
  if (!filters) return true;
  if (filters.has(model.type)) return true;

  return filters.has('text') && model.type === 'code';
};

const axModelCatalogPrice = (
  model: Readonly<AxModelInfo> | undefined
): number => {
  const hasPromptPrice = typeof model?.promptTokenCostPer1M === 'number';
  const hasCompletionPrice =
    typeof model?.completionTokenCostPer1M === 'number';

  if (!hasPromptPrice && !hasCompletionPrice) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    (model?.promptTokenCostPer1M ?? 0) + (model?.completionTokenCostPer1M ?? 0)
  );
};

const axCompareModelCatalogModels = (
  a: Readonly<AxAIModelCatalogModel>,
  b: Readonly<AxAIModelCatalogModel>
): number => {
  const priceDelta = axModelCatalogPrice(a) - axModelCatalogPrice(b);
  if (priceDelta !== 0) return priceDelta;

  return a.name.localeCompare(b.name);
};

const axModelCatalogModel = (
  provider: AxAIModelCatalogProviderName,
  profile: Readonly<AxAIProfileSummary>,
  defaultModel: string | undefined,
  defaultEmbedModel: string | undefined,
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModel => {
  const modelInfo = axCloneModelInfo(model);
  const defaultModels = [defaultModel, defaultEmbedModel].filter(
    (item): item is string => item !== undefined
  );

  return {
    ...modelInfo,
    provider,
    type: axModelType(model),
    isDefault: defaultModels.some(
      (item) => model.name === item || (model.aliases?.includes(item) ?? false)
    ),
    capabilities: axModelCapabilities(provider, profile, model),
  };
};

/**
 * Returns the static Ax AI provider/model catalog.
 *
 * The catalog is built from bundled Ax metadata and does not fetch live provider
 * pricing. Dynamic providers can support arbitrary user-selected models or
 * deployments, so their model lists are intentionally empty or static-limited.
 */
export const axGetSupportedAIModels = (
  options?: Readonly<AxAIModelCatalogOptions>
): AxAIModelCatalogProvider[] => {
  const filters = axModelCatalogFilterSet(options?.type);

  return (
    Object.entries(axAIModelCatalogProviderDefinitions) as [
      AxAIModelCatalogProviderName,
      AxAIModelCatalogProviderDefinition,
    ][]
  )
    .map(
      ([
        name,
        { displayName, defaultModel, defaultEmbedModel, isDynamic, modelInfo },
      ]) => {
        const profile = axAIModelCatalogProfiles.get(name);
        if (!profile) {
          throw new Error(
            `Missing AI profile metadata for catalog provider ${name}`
          );
        }
        const models = modelInfo
          .map((model) =>
            axModelCatalogModel(
              name,
              profile,
              defaultModel,
              defaultEmbedModel,
              model
            )
          )
          .filter((model) => axMatchesModelCatalogFilter(model, filters))
          .sort(axCompareModelCatalogModels);

        return {
          name,
          displayName,
          ...(defaultModel !== undefined ? { defaultModel } : undefined),
          ...(defaultEmbedModel !== undefined
            ? { defaultEmbedModel }
            : undefined),
          isDynamic,
          capabilities: axProviderCapabilities(profile, defaultModel),
          models,
        };
      }
    )
    .sort((a, b) => {
      const priceDelta =
        axModelCatalogPrice(a.models[0]) - axModelCatalogPrice(b.models[0]);
      if (priceDelta !== 0) return priceDelta;

      return a.displayName.localeCompare(b.displayName);
    });
};
