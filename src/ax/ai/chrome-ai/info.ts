import type { AxModelInfo } from '../types.js';

import { AxAIChromeAIModel } from './types.js';

/**
 * Chrome AI model information
 * Chrome ships with Gemini Nano which runs locally in the browser.
 * No API costs — all inference is local.
 */
export const axModelInfoChromeAI: AxModelInfo[] = [
  {
    name: AxAIChromeAIModel.GeminiNano,
    currency: 'usd',
    promptTokenCostPer1M: 0, // Local inference - no cost
    completionTokenCostPer1M: 0, // Local inference - no cost
    contextWindow: 4096, // Gemini Nano has a limited context window
    maxTokens: 2048,
    supported: {
      structuredOutputs: true,
    },
  },
];
