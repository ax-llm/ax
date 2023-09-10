import { TextModelInfo } from '../types.js';

import { CohereEmbedModel, CohereModel } from './types.js';

export const modelInfoCohere: TextModelInfo[] = [
  {
    name: CohereModel.Command,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereModel.CommandXLarge,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereModel.CommandLight,
    currency: 'usd',
    promptTokenCostPer1K: 0.015,
    completionTokenCostPer1K: 0.015,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedEnglishLightV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedEnglishV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
  {
    name: CohereEmbedModel.EmbedMultiLingualV20,
    currency: 'usd',
    promptTokenCostPer1K: 0.0004,
    completionTokenCostPer1K: 0.0004,
    maxTokens: 4096,
  },
];
