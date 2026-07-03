import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import {
  createCatalogSkillsSearch,
  rankCatalogSkills,
} from './agentInternal/skillsHelpers.js';
import type { AxAgentCatalogSkill } from './agentInternal/skillsTypes.js';
import type { AxAgentContextEvent } from './contextEvents.js';
import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';
import { axBuildExecutorDefinition } from './rlm.js';

// ----- Fixtures -----

const CATALOG: AxAgentCatalogSkill[] = [
  {
    id: 'release-checklist',
    name: 'Release checklist',
    description: 'Steps for shipping a new package release safely',
    content: '1. Bump version\n2. Run tests\n3. Tag and publish',
  },
  {
    id: 'incident-response',
    name: 'Incident response',
    description: 'How to acknowledge, triage, and escalate incidents',
    content: 'Acknowledge the page, assess blast radius, escalate to on-call.',
  },
  {
    id: 'style-guide',
    name: 'Writing style guide',
    description: 'Tone and formatting rules for customer-facing docs',
    content: 'Use plain language. Prefer short sentences.',
  },
];

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

/**
 * Runtime whose first turn calls discover({skills}) and second turn finishes.
 */
function makeSkillsDiscoverRuntime(searchQuery: string): AxCodeRuntime {
  const turn = 0;
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        execute: async (code: string) => {
          if (globals?.final && code.includes('final(')) {
            (globals.final as (...args: unknown[]) => void)('done', {
              data: 'done',
            });
            return 'done';
          }
          if (code.includes('discover(') && globals?.discover) {
            await (globals.discover as (v: unknown) => Promise<void>)({
              skills: [searchQuery],
            });
            return 'discover ok';
          }
          return 'ok';
        },
        patchGlobals: async () => {},
        close: () => {},
      };
    },
  } as AxCodeRuntime & { turn?: typeof turn };
}

interface ExecutorCapture {
  systems: string[];
  users: string[];
}

