import { AxAIOllamaModel } from './types';
import type { AxModelInfo } from '../types';

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
  }
];
