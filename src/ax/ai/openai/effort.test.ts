import { describe, expect, it } from 'vitest';

import { AxAIOpenAIModel } from './chat_types.js';
import { axResolveOpenAIReasoningEffort } from './effort.js';

describe('axResolveOpenAIReasoningEffort', () => {
  const gpt56Models = [
    AxAIOpenAIModel.GPT56,
    AxAIOpenAIModel.GPT56Sol,
    AxAIOpenAIModel.GPT56Terra,
    AxAIOpenAIModel.GPT56Luna,
  ];

  // GPT-5.6 is the only generation serving `max`, so `highest` finally reaches
  // the top rung instead of collapsing onto `xhigh`. It dropped `minimal`.
  it.each([
    ['none', 'none'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['highest', 'max'],
  ] as const)('maps %s to %s on every GPT-5.6 tier', (budget, expected) => {
    for (const model of gpt56Models) {
      expect(axResolveOpenAIReasoningEffort(model, budget)).toBe(expected);
    }
  });

  // Everything else keeps the historical ladder byte-for-byte. The non-OpenAI
  // names matter most: their own request updaters read what this produced.
  it.each([
    ['none', undefined],
    ['minimal', 'minimal'],
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'high'],
    ['highest', 'xhigh'],
  ] as const)('maps %s to %s on every other model', (budget, expected) => {
    for (const model of [
      AxAIOpenAIModel.GPT55,
      AxAIOpenAIModel.GPT54,
      AxAIOpenAIModel.GPT52,
      AxAIOpenAIModel.GPT5,
      AxAIOpenAIModel.O3,
      'deepseek-v4-pro',
      'mistral-large-latest',
      'grok-4',
      undefined,
    ]) {
      expect(axResolveOpenAIReasoningEffort(model, budget)).toBe(expected);
    }
  });

  it('does not mistake other 5.x generations for 5.6', () => {
    expect(
      axResolveOpenAIReasoningEffort(AxAIOpenAIModel.GPT55, 'highest')
    ).toBe('xhigh');
    expect(axResolveOpenAIReasoningEffort('gpt-5.6-sol', 'highest')).toBe(
      'max'
    );
  });
});
