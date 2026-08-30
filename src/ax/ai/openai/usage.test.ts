import { describe, expect, it } from 'vitest';
import { AxAIOpenAI } from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';
import { axNormalizeOpenAIUsage } from './usage.js';

// Shapes observed against gpt-5.6-luna.
describe('axNormalizeOpenAIUsage cache write tokens', () => {
  it('maps a cold request to cacheCreationTokens', () => {
    const usage = axNormalizeOpenAIUsage({
      prompt_tokens: 5000,
      completion_tokens: 100,
      total_tokens: 5100,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 4010 },
    });

    expect(usage).toEqual({
      // prompt_tokens includes the written tokens, so uncached input is the
      // remainder — not the full 5000.
      promptTokens: 990,
      completionTokens: 100,
      totalTokens: 5100,
      cacheCreationTokens: 4010,
    });
  });

  it('maps a warm request to cacheReadTokens with no creation', () => {
    const usage = axNormalizeOpenAIUsage({
      prompt_tokens: 5000,
      completion_tokens: 100,
      total_tokens: 5100,
      prompt_tokens_details: { cached_tokens: 4010, cache_write_tokens: 0 },
    });

    expect(usage?.cacheReadTokens).toBe(4010);
    expect(usage?.cacheCreationTokens).toBeUndefined();
    expect(usage?.promptTokens).toBe(990);
  });

  it('reads the Responses API field name identically', () => {
    const usage = axNormalizeOpenAIUsage({
      input_tokens: 5000,
      output_tokens: 100,
      total_tokens: 5100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 4010 },
    });

    expect(usage?.cacheCreationTokens).toBe(4010);
    expect(usage?.promptTokens).toBe(990);
  });

  it('leaves usage without cache details unchanged', () => {
    const usage = axNormalizeOpenAIUsage({
      prompt_tokens: 5000,
      completion_tokens: 100,
      total_tokens: 5100,
    });

    expect(usage).toEqual({
      promptTokens: 5000,
      completionTokens: 100,
      totalTokens: 5100,
    });
  });

  it.each([
    ['default', 'standard'],
    ['on_demand', 'standard'],
    ['performance', 'priority'],
    ['flex', 'flex'],
    ['batch', 'batch'],
  ] as const)('normalizes applied service tier %s', (raw, expected) => {
    expect(
      axNormalizeOpenAIUsage(
        { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        raw
      )?.serviceTier
    ).toBe(expected);
  });
});

describe('cache write pricing', () => {
  const ai = new AxAIOpenAI({
    apiKey: 'key',
    config: { model: AxAIOpenAIModel.GPT56Luna },
  });

  const cost = (tokens: Record<string, number>) =>
    ai.getEstimatedCost({
      ai: 'OpenAI',
      model: AxAIOpenAIModel.GPT56Luna,
      tokens: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        ...tokens,
      },
    });

  it('bills writes above the uncached input rate', () => {
    // Luna: $0.20/1M input, $0.25/1M cache write (1.25x). Both counts stay
    // under the 272k long-context threshold.
    expect(cost({ cacheCreationTokens: 100_000 })).toBeCloseTo(0.025, 9);
    expect(cost({ promptTokens: 100_000 })).toBeCloseTo(0.02, 9);
  });

  // promptTokens now excludes written tokens, so long-context detection has to
  // add them back. Otherwise a mostly-cold 300k request reads as a 10k prompt
  // and silently bills below the tier it actually landed in.
  //
  // Note the write tokens themselves stay at the base $0.25/1M either way:
  // AxModelInfo has no long-context cache-write rate. Out of scope here, but
  // it means this assertion has to key off the uncached remainder.
  it('counts written tokens toward the long-context threshold', () => {
    const writes = 290_000;
    const uncached = 10_000;
    const writeCost = (writes * 0.25) / 1_000_000;

    // 300k total input > 272k, so the uncached remainder bills at $0.40/1M.
    expect(
      cost({ promptTokens: uncached, cacheCreationTokens: writes })
    ).toBeCloseTo(writeCost + (uncached * 0.4) / 1_000_000, 9);
  });
});
