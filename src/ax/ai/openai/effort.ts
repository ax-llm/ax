import type { AxAIServiceOptions } from '../types.js';
import type { AxAIOpenAIChatRequest } from './chat_types.js';
import { axIsGPT56Family } from './model_family.js';
import type { AxAIOpenAIResponsesRequest } from './responses_types.js';

/**
 * The `reasoning_effort` vocabulary Chat Completions accepts. No single model
 * accepts all of these — the vocabulary is not shared across generations, and
 * OpenAI rejects an effort its model doesn't know with a 400 rather than
 * degrading gracefully. Taken from the request type so the ladders below cannot
 * drift from what the wire format accepts.
 */
export type AxAIOpenAIChatReasoningEffort = NonNullable<
  AxAIOpenAIChatRequest<unknown>['reasoning_effort']
>;

/**
 * The same vocabulary on the Responses API, which serves one rung more. The
 * property is optional and nullable, hence the two unwraps.
 */
export type AxAIOpenAIResponsesReasoningEffort = NonNullable<
  NonNullable<AxAIOpenAIResponsesRequest<unknown>['reasoning']>['effort']
>;

type ThinkingTokenBudget = NonNullable<
  AxAIServiceOptions['thinkingTokenBudget']
>;

/**
 * A budget rung mapped to the effort to put on the wire. `none` is absent
 * because it means "send no effort at all" rather than an effort value.
 */
type EffortLadder<TEffort> = Record<
  Exclude<ThinkingTokenBudget, 'none'>,
  TEffort
>;

/**
 * GPT-5.6 on Chat Completions serves `none`, `low`, `medium`, `high` and
 * `xhigh`, so the ladder maps onto them in order. It does not serve `minimal` —
 * that rung was retired after GPT-5 — so `minimal` takes the lowest thinking
 * level 5.6 does offer, which is also where `low` lands.
 */
const GPT56_CHAT_LADDER: EffortLadder<AxAIOpenAIChatReasoningEffort> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  highest: 'xhigh',
};

/**
 * The Responses API serves one rung above `xhigh`, so `highest` reaches `max`
 * there and only there. Chat Completions refuses the same value on the same
 * model:
 *
 *   Unsupported value: `reasoning_effort` does not support `max` with this
 *   model. Supported values are: `none`, `low`, `medium`, `high`, and `xhigh`.
 *
 * Observed on all three 5.6 tiers, so the two surfaces cannot share a ladder.
 */
const GPT56_RESPONSES_LADDER: EffortLadder<AxAIOpenAIResponsesReasoningEffort> =
  {
    ...GPT56_CHAT_LADDER,
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
 * on the historical ladder keeps their wire output byte-identical. It never
 * produces `max`, so both surfaces can share it.
 */
const LEGACY_LADDER: EffortLadder<AxAIOpenAIChatReasoningEffort> = {
  minimal: 'minimal',
  low: 'medium',
  medium: 'high',
  high: 'high',
  highest: 'xhigh',
};

/**
 * GPT-5.6 defaults an omitted effort to `medium`, so disabling reasoning
 * requires an explicit `none`. Every other model and OpenAI-compatible provider
 * keeps the historical omission.
 */
function resolveNone(model: unknown): 'none' | undefined {
  return axIsGPT56Family(model) ? 'none' : undefined;
}

/**
 * Resolve a thinking-budget rung to the `reasoning_effort` value to send on a
 * Chat Completions request, or `undefined` when no effort should be sent.
 */
export function axResolveOpenAIChatReasoningEffort(
  model: unknown,
  budget: ThinkingTokenBudget
): AxAIOpenAIChatReasoningEffort | undefined {
  if (budget === 'none') {
    return resolveNone(model);
  }
  return axIsGPT56Family(model)
    ? GPT56_CHAT_LADDER[budget]
    : LEGACY_LADDER[budget];
}

/**
 * The same resolution for a Responses request, where `highest` reaches `max` on
 * GPT-5.6. Kept separate from the chat resolver rather than defaulted behind a
 * surface argument: a default is what sent `max` to Chat Completions.
 */
export function axResolveOpenAIResponsesReasoningEffort(
  model: unknown,
  budget: ThinkingTokenBudget
): AxAIOpenAIResponsesReasoningEffort | undefined {
  if (budget === 'none') {
    return resolveNone(model);
  }
  return axIsGPT56Family(model)
    ? GPT56_RESPONSES_LADDER[budget]
    : LEGACY_LADDER[budget];
}
