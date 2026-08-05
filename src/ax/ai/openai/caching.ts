import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxInternalChatRequest,
} from '../types.js';
import type {
  AxAIOpenAIChatContentPart,
  AxAIOpenAIChatRequest,
} from './chat_types.js';
import { axIsGPT56Family } from './model_family.js';

/**
 * OpenAI prompt caching for GPT-5.6 and later.
 *
 * From GPT-5.6 the service caches exact prompt prefixes **at cache breakpoints**
 * and, unlike earlier families, does not fall back to the longest matching
 * unmarked prefix before the newest implicit breakpoint. An append-only
 * conversation therefore caches almost nothing unless its stable prefix is
 * explicitly marked.
 *
 * ## Markers must not move
 *
 * A breakpoint marker is part of the content block it sits on. Marking only
 * "the newest stable message" each turn looks equivalent to marking a fixed set
 * and is not: the next turn *un-marks* what it marked last turn, which changes
 * that block's serialized form, which changes the prefix, which voids the entry
 * the previous turn just wrote. Measured across three real consecutive agent
 * prompts, a mark that moved left `cached_tokens` pinned at the system-message
 * size on every turn (10,445), while marks that never moved grew it to 93% and
 * then 86% of the prompt.
 *
 * Because the conversation is append-only, an **absolute index from the front**
 * always denotes the same message. So the marked set below is defined purely by
 * absolute position, and a message that was marked once stays marked. Keep it
 * that way: any scheme expressed relative to the end of the array silently
 * destroys the feature and no single-request test can catch it.
 *
 * This also depends on `createMessages` in api.ts being a plain `.map` over
 * `req.chatPrompt`, so output index `i` denotes input index `i`. Unlike the
 * Anthropic path, which hoists system messages out of the array. Changing that
 * mapping is a wire-format change.
 *
 * ## Known cache-busters
 *
 * These are the realistic ways growing `cached_tokens` fails in the field even
 * though the unit tests pass. All of them degrade to a cache miss rather than to
 * incorrect output, and none are fixable here:
 *
 * - `AxGen` overwrites the system message in history with a freshly rendered one
 *   every step, so `ctx.addFunctions()` changing `<available_functions>` voids
 *   every entry behind it.
 * - The MCP context prompt is spliced in immediately after the system message.
 * - `mem.rewindToTag` / `removeByTag` shift absolute indices on the error and
 *   correction paths.
 * - Turning caching on for some turns of a conversation and not others. The gate
 *   below is all-or-nothing, so a turn that does not request caching sends the
 *   whole prompt unmarked, and the turn after it re-marks and rewrites from
 *   scratch. This is the one a caller can trip by accident: keep `contextCache`
 *   (or the `cache: true` flags) consistent for the life of a conversation.
 *
 * ## Breakpoint budget
 *
 * OpenAI documents a limit of four *new* breakpoints written per request, with
 * the latest 50 considered for reads. An append-only turn adds roughly two new
 * marks, so the limit does not bind in steady state; only a cold first request
 * over a long restored conversation submits many at once. Ten new breakpoints
 * were observed to be accepted rather than rejected, so over-submission degrades
 * writes instead of erroring.
 */

type Messages<TModel> = AxAIOpenAIChatRequest<TModel>['messages'];
type Message<TModel> = Messages<TModel>[number];

const BREAKPOINT = { mode: 'explicit' } as const;

/**
 * Whether to emit caching parameters at all.
 *
 * Three conditions, all required:
 *
 * 1. The provider opted in. The model name alone is not enough — Azure OpenAI
 *    shares this request builder and is typed on the same model enum, so a
 *    `gpt-5.6-*` deployment name would otherwise pick up parameters its API
 *    version may reject.
 * 2. The model is a GPT-5.6+ family member. Earlier families predate the
 *    parameters and answer with a 400.
 * 3. The caller asked for caching, either by marking messages or functions with
 *    `cache: true` (which is what `AxPromptTemplate` does) or by passing
 *    `contextCache`. The second clause matters: the flags are only ever set on
 *    the `AxGen` path, so without it a direct `ai.chat()` caller would have no
 *    way to turn this on.
 *
 * When this is false the request is left byte-identical to what Ax sent before.
 */
