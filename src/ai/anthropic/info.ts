import type { TextModelInfo } from '../types.js';

import { AnthropicModel } from './types.js';

export const modelInfoAnthropic: TextModelInfo[] = [
  {
    name: AnthropicModel.Claude3Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0
  },
  {
    name: AnthropicModel.Claude3Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0
  },
  {
    name: AnthropicModel.Claude3Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 1.25
  },
  {
    name: AnthropicModel.Claude21,
    currency: 'usd',
    promptTokenCostPer1M: 8.0,
    completionTokenCostPer1M: 25
  },
  {
    name: AnthropicModel.ClaudeInstant12,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 2.24
  }
];
