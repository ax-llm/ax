---
name: ax-agent-memory-skills
description: This skill helps an LLM generate correct AxAgent memory retrieval, context-map, and dynamic skill-loading code using @ax-llm/ax. Use when the user asks about contextMap, AxAgentContextMap, onMemoriesSearch, recall(...), inputs.memories, onLoadedMemories, onUsedMemories, onSkillsSearch, discover({ skills }), onLoadedSkills, onUsedSkills, preloaded skills, loaded memory/skill IDs, or carrying memories across forward() calls.
version: "22.0.7"
---

# AxAgent Memory And Skills Rules (@ax-llm/ax)

Use this skill when an agent needs a persistent context map, task-relevant memory retrieval, or skill guides loaded into the executor prompt on demand. For ordinary agent setup use `ax-agent`. For RLM runtime policy use `ax-agent-rlm`. For callbacks and telemetry use `ax-agent-observability`.

## Use These Defaults

- Use `onMemoriesSearch` when the agent should pull relevant context from an external store instead of stuffing everything into the prompt upfront.
- Use `contextMap` when repeated runs inspect the same long external context and should accumulate a small orientation cache automatically.
- Use `onSkillsSearch` when the agent should load usage guides, runbooks, or domain conventions into the executor prompt on demand.
- `recall(...)` is available to distiller and executor stages when `onMemoriesSearch` is set.
- `discover({ skills })` is available to the executor when `onSkillsSearch` is set.
- Both `recall(...)` and `discover({ skills })` return `void`. The loaded content appears on the next turn.
- Use `onLoadedMemories` / `onLoadedSkills` to observe what got loaded.
- Use `onUsedMemories` / `onUsedSkills` to track what the actor says it actually relied on.
- Child agents do not inherit memory or skills search callbacks; wire them explicitly on every agent that needs the capability.

## Context Map

Use `contextMap` when repeated runs ask different questions over the same long context, document set, or repository. The map is prompt-resident orientation knowledge: structure, concepts, constants, parsing schema, reusable aggregate results, and concrete error patterns. It is not a task-specific answer cache.

   Runnable example: [`src/examples/rlm-context-map-live.ts`](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-context-map-live.ts) demonstrates a provider-backed context-map update, `onUpdate` snapshot persistence, finite evolve, and frozen map reuse.

When `contextMap` is configured:

- Ax injects the current map into the distiller prompt.
- Ax updates the map once after each successful completed `forward(...)`.
- By default the map evolves forever. For a finite warmup, create the map with `{ infiniteEvolve: false, evolveSteps: N }`; after `N` successful updates it is still injected but no longer updated.
- Failed runs, aborts, and clarification requests do not update the map.
- Use `onUpdate` to persist `result.map.snapshot()` outside the agent.

```typescript
import { agent, AxAgentContextMap } from '@ax-llm/ax';

const map = new AxAgentContextMap(savedSnapshot, {
  maxChars: 4000,
  infiniteEvolve: false,
  evolveSteps: 10,
});

const myAgent = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  contextMap: {
    map,
    onUpdate: ({ map }) => saveSnapshot(map.snapshot()),
  },
});
```

Types:

```typescript
type AxAgentContextMapConfig = {
  map?: AxAgentContextMap | AxAgentContextMapSnapshot | string;
  onUpdate?: (result: AxAgentContextMapUpdateResult) => void | Promise<void>;
};

type AxAgentContextMapOptions = {
  maxChars?: number;
  infiniteEvolve?: boolean;
  evolveSteps?: number;
};
```

## Memory Search

Use `onMemoriesSearch` when the agent needs to pull task-relevant context such as user preferences, prior decisions, project facts, or past conversations from an external store (vector DB, BM25, KV). The actor decides what to load, when, and how much.

When `onMemoriesSearch` is set, the distiller and executor stages gain:

1. An `inputs.memories` field. In JS this is an array of `{ id, content }` entries the actor reads directly. In the prompt, the same entries render as markdown blocks with `ID: \`...\`` lines, matching the Loaded Skills ID style. Each `content` is opaque markdown; frontmatter is not parsed.
2. A `recall(searches: string[]): void` global the actor `await`s to load more entries. Recalled entries are appended to `inputs.memories` and visible from the next turn onward. `recall()` returns nothing.

The responder stage does not receive memories.

### Enabling

