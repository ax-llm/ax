import type { AxModelInfo } from '../types.js'

import { AxAIGroqModel } from './types.js'

/**
 * AxAIGroq: Model information
 */
export const axModelInfoGroq: AxModelInfo[] = [
  {
    name: AxAIGroqModel.Gemma_7B,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.2,
    completionTokenCostPer1M: 0.2,
  },
  {
    name: AxAIGroqModel.Llama3_70B,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.59,
    completionTokenCostPer1M: 0.79,
  },
  {
    name: AxAIGroqModel.Llama3_8B,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.05,
    completionTokenCostPer1M: 0.08,
  },
  {
    name: AxAIGroqModel.Mixtral_8x7B,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.24,
    completionTokenCostPer1M: 0.24,
  },
]
