/**
 * Bedrock model information (pricing, limits, features)
 */

import type {
  AxModelInfo,
  AxServiceTier,
  AxStructuredOutputRung,
} from '@ax-llm/ax';
import { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';

export type AxAIBedrockThinkingMode =
  | 'none'
  | 'budget'
  | 'adaptive'
  | 'provider';

export type AxAIBedrockModelCapabilities = {
  family: 'claude' | 'gpt';
  functions: boolean;
  streaming: boolean;
  functionCot: boolean;
  images: boolean;
  files: boolean;
  cacheTTLs: readonly ('5m' | '1h')[];
  thinking: AxAIBedrockThinkingMode;
  thinkingDefault: boolean;
  thinkingAlwaysOn: boolean;
  showThoughts: boolean;
  structuredOutputModes: readonly AxStructuredOutputRung[];
  serviceTiers: readonly AxServiceTier[];
};

const claude = (
  overrides: Partial<AxAIBedrockModelCapabilities> = {}
): AxAIBedrockModelCapabilities => ({
  family: 'claude',
  functions: true,
  streaming: true,
  functionCot: true,
  images: true,
  files: true,
  cacheTTLs: ['5m'],
  thinking: 'budget',
  thinkingDefault: false,
  thinkingAlwaysOn: false,
  showThoughts: true,
  structuredOutputModes: ['function'],
  serviceTiers: ['standard'],
  ...overrides,
});

const gpt = (): AxAIBedrockModelCapabilities => ({
  family: 'gpt',
  functions: false,
  streaming: true,
  functionCot: false,
  images: false,
  files: false,
  cacheTTLs: [],
  thinking: 'none',
  thinkingDefault: false,
  thinkingAlwaysOn: false,
  showThoughts: false,
  structuredOutputModes: ['native'],
  serviceTiers: ['standard', 'flex', 'priority'],
});

/** Exact native-runtime capabilities verified per Bedrock model. */
export const axBedrockModelCapabilities: Readonly<
  Record<AxAIBedrockModel, AxAIBedrockModelCapabilities>
> = {
  [AxAIBedrockModel.ClaudeSonnet5]: claude({
    cacheTTLs: ['5m', '1h'],
    thinking: 'adaptive',
    thinkingDefault: true,
    thinkingAlwaysOn: true,
  }),
  [AxAIBedrockModel.ClaudeOpus5]: claude({
    cacheTTLs: ['5m', '1h'],
    thinking: 'adaptive',
    thinkingDefault: true,
  }),
  [AxAIBedrockModel.ClaudeOpus48]: claude({
    cacheTTLs: ['5m', '1h'],
    thinking: 'adaptive',
  }),
  [AxAIBedrockModel.ClaudeSonnet46]: claude({
    cacheTTLs: ['5m', '1h'],
    thinking: 'adaptive',
    structuredOutputModes: ['native', 'function'],
  }),
  [AxAIBedrockModel.ClaudeHaiku45]: claude({
    cacheTTLs: ['5m', '1h'],
    structuredOutputModes: ['native', 'function'],
  }),
  [AxAIBedrockModel.ClaudeOpus45]: claude({
    cacheTTLs: ['5m', '1h'],
    structuredOutputModes: ['native', 'function'],
  }),
  [AxAIBedrockModel.ClaudeSonnet4]: claude(),
  [AxAIBedrockModel.Claude37Sonnet]: claude({ functionCot: false }),
  [AxAIBedrockModel.Claude35Sonnet]: claude({
    functionCot: false,
    cacheTTLs: [],
    thinking: 'none',
    showThoughts: false,
  }),
  [AxAIBedrockModel.GptOss120B]: gpt(),
  [AxAIBedrockModel.GptOss20B]: gpt(),
};

export function axGetBedrockModelCapabilities(
  model: AxAIBedrockModel
): AxAIBedrockModelCapabilities {
  const capabilities = axBedrockModelCapabilities[model];
  if (!capabilities) {
    throw new Error(`Unsupported Bedrock model: ${model}`);
  }
  return capabilities;
}

export const axModelInfoBedrock: AxModelInfo[] = [
  // ========================================================================
  // Claude Models
  // ========================================================================
  {
    name: AxAIBedrockModel.ClaudeSonnet5,
    currency: 'usd',
    promptTokenCostPer1M: 2.0,
    completionTokenCostPer1M: 10.0,
    maxTokens: 128000,
    contextWindow: 1000000,
    supported: {
      showThoughts: true,
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeOpus5,
    currency: 'usd',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
    maxTokens: 128000,
    contextWindow: 1000000,
    isExpensive: true,
    supported: {
      showThoughts: true,
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeOpus48,
    currency: 'usd',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
    maxTokens: 128000,
    contextWindow: 1000000,
    isExpensive: true,
    supported: {
      showThoughts: true,
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeSonnet46,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    contextWindow: 1000000,
    supported: {
      showThoughts: true,
      structuredOutputs: true,
      structuredOutputModes: ['native', 'function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeHaiku45,
    currency: 'usd',
    promptTokenCostPer1M: 1.0,
    completionTokenCostPer1M: 5.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
      structuredOutputModes: ['native', 'function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeOpus45,
    currency: 'usd',
    promptTokenCostPer1M: 5.0,
    completionTokenCostPer1M: 25.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputs: true,
      structuredOutputModes: ['native', 'function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.ClaudeSonnet4,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.Claude37Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 64000,
    contextWindow: 200000,
    supported: {
      thinkingBudget: true,
      showThoughts: true,
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
  },
  {
    name: AxAIBedrockModel.Claude35Sonnet,
    currency: 'usd',
    promptTokenCostPer1M: 3.0,
    completionTokenCostPer1M: 15.0,
    maxTokens: 8192,
    contextWindow: 200000,
    isDeprecated: true,
    deprecatedOn: '2026-07-30',
    supported: {
      structuredOutputModes: ['function'],
      serviceTiers: ['standard'],
    },
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
    supported: {
      structuredOutputs: true,
      structuredOutputModes: ['native'],
      serviceTiers: ['standard', 'flex', 'priority'],
    },
  },
  {
    name: AxAIBedrockModel.GptOss20B,
    currency: 'usd',
    promptTokenCostPer1M: 0.25,
    completionTokenCostPer1M: 0.75,
    maxTokens: 16384,
    contextWindow: 128000,
    supported: {
      structuredOutputs: true,
      structuredOutputModes: ['native'],
      serviceTiers: ['standard', 'flex', 'priority'],
    },
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
