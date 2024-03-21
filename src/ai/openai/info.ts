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
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 8192,
    aliases: ['gpt-4-0613']
  },
  {
    name: OpenAIModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1K: 0.01,
    completionTokenCostPer1K: 0.03,
    maxTokens: 128000
  },
  {
    name: OpenAIModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.002,
    maxTokens: 4096,
    aliases: ['gpt-3.5-turbo-0613', 'gpt-3.5-turbo']
  },
  {
    name: OpenAIModel.GPT35Turbo16K,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.004,
    maxTokens: 16384
  },
  {
    name: OpenAIModel.GPT35TextDavinci003,
    currency: 'usd',
    promptTokenCostPer1K: 0.02,
    completionTokenCostPer1K: 0.02,
    maxTokens: 4097
  },
  {
    name: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 8191
  }
];
