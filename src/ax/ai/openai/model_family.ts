/**
 * Model-family predicates shared by the OpenAI request builders.
 *
 * Families are enumerated here explicitly and never inferred by comparing
 * version numbers. A parameter a family predates is a 400 rather than a
 * silently ignored field, so a predicate that guessed forward would break
 * every model released between two Ax versions.
 *
 * Amazon Bedrock serves the same models under its own IDs: `openai.gpt-6-sol`
 * on bedrock-mantle, and cross-Region inference profiles such as
 * `us.openai.gpt-6-sol`, `global.openai.gpt-6-sol` and, in GovCloud,
 * `us-gov.openai.gpt-6-sol` on bedrock-runtime. A model keeps its contracts on
 * any host, so every family matches those IDs too. The geography is matched by
 * shape rather than listed: a new profile renames the host, not the model.
 */
const BEDROCK_OPENAI_PREFIX = /^(?:[a-z]+(?:-[a-z]+)*\.)?openai\./;

/** The OpenAI model name inside a Bedrock model or inference profile ID. */
function openAIModelName(model: unknown): string {
  return typeof model === 'string'
    ? model.replace(BEDROCK_OPENAI_PREFIX, '')
    : '';
}

/**
 * Whether the model is named by a Bedrock ID. Bedrock serves the model but not
 * every OpenAI platform feature around it.
 */
function isBedrockModel(model: unknown): boolean {
  return typeof model === 'string' && BEDROCK_OPENAI_PREFIX.test(model);
}

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
  return GPT56_MODELS.test(openAIModelName(model));
}

/**
 * Matches the GPT-6 tiers by name — `-astra`, `-sol` and `-luna` — and the
 * GPT-6.1 point releases, `gpt-6.1-sol`.
 */
const GPT6_MODELS = /^gpt-6(?:-(?:astra|sol|luna)|\.1-sol)($|-)/;

/**
 * Whether the model belongs to the GPT-6 family. Every member keeps GPT-5.6's
 * effort vocabulary and breakpoint caching, adds a `ttl` to the cache options,
 * drops sampling parameters, and refuses function tools on Chat Completions
 * while reasoning — so `ai()` routes the whole family through Responses.
 *
 * Some members layer stricter contracts on top; see
 * axRequiresOpenAIReasoning, axRefusesOpenAIChatTools and axIsGPT6Astra.
 */
export function axIsGPT6Family(model: unknown): boolean {
  return GPT6_MODELS.test(openAIModelName(model));
}

/**
 * Astra is the GPT-6 tier that alone supports chat sessions and
 * `configuration_update` (on OpenAI's own API; see
 * axSupportsOpenAIChatSessions).
 */
export function axIsGPT6Astra(model: unknown): boolean {
  return /^gpt-6-astra($|-)/.test(openAIModelName(model));
}

/** GPT-6 members that cannot turn reasoning off: Astra and GPT-6.1 Sol. */
const REASONING_REQUIRED_MODELS = /^gpt-6(?:-astra|\.1-sol)($|-)/;

/**
 * Whether the model refuses `reasoning_effort: none`, so Ax must throw before
 * sending it rather than let OpenAI return a 400.
 */
export function axRequiresOpenAIReasoning(model: unknown): boolean {
  return REASONING_REQUIRED_MODELS.test(openAIModelName(model));
}

/**
 * Whether the model refuses function tools on Chat Completions at every
 * effort. The rest of the GPT-6 family accepts them once reasoning is off;
 * these models cannot turn it off, so their tool calls need Responses.
 */
export function axRefusesOpenAIChatTools(model: unknown): boolean {
  return axRequiresOpenAIReasoning(model);
}

/**
 * Whether Chat Completions caches the model's prompt at explicit breakpoints.
 * Bedrock serves prompt caching for these models on the Responses API only, so
 * its IDs are left out.
 */
export function axSupportsOpenAIBreakpointCaching(model: unknown): boolean {
  return (
    (axIsGPT56Family(model) || axIsGPT6Family(model)) && !isBedrockModel(model)
  );
}

/**
 * Whether Ax can open a chat session on the model, for async tools, mid-turn
 * steering and reasoning updates. Only Astra supports them, and only on
 * OpenAI's own API: OpenAI's Bedrock guide lists all three as not available.
 */
export function axSupportsOpenAIChatSessions(model: unknown): boolean {
  return axIsGPT6Astra(model) && !isBedrockModel(model);
}
