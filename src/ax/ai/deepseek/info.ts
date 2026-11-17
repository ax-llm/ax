import type { AxModelInfo } from '../types.js';

import { AxAIDeepSeekModel } from './types.js';

// Prices are DeepSeek's standard (peak-hour) rates. DeepSeek bills half of
// these off-peak; see https://api-docs.deepseek.com/quick_start/pricing.
const flashPricing = {
  currency: 'USD',
  promptTokenCostPer1M: 0.3,
  completionTokenCostPer1M: 1.2,
  cacheReadTokenCostPer1M: 0.006,
} as const;

const v4Supported = {
  thinkingBudget: true,
  showThoughts: true,
  structuredOutputs: false,
} as const;

export const axModelInfoDeepSeek: AxModelInfo[] = [
  {
    name: AxAIDeepSeekModel.DeepSeekFlash,
    ...flashPricing,
    contextWindow: 1_048_576,
    maxTokens: 393_216,
    modalities: { input: ['text', 'image'], output: ['text'] },
    supported: { ...v4Supported },
  },
  {
    name: AxAIDeepSeekModel.DeepSeekV4Pro,
    currency: 'USD',
    promptTokenCostPer1M: 1.32,
    completionTokenCostPer1M: 3.96,
    cacheReadTokenCostPer1M: 0.044,
    contextWindow: 1_048_576,
    maxTokens: 393_216,
    modalities: { input: ['text'], output: ['text'] },
    supported: { ...v4Supported },
  },
  {
    // Retired by DeepSeek on 2026-09-10; still accepted and served by
    // DeepSeek-V4.1-Flash at Flash prices.
    name: AxAIDeepSeekModel.DeepSeekV4Flash,
    ...flashPricing,
    aliases: [
      AxAIDeepSeekModel.DeepSeekChat,
      AxAIDeepSeekModel.DeepSeekReasoner,
    ],
    contextWindow: 1_048_576,
    maxTokens: 393_216,
    isDeprecated: true,
    supported: { ...v4Supported },
  },
];
