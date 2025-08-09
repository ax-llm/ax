// cspell:ignore grok

import type { AxModelInfo } from '../types.js';

import { AxAIGrokModel } from './types.js';

export const axModelInfoGrok: AxModelInfo[] = [
  {
    name: AxAIGrokModel.Grok3,
    currency: 'USD',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
  },
  {
    name: AxAIGrokModel.Grok3Mini,
    currency: 'USD',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.5,
    supported: { thinkingBudget: true },
  },
  {
    name: AxAIGrokModel.Grok3Fast,
    currency: 'USD',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
  },
  {
    name: AxAIGrokModel.Grok3MiniFast,
    currency: 'USD',
    promptTokenCostPer1M: 0.6,
    completionTokenCostPer1M: 4.0,
    supported: { thinkingBudget: true },
  },
];
