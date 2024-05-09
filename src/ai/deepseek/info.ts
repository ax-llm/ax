import type { TextModelInfo } from '../types.js';

import { DeepSeekModel } from './types.js';

export const textModelInfos: TextModelInfo[] = [
  {
    name: DeepSeekModel.DeepSeekChat,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  },
  {
    name: DeepSeekModel.DeepSeekCoder,
    currency: 'USD',
    promptTokenCostPer1M: 0.14,
    completionTokenCostPer1M: 0.28
  }
];
