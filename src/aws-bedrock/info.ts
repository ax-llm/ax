/**
 * Bedrock model information (pricing, limits, features)
 */

import type { AxModelInfo } from '@ax-llm/ax';
import { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';

export const axModelInfoBedrock: AxModelInfo[] = [
  // ========================================================================
  // Claude Models
  // ========================================================================
  {
    name: AxAIBedrockModel.ClaudeOpus45,
    currency: 'usd',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: { thinkingBudget: true, showThoughts: true },
  },
  {
    name: AxAIBedrockModel.ClaudeSonnet4,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: { thinkingBudget: true, showThoughts: true },
  },
  {
    name: AxAIBedrockModel.Claude37Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    contextWindow: 200000,
  },
  {
    name: AxAIBedrockModel.Claude35Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 8192,
    contextWindow: 200000,
  },

  // ========================================================================
  // GPT OSS Models
  // ========================================================================
  {
    name: AxAIBedrockModel.GptOss120B,
    currency: 'usd',
    promptTokenCostPer1M: 0.5,
    completionTokenCostPer1M: 1.5,
    maxTokens: 16384,
    contextWindow: 128000,
  },
  {
    name: AxAIBedrockModel.GptOss20B,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.75,
    maxTokens: 16384,
    contextWindow: 128000,
  },

  // ========================================================================
  // Embed Models
  // ========================================================================
  {
    name: AxAIBedrockEmbedModel.TitanEmbedV2,
    currency: 'usd',
    promptTokenCostPer1M: 0.02,
    completionTokenCostPer1M: 0,
    maxTokens: 8192,
    contextWindow: 8192,
  },
];
