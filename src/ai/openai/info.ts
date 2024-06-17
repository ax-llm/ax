import type { AxModelInfo } from '../types.js';

import { AxOpenAIEmbedModels, AxOpenAIModel } from './types.js';

/**
 * OpenAI: Model information
 * @export
 */
export const axModelInfoOpenAI: AxModelInfo[] = [
  {
    name: AxOpenAIModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1M: 30,
    completionTokenCostPer1M: 60
  },
  {
    name: AxOpenAIModel.GPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15
  },
  {
    name: AxOpenAIModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30
  },
  {
    name: AxOpenAIModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: AxOpenAIEmbedModels.TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: AxOpenAIEmbedModels.TextEmbedding3Small,
    currency: 'usd',
    promptTokenCostPer1M: 0.02,
    completionTokenCostPer1M: 0.02
  },
  {
    name: AxOpenAIEmbedModels.TextEmbedding3Large,
    currency: 'usd',
    promptTokenCostPer1M: 0.13,
    completionTokenCostPer1M: 0.13
  }
];
