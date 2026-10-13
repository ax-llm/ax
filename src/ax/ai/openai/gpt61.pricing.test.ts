import { describe, expect, it } from 'vitest';
import { ai } from '../wrap.js';
import { axNormalizeOpenAIUsage } from './usage.js';

describe('GPT-6.1 Sol service-tier pricing', () => {
  for (const name of ['openai', 'openai-responses'] as const) {
    for (const [serviceTier, multiplier] of [
      ['standard', 1],
      ['priority', 2],
      ['flex', 0.5],
    ] as const) {
      it.each([100_000, 272_000, 272_001])(
        `bills ${name} ${serviceTier} prompt, cache, and output tokens at %i input tokens`,
        (inputTokens) => {
          const model = 'gpt-6.1-sol';
          const provider = ai({ name, apiKey: 'test', config: { model } });
          const long = inputTokens > 272_000;
          const cost = provider.getEstimatedCost({
            ai: name,
            model,
            tokens: {
              promptTokens: inputTokens - 30_000,
              cacheReadTokens: 10_000,
              cacheCreationTokens: 20_000,
              completionTokens: 100,
              totalTokens: inputTokens + 100,
              serviceTier,
            },
          });
          const standardCost =
            ((inputTokens - 30_000) * (long ? 4 : 2) +
              10_000 * (long ? 0.2 : 0.1) +
              20_000 * (long ? 5 : 2.5) +
              100 * (long ? 15 : 10)) /
            1_000_000;
          expect(cost).toBeCloseTo(standardCost * multiplier, 10);
        }
      );
    }

    it(`bills ${name} a served fast response as priority`, () => {
      const model = 'gpt-6.1-sol';
      const provider = ai({ name, apiKey: 'test', config: { model } });
      const tokens = axNormalizeOpenAIUsage(
        { input_tokens: 100_000, output_tokens: 0, total_tokens: 100_000 },
        'fast'
      );
      expect(tokens?.serviceTier).toBe('priority');
      expect(provider.getEstimatedCost({ ai: name, model, tokens })).toBe(0.4);
    });
  }
});
