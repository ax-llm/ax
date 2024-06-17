import type { AxModelInfo } from '../types.js';

import { AxCohereEmbedModel, AxCohereModel } from './types.js';

export const axModelInfoCohere: AxModelInfo[] = [
  {
    name: AxCohereModel.CommandRPlus,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15
  },
  {
    name: AxCohereModel.CommandR,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: AxCohereModel.Command,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: AxCohereModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.6
  },
  {
    name: AxCohereEmbedModel.EmbedEnglishLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: AxCohereEmbedModel.EmbedEnglishV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: AxCohereEmbedModel.EmbedMultiLingualV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: AxCohereEmbedModel.EmbedMultiLingualLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  }
];
