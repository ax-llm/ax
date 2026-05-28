/*
 * RLM agent with memories + skills:
 * - `onMemoriesSearch` is a vector/BM25/KV lookup. The actor pulls
 *   relevant entries into `inputs.memories` via `await recall([...])`;
 *   results live for one `.forward()` call.
 * - `onSkillsSearch` loads skill guides into the executor system prompt
 *   via `await discover({ skills: [...] })`. Loaded skills persist on the agent's
 *   skills prompt state across calls (until you reset it).
 *
 * Search callbacks are opt-in. `recall()` and `discover()` return `void` —
 * the actor reads `inputs.memories` (or the **Loaded Skills** section)
 * on the next turn to see what landed.
 *
 * Run: tsx src/examples/rlm-memories-and-skills.ts
 */

import {
  type AxAgentMemoriesSearchFn,
  type AxAgentMemoryResult,
  type AxAgentSkillsSearchFn,
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
  ai,
} from '@ax-llm/ax';

// ---------------------------------------------------------------------------
// Memory store — toy in-memory KV. In production this is a vector DB / BM25.
// ---------------------------------------------------------------------------

const memoryStore: Record<string, string> = {
  'user-prefs/v2':
    '# Preferences\n- Tone: concise\n- Code style: TypeScript, no semicolons',
  'project/constraints':
    '# Constraints\n- Target runtime: Node 22\n- No new deps without sign-off',
  'incidents/2025-04-12':
    '# Postmortem\nRoot cause: stale cache. Mitigation: TTL bump + alert.',
};

const onMemoriesSearch: AxAgentMemoriesSearchFn = async (
  searches,
  alreadyLoaded
) => {
  // Skip ids the actor already has in scope — saves a round-trip to your
  // store and avoids re-billing the actor for tokens it already paid for.
  const skip = new Set(alreadyLoaded.map((m) => m.id));

  // Naive substring match — replace with your vector DB / BM25 / KV.
  const matches: AxAgentMemoryResult[] = [];
  for (const query of searches) {
    const q = query.toLowerCase();
    for (const [id, content] of Object.entries(memoryStore)) {
      if (skip.has(id)) continue;
      if (id.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        matches.push({ id, content });
      }
    }
  }
  return matches;
};

// ---------------------------------------------------------------------------
// Skill store — { id?, name, content }. Skills get rendered directly into
// the executor system prompt under "Loaded Skills"; the id is what `used()`
// reports back when actual skill usage tracking is enabled.
// ---------------------------------------------------------------------------

const skillStore = [
  {
    id: 'release-checklist',
    name: 'Release checklist',
    content:
      '## Release checklist\n1. Bump version\n2. Update CHANGELOG\n3. Tag and push',
  },
  {
    id: 'incident-response',
    name: 'Incident response',
    content:
      '## Incident response\n- Acknowledge within 5 min\n- Open incident channel\n- File postmortem within 48h',
  },
] as const;

const onSkillsSearch: AxAgentSkillsSearchFn = async (searches) => {
  return searches.flatMap((query) => {
    const normalized = query.toLowerCase();
    const exactId = skillStore.find((s) => s.id.toLowerCase() === normalized);
    if (exactId) {
      return [exactId];
    }
    const exactName = skillStore.find(
      (s) => s.name.toLowerCase() === normalized
    );
    if (exactName) {
      return [exactName];
    }
    return skillStore.filter(
      (s) =>
        s.id.toLowerCase().includes(normalized) ||
        s.name.toLowerCase().includes(normalized) ||
        s.content.toLowerCase().includes(normalized)
    );
  });
};

// ---------------------------------------------------------------------------
// Agent — both load and actual-use callbacks wired up.
// Load observability: these fire when memories / skills are loaded so
// you can log, score, or feed retrieval results back into your store.
// `onUsedMemories` / `onUsedSkills` are separate: they track what the
// actor says it actually relied on.
// ---------------------------------------------------------------------------

const myAgent = agent(
  'task:string "What the user wants done" -> plan:string "Concrete next steps"',
  {
    contextFields: [],
    runtime: new AxJSRuntime(),
    onMemoriesSearch,
    onSkillsSearch,
    // Observability — track what got loaded for each run.
    onLoadedMemories: (results) => {
      console.log('[memories loaded]', results.map((r) => r.id).join(', '));
    },
    onLoadedSkills: (results) => {
      console.log(
        '[skills loaded]',
        results.map((r) => r.id ?? r.name).join(', ')
      );
    },
    onUsedMemories: (usedMemories) => {
      console.log('[memories used]', usedMemories);
    },
    onUsedSkills: (usedSkills) => {
      console.log('[skills used]', usedSkills);
    },
  }
);

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

const result = await myAgent.forward(llm, {
  task: 'Draft a release plan that respects our project constraints and user prefs.',
});

console.log('>', result);
