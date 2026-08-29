import { axNormalizeAppliedServiceTier } from '../service_tier.js';
import type { AxTokenUsage } from '../types.js';

type OpenAICompatibleUsageDetails = {
  cached_tokens?: number;
  /**
   * Prompt tokens written to the cache on this request. Present on GPT-5.6+ and
   * billed above the uncached input rate. Writes happen whether or not caching
   * parameters were sent, so dropping this field under-reports cost for every
   * caller, not only those using breakpoints.
   */
  cache_write_tokens?: number;
  reasoning_tokens?: number;
};

export type OpenAICompatibleUsage = {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  service_tier?: string;
  prompt_tokens_details?: OpenAICompatibleUsageDetails;
  input_tokens_details?: OpenAICompatibleUsageDetails;
  completion_tokens_details?: OpenAICompatibleUsageDetails;
  output_tokens_details?: OpenAICompatibleUsageDetails;
};

export const axNormalizeOpenAIUsage = (
  usage?: Readonly<OpenAICompatibleUsage> | null,
  rawServiceTier?: unknown
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
  const cacheWriteTokens =
    usage.prompt_tokens_details?.cache_write_tokens ??
    usage.input_tokens_details?.cache_write_tokens ??
    0;
  const reasoningTokens =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens;
  const serviceTier = axNormalizeAppliedServiceTier(
    rawServiceTier ?? usage.service_tier
  );

  return {
    // OpenAI's prompt_tokens includes both the cached and the written tokens.
    // Subtract them so promptTokens means uncached input only, matching the
    // Anthropic and Gemini convention and the cost formula in base.ts, which
    // bills prompt, read and write separately.
    promptTokens: Math.max(0, inputTokens - cachedTokens - cacheWriteTokens),
    completionTokens,
    totalTokens: usage.total_tokens ?? inputTokens + completionTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheCreationTokens: cacheWriteTokens } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  };
};