export const axIsOpenAIPromptCachingEnabled = <TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>,
  options: Readonly<AxAIServiceOptions> | undefined,
  promptCaching: boolean
): boolean => {
  if (!promptCaching || !axIsGPT56Family(req.model)) {
    return false;
  }
  return (
    options?.contextCache !== undefined ||
    req.chatPrompt.some((msg) => 'cache' in msg && msg.cache) ||
    (req.functions?.some((fn) => fn.cache) ?? false)
  );
};

/**
 * Resolve the stable per-conversation key that routes a request to the shard its
 * cache lives on. Falls back to the session identifier, which is already scoped
 * per conversation. Returns undefined when neither is set; the key improves
 * match reliability but is not required for the request to be valid.
 *
 * A key set on the service rather than the request outranks a per-request
 * `sessionId`, on the principle that the explicit option beats the fallback. It
 * also funnels every conversation on that instance onto one key, which works
 * against the ~15 requests/minute per key OpenAI advises — so prefer setting it
 * per request.
 */
export const axResolveOpenAIPromptCacheKey = (
  requestOptions?: Readonly<AxAIServiceOptions>,
  serviceOptions?: Readonly<AxAIServiceOptions>
): string | undefined =>
  requestOptions?.promptCacheKey ??
  serviceOptions?.promptCacheKey ??
  requestOptions?.sessionId ??
  serviceOptions?.sessionId;

/**
 * Which absolute indices carry a breakpoint.
 *
 * Every message except the last, plus any the caller marked explicitly — which
 * may include the last. The tail is excluded by default because it is the
 * message most likely to differ next turn (a freshly rendered user message, or
 * the result just appended), making a breakpoint there a usually-wasted write.
 * Note this is a cost judgement, not a correctness one: in a pure append-only
 * replay a mark on the tail would be stable and readable too.
 */
const markedIndices = (
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): Set<number> => {
  const marked = new Set<number>();
  for (let i = 0; i < chatPrompt.length; i++) {
    const msg = chatPrompt[i];
    if (i < chatPrompt.length - 1 || (msg && 'cache' in msg && msg.cache)) {
      marked.add(i);
    }
  }
  return marked;
};

/**
 * Attach a breakpoint to a message, widening string content to a block array so
 * it has somewhere to sit. A breakpoint caches everything up to and including
 * its block, so it goes on the trailing one.
 *
 * Returns the message unchanged when it has no block to carry a marker: an
 * assistant message that is only tool calls has no content, and empty string
 * content cannot be widened into a text block without sending an empty one.
 * Both are deterministic per-message properties, so skipping preserves the
 * absolute-index stability the whole scheme rests on.
 */
const withBreakpoint = <TModel>(msg: Message<TModel>): Message<TModel> => {
  const content = (msg as { content?: unknown }).content;

  if (typeof content === 'string') {
    if (content.length === 0) {
      return msg;
    }
    return {
      ...msg,
      content: [
        { type: 'text', text: content, prompt_cache_breakpoint: BREAKPOINT },
      ],
    } as Message<TModel>;
  }

  if (Array.isArray(content) && content.length > 0) {
    const parts = content as AxAIOpenAIChatContentPart[];
    const last = parts[parts.length - 1]!;
    return {
      ...msg,
      content: [
        ...parts.slice(0, -1),
        { ...last, prompt_cache_breakpoint: BREAKPOINT },
      ],
    } as Message<TModel>;
  }

  return msg;
};

/**
 * Apply cache breakpoints to already-built messages. `messages` must be
 * index-aligned with `chatPrompt`.
 *
 * Reports how many markers actually landed, because a marked index can still be
 * skipped for having no block to carry one. The caller needs the count: sending
 * `mode: 'explicit'` with zero breakpoints is strictly worse than sending
 * nothing, since it also discards the implicit breakpoint.
 */
export const axApplyOpenAIPromptCacheBreakpoints = <TModel>(
  messages: Messages<TModel>,
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): { messages: Messages<TModel>; markerCount: number } => {
  const marked = markedIndices(chatPrompt);
  let markerCount = 0;
  const out = messages.map((msg, i) => {
    if (!marked.has(i)) {
      return msg;
    }
    const next = withBreakpoint(msg);
    if (next !== msg) {
      markerCount++;
    }
    return next;
  }) as Messages<TModel>;
  return { messages: out, markerCount };
};
