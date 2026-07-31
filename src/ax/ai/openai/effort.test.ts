import { describe, expect, it } from 'vitest';

import { AxAIOpenAIModel } from './chat_types.js';
import {
  axResolveOpenAIChatReasoningEffort,
  axResolveOpenAIResponsesReasoningEffort,
} from './effort.js';

describe('OpenAI reasoning effort resolvers', () => {
  const gpt56Models = [
    AxAIOpenAIModel.GPT56,
    AxAIOpenAIModel.GPT56Sol,
    AxAIOpenAIModel.GPT56Terra,
    AxAIOpenAIModel.GPT56Luna,
  ];

  const budgets = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'highest',
  ] as const;

  // GPT-5.6 dropped `minimal`, so it shares `low` with the rung below. The two
  // surfaces agree everywhere except the top: `max` exists only on Responses.
  it.each([
    ['none', 'none', 'none'],
    ['minimal', 'low', 'low'],
    ['low', 'low', 'low'],
    ['medium', 'medium', 'medium'],
    ['high', 'high', 'high'],
    ['highest', 'xhigh', 'max'],
  ] as const)(
    'maps %s to %s on chat and %s on responses for every GPT-5.6 tier',
    (budget, chat, responses) => {
      for (const model of gpt56Models) {
        expect(axResolveOpenAIChatReasoningEffort(model, budget)).toBe(chat);
        expect(axResolveOpenAIResponsesReasoningEffort(model, budget)).toBe(
          responses
        );
      }
    }
  );

  // Chat Completions 400s on `max`, which is what shipped in 23.0.7. No rung on
  // any 5.6 tier may produce it.
  it('never resolves max on the chat path', () => {
    for (const model of gpt56Models) {
      for (const budget of budgets) {
        expect(axResolveOpenAIChatReasoningEffort(model, budget)).not.toBe(
          'max'
        );
      }
    }
  });

  // Everything else keeps the historical ladder byte-for-byte, on both
  // surfaces. The non-OpenAI names matter most: their own request updaters read
  // what this produced.
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
      expect(axResolveOpenAIChatReasoningEffort(model, budget)).toBe(expected);
      expect(axResolveOpenAIResponsesReasoningEffort(model, budget)).toBe(
        expected
      );
    }
  });

  it('does not mistake other 5.x generations for 5.6', () => {
    expect(
      axResolveOpenAIResponsesReasoningEffort(AxAIOpenAIModel.GPT55, 'highest')
    ).toBe('xhigh');
    expect(
      axResolveOpenAIResponsesReasoningEffort('gpt-5.6-sol', 'highest')
    ).toBe('max');
  });
});
