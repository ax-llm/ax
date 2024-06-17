import type { AxModelInfo } from '../types.js';

import { AxMistralModel } from './types.js';

export const axModelInfoMistral: AxModelInfo[] = [
  {
    name: AxMistralModel.Mistral7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.25
  },
  {
    name: AxMistralModel.Mistral8x7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.7,
    completionTokenCostPer1M: 0.7
  },
  {
    name: AxMistralModel.MistralSmall,
    currency: 'USD',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 6
  },
  {
    name: AxMistralModel.MistralMedium,
    currency: 'USD',
    promptTokenCostPer1M: 2.7,
    completionTokenCostPer1M: 8.1
  },
  {
    name: AxMistralModel.MistralLarge,
    currency: 'USD',
    promptTokenCostPer1M: 8,
    completionTokenCostPer1M: 24
  }
];
