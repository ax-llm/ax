// cspell:ignore mistral, mixtral, codestral, nemo

import type { AxModelInfo } from '../types.js';

import { AxAIMistralModel } from './types.js';

export const axModelInfoMistral: AxModelInfo[] = [
  {
    name: AxAIMistralModel.Mistral7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.25
  },
  {
    name: AxAIMistralModel.Mistral8x7B,
    currency: 'USD',
    promptTokenCostPer1M: 0.7,
    completionTokenCostPer1M: 0.7
  },
  {
    name: AxAIMistralModel.MistralSmall,
    currency: 'USD',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 6
  },
  {
    name: AxAIMistralModel.MistralLarge,
    currency: 'USD',
    promptTokenCostPer1M: 8,
    completionTokenCostPer1M: 24
  },
  {
    name: AxAIMistralModel.Codestral,
    currency: 'USD',
    promptTokenCostPer1M: 1,
    completionTokenCostPer1M: 3
  },
  {
    name: AxAIMistralModel.OpenCodestralMamba,
    currency: 'USD',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.25
  },
  {
    name: AxAIMistralModel.OpenMistralNemo,
    currency: 'USD',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.3
  }
];
