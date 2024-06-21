import type { AxModelInfo } from '../types.js';

import { AxAIGoogleGeminiModel } from './types.js';

/**
 * AxAIGoogleGemini: Model information
 * @export
 */
export const axModelInfoGoogleGemini: AxModelInfo[] = [
  {
    name: AxAIGoogleGeminiModel.Gemini15Flash,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.35,
    completionTokenCostPer1M: 0.7
  },
  {
    name: AxAIGoogleGeminiModel.Gemini15Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 3.5,
    completionTokenCostPer1M: 1.75
  },
  {
    name: AxAIGoogleGeminiModel.Gemini1Pro,
    currency: 'usd',
    characterIsToken: true,
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5
  }
];
