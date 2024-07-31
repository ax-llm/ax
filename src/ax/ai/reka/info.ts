import type { AxModelInfo } from '../types.js';

import { AxAIRekaModel } from './types.js';
/**
 * OpenAI: Model information
 * @export
 */
export const axModelInfoReka: AxModelInfo[] = [
  {
    name: AxAIRekaModel.RekaCore,
    currency: 'usd',
    promptTokenCostPer1M: 3,
    completionTokenCostPer1M: 15
  },
  {
    name: AxAIRekaModel.RekaFlash,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 2
  },
  {
    name: AxAIRekaModel.RekaEdge,
    currency: 'usd',
    promptTokenCostPer1M: 0.4,
    completionTokenCostPer1M: 1
  }
];
