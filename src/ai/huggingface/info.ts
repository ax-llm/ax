import type { TextModelInfo } from '../types.js';

import { HuggingFaceModel } from './types.js';

/**
 * HuggingFace: Model information
 * @export
 */
export const modelInfoHuggingFace: TextModelInfo[] = [
  {
    name: HuggingFaceModel.MetaLlama270BChatHF,
    currency: 'usd',
    promptTokenCostPer1K: 0.0,
    completionTokenCostPer1K: 0.0,
    maxTokens: 4000
  }
];
