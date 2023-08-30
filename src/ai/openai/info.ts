import { TextModelInfo } from '../../text/types';

import { OpenAIEmbedModels, OpenAIGenerateModel } from './types.js';

/**
 * OpenAI: Model information
 * @export
 */
export const modelInfoOpenAI: TextModelInfo[] = [
  {
    name: OpenAIGenerateModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1K: 0.03,
    completionTokenCostPer1K: 0.06,
    maxTokens: 8192,
  },
  {
    name: OpenAIGenerateModel.GPT432K,
    currency: 'usd',
    promptTokenCostPer1K: 0.06,
    completionTokenCostPer1K: 0.12,
    maxTokens: 32768,
  },
  {
    name: OpenAIGenerateModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1K: 0.002,
    completionTokenCostPer1K: 0.002,
    maxTokens: 4096,
  },
  {
    name: OpenAIGenerateModel.GPT35Turbo0613,
    currency: 'usd',
    promptTokenCostPer1K: 0.002,
    completionTokenCostPer1K: 0.002,
    maxTokens: 4096,
  },
  {
    name: OpenAIGenerateModel.GPT35Turbo16K,
    currency: 'usd',
    promptTokenCostPer1K: 0.003,
    completionTokenCostPer1K: 0.004,
    maxTokens: 16384,
  },
  {
    name: OpenAIGenerateModel.GPT35TextDavinci003,
    currency: 'usd',
    promptTokenCostPer1K: 0.02,
    completionTokenCostPer1K: 0.02,
    maxTokens: 4097,
  },
  {
    name: OpenAIEmbedModels.GPT3TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 8191,
  },
];
