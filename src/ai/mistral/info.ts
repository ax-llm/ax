import type { TextModelInfo } from '../types.js';

import { MistralModel } from './types.js';

export const textModelInfos: TextModelInfo[] = [
  {
    name: MistralModel.Mistral7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.25
  },
  {
    name: MistralModel.Mistral8x7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.7,
    completionTokenCostPer1M: 0.7
  },
  {
    name: MistralModel.MistralSmall,
    currency: 'USD',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 6
  },
  {
    name: MistralModel.MistralMedium,
    currency: 'USD',
    promptTokenCostPer1M: 2.7,
    completionTokenCostPer1M: 8.1
  },
  {
    name: MistralModel.MistralLarge,
    currency: 'USD',
    promptTokenCostPer1M: 8,
    completionTokenCostPer1M: 24
  }
];
