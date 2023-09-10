import { TextModelInfo } from '../types.js';

import { AnthropicModel } from './types.js';

export const modelInfoAnthropic: TextModelInfo[] = [
  {
    name: AnthropicModel.Claude2,
    currency: 'usd',
    promptTokenCostPer1K: 0.01102,
    completionTokenCostPer1K: 0.03268,
    maxTokens: 100000,
  },
  {
    name: AnthropicModel.ClaudeInstant,
    currency: 'usd',
    promptTokenCostPer1K: 0.00163,
    completionTokenCostPer1K: 0.00551,
    maxTokens: 100000,
  },
];
