import type { AxModelInfo } from '../types.js';

import { AxGoogleGeminiModel } from './types.js';

/**
 * AxGoogleGemini: Model information
 * @export
 */
export const axModelInfoGoogleGemini: AxModelInfo[] = [
  {
    name: AxGoogleGeminiModel.Gemini15Flash,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.35,
    completionTokenCostPer1M: 0.7
  },
  {
    name: AxGoogleGeminiModel.Gemini15Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 3.5,
    completionTokenCostPer1M: 1.75
  },
  {
    name: AxGoogleGeminiModel.Gemini1Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  }
];
