// cspell:ignore grok

import type { AxModelInfo } from '../types.js';

import { AxAIGrokModel } from './types.js';

export const axModelInfoGrok: AxModelInfo[] = [
  {
    name: AxAIGrokModel.Grok43,
    currency: 'USD',
    promptTokenCostPer1M: 1.25,
    cacheReadTokenCostPer1M: 0.2,
    completionTokenCostPer1M: 2.5,
    contextWindow: 1_000_000,
    aliases: [AxAIGrokModel.Grok43Latest, AxAIGrokModel.GrokLatest],
    supported: { thinkingBudget: true, structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.Grok420Reasoning,
    currency: 'USD',
    promptTokenCostPer1M: 1.25,
    cacheReadTokenCostPer1M: 0.2,
    completionTokenCostPer1M: 2.5,
    contextWindow: 2_000_000,
    aliases: [
      AxAIGrokModel.Grok420Reasoning0309,
      'grok-4.20-reasoning-latest',
      'grok-4.20',
      'grok-4.20-0309',
    ],
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.Grok420NonReasoning,
    currency: 'USD',
    promptTokenCostPer1M: 1.25,
    cacheReadTokenCostPer1M: 0.2,
    completionTokenCostPer1M: 2.5,
    contextWindow: 2_000_000,
    aliases: [
      AxAIGrokModel.Grok420NonReasoning0309,
      'grok-4.20-non-reasoning-latest',
    ],
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.Grok420MultiAgent,
    currency: 'USD',
    promptTokenCostPer1M: 1.25,
    cacheReadTokenCostPer1M: 0.2,
    completionTokenCostPer1M: 2.5,
    contextWindow: 2_000_000,
    aliases: [
      AxAIGrokModel.Grok420MultiAgent0309,
      'grok-4.20-multi-agent-latest',
    ],
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.Grok41FastReasoning,
    currency: 'USD',
    promptTokenCostPer1M: 0.2,
    cacheReadTokenCostPer1M: 0.05,
    completionTokenCostPer1M: 0.5,
    contextWindow: 2_000_000,
    aliases: ['grok-4-1-fast-reasoning-latest'],
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.Grok41FastNonReasoning,
    currency: 'USD',
    promptTokenCostPer1M: 0.2,
    cacheReadTokenCostPer1M: 0.05,
    completionTokenCostPer1M: 0.5,
    contextWindow: 2_000_000,
    aliases: ['grok-4-1-fast-non-reasoning-latest'],
    supported: { structuredOutputs: true },
  },
  {
    name: AxAIGrokModel.GrokVoiceThinkFast,
    currency: 'USD',
  },
  {
    name: AxAIGrokModel.GrokVoiceFast,
    currency: 'USD',
  },
  {
    name: AxAIGrokModel.Grok3,
    currency: 'USD',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
  },
  {
    name: AxAIGrokModel.Grok3Mini,
    currency: 'USD',
    promptTokenCostPer1M: 0.3,
    completionTokenCostPer1M: 0.5,
    supported: { thinkingBudget: true },
  },
  {
    name: AxAIGrokModel.Grok3Fast,
    currency: 'USD',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
  },
  {
    name: AxAIGrokModel.Grok3MiniFast,
    currency: 'USD',
    promptTokenCostPer1M: 0.6,
    completionTokenCostPer1M: 4.0,
    supported: { thinkingBudget: true },
  },
];
