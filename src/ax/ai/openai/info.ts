import type { AxModelInfo } from '../types.js';

import { AxAIOpenAIEmbedModel, AxAIOpenAIModel } from './chat_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

/**
 * OpenAI: Model information
 */
export const axModelInfoOpenAI: AxModelInfo[] = [
  // Not Reasoning models
  {
    name: AxAIOpenAIModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1M: 30,
    completionTokenCostPer1M: 60,
  },
  {
    name: AxAIOpenAIModel.GPT41,
    currency: 'usd',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 8,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT41Mini,
    currency: 'usd',
    promptTokenCostPer1M: 0.4,
    completionTokenCostPer1M: 1.6,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT41Nano,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.4,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT4OMini,
    currency: 'usd',
    promptTokenCostPer1M: 0.15,
    completionTokenCostPer1M: 0.6,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT4ChatGPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
  },
  // GPT-5 models
  {
    name: AxAIOpenAIModel.GPT5Nano,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
    notSupported: { temperature: true, topP: true },
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT5Mini,
    currency: 'usd',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 6,
    notSupported: { temperature: true, topP: true },
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT5,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30,
    notSupported: { temperature: true, topP: true },
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT5Chat,
    currency: 'usd',
    promptTokenCostPer1M: 12,
    completionTokenCostPer1M: 36,
    notSupported: { temperature: true, topP: true },
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.GPT5,
    currency: 'usd',
    promptTokenCostPer1M: 20,
    completionTokenCostPer1M: 60,
    notSupported: { temperature: true, topP: true },
    supported: { structuredOutputs: true },
  },
  // Reasoning models
  {
    name: AxAIOpenAIModel.O1,
    currency: 'usd',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 60,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.O1Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 14.4,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.O3,
    currency: 'usd',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 60,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIModel.O4Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 4.4,
    supported: { structuredOutputs: true },
  },
  // Embedding models
  {
    name: AxAIOpenAIEmbedModel.TextEmbeddingAda002,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.1,
  },
  {
    name: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    currency: 'usd',
    promptTokenCostPer1M: 0.02,
    completionTokenCostPer1M: 0.02,
  },
  {
    name: AxAIOpenAIEmbedModel.TextEmbedding3Large,
    currency: 'usd',
    promptTokenCostPer1M: 0.13,
    completionTokenCostPer1M: 0.13,
  },
];

/**
 * OpenAI: Model information
 */
export const axModelInfoOpenAIResponses: AxModelInfo[] = [
  // Not Reasoning models
  {
    name: AxAIOpenAIResponsesModel.GPT4,
    currency: 'usd',
    promptTokenCostPer1M: 30,
    completionTokenCostPer1M: 60,
  },
  {
    name: AxAIOpenAIResponsesModel.GPT41,
    currency: 'usd',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 8,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT41Mini,
    currency: 'usd',
    promptTokenCostPer1M: 0.4,
    completionTokenCostPer1M: 1.6,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT41Nano,
    currency: 'usd',
    promptTokenCostPer1M: 0.1,
    completionTokenCostPer1M: 0.4,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT4OMini,
    currency: 'usd',
    promptTokenCostPer1M: 0.15,
    completionTokenCostPer1M: 0.6,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT4ChatGPT4O,
    currency: 'usd',
    promptTokenCostPer1M: 5,
    completionTokenCostPer1M: 15,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT4Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT35Turbo,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
  },
  // GPT-5 models
  {
    name: AxAIOpenAIResponsesModel.GPT5Nano,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
    notSupported: { temperature: true, topP: true },
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT5Mini,
    currency: 'usd',
    promptTokenCostPer1M: 2,
    completionTokenCostPer1M: 6,
    notSupported: { temperature: true, topP: true },
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT5,
    currency: 'usd',
    promptTokenCostPer1M: 10,
    completionTokenCostPer1M: 30,
    notSupported: { temperature: true, topP: true },
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT5Chat,
    currency: 'usd',
    promptTokenCostPer1M: 12,
    completionTokenCostPer1M: 36,
    notSupported: { temperature: true, topP: true },
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.GPT5,
    currency: 'usd',
    promptTokenCostPer1M: 20,
    completionTokenCostPer1M: 60,
    notSupported: { temperature: true, topP: true },
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  // Reasoning models
  {
    name: AxAIOpenAIResponsesModel.O1Pro,
    currency: 'usd',
    promptTokenCostPer1M: 150,
    completionTokenCostPer1M: 600,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
    isExpensive: true,
  },
  {
    name: AxAIOpenAIResponsesModel.O1,
    currency: 'usd',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 60,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.O3Pro,
    currency: 'usd',
    promptTokenCostPer1M: 20,
    completionTokenCostPer1M: 80,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
    isExpensive: true,
  },
  {
    name: AxAIOpenAIResponsesModel.O3,
    currency: 'usd',
    promptTokenCostPer1M: 15,
    completionTokenCostPer1M: 60,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIModel.O3Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 4.4,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIOpenAIResponsesModel.O4Mini,
    currency: 'usd',
    promptTokenCostPer1M: 1.1,
    completionTokenCostPer1M: 4.4,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
];
