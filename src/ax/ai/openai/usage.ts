import type { AxTokenUsage } from '../types.js';

type OpenAICompatibleUsageDetails = {
  cached_tokens?: number;
  reasoning_tokens?: number;
};

export type OpenAICompatibleUsage = {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: OpenAICompatibleUsageDetails;
  input_tokens_details?: OpenAICompatibleUsageDetails;
  completion_tokens_details?: OpenAICompatibleUsageDetails;
  output_tokens_details?: OpenAICompatibleUsageDetails;
};

export const axNormalizeOpenAIUsage = (
  usage?: Readonly<OpenAICompatibleUsage> | null
): AxTokenUsage | undefined => {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    0;
  const reasoningTokens =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens;

  return {
    promptTokens: Math.max(0, inputTokens - cachedTokens),
    completionTokens,
    totalTokens: usage.total_tokens ?? inputTokens + completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {}),
  };
};
