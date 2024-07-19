import type { AxModelInfo } from '../types.js';

import { AxAIOllamaModel } from './types.js';

// cspell:ignore Codellama
export const axModelInfoOllama: AxModelInfo[] = [
  {
    name: AxAIOllamaModel.Codellama,
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0
  },
  {
    name: AxAIOllamaModel.Llama2,
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0
  },
  {
    name: 'all-MiniLM',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0
  },
  {
    name: 'Llama2-7B',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0
  },
  {
    name: 'Llama2-13B',
    currency: 'N/A',
    characterIsToken: false,
    promptTokenCostPer1M: 0,
    completionTokenCostPer1M: 0
  }
];
