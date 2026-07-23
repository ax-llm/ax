import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import {
  createCatalogMemoriesSearch,
  rankCatalogMemories,
} from './agentInternal/memoriesHelpers.js';
import type { AxAgentMemoryResult } from './agentInternal/memoriesTypes.js';
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from './agentInternal/sharedSession.js';
import type { AxAgentContextEvent } from './contextEvents.js';
import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

// ----- Fixtures -----

const CATALOG: AxAgentMemoryResult[] = [
  {
    id: 'coffee-preference',
    content: 'User prefers oat-milk cappuccino every morning at 9am.',
  },
  {
    id: 'deploy-window',
    content: 'Production deploys are only allowed on Tuesday afternoons.',
  },
  {
    id: 'team-roster',
    content: 'The platform team is Alice, Bob, and Carol; Alice is on-call.',
  },
];

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

/** Runtime whose first turn recalls, second finishes. */
function makeRecallRuntime(searchQuery: string): AxCodeRuntime {
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        execute: async (code: string) => {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('done', {
              data: 'done',
            });
            return 'done';
          }
          if (code.includes('recall(') && globals?.recall) {
            await (globals.recall as (v: unknown) => Promise<void>)([
              searchQuery,
            ]);
            return 'recall ok';
          }
          return 'ok';
        },
        // REPL-faithful: merge (phase-2 rebinding) + honor staged input merges.
        patchGlobals: async (patch: Record<string, unknown>) => {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        close: () => {},
      };
    },
  };
}

interface ExecutorCapture {
  systems: string[];
  users: string[];
}