/** Mock AI: executor turn 1 discovers, turn 2 finals; distiller forwards. */
function makeSkillsMockAI(capture: ExecutorCapture) {
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
                  ? "Javascript Code: await discover({ skills: ['release'] })"
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

// ----- Unit: built-in catalog search -----

describe('createCatalogSkillsSearch', () => {
  it('matches by name/description and returns full results', () => {
    const search = createCatalogSkillsSearch(CATALOG);
    const results = search(['how do I ship a release']) as {
      id?: string;
      name: string;
      content: string;
    }[];
    expect(results[0]?.id).toBe('release-checklist');
    expect(results[0]?.content).toContain('Bump version');
  });

  it('is best-effort over a single-entry catalog (minDocs 1)', () => {
    const search = createCatalogSkillsSearch([CATALOG[0]!]);
    const results = search(['release']) as { id?: string }[];
    expect(results[0]?.id).toBe('release-checklist');
  });

  it('unions matches across multiple search strings without duplicates', () => {
    const search = createCatalogSkillsSearch(CATALOG);
    const results = search([
      'release checklist',
      'incident escalation',
      'release',
    ]) as { id?: string }[];
    const ids = results.map((r) => r.id);
    expect(ids).toContain('release-checklist');
    expect(ids).toContain('incident-response');
    expect(new Set(ids).size).toBe(ids.length); // no dupes
  });

  it('returns [] when nothing matches', () => {
    const search = createCatalogSkillsSearch(CATALOG);
    expect(search(['xyzzy quux'])).toEqual([]);
  });
});

describe('rankCatalogSkills (advisory hint — strict guards)', () => {
  it('ranks the on-topic skill first with name included', () => {
    const ranked = rankCatalogSkills(
      'prepare the next package release for shipping',
      CATALOG
    );
    expect(ranked[0]?.id).toBe('release-checklist');
    expect(ranked[0]?.name).toBe('Release checklist');
  });

  it('suppresses on no signal', () => {
    expect(rankCatalogSkills('xyzzy quux', CATALOG)).toEqual([]);
  });
});

// ----- Prompt: static Available Skills catalog section -----

describe('skills catalog — executor prompt section', () => {
  it('renders the id-sorted catalog index when skillsMode is on', () => {
    const def = axBuildExecutorDefinition(undefined, [], [], {
      skillsMode: true,
      skillsCatalog: [
        { id: 'z-skill', name: 'Zed' },
        { id: 'a-skill', name: 'Aye', description: 'first' },
      ],
    });
    expect(def).toContain('### Available Skills');
    const aIdx = def.indexOf('`a-skill`');
    const zIdx = def.indexOf('`z-skill`');
    expect(aIdx).toBeGreaterThan(-1);
    expect(zIdx).toBeGreaterThan(aIdx); // sorted by id
    expect(def).toContain('— Aye — first');
  });

  it('omits the section without a catalog (golden-churn guard)', () => {
    const withCallbackOnly = axBuildExecutorDefinition(undefined, [], [], {
      skillsMode: true,
    });
    expect(withCallbackOnly).not.toContain('### Available Skills');
    const noSkills = axBuildExecutorDefinition(undefined, [], [], {});
    expect(noSkills).not.toContain('### Available Skills');
    expect(noSkills).not.toContain('### Loaded Skills');
  });
});

// ----- E2E: batteries-included discover({skills}) -----

describe('skills catalog — end to end', () => {
  it('discover({skills}) works with a catalog and NO host callback', async () => {
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeSkillsMockAI(capture);
    const loaded: string[] = [];
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeSkillsDiscoverRuntime('release'),
      skillsCatalog: CATALOG,
      maxTurns: 4,
      onLoadedSkills: (results) => {
        loaded.push(...results.map((r) => r.id ?? r.name));
      },
    });

    await a.forward(mockAI, { query: 'help me ship the release' });

    // Built-in search matched and loaded the skill…
    expect(loaded).toContain('release-checklist');
    // …the catalog index is in the cached system prompt…
    expect(capture.systems[0]).toContain('### Available Skills');
    expect(capture.systems[0]).toContain('`release-checklist`');
    // …and the loaded guide reaches the next turn's prompt values.
    expect(capture.users[1] ?? '').toContain('Bump version');
  });

  it('host onSkillsSearch takes precedence over the catalog', async () => {
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeSkillsMockAI(capture);
    const hostSearch = vi.fn(async () => [
      { id: 'host-skill', name: 'Host skill', content: 'HOST CONTENT' },
    ]);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeSkillsDiscoverRuntime('release'),
      skillsCatalog: CATALOG,
      onSkillsSearch: hostSearch,
      maxTurns: 4,
    });

    await a.forward(mockAI, { query: 'help me ship the release' });

    expect(hostSearch).toHaveBeenCalled();
    // Host result loaded, not the catalog match.
    expect(capture.users[1] ?? '').toContain('HOST CONTENT');
    expect(capture.users[1] ?? '').not.toContain('Bump version');
  });

  it('emits a skills relevance_ranking event and rides the dynamic field', async () => {
    const events: AxAgentContextEvent[] = [];
    const capture: ExecutorCapture = { systems: [], users: [] };
    const mockAI = makeSkillsMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: makeSkillsDiscoverRuntime('release'),
      skillsCatalog: CATALOG,
      relevanceRanking: true,
      maxTurns: 4,
      onContextEvent: (event) => {
        events.push(event);
      },
    });

    await a.forward(mockAI, {
      query: 'prepare the next package release for shipping',
    });

    const skillEvent = events.find(
      (e) => e.kind === 'relevance_ranking' && e.domain === 'skills'
    );
    expect(skillEvent).toBeDefined();
    if (skillEvent?.kind !== 'relevance_ranking')
      throw new Error('unreachable');
    expect(skillEvent.suppressed).toBe(false);
    expect(skillEvent.shortlist[0]?.id).toBe('release-checklist');
    // Hint content is in the dynamic user turn, labeled by domain.
    expect(capture.users[0] ?? '').toContain('Skills:');
    expect(capture.users[0] ?? '').toContain('`release-checklist`');
    // And the hint instruction section is present even without discovery.
    expect(capture.systems[0]).toContain('### Likely Relevant');
  });

  it('keeps the cached executor system prompt byte-identical across tasks', async () => {
    const runForward = async (query: string) => {
      const capture: ExecutorCapture = { systems: [], users: [] };
      const mockAI = makeSkillsMockAI(capture);
      const a = agent('query:string -> answer:string', {
        ai: mockAI,
        runtime: makeSkillsDiscoverRuntime('release'),
        skillsCatalog: CATALOG,
        relevanceRanking: true,
        maxTurns: 4,
      });
      await a.forward(mockAI, { query });
      return capture.systems[0] ?? '';
    };

    const first = await runForward('prepare the next package release');
    const second = await runForward('how do we respond to the incident page');
    expect(first).not.toBe('');
    expect(first).toBe(second);
  });
});
