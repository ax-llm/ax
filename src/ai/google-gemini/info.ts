import type { TextModelInfo } from '../types.js';

import { GoogleGeminiModel } from './types.js';

/**
 * GoogleGemini: Model information
 * @export
 */
export const modelInfoGoogleGemini: TextModelInfo[] = [
  {
    name: GoogleGeminiModel.Gemini15Flash,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.35,
    completionTokenCostPer1M: 0.7
  },
  {
    name: GoogleGeminiModel.Gemini15Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 3.5,
    completionTokenCostPer1M: 1.75
  },
  {
    name: GoogleGeminiModel.Gemini1Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  }
];
