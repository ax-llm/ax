import type { AxAIServiceOptions } from '../types.js';
import type { AxAIOpenAIChatRequest } from './chat_types.js';

/**
 * The `reasoning.effort` vocabulary across the OpenAI reasoning line. No single
 * model accepts all of these — the vocabulary is not shared across generations,
 * and OpenAI rejects an effort its model doesn't know with a 400 rather than
 * degrading gracefully. Taken from the request type so the ladders below cannot
 * drift from what the wire format accepts.
 */
export type AxAIOpenAIReasoningEffort = NonNullable<
  AxAIOpenAIChatRequest<unknown>['reasoning_effort']
>;

type ThinkingTokenBudget = NonNullable<
  AxAIServiceOptions['thinkingTokenBudget']
>;

/**
 * A budget rung mapped to the effort to put on the wire. `none` is absent
 * because it means "send no effort at all" rather than an effort value.
 */
type EffortLadder = Record<
  Exclude<ThinkingTokenBudget, 'none'>,
  AxAIOpenAIReasoningEffort
>;

/**
 * GPT-5.6 serves `none`, `low`, `medium`, `high`, `xhigh` and `max`, so the
 * ladder maps one-to-one and `highest` can finally reach `max`. It does not
 * serve `minimal` — that rung was retired after GPT-5 — so `minimal` takes the
 * lowest thinking level 5.6 does offer.
 */
const GPT56_LADDER: EffortLadder = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  highest: 'max',
};

/**
 * Every other model keeps the historical mapping verbatim. It is shifted and
 * lossy — `medium` and `high` collapse onto one wire value and `low` is
 * unreachable — but correcting it is a per-generation problem, not a per-rung
 * one: `minimal` is only served by GPT-5, `xhigh` only from GPT-5.2 up, and the
 * `-pro` tiers refuse the bottom of the ladder outright. Realigning without
 * that whole compatibility matrix would trade unreachable rungs for 400s.
 *
 * This request builder is also shared with DeepSeek, Grok, Mistral, Cohere and
 * Reka, whose own request updaters read the effort this produced. Leaving them
 * on the historical ladder keeps their wire output byte-identical.
 */
const LEGACY_LADDER: EffortLadder = {
  minimal: 'minimal',
  low: 'medium',
  medium: 'high',
  high: 'high',
  highest: 'xhigh',
};

/** Matches `gpt-5.6` and every tier suffix (`-sol`, `-terra`, `-luna`). */
const GPT56_MODELS = /^gpt-5\.6($|-)/;

/**
 * Resolve a thinking-budget rung to the `reasoning.effort` value to send, or
 * `undefined` when no effort should be sent at all.
 */
export function axResolveOpenAIReasoningEffort(
  model: unknown,
  budget: ThinkingTokenBudget
): AxAIOpenAIReasoningEffort | undefined {
  const name = typeof model === 'string' ? model : '';
  if (budget === 'none') {
    // GPT-5.6 defaults an omitted effort to `medium`, so disabling reasoning
    // requires an explicit `none`. Preserve the historical omission for every
    // other model and OpenAI-compatible provider.
    return GPT56_MODELS.test(name) ? 'none' : undefined;
  }
  return GPT56_MODELS.test(name) ? GPT56_LADDER[budget] : LEGACY_LADDER[budget];
}