```typescript
import { agent } from '@ax-llm/ax';
import type { AxAgentMemoriesSearchFn } from '@ax-llm/ax';

const onMemoriesSearch: AxAgentMemoriesSearchFn = async (
  searches,
  alreadyLoaded
) => {
  // `searches` is the full array passed to recall(...). Batch your
  // store lookup in one round-trip.
  // `alreadyLoaded` is the current inputs.memories snapshot. Filter
  // against it to skip duplicates.
  const skip = new Set(alreadyLoaded.map((m) => m.id));
  const fresh = await myVectorDB.searchBatch(searches, { topK: 3 });
  return fresh.filter((m) => !skip.has(m.id));
};

const myAgent = agent('task:string -> answer:string', {
  contextFields: [],
  onMemoriesSearch,
});
```

Each memory result must be:

```typescript
type AxAgentMemoryResult = {
  id: string;
  content: string;
};
```

### Actor usage

```javascript
// Turn 1: kick off one batched lookup.
await recall(['user preferences', 'project constraints']);

// Turn 2+: matched entries are now visible on inputs.memories.
const prefs = inputs.memories.find((m) => m.id === 'user-prefs-v2');
```

Rules:

- Pass all memory queries in one `await recall([...])` call.
- Do not loop `recall()` calls or wrap them in `Promise.all(...)`.
- Read `inputs.memories` on the next turn to see what landed.
- `recall()` invokes `onMemoriesSearch` with `(searches, alreadyLoaded)` and returns `void`.
- Results land on `inputs.memories` for subsequent turns and render in the prompt as:

```markdown
### Memory

ID: `mem:user-prefs-v2`

...
```

- Entries are deduped by `id` (last-write-wins) and sorted by `id` for prefix-cache stability.
- Memories loaded by the distiller thread automatically to the executor. No second `recall()` is needed for those entries.
- `recall()` may be called multiple times across turns; results accumulate for that run.
- `inputs.memories` lifetime is one `.forward()` call. It resets between calls.

## Carrying Memories Across `.forward()` Calls

To preserve continuity across calls, persist memories in your store and recall them again on the next call. If you want to replay anything loaded on a prior run, observe loads with `onLoadedMemories`.

```typescript
const carried = new Map<string, string>();

const myAgent = agent('task:string -> answer:string', {
  contextFields: [],
  onMemoriesSearch: async (searches) => {
    const fresh = await myVectorDB.searchBatch(searches, { topK: 3 });
    const carriedAsResults = [...carried.entries()].map(([id, content]) => ({
      id,
      content,
    }));
    return [...carriedAsResults, ...fresh];
  },
  onLoadedMemories: (results) => {
    for (const r of results) carried.set(r.id, r.content);
  },
});
```

## Skills Search

Use `onSkillsSearch` when the agent needs to load skill guides such as usage instructions, runbooks, or domain conventions into the executor's system prompt on demand. The actor decides which skills to fetch and when, so you do not pre-render every skill into every prompt.

When `onSkillsSearch` is set, the executor stage gains:

1. A "Loaded Skills" section in the system prompt that renders matched skill bodies with stable `ID:` values sorted by `id`.
2. A `discover({ skills })` path the actor `await`s to load more skills. Loaded entries appear in the next turn's prompt. `discover(...)` returns nothing.

The distiller and responder do not see skills. Only the executor.

### Enabling

```typescript
import { agent } from '@ax-llm/ax';
import type { AxAgentSkillsSearchFn } from '@ax-llm/ax';

// Each result is { id?: string; name: string; content: string }.
// If id is omitted, Ax falls back to name.
const onSkillsSearch: AxAgentSkillsSearchFn = async (searches) => {
  return mySkillStore.resolveBatch(searches, {
    // Recommended backend order: exact id, exact name, then broader search.
    // This lets the actor pass one simple string and keeps lookup policy host-side.
    strategy: ['id', 'name', 'search'],
    topK: 2,
  });
};

const myAgent = agent('task:string -> answer:string', {
  contextFields: [],
  onSkillsSearch,
});
```

Each skill result is:

```typescript
type AxAgentSkillResult = {
  id?: string;
  name: string;
  content: string;
};
```

### Actor usage

```javascript
// Pass all skill queries in one call.
await discover({ skills: ['release-checklist', 'incident-response'] });

// Next turn: loaded skill bodies render under the "Loaded Skills"
// system-prompt section.
```

Rules:

- `discover({ skills })` invokes `onSkillsSearch` with the raw search strings and returns `void`.
- Resolve each raw string backend-side: prefer an exact `id` match, then an exact `name` match, then fuzzy/full-text search. The actor should not have to choose `id:` vs `name:` syntax.
- Matched skills land under "Loaded Skills" for the next turn.
- Entries are deduped by `id` (last-write-wins) and sorted by `id` for prefix-cache stability.
- If a skill result omits `id`, its trimmed `name` is used as the id for backwards compatibility.
- Skills persist on the agent's `currentSkillsPromptState` across `.forward()` calls, unlike memories.
- Use `agent.getState()` / `setState(...)` to serialize/restore loaded skills.
- `discover({ skills })` may be called multiple times across turns. Within one turn, batch all skill queries in a single call.
- Child agents do not inherit `onSkillsSearch`; wire it explicitly per agent.

