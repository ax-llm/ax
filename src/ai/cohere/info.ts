import type { TextModelInfo } from '../types.js';

import { CohereEmbedModel, CohereModel } from './types.js';

export const modelInfoCohere: TextModelInfo[] = [
  {
    name: CohereModel.CommandRPlus,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15
  },
  {
    name: CohereModel.CommandR,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: CohereModel.Command,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: CohereModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.6
  },
  {
    name: CohereEmbedModel.EmbedEnglishLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: CohereEmbedModel.EmbedEnglishV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: CohereEmbedModel.EmbedMultiLingualV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: CohereEmbedModel.EmbedMultiLingualLightV30,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  }
];
