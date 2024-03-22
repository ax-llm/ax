import type { TextModelInfo } from '../types.js';

import { GoogleGeminiModel } from './types.js';

/**
 * GoogleGemini: Model information
 * @export
 */
export const modelInfoGoogleGemini: TextModelInfo[] = [
  {
    name: GoogleGeminiModel.Gemini_1_0_Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.125,
    completionTokenCostPer1M: 0.375
  }
];