/** Mock AI: executor turn 1 recalls, turn 2 finals; distiller forwards. */
function makeMemoriesMockAI(capture: ExecutorCapture) {
  let executorTurn = 0;
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const system = String(req.chatPrompt[0]?.content ?? '');
      const user = String(req.chatPrompt[1]?.content ?? '');
      if (system.includes('You (`executor`)')) {
        executorTurn++;
        capture.systems.push(system);
        capture.users.push(user);
        return {
          results: [
            {
              index: 0,
              content:
                executorTurn === 1
                  ? "Javascript Code: await recall(['deploy window'])"
                  : 'Javascript Code: await final("done", { data: "done" })',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      }
      if (system.includes('You (`distiller`)')) {
        return {
          results: [
            {
              index: 0,
              content: 'Javascript Code: final("forward the request", {})',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: makeModelUsage(),
        };
      }
      return {
        results: [
          { index: 0, content: 'Answer: done', finishReason: 'stop' as const },
        ],
        modelUsage: makeModelUsage(),
      };
    },
  });
}

// ----- Unit: built-in catalog recall -----

describe('createCatalogMemoriesSearch', () => {
  it('matches by content and returns full results', () => {
    const search = createCatalogMemoriesSearch(CATALOG);
    const results = search(['when can we deploy to production'], []) as {
      id: string;
    }[];
    expect(results[0]?.id).toBe('deploy-window');
  });

  it('honors the alreadyLoaded contract (excludes loaded ids)', () => {
    const search = createCatalogMemoriesSearch(CATALOG);
    const results = search(
      ['when can we deploy to production'],
      [{ id: 'deploy-window', content: 'already here' }]
    ) as { id: string }[];
    expect(results.map((r) => r.id)).not.toContain('deploy-window');
  });

  it('returns [] when the whole catalog is already loaded', () => {
    const search = createCatalogMemoriesSearch(CATALOG);
    expect(search(['anything about deploys'], CATALOG)).toEqual([]);
  });
});

describe('rankCatalogMemories (advisory hint — strict guards)', () => {
  it('ranks the on-topic memory first with a single-line snippet', () => {
    const ranked = rankCatalogMemories(
      'schedule the production deploy',
      CATALOG
    );
    expect(ranked[0]?.id).toBe('deploy-window');
    expect(ranked[0]?.snippet).toContain('Tuesday');
    expect(ranked[0]?.snippet.length).toBeLessThanOrEqual(80);
  });

  it('suppresses on no signal', () => {
    expect(rankCatalogMemories('xyzzy quux', CATALOG)).toEqual([]);
  });
});

// ----- E2E: batteries-included recall() -----

describe('memories catalog — end to end', () => {
  it('recall() works with a catalog and NO host callback', async () => {
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeMemoriesMockAI(capture);
    const loaded: string[] = [];
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('deploy window'),
      memoriesCatalog: CATALOG,
      relevanceRanking: false, // isolate built-in recall from the default-on hint
      maxTurns: 4,
      onLoadedMemories: (results) => {
        loaded.push(...results.map((r) => r.id));
      },
    });

    await a.forward(mockAI, { query: 'when can we ship to production?' });

    expect(loaded).toContain('deploy-window');
    // Recalled memory reaches the next turn's prompt values.
    expect(capture.users[1] ?? '').toContain('Tuesday afternoons');
  });

  it('host onMemoriesSearch takes precedence over the catalog', async () => {
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeMemoriesMockAI(capture);
    const hostSearch = vi.fn(async () => [
      { id: 'host-memory', content: 'HOST MEMORY CONTENT' },
    ]);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('deploy window'),
      memoriesCatalog: CATALOG,
      onMemoriesSearch: hostSearch,
      // The hint snippet would carry catalog content into every turn and
      // defeat this test's not.toContain assertion — disable explicitly.
      relevanceRanking: false,
      maxTurns: 4,
    });

    await a.forward(mockAI, { query: 'when can we ship to production?' });

    expect(hostSearch).toHaveBeenCalled();
    expect(capture.users[1] ?? '').toContain('HOST MEMORY CONTENT');
    expect(capture.users[1] ?? '').not.toContain('Tuesday afternoons');
  });

  it('forward-time memories preload is official and renders in the prompt', async () => {
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeMemoriesMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('deploy window'),
      memoriesCatalog: CATALOG,
      relevanceRanking: false, // isolate the preload path from the default-on hint
      maxTurns: 4,
    });

    await a.forward(mockAI, {
      query: 'when can we ship to production?',
      memories: [{ id: 'preloaded-fact', content: 'PRELOADED FACT BODY' }],
    });

    // Preloaded memory is present from the FIRST executor turn.
    expect(capture.users[0] ?? '').toContain('PRELOADED FACT BODY');
  });

  it('emits a memories relevance_ranking event excluding already-loaded ids', async () => {
    const events: AxAgentContextEvent[] = [];
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeMemoriesMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('deploy window'),
      memoriesCatalog: CATALOG,
      relevanceRanking: true,
      maxTurns: 4,
      onContextEvent: (event) => {
        events.push(event);
      },
    });

    await a.forward(mockAI, {
      query: 'schedule the production deploy',
      // Preload the on-topic memory — the hint must then EXCLUDE it.
      memories: [CATALOG[1]!],
    });

    const memEvent = events.find(
      (e) => e.kind === 'relevance_ranking' && e.domain === 'memories'
    );
    expect(memEvent).toBeDefined();
    if (memEvent?.kind !== 'relevance_ranking') throw new Error('unreachable');
    expect(memEvent.shortlist.map((s) => s.id)).not.toContain('deploy-window');
  });

  it('surfaces the memories hint in the dynamic field', async () => {
    const events: AxAgentContextEvent[] = [];
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeMemoriesMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('deploy window'),
      memoriesCatalog: CATALOG,
      relevanceRanking: true,
      maxTurns: 4,
      onContextEvent: (event) => {
        events.push(event);
      },
    });

    await a.forward(mockAI, { query: 'schedule the production deploy' });

    const memEvent = events.find(
      (e) => e.kind === 'relevance_ranking' && e.domain === 'memories'
    );
    if (memEvent?.kind !== 'relevance_ranking') throw new Error('unreachable');
    expect(memEvent.suppressed).toBe(false);
    expect(memEvent.shortlist[0]?.id).toBe('deploy-window');
    expect(capture.users[0] ?? '').toContain('Memories:');
    expect(capture.users[0] ?? '').toContain('`deploy-window`');
    expect(capture.systems[0]).toContain('### Likely Relevant');
  });

  it('keeps the cached executor system prompt byte-identical across tasks', async () => {
    const runForward = async (query: string) => {
      const capture: ExecutorCapture = { systems: [], users: [] };
      const mockAI = makeMemoriesMockAI(capture);
      const a = agent('query:string -> answer:string', {
        ai: mockAI,
        runtime: makeRecallRuntime('deploy window'),
        memoriesCatalog: CATALOG,
        relevanceRanking: true,
        maxTurns: 4,
      });
      await a.forward(mockAI, { query });
      return capture.systems[0] ?? '';
    };

    const first = await runForward('schedule the production deploy');
    const second = await runForward('who is on-call this week');
    expect(first).not.toBe('');
    expect(first).toBe(second);
  });

  it('declares the memories field with a cache breakpoint on both signature paths', () => {
    const mockAI = makeMemoriesMockAI({ systems: [], users: [] });
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeRecallRuntime('x'),
      memoriesCatalog: CATALOG,
    });
    const memField = (target: any) =>
      (target.distiller ?? target)
        .getSignature?.()
        ?.getInputFields?.()
        ?.find((field: any) => field.name === 'memories');

    const constructed = memField(a);
    expect(constructed?.isCached).toBe(true);

    // setSignature re-declaration path must keep the cache breakpoint too
    // (pre-existing omission fixed alongside the catalog gating change).
    (a as any).setSignature('query:string -> answer:string');
    const redeclared = memField(a);
    expect(redeclared?.isCached).toBe(true);
  });
});
