import type { AxModelInfo } from '../types.js'

import { AxAIDeepSeekModel } from './types.js'

export const axModelInfoDeepSeek: AxModelInfo[] = [
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
]
