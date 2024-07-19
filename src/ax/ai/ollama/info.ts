import type { AxModelInfo } from '../types.js';

import { AxAIOllamaModel } from './types.js';

export const axModelInfoOllama: AxModelInfo[] = [
  {
    name: AxAIOllamaModel.Codellama,
    currency: 'compute',
    characterIsToken: false,
    promptTokenCostPer1M: 1,
    completionTokenCostPer1M: 1,
  },
  {
    name: AxAIOllamaModel.Llama2,
    currency: 'compute',
    characterIsToken: false,
    promptTokenCostPer1M: 1,
    completionTokenCostPer1M: 1,
  },
  {
    name: AxAIOllamaModel.MiniLM,
    currency: 'compute',
    characterIsToken: false,
    promptTokenCostPer1M: 0.5, 
    completionTokenCostPer1M: 0.5,
  },
  {
    name: AxAIOllamaModel.Llama2_7B,
    currency: 'compute',
    characterIsToken: false,
    promptTokenCostPer1M: 0.7,
    completionTokenCostPer1M: 0.7,
  },
  {
    name: AxAIOllamaModel.Llama2_13B,
    currency: 'compute',
    characterIsToken: false,
    promptTokenCostPer1M: 1.3,
    completionTokenCostPer1M: 1.3,
  },
];
