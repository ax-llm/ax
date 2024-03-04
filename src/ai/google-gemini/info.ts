import { TextModelInfo } from '../types.js';

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
    promptTokenCostPer1K: 0.001,
    completionTokenCostPer1K: 0.001,
    maxTokens: 32000
  }
];
