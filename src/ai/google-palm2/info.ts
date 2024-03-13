import { TextModelInfo } from '../types.js';

import { GooglePalm2EmbedModels, GooglePalm2Model } from './types.js';

/**
 * GooglePalm2: Model information
 * @export
 */
export const modelInfoGooglePalm2: TextModelInfo[] = [
  {
    name: GooglePalm2Model.PaLMTextBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 8192
  },
  {
    name: GooglePalm2Model.PaLMChatBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0005,
    completionTokenCostPer1K: 0.0005,
    maxTokens: 4096
  },
  {
    name: GooglePalm2EmbedModels.PaLMTextEmbeddingGecko,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1K: 0.0001,
    completionTokenCostPer1K: 0.0001,
    maxTokens: 3072
  }
];
