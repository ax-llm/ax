import type { AxModelInfo } from '../types.js';

import { AxAIDeepSeekModel } from './types.js';

export const axModelInfoDeepSeek: AxModelInfo[] = [
  {
    name: AxAIDeepSeekModel.DeepSeekChat,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  },
  {
    name: AxAIDeepSeekModel.DeepSeekCoder,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  }
];