## Preloading Skills

If the caller already knows which skills are relevant, pass them up front instead of round-tripping through `discover({ skills })`.

- Init-time: `skills` on `AxAgentOptions` seeds the executor prompt at agent creation. They survive `setState(...)` resets.
- Forward-time: `skills` on `forward(ai, values, { skills })` merge in at the start of that call. Distiller and responder ignore forward-time skills.

Both accept the same shape `onSkillsSearch` returns: `readonly AxAgentSkillResult[]`. Forward-time skills override init-time skills by `id`. `onLoadedSkills` is not fired for preset skills; that callback is for runtime `discover({ skills })` analytics.

```typescript
const releaseAgent = agent('task:string -> answer:string', {
  contextFields: [],
  skills: [
    {
      id: 'release-checklist',
      name: 'release-checklist',
      content: '...',
    },
  ],
});

await releaseAgent.forward(
  ai,
  { task: 'Prepare release notes' },
  {
    skills: [
      {
        id: 'incident-response',
        name: 'incident-response',
        content: '...',
      },
    ],
  }
);
```

You can use `skills` without setting `onSkillsSearch` at all. That is useful for static guides where the actor never needs to fetch more.

## Loaded And Used Tracking

`onLoadedMemories` reports what `recall(...)` loaded. `onLoadedSkills` reports what `discover({ skills })` loaded. To track what the actor says it actually relied on, use `onUsedMemories` / `onUsedSkills`.

```typescript
const used: AxAgentUsedMemory[] = [];

await myAgent.forward(
  ai,
  { task: 'Make a personal plan' },
  {
    onUsedMemories: (items) => used.push(...items),
  }
);

used; // [{ id, reason, stage }]
```

Rules:

- The actor can only report memory IDs already present in `inputs.memories`.
- The actor can only report skill IDs already present in Loaded Skills.
- Unknown values are dropped.
- When tracking is enabled, the actor sees `await used(id, reason?)`; this is the actor-side declaration mechanism.
- `used(...)` resolves against loaded memory IDs and loaded skill IDs.
- If memory IDs and skill IDs can collide, namespace them in your application, for example `mem:abc` and `skill:planning`.

Types:

```typescript
onMemoriesSearch?: AxAgentMemoriesSearchFn;
onLoadedMemories?: (
  results: readonly AxAgentMemoryResult[]
) => void | Promise<void>;
onUsedMemories?: (
  usedMemories: readonly AxAgentUsedMemory[]
) => void | Promise<void>;

onSkillsSearch?: AxAgentSkillsSearchFn;
onLoadedSkills?: (
  results: readonly AxAgentSkillResult[]
) => void | Promise<void>;
onUsedSkills?: (
  usedSkills: readonly AxAgentUsedSkill[]
) => void | Promise<void>;

contextMap?: AxAgentContextMapConfig;
skills?: readonly AxAgentSkillResult[];
```

## Examples

Fetch this for full working code:

- [RLM Memories and Skills](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-memories-and-skills.ts) - `onMemoriesSearch` + `recall()` and `onSkillsSearch` + `discover({ skills })` with load observability and actual usage tracking via `onUsedMemories` / `onUsedSkills`
- [Skills + Memory Ops Assistant](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/skills-and-memory-assistant.ts) - an on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand (also ported to Python, Go, Rust, Java, and C++ under `src/examples/<lang>/long-agents/`). All six languages support the native `onMemoriesSearch` / `onSkillsSearch` host callbacks, passed in the agent options at construction (Go/Java use native function values, Rust a `agent_with_search_callbacks` constructor, C++ a `register_*_search` helper); a static `memory_search_results` / `skill_search_results` config is also available.

## Do Not Generate

- Do not assign the result of `await recall(...)` or `await discover(...)`; both return `void`.
- Do not call `recall()` from the responder stage.
- Do not call `discover({ skills })` from the distiller or responder stages.
- Do not loop `recall()` calls or wrap them in `Promise.all(...)`.
- Do not loop `discover()` calls or wrap them in `Promise.all(...)`.
- Do not assume child agents inherit `onMemoriesSearch` or `onSkillsSearch`.
- Do not pass `onMemoriesSearch` results via shared fields as a workaround; use `recall(...)`.
- Do not assume `inputs.memories` persists across `.forward()` calls.
- Do not use `onLoadedMemories` / `onLoadedSkills` as proof that the actor relied on an item; use `onUsedMemories` / `onUsedSkills` for actual-use tracking.
