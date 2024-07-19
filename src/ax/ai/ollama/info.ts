import type { AxModelInfo } from '../types';

import { AxAIOllamaModel } from './types';

export const axModelInfoOllama: AxModelInfo[] = [
  {
    name: AxAIOllamaModel.Codellama,
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    computeCost: 1
  },
  {
    name: AxAIOllamaModel.Llama2,
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    computeCost: 1.5
  },
  {
    name: 'all-MiniLM',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    computeCost: 0.5
  },
  {
    name: 'Llama2-7B',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    computeCost: 2
  },
  {
    name: 'Llama2-13B',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0,
    computeCost: 2.5
  }
];
