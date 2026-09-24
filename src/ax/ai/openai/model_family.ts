/**
 * Model-family predicates shared by the OpenAI request builders.
 *
 * Families are enumerated here explicitly and never inferred by comparing
 * version numbers. A parameter a family predates is a 400 rather than a
 * silently ignored field, so a predicate that guessed forward would break
 * every model released between two Ax versions.
 */

/** Matches `gpt-5.6` and every tier suffix (`-sol`, `-terra`, `-luna`). */
const GPT56_MODELS = /^gpt-5\.6($|-)/;

/**
 * Whether the model belongs to the GPT-5.6 family, which changed two contracts
 * at once: the `reasoning_effort` vocabulary (see effort.ts) and prompt caching,
 * which from 5.6 caches only at breakpoints and no longer falls back to the
 * longest matching unmarked prefix (see caching.ts).
 *
 * Add later families here as they land — both call sites want the same answer.
 */
export function axIsGPT56Family(model: unknown): boolean {
  return GPT56_MODELS.test(typeof model === 'string' ? model : '');
}

/** Matches the GPT-6 tiers by name: `-astra`, `-sol` and `-luna`. */
const GPT6_MODELS = /^gpt-6-(astra|sol|luna)($|-)/;

/**
 * Whether the model belongs to the GPT-6 family. Every tier keeps GPT-5.6's
 * effort vocabulary and breakpoint caching, adds a `ttl` to the cache options,
 * drops sampling parameters, and refuses function tools on Chat Completions
 * while reasoning — so `ai()` routes the whole family through Responses.
 *
 * Astra layers stricter contracts on top; see axIsGPT6Astra.
 */
export function axIsGPT6Family(model: unknown): boolean {
  return GPT6_MODELS.test(typeof model === 'string' ? model : '');
}

/**
 * Astra is the GPT-6 tier with contracts the rest of the family lacks: it
 * refuses `reasoning_effort: none`, refuses function tools on Chat Completions
 * at every effort, and alone supports chat sessions and `configuration_update`.
 */
export function axIsGPT6Astra(model: unknown): boolean {
  return typeof model === 'string' && /^gpt-6-astra($|-)/.test(model);
}

export function axSupportsOpenAIBreakpointCaching(model: unknown): boolean {
  return axIsGPT56Family(model) || axIsGPT6Family(model);
}
