/*
 * RLM agent with memories + skills:
 * - `onMemoriesSearch` is a vector/BM25/KV lookup. The actor pulls
 *   relevant entries into `inputs.memories` via `await recall([...])`;
 *   results live for one `.forward()` call.
 * - `onSkillsSearch` loads skill guides into the executor system prompt
 *   via `await consult([...])`. Loaded skills persist on the agent's
 *   skills prompt state across calls (until you reset it).
 *
 * Both callbacks are opt-in. `recall()` and `consult()` return `void` —
 * the actor reads `inputs.memories` (or the **Loaded Skills** section)
 * on the next turn to see what landed.
 *
 * Run: tsx src/examples/rlm-memories-and-skills.ts
 */

import {
  type AxAgentMemoriesSearchFn,
  type AxAgentMemoryResult,
  type AxAgentSkillsSearchFn,
  AxAI,
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
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

const onMemoriesSearch: AxAgentMemoriesSearchFn = async (searches) => {
  // Naive substring match — replace with your vector DB / BM25 / KV.
  const matches: AxAgentMemoryResult[] = [];
  for (const query of searches) {
    const q = query.toLowerCase();
    for (const [id, content] of Object.entries(memoryStore)) {
      if (id.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
        matches.push({ id, content });
      }
    }
  }
  return matches;
};

// ---------------------------------------------------------------------------
// Skill store — same shape, but { name, content }. Skills get rendered
// directly into the executor system prompt under "Loaded Skills".
// ---------------------------------------------------------------------------

const skillStore: Record<string, string> = {
  'release-checklist':
    '## Release checklist\n1. Bump version\n2. Update CHANGELOG\n3. Tag and push',
  'incident-response':
    '## Incident response\n- Acknowledge within 5 min\n- Open incident channel\n- File postmortem within 48h',
};

const onSkillsSearch: AxAgentSkillsSearchFn = async (searches) => {
  return searches.flatMap((q) => {
    const lower = q.toLowerCase();
    return Object.entries(skillStore)
      .filter(([name]) => name.toLowerCase().includes(lower))
      .map(([name, content]) => ({ name, content }));
  });
};

// ---------------------------------------------------------------------------
// Agent — both callbacks wired up. The optional onUsed* callbacks are
// pure observability: they fire when memories / skills are loaded so
// you can log, score, or feed results back into your store.
// ---------------------------------------------------------------------------

const myAgent = agent(
  'task:string "What the user wants done" -> plan:string "Concrete next steps"',
  {
    contextFields: [],
    runtime: new AxJSRuntime(),
    onMemoriesSearch,
    onSkillsSearch,
    // Observability — track what got loaded for each run.
    onUsedMemories: (results) => {
      console.log('[memories loaded]', results.map((r) => r.id).join(', '));
    },
    onUsedSkills: (results) => {
      console.log('[skills loaded]', results.map((r) => r.name).join(', '));
    },
  }
);

const llm = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
});

const result = await myAgent.forward(llm, {
  task: 'Draft a release plan that respects our project constraints and user prefs.',
});

console.log('>', result);
