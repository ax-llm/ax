import {
  type AxAIFeatures,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js';
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js';
import type { AxAIOpenAIConfig } from '../openai/chat_types.js';

import { axModelInfoReka } from './info.js';
import { type AxAIRekaConfig, AxAIRekaModel } from './types.js';

type AxAIRekaOpenAIConfig = AxAIOpenAIConfig<AxAIRekaModel, undefined>;

export const axAIRekaDefaultConfig = (): AxAIRekaConfig =>
  structuredClone({
    model: AxAIRekaModel.RekaCore,
    ...axBaseAIDefaultConfig(),
  });

export const axAIRekaBestConfig = (): AxAIRekaConfig =>
  structuredClone({
    ...axAIRekaDefaultConfig(),
    model: AxAIRekaModel.RekaCore,
  });

export const axAIRekaCreativeConfig = (): AxAIRekaConfig =>
  structuredClone({
    model: AxAIRekaModel.RekaCore,
    ...axBaseAIDefaultCreativeConfig(),
  });

export const axAIRekaFastConfig = (): AxAIRekaConfig => ({
  ...axAIRekaDefaultConfig(),
  model: AxAIRekaModel.RekaFlash,
});

export type AxAIRekaArgs<TModelKey> = AxAIOpenAIArgs<
  'reka',
  AxAIRekaModel,
  undefined,
  TModelKey
>;

const rekaSupportFor: AxAIFeatures = {
  functions: true,
  streaming: true,
  hasThinkingBudget: false,
  hasShowThoughts: false,
  media: {
    images: {
      supported: false,
      formats: [],
    },
    audio: {
      supported: false,
      formats: [],
    },
    files: {
      supported: false,
      formats: [],
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
  models: AxAIRekaArgs<TModelKey>['models']
): AxAIRekaArgs<TModelKey>['models'] =>
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
  }) as AxAIRekaArgs<TModelKey>['models'];

export class AxAIReka<TModelKey> extends AxAIOpenAIBase<
  AxAIRekaModel,
  undefined,
  TModelKey
> {
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo,
    models,
  }: Readonly<Omit<AxAIRekaArgs<TModelKey>, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Reka API key not set');
    }

    const Config = {
      ...axAIRekaDefaultConfig(),
      ...config,
    } as AxAIRekaOpenAIConfig;

    modelInfo = [...axModelInfoReka, ...(modelInfo ?? [])];

    super({
      apiKey,
      config: Config,
      options,
      apiURL: apiURL ? apiURL : 'https://api.reka.ai/v1',
      modelInfo,
      models: normalizeOpenAIModelPresets(models),
      supportFor: rekaSupportFor,
    });

    super.setName('Reka');
  }
}
