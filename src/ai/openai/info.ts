import type { TextModelInfo } from '../types.js';

import { OpenAIEmbedModels, OpenAIModel } from './types.js';

/**
 * OpenAI: Model information
 * @export
 */
export const modelInfoOpenAI: TextModelInfo[] = [
  {
    name: OpenAIModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1M: 30,
    completionTokenCostPer1M: 60
  },
  {
    name: OpenAIModel.GPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15
  },
  {
    name: OpenAIModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30
  },
  {
    name: OpenAIModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  },
  {
    name: OpenAIEmbedModels.TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1
  },
  {
    name: OpenAIEmbedModels.TextEmbedding3Small,
    currency: 'usd',
    promptTokenCostPer1M: 0.02,
    completionTokenCostPer1M: 0.02
  },
  {
    name: OpenAIEmbedModels.TextEmbedding3Large,
    currency: 'usd',
    promptTokenCostPer1M: 0.13,
    completionTokenCostPer1M: 0.13
  }
];
