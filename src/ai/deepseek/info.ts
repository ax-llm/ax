import type { AxModelInfo } from '../types.js';

import { AxDeepSeekModel } from './types.js';

export const axModelInfoDeepSeek: AxModelInfo[] = [
  {
    name: AxDeepSeekModel.DeepSeekChat,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  },
  {
    name: AxDeepSeekModel.DeepSeekCoder,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  }
];
