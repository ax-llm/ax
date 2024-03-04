import { TextModelInfo } from '../types.js';

import { GoogleVertexEmbedModels, GoogleVertexModel } from './types.js';

/**
 * GoogleVertex: Model information
 * @export
 */
export const modelInfoGoogleVertex: TextModelInfo[] = [
  {
    name: GoogleVertexModel.PaLMTextBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 8192
  },
  {
    name: GoogleVertexModel.PaLMChatBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0005,
    completionTokenCostPer1K: 0.0005,
    maxTokens: 4096
  },
  {
    name: GoogleVertexEmbedModels.PaLMTextEmbeddingGecko,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 3072
  }
];
