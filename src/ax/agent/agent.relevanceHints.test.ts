import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxAgentContextEvent } from './contextEvents.js';
import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';
import { axBuildExecutorDefinition } from './rlm.js';

// ----- Fixtures -----

/** Three modules with clearly distinct selection criteria. */
function moduleGroups() {
  return [
    {
      namespace: 'calendar',
      title: 'Calendar',
      selectionCriteria:
        'Use to look up meetings, availability, and to schedule calendar events.',
      description: 'Calendar and scheduling helpers.',
      functions: [
        {
          name: 'eventsOnDate',
          description: 'List events on a date',
          parameters: {
            type: 'object',
            properties: { date: { type: 'string', description: 'ISO date' } },
            required: ['date'],
          },
          func: async () => [],
        },
        {
          name: 'findSlot',
          description: 'Find a free meeting slot',
          parameters: {
            type: 'object',
            properties: {
              duration: { type: 'string', description: 'Duration' },
            },
            required: ['duration'],
          },
          func: async () => '',
        },
      ],
    },
    {
      namespace: 'email',
      title: 'Email',
      selectionCriteria:
        'Use for reading, drafting, and sending email messages.',
      description: 'Email helpers.',
      functions: [
        {
          name: 'searchInbox',
          description: 'Search the inbox',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Query' } },
            required: ['query'],
          },
          func: async () => [],
        },
      ],
    },
    {
      namespace: 'math',
      title: 'Math',
      selectionCriteria: 'Use for arithmetic, sums, and numeric calculations.',
      description: 'Numeric helpers.',
      functions: [
        {
          name: 'add',
          description: 'Add two numbers',
          parameters: {
            type: 'object',
            properties: {
              a: { type: 'number', description: 'a' },
              b: { type: 'number', description: 'b' },
            },
            required: ['a', 'b'],
          },
          func: async () => 0,
        },
      ],
    },
  ] as const;
}

/** Runtime that finishes each stage on the first `final(...)` call. */
const rankRuntime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession(globals) {
    return {
      execute: async (code: string) => {
        if (globals?.final && code.includes('final(')) {
          (globals.final as (...args: unknown[]) => void)('complete the task', {
            data: 'done',
          });
          return 'done';
        }
        return 'ok';
      },
      patchGlobals: async () => {},
      close: () => {},
    };
  },
};

const makeModelUsage = () => ({
  ai: 'mock-ai',
  model: 'mock-model',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
});

interface ExecutorCapture {
  system?: string;
  user?: string;
}

/**
 * Mock AI that drives distiller + executor to finish immediately and records
 * the first executor turn's system/user prompts.
 */
