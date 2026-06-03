import {
  type AxAIFeatures,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

import { axModelInfoCohere } from './info.js';
import { AxAICohereEmbedModel, AxAICohereModel } from './types.js';

type AxAICohereOpenAIConfig = AxAIOpenAIConfig<
  AxAICohereModel,
  AxAICohereEmbedModel
>;

/**
 * Creates the default configuration for Cohere AI service.
 */
export const axAICohereDefaultConfig = (): AxAICohereOpenAIConfig =>
  structuredClone({
    model: AxAICohereModel.CommandRPlus,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultConfig(),
  });

/**
 * Creates a creative configuration for Cohere AI service.
 */
export const axAICohereCreativeConfig = (): AxAICohereOpenAIConfig =>
  structuredClone({
    model: AxAICohereModel.CommandR,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultCreativeConfig(),
  });

export type AxAICohereArgs<TModelKey> = AxAIOpenAIArgs<
  'cohere',
  AxAICohereModel,
  AxAICohereEmbedModel,
  TModelKey
>;

const cohereSupportFor: AxAIFeatures = {
  functions: true,
  streaming: true,
  hasThinkingBudget: false,
  hasShowThoughts: false,
  media: {
    images: {
      supported: false,
      formats: [],
      maxSize: 0,
      detailLevels: [],
    },
    audio: {
      supported: false,
      formats: [],
      maxDuration: 0,
    },
    files: {
      supported: false,
      formats: [],
      maxSize: 0,
      uploadMethod: 'none',
    },
    urls: {
      supported: false,
      webSearch: false,
      contextFetching: false,
    },
  },
  caching: {
    supported: false,
    types: [],
  },
  thinking: false,
  multiTurn: true,
};

const normalizeOpenAIModelPresets = <TModelKey>(
  models: AxAICohereArgs<TModelKey>['models']
): AxAICohereArgs<TModelKey>['models'] =>
  models?.map((item) => {
    const anyItem = item as any;
    const cfg = anyItem?.config;
    if (!cfg) return item;
    const modelConfig: Record<string, unknown> = {};
    if (cfg.maxTokens !== undefined) modelConfig.maxTokens = cfg.maxTokens;
    if (cfg.temperature !== undefined)
      modelConfig.temperature = cfg.temperature;
    if (cfg.topP !== undefined) modelConfig.topP = cfg.topP;
    if (cfg.presencePenalty !== undefined)
      modelConfig.presencePenalty = cfg.presencePenalty;
    if (cfg.frequencyPenalty !== undefined)
      modelConfig.frequencyPenalty = cfg.frequencyPenalty;
    const stopSeq = cfg.stopSequences ?? cfg.stop;
    if (stopSeq !== undefined) modelConfig.stopSequences = stopSeq;
    if (cfg.n !== undefined) modelConfig.n = cfg.n;
    if (cfg.stream !== undefined) modelConfig.stream = cfg.stream;
    return Object.keys(modelConfig).length > 0
      ? {
          ...anyItem,
          modelConfig: { ...(anyItem.modelConfig ?? {}), ...modelConfig },
        }
      : item;
  }) as AxAICohereArgs<TModelKey>['models'];

/**
 * Cohere provider using Cohere's OpenAI compatibility endpoint.
 */
export class AxAICohere<TModelKey> extends AxAIOpenAIBase<
  AxAICohereModel,
  AxAICohereEmbedModel,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAICohereArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set');
    }

    const Config = {
      ...axAICohereDefaultConfig(),
      ...config,
    };

    modelInfo = [...axModelInfoCohere, ...(modelInfo ?? [])];

    super({
      apiKey,
      config: Config,
      options,
      apiURL: 'https://api.cohere.ai/compatibility/v1',
      modelInfo,
      models: normalizeOpenAIModelPresets(models),
      supportFor: cohereSupportFor,
    });

    super.setName('Cohere');
  }
}
