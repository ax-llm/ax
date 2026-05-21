import type { AxModelInfo } from '../types.js';

import { AxAIDeepSeekModel } from './types.js';

export const axModelInfoDeepSeek: AxModelInfo[] = [
  {
    name: AxAIDeepSeekModel.DeepSeekV4Flash,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28,
    cacheReadTokenCostPer1M: 0.0028,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
  {
    name: AxAIDeepSeekModel.DeepSeekV4Pro,
    currency: 'USD',
    promptTokenCostPer1M: 0.435,
    completionTokenCostPer1M: 0.87,
    cacheReadTokenCostPer1M: 0.003625,
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
  {
    name: AxAIDeepSeekModel.DeepSeekChat,
    currency: 'USD',
    promptTokenCostPer1M: 0.27,
    completionTokenCostPer1M: 1.1,
  },
  {
    name: AxAIDeepSeekModel.DeepSeekReasoner,
    currency: 'USD',
    promptTokenCostPer1M: 0.55,
    completionTokenCostPer1M: 2.19,
  },
];