function makeRankMockAI(capture: ExecutorCapture) {
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const system = String(req.chatPrompt[0]?.content ?? '');
      const user = String(req.chatPrompt[1]?.content ?? '');
      if (system.includes('You (`executor`)')) {
        if (capture.system === undefined) {
          capture.system = system;
          capture.user = user;
        }
        return {
          results: [
            {
              index: 0,
              content: 'Javascript Code: final("done", { data: "done" })',
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

function actorInputField(a: any, name: string) {
  const actor = a.primaryAgent ?? a;
  return actor.actorProgram
    .getSignature()
    .getInputFields()
    .find((field: any) => field.name === name);
}

// ----- Tests -----

describe('relevance hints — executor prompt section', () => {
  it('renders the section only when relevanceHintsMode is on', () => {
    const build = (relevanceHintsMode: boolean) =>
      axBuildExecutorDefinition(undefined, [], [], {
        discoveryMode: true,
        relevanceHintsMode,
        availableModules: [
          { namespace: 'calendar', selectionCriteria: 'meetings' },
          { namespace: 'email', selectionCriteria: 'email' },
        ],
      });
    expect(build(true)).toContain('### Likely Relevant');
    expect(build(true)).toContain('inputs.relevanceHints');
    expect(build(false)).not.toContain('### Likely Relevant');
  });

  it('renders the section even with discovery OFF (template-move guard)', () => {
    // Skills/memories hints must work without functionDiscovery, so the
    // section cannot live inside the {{ if discoveryMode }} block.
    const def = axBuildExecutorDefinition(undefined, [], [], {
      discoveryMode: false,
      relevanceHintsMode: true,
    });
    expect(def).toContain('### Likely Relevant');
    expect(def).not.toContain('### Available Modules');
  });
});

describe('relevance hints — signature field placement', () => {
  it('adds relevanceHints as a non-cached executor input when enabled', () => {
    const on = agent('query:string -> answer:string', {
      ai: makeRankMockAI({}),
      runtime: rankRuntime,
      functions: moduleGroups(),
      functionDiscovery: true,
      relevanceRanking: true,
    });
    const field = actorInputField(on, 'relevanceHints');
    expect(field).toBeDefined();
    // Query-dependent hint must NOT be part of the cached prefix.
    expect(Boolean(field?.isCached)).toBe(false);
  });

  it('omits relevanceHints when relevanceRanking is explicitly disabled', () => {
    const off = agent('query:string -> answer:string', {
      ai: makeRankMockAI({}),
      runtime: rankRuntime,
      functions: moduleGroups(),
      functionDiscovery: true,
      relevanceRanking: false,
    });
    expect(actorInputField(off, 'relevanceHints')).toBeUndefined();
  });

  it('adds relevanceHints by default when discovery is on (default-ON gate)', () => {
    const byDefault = agent('query:string -> answer:string', {
      ai: makeRankMockAI({}),
      runtime: rankRuntime,
      functions: moduleGroups(),
      functionDiscovery: true,
    });
    const field = actorInputField(byDefault, 'relevanceHints');
    expect(field).toBeDefined();
    expect(Boolean(field?.isCached)).toBe(false);
  });
});

describe('relevance hints — end to end', () => {
  it('surfaces the on-topic module and emits a relevance_ranking event', async () => {
    const events: AxAgentContextEvent[] = [];
    const capture: ExecutorCapture = {};
    const mockAI = makeRankMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: rankRuntime,
      functions: moduleGroups(),
      functionDiscovery: true,
      relevanceRanking: true,
      onContextEvent: (event) => {
        events.push(event);
      },
    });

    await a.forward(mockAI, {
      query: 'find the next available meeting slot on my calendar',
    });

    const rankEvent = events.find((e) => e.kind === 'relevance_ranking');
    expect(rankEvent).toBeDefined();
    if (rankEvent?.kind !== 'relevance_ranking') throw new Error('unreachable');
    expect(rankEvent.domain).toBe('modules');
    expect(rankEvent.suppressed).toBe(false);
    expect(rankEvent.shortlist[0]?.id).toBe('calendar');

    // Static instruction lives in the (cached) system prompt...
    expect(capture.system).toContain('### Likely Relevant');
    // ...and the actual shortlist rides the dynamic user-turn field.
    expect(capture.user).toContain('Modules:');
    expect(capture.user).toContain('`calendar`');
  });

  it('suppresses the hint for an off-topic task', async () => {
    const events: AxAgentContextEvent[] = [];
    const capture: ExecutorCapture = {};
    const mockAI = makeRankMockAI(capture);
    const a = agent('query:string -> answer:string', {
      ai: mockAI,
      runtime: rankRuntime,
      functions: moduleGroups(),
      functionDiscovery: true,
      relevanceRanking: true,
      onContextEvent: (event) => {
        events.push(event);
      },
    });

    await a.forward(mockAI, { query: 'xyzzy plugh frobnicate quux' });

    const rankEvent = events.find((e) => e.kind === 'relevance_ranking');
    expect(rankEvent).toBeDefined();
    if (rankEvent?.kind !== 'relevance_ranking') throw new Error('unreachable');
    expect(rankEvent.suppressed).toBe(true);
    expect(rankEvent.shortlist).toHaveLength(0);
    // No hint content in the dynamic field.
    expect(capture.user ?? '').not.toContain('Modules:\n- `');
  });

  it('keeps the cached executor system prompt byte-identical across tasks', async () => {
    const runForward = async (query: string) => {
      const capture: ExecutorCapture = {};
      const mockAI = makeRankMockAI(capture);
      const a = agent('query:string -> answer:string', {
        ai: mockAI,
        runtime: rankRuntime,
        functions: moduleGroups(),
        functionDiscovery: true,
        relevanceRanking: true,
      });
      await a.forward(mockAI, { query });
      return capture.system ?? '';
    };

    const first = await runForward(
      'find the next available meeting slot on my calendar'
    );
    const second = await runForward('draft and send an email to the team');
    expect(first).not.toBe('');
    // The query-dependent hint is a field, not part of the system prompt, so
    // the cacheable system prompt must not vary with the task.
    expect(first).toBe(second);
  });
});
