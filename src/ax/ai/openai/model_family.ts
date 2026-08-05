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
