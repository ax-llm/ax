import type { AxModelInfo } from '../types.js';
import { AxAIGoogleGeminiDecisionsModel } from './types.js';

export const axModelInfoGoogleGeminiDecisions: AxModelInfo[] = [
  {
    name: AxAIGoogleGeminiDecisionsModel.GeminiDecision1,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    contextWindow: 262_144,
    completionTokenCostPer1M: 0,
    supported: { structuredOutputs: true },
    notSupported: { temperature: true, topP: true, topK: true },
    modalities: {
      input: ['text', 'image', 'audio', 'video', 'pdf'],
      output: [],
    },
    audio: { input: true, output: false },
  },
];
