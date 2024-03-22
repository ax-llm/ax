import type { TextModelInfo } from '../types.js';

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
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.5
  },
  {
    name: GooglePalm2Model.PaLMChatBison,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.5
  },
  {
    name: GooglePalm2EmbedModels.PaLMTextEmbeddingGecko,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.025,
    completionTokenCostPer1M: 0.025
  }
];
