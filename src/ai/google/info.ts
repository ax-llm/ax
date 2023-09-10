import { TextModelInfo } from '../types.js';

import { GoogleEmbedModels, GoogleModel } from './types.js';

/**
 * Google: Model information
 * @export
 */
export const modelInfoGoogle: TextModelInfo[] = [
  {
    name: GoogleModel.PaLMTextBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 8192,
  },
  {
    name: GoogleModel.PaLMChatBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0005,
    completionTokenCostPer1K: 0.0005,
    maxTokens: 4096,
  },
  {
    name: GoogleEmbedModels.PaLMTextEmbeddingGecko,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 3072,
  },
];
