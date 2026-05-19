import { axModelInfoAnthropic } from './anthropic/info.js';
import { AxAIAnthropicModel } from './anthropic/types.js';
import { axModelInfoCohere } from './cohere/info.js';
import { AxAICohereModel } from './cohere/types.js';
import { axModelInfoDeepSeek } from './deepseek/info.js';
import { AxAIDeepSeekModel } from './deepseek/types.js';
import { axModelInfoGoogleGemini } from './google-gemini/info.js';
import {
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
} from './google-gemini/types.js';
import { axModelInfoGroq } from './groq/info.js';
import { AxAIGroqModel } from './groq/types.js';
import { axModelInfoHuggingFace } from './huggingface/info.js';
import { AxAIHuggingFaceModel } from './huggingface/types.js';
import { axModelInfoMistral } from './mistral/info.js';
import { AxAIMistralModel } from './mistral/types.js';
import { AxAIOpenAIEmbedModel, AxAIOpenAIModel } from './openai/chat_types.js';
import {
  axModelInfoOpenAI,
  axModelInfoOpenAIResponses,
} from './openai/info.js';
import { AxAIOpenAIResponsesModel } from './openai/responses_types.js';
import { axModelInfoReka } from './reka/info.js';
import { AxAIRekaModel } from './reka/types.js';
import { axModelInfoTogether } from './together/info.js';
import { AxAITogetherModel } from './together/types.js';
import type { AxModelInfo } from './types.js';
import { axModelInfoWebLLM } from './webllm/info.js';
import { AxAIWebLLMModel } from './webllm/types.js';
import type { AxAIArgs } from './wrap.js';
import { axModelInfoGrok } from './x-grok/info.js';
import { AxAIGrokModel } from './x-grok/types.js';

export type AxAIModelCatalogProviderName = AxAIArgs<string>['name'];

export type AxAIModelCatalogModelCapabilities = {
  thinkingBudget: boolean;
  showThoughts: boolean;
  structuredOutputs: boolean;
  temperature: boolean;
  topP: boolean;
  audioInput: boolean;
  audioOutput: boolean;
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
const axAIModelCatalogProviderDefinitions = {
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
  groq: {
    displayName: 'Groq',
    defaultModel: AxAIGroqModel.Llama33_70B,
    isDynamic: false,
    modelInfo: axModelInfoGroq,
  },
  cohere: {
    displayName: 'Cohere',
    defaultModel: AxAICohereModel.CommandRPlus,
    isDynamic: false,
    modelInfo: axModelInfoCohere,
  },
  together: {
    displayName: 'Together AI',
    defaultModel: AxAITogetherModel.Llama33_70B,
    isDynamic: false,
    modelInfo: axModelInfoTogether,
  },
  deepseek: {
    displayName: 'DeepSeek',
    defaultModel: AxAIDeepSeekModel.DeepSeekChat,
    isDynamic: false,
    modelInfo: axModelInfoDeepSeek,
  },
  mistral: {
    displayName: 'Mistral AI',
    defaultModel: AxAIMistralModel.MistralSmall,
    isDynamic: false,
    modelInfo: axModelInfoMistral,
  },
  ollama: {
    displayName: 'Ollama',
    defaultModel: 'nous-hermes2',
    defaultEmbedModel: 'all-minilm',
    isDynamic: true,
    modelInfo: [],
  },
  huggingface: {
    displayName: 'Hugging Face',
    defaultModel: AxAIHuggingFaceModel.MetaLlama270BChatHF,
    isDynamic: true,
    modelInfo: axModelInfoHuggingFace,
  },
  openrouter: {
    displayName: 'OpenRouter',
    defaultModel: 'openrouter/auto',
    isDynamic: true,
    modelInfo: [],
  },
  reka: {
    displayName: 'Reka',
    defaultModel: AxAIRekaModel.RekaCore,
    isDynamic: false,
    modelInfo: axModelInfoReka,
  },
  grok: {
    displayName: 'xAI Grok',
    defaultModel: AxAIGrokModel.Grok3,
    isDynamic: false,
    modelInfo: axModelInfoGrok,
  },
  webllm: {
    displayName: 'WebLLM',
    defaultModel: AxAIWebLLMModel.Llama32_3B_Instruct,
    isDynamic: false,
    modelInfo: axModelInfoWebLLM,
  },
} satisfies Record<
  AxAIModelCatalogProviderName,
  AxAIModelCatalogProviderDefinition
>;

const axCloneModelInfo = (
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModelInfo => {
  const clone: AxAIModelCatalogModelInfo = { ...model };

  if (model.aliases) {
    clone.aliases = [...model.aliases];
  }
  if (model.supported) {
    clone.supported = { ...model.supported };
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
  model: Readonly<AxAIModelCatalogModelInfo>
): AxAIModelCatalogModelCapabilities => {
  const type = axModelType(model);
  const name = model.name.toLowerCase();

  return {
    thinkingBudget: model.supported?.thinkingBudget ?? false,
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

const axModelCatalogPrice = (model: Readonly<AxModelInfo>): number => {
  const hasPromptPrice = typeof model.promptTokenCostPer1M === 'number';
  const hasCompletionPrice = typeof model.completionTokenCostPer1M === 'number';

  if (!hasPromptPrice && !hasCompletionPrice) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    (model.promptTokenCostPer1M ?? 0) + (model.completionTokenCostPer1M ?? 0)
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
    capabilities: axModelCapabilities(model),
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
        const models = modelInfo
          .map((model) =>
            axModelCatalogModel(name, defaultModel, defaultEmbedModel, model)
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
          models,
        };
      }
    )
    .sort((a, b) => {
      const priceDelta =
        axModelCatalogPrice(a.models[0] ?? {}) -
        axModelCatalogPrice(b.models[0] ?? {});
      if (priceDelta !== 0) return priceDelta;

      return a.displayName.localeCompare(b.displayName);
    });
};
