import type { AxModelInfo } from '../types.js'

import { AxAIOpenAIEmbedModel, AxAIOpenAIModel } from './types.js'

/**
 * OpenAI: Model information
 */
export const axModelInfoOpenAI: AxModelInfo[] = [
  {
    name: AxAIOpenAIModel.GPT45,
    currency: 'usd',
    promptTokenCostPer1M: 75,
    completionTokenCostPer1M: 150,
  },
  {
    name: AxAIOpenAIModel.O1,
    currency: 'usd',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 60,
  },
  {
    name: AxAIOpenAIModel.O1Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 14.4,
  },
  {
    name: AxAIOpenAIModel.O3Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 4.4,
  },
  {
    name: AxAIOpenAIModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1M: 30,
    completionTokenCostPer1M: 60,
  },
  {
    name: AxAIOpenAIModel.GPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
  },
  {
    name: AxAIOpenAIModel.GPT4OMini,
    currency: 'usd',
    promptTokenCostPer1M: 0.15,
    completionTokenCostPer1M: 0.6,
  },
  {
    name: AxAIOpenAIModel.GPT4ChatGPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
  },
  {
    name: AxAIOpenAIModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30,
  },
  {
    name: AxAIOpenAIModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
  },
  {
    name: AxAIOpenAIEmbedModel.TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
  {
    name: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    currency: 'usd',
    promptTokenCostPer1M: 0.02,
    completionTokenCostPer1M: 0.02,
  },
  {
    name: AxAIOpenAIEmbedModel.TextEmbedding3Large,
    currency: 'usd',
    promptTokenCostPer1M: 0.13,
    completionTokenCostPer1M: 0.13,
  },
]
