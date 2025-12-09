import type { AxModelInfo } from '../types.js';

import { AxAIAnthropicModel, AxAIAnthropicVertexModel } from './types.js';

export const axModelInfoAnthropic: AxModelInfo[] = [
  // 4.5 Sonnet (2025-09)
  {
    name: AxAIAnthropicModel.Claude45Sonnet,
    currency: 'usd',
    // Estimated/prior pricing aligned with Sonnet tier
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicVertexModel.Claude45Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  // 4.5 Haiku (2025-10)
  {
    name: AxAIAnthropicModel.Claude45Haiku,
    currency: 'usd',
    // Pricing per Anthropic announcement: $1 input / $5 output per 1M tokens
    promptTokenCostPer1M: 1.0,
    completionTokenCostPer1M: 5.0,
    maxTokens: 200000, // match modern context window similar to Sonnet 4.5 era
    supported: { thinkingBudget: true, showThoughts: true },
  },
  {
    name: AxAIAnthropicVertexModel.Claude45Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 1.0,
    completionTokenCostPer1M: 5.0,
    maxTokens: 200000,
    supported: { thinkingBudget: true, showThoughts: true },
  },
  // 4
  {
    name: AxAIAnthropicModel.Claude41Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 32000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicVertexModel.Claude41Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 32000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicModel.Claude4Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 32000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicVertexModel.Claude4Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 32000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicModel.Claude4Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicVertexModel.Claude4Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  // 3.7
  {
    name: AxAIAnthropicModel.Claude37Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicVertexModel.Claude37Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  // 3.5
  {
    name: AxAIAnthropicModel.Claude35Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 8192,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIAnthropicVertexModel.Claude35Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 8192,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIAnthropicVertexModel.Claude35SonnetV2,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 8192,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
    },
  },
  {
    name: AxAIAnthropicModel.Claude35Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 4.0,
    maxTokens: 8192,
  },
  {
    name: AxAIAnthropicVertexModel.Claude35Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 1.0,
    completionTokenCostPer1M: 5.0,
    maxTokens: 8192,
  },
  // 3
  {
    name: AxAIAnthropicModel.Claude3Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 4096,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIAnthropicVertexModel.Claude3Opus,
    currency: 'usd',
    promptTokenCostPer1M: 15.0,
    completionTokenCostPer1M: 75.0,
    maxTokens: 4096,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIAnthropicModel.Claude3Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 4096,
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIAnthropicModel.Claude3Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 1.25,
    maxTokens: 4096,
  },
  {
    name: AxAIAnthropicVertexModel.Claude3Haiku,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 1.25,
    maxTokens: 4096,
  },
  // 2.1
  {
    name: AxAIAnthropicModel.Claude21,
    currency: 'usd',
    promptTokenCostPer1M: 8.0,
    completionTokenCostPer1M: 25,
    maxTokens: 4096,
  },
  {
    name: AxAIAnthropicModel.ClaudeInstant12,
    currency: 'usd',
    promptTokenCostPer1M: 0.8,
    completionTokenCostPer1M: 2.24,
    maxTokens: 4096,
  },
];
