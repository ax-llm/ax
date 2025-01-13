import type { AxModelInfo } from '../types.js'

import { AxAIAnthropicModel } from './types.js'

export const axModelInfoAnthropic: AxModelInfo[] = [
  // 35
  {
    name: AxAIAnthropicModel.Claude35Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
  },
  {
    name: AxAIAnthropicModel.Claude35Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 4.0,
  },
  // 3
  {
    name: AxAIAnthropicModel.Claude3Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
  },
  {
    name: AxAIAnthropicModel.Claude3Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
  },
  {
    name: AxAIAnthropicModel.Claude3Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 1.25,
  },
  // 21
  {
    name: AxAIAnthropicModel.Claude21,
    currency: 'usd',
    promptTokenCostPer1M: 8.0,
    completionTokenCostPer1M: 25,
  },
  {
    name: AxAIAnthropicModel.ClaudeInstant12,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 2.24,
  },
]
