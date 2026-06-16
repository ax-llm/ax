// ax-example:start
// title: TypeScript Skills + Memory Ops Assistant
// group: long-agents
// description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
import {
  type AxAgentMemoriesSearchFn,
  type AxAgentMemoryResult,
  type AxAgentSkillsSearchFn,
  AxAIOpenAIModel,
  AxJSRuntime,
  agent,
  ai,
} from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT4OMini,
    temperature: 0,
  },
});

// ---------------------------------------------------------------------------
// Memory store — remembered decisions and postmortems. In production this is a
// vector DB / BM25 index; here a tiny KV with substring matching. The actor
// pulls relevant entries into scope via `await recall([...])`.
// ---------------------------------------------------------------------------
const memoryStore: Record<string, string> = {
  'decision/db-failover':
    'Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118.',
  'postmortem/inc-118':
    'inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate.',
  'decision/customer-comms':
    'Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly.',
};

const onMemoriesSearch: AxAgentMemoriesSearchFn = async (
  searches,
  alreadyLoaded
) => {
  const skip = new Set(alreadyLoaded.map((m) => m.id));
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
// Skill store — runbooks loaded into the executor prompt on demand via
// `await discover({ skills: [...] })`. Loaded skills persist across calls.
// ---------------------------------------------------------------------------
const skillStore = [
  {
    id: 'runbook-db-failover',
    name: 'DB failover runbook',
    content:
      '## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h.',
  },
  {
    id: 'runbook-status-comms',
    name: 'Status communications runbook',
    content:
      '## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep.',
  },
] as const;

const onSkillsSearch: AxAgentSkillsSearchFn = async (searches) =>
  searches.flatMap((query) => {
    const q = query.toLowerCase();
    return skillStore.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q)
    );
  });

const assistant = agent(
  'situation:string -> guidance:string "What to do, grounded in our decisions and runbooks", steps:string[]',
  {
    runtime: new AxJSRuntime(),
    contextFields: [],
    // A base skill that is always loaded, independent of search.
    skills: [
      {
        name: 'house-style',
        content:
          'Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps — cite the runbook.',
      },
    ],
    onMemoriesSearch,
    onSkillsSearch,
    // Observability: what got loaded and what the actor actually used.
    onLoadedMemories: (results) => {
      console.log('[memories loaded]', results.map((r) => r.id).join(', '));
    },
    onLoadedSkills: (results) => {
      console.log(
        '[skills loaded]',
        results.map((r) => r.id ?? r.name).join(', ')
      );
    },
    onUsedMemories: (used) => {
      console.log('[memories used]', used);
    },
    onUsedSkills: (used) => {
      console.log('[skills used]', used);
    },
    maxTurns: 10,
  }
);

const result = await assistant.forward(llm, {
  situation:
    'Our primary database is unhealthy and we may need to fail over. Enterprise checkout is affected. What exactly should I do, in order?',
});

console.log('\n=== Response ===');
console.log(JSON.stringify(result, null, 2));
