import type { AxModelInfo } from '../types.js';
import { AxAIOpenAIDecisionsModel } from './types.js';
/** Decisions endpoint pricing; other endpoints may price the same model differently. */
export const axModelInfoOpenAIDecisions: AxModelInfo[] = [
  {
    name: AxAIOpenAIDecisionsModel.GPT6Luna,
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0,
    cacheReadTokenCostPer1M: 0,
    cacheWriteTokenCostPer1M: 0,
  },
];
