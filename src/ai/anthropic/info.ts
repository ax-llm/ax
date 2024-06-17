import type { AxModelInfo } from '../types.js';

import { AxAnthropicModel } from './types.js';

export const axModelInfoAnthropic: AxModelInfo[] = [
  {
    name: AxAnthropicModel.Claude3Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0
  },
  {
    name: AxAnthropicModel.Claude3Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0
  },
  {
    name: AxAnthropicModel.Claude3Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 1.25
  },
  {
    name: AxAnthropicModel.Claude21,
    currency: 'usd',
    promptTokenCostPer1M: 8.0,
    completionTokenCostPer1M: 25
  },
  {
    name: AxAnthropicModel.ClaudeInstant12,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 2.24
  }
];
