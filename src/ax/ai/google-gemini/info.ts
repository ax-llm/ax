import type { AxModelInfo } from '../types.js';

import { AxAIGoogleGeminiModel } from './types.js';

/**
 * AxAIGoogleGemini: Model information
 */
export const axModelInfoGoogleGemini: AxModelInfo[] = [
  {
    name: AxAIGoogleGeminiModel.Gemini3ProPreview,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 2.0,
    completionTokenCostPer1M: 12.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini3ProImagePreview,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 2.0,
    completionTokenCostPer1M: 0.134, // Per image output, approximate
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini25Pro,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 2.5,
    completionTokenCostPer1M: 15.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini20ProExp,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.0,
    completionTokenCostPer1M: 0.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini20FlashThinkingExp,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.0,
    completionTokenCostPer1M: 0.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini25Flash,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 3.5,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini25FlashLite,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.4,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini20Flash,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.01,
    completionTokenCostPer1M: 0.4,
    supported: { structuredOutputs: true },
  },

  {
    name: AxAIGoogleGeminiModel.Gemini20FlashLite,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.0,
    completionTokenCostPer1M: 0.0,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini15Flash,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.075,
    completionTokenCostPer1M: 0.3,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini15Flash8B,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.0375,
    completionTokenCostPer1M: 0.15,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini15Pro,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 1.25,
    completionTokenCostPer1M: 5.0,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGoogleGeminiModel.Gemini1Pro,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGoogleGeminiModel.GeminiFlashLatest,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.075,
    completionTokenCostPer1M: 0.3,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.GeminiFlashLiteLatest,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 0.0,
    completionTokenCostPer1M: 0.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIGoogleGeminiModel.GeminiProLatest,
    currency: 'usd',
    characterIsToken: false,
    promptTokenCostPer1M: 1.25,
    completionTokenCostPer1M: 5.0,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
];
