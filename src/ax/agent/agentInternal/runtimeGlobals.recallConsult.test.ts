import { describe, expect, it, vi } from 'vitest';
import { agent } from '../index.js';
import type { AxCodeRuntime } from '../rlm.js';
import {
  mergeUsedMemoryResults,
  normalizeUsedMemoryResult,
  renderMemoriesPromptMarkdown,
} from './memoriesHelpers.js';
import type { AxAgentMemoryResult } from './memoriesTypes.js';
import { buildRuntimeGlobals } from './runtimeGlobals.js';
import {
  createMutableSkillsPromptState,
  ingestSkillResults,
  mergeUsedSkillResults,
  normalizeUsedSkillResult,
  renderSkillsPromptMarkdown,
} from './skillsHelpers.js';
import type { AxAgentSkillResult } from './skillsTypes.js';

const noOpRuntime: AxCodeRuntime = {
  getUsageInstructions: () => '',
  createSession() {
    return { execute: async () => 'ok', close: () => {} };
  },
};

/**
 * Build a minimal `self`-like stub for `buildRuntimeGlobals`. The runtime
 * globals factory only needs a small surface (functions, agents, search
 * callbacks, skills state, namespace defaults), so we construct it
 * directly instead of going through `agent(...)` to keep the contract
 * tests focused and fast.
 */
function makeSelf(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    agentFunctions: [],
    agents: [],
    agentFunctionModuleMetadata: new Map(),
    functionDiscoveryEnabled: false,
    currentSkillsPromptState: createMutableSkillsPromptState(),
    onMemoriesSearch: undefined,
    onSkillsSearch: undefined,
    ...overrides,
  };
}

describe('recall() runtime global — void contract', () => {
  it('returns undefined even when memories are matched', async () => {
    const self = makeSelf({
      onMemoriesSearch: async (
        searches: readonly string[]
      ): Promise<readonly AxAgentMemoryResult[]> => [
        { id: 'a', content: `match for ${searches[0]}` },
        { id: 'b', content: 'second match' },
      ],
    });

    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const recall = globals.recall as (
      input: string | string[]
    ) => Promise<unknown>;

    expect(typeof recall).toBe('function');
    await expect(recall(['user prefs'])).resolves.toBeUndefined();
    await expect(recall('single query')).resolves.toBeUndefined();
  });

  it('returns undefined when no memories match', async () => {
    const self = makeSelf({
      onMemoriesSearch: async () => [],
    });
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<unknown>;

    await expect(recall(['nothing'])).resolves.toBeUndefined();
  });

  it('is not exposed when onMemoriesSearch is not configured', () => {
    const self = makeSelf();
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    expect(globals.recall).toBeUndefined();
  });

  it('fires onLoadedMemories with the matched results', async () => {
    const matched: AxAgentMemoryResult[] = [
      { id: 'a', content: 'A' },
      { id: 'b', content: 'B' },
    ];
    const self = makeSelf({
      onMemoriesSearch: async () => matched,
    });
    const onLoadedMemories = vi.fn();
    const globals = buildRuntimeGlobals(
      self,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onLoadedMemories
    ) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['anything']);

    expect(onLoadedMemories).toHaveBeenCalledTimes(1);
    expect(onLoadedMemories).toHaveBeenCalledWith(matched);
  });

  it('does not fire onLoadedMemories when search returns nothing', async () => {
    const self = makeSelf({ onMemoriesSearch: async () => [] });
    const onLoadedMemories = vi.fn();
    const globals = buildRuntimeGlobals(
      self,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onLoadedMemories
    ) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['nothing']);

    expect(onLoadedMemories).not.toHaveBeenCalled();
  });

  it('passes alreadyLoaded snapshot to onMemoriesSearch', async () => {
    const onMemoriesSearch = vi.fn(async () => [
      { id: 'b', content: 'B' } as AxAgentMemoryResult,
    ]);
    const self = makeSelf({ onMemoriesSearch });
    const alreadyLoaded: AxAgentMemoryResult[] = [{ id: 'a', content: 'A' }];
    const globals = buildRuntimeGlobals(
      self,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => alreadyLoaded
    ) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['fresh query']);

    expect(onMemoriesSearch).toHaveBeenCalledTimes(1);
    expect(onMemoriesSearch).toHaveBeenCalledWith(
      ['fresh query'],
      alreadyLoaded
    );
  });

  it('passes empty alreadyLoaded snapshot when no getter is provided', async () => {
    const onMemoriesSearch = vi.fn(async () => []);
    const self = makeSelf({ onMemoriesSearch });
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['anything']);

    expect(onMemoriesSearch).toHaveBeenCalledWith(['anything'], []);
  });

  it('exposes used only when usage tracking is enabled', async () => {
    const onUsed = vi.fn();
    const enabled = makeSelf({
      usageTrackingEnabled: true,
      onMemoriesSearch: async () => [],
    });
    const disabled = makeSelf({ onMemoriesSearch: async () => [] });

    const enabledGlobals = buildRuntimeGlobals(
      enabled,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onUsed
    ) as Record<string, unknown>;
    const disabledGlobals = buildRuntimeGlobals(disabled) as Record<
      string,
      unknown
    >;

    expect(typeof enabledGlobals.used).toBe('function');
    expect(disabledGlobals.used).toBeUndefined();

    await (
      enabledGlobals.used as (id: unknown, reason?: unknown) => Promise<void>
    )('x', 'Used');
    expect(onUsed).toHaveBeenCalledWith('x', 'Used');
  });
});

describe('discover() skills runtime global — void contract', () => {
  it('returns undefined even when skills are matched', async () => {
    const self = makeSelf({
      onSkillsSearch: async (): Promise<readonly AxAgentSkillResult[]> => [
        { name: 'skill-a', content: '## A' },
        { name: 'skill-b', content: '## B' },
      ],
    });

    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const discover = globals.discover as (input: unknown) => Promise<unknown>;

    expect(typeof discover).toBe('function');
    expect(globals.consult).toBeUndefined();
    await expect(discover({ skills: ['some query'] })).resolves.toBeUndefined();
  });

  it('returns undefined when no skills match', async () => {
    const self = makeSelf({ onSkillsSearch: async () => [] });
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const discover = globals.discover as (input: unknown) => Promise<unknown>;

    await expect(discover({ skills: ['nothing'] })).resolves.toBeUndefined();
  });

  it('is not exposed when onSkillsSearch is not configured', () => {
    const self = makeSelf();
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    expect(globals.discover).toBeUndefined();
  });

  it('fires onLoadedSkills with the matched results', async () => {
    const matched: AxAgentSkillResult[] = [
      { name: 'skill-a', content: '## A' },
    ];
    const self = makeSelf({ onSkillsSearch: async () => matched });
    const onLoadedSkills = vi.fn();
    const globals = buildRuntimeGlobals(
      self,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onLoadedSkills
    ) as Record<string, unknown>;
    const discover = globals.discover as (input: unknown) => Promise<void>;

    await discover({ skills: ['anything'] });

    expect(onLoadedSkills).toHaveBeenCalledTimes(1);
    expect(onLoadedSkills).toHaveBeenCalledWith(matched);
  });

  it('rejects skill discovery when onSkillsSearch is not configured', async () => {
    const self = makeSelf({ functionDiscoveryEnabled: true });
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const discover = globals.discover as (input: unknown) => Promise<unknown>;

    await expect(discover({ skills: ['anything'] })).rejects.toThrow(
      'discover({ skills }) requires onSkillsSearch to be configured'
    );
  });
});

describe('skills option preloads into the executor prompt state', () => {
  const presets: AxAgentSkillResult[] = [
    {
      id: 'skill:release-checklist',
      name: 'release-checklist',
      content: '## checklist body',
    },
    { name: 'incident-response', content: '## ir body' },
  ];

  function getInternal(a: unknown): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (a as any).primaryAgent ?? a;
  }

  it('seeds currentSkillsPromptState at construction (no onSkillsSearch needed)', () => {
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: noOpRuntime,
      skills: presets,
    });
    const internal = getInternal(myAgent);
    const loaded = internal.currentSkillsPromptState.loaded as Map<
      string,
      { id: string; name: string; content: string }
    >;
    expect(loaded.get('skill:release-checklist')?.content).toBe(
      '## checklist body'
    );
    expect(loaded.get('incident-response')?.content).toBe('## ir body');
  });

  it('preserves preset skills across setState({}) resets', () => {
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: noOpRuntime,
      skills: presets,
    });
    const internal = getInternal(myAgent);
    // setState is the public reset path — preset skills must be re-ingested.
    if (typeof internal.setState === 'function') {
      internal.setState(undefined);
    }
    const loaded = internal.currentSkillsPromptState.loaded as Map<
      string,
      { id: string; name: string; content: string }
    >;
    expect(loaded.get('skill:release-checklist')?.content).toBe(
      '## checklist body'
    );
    expect(loaded.get('incident-response')?.content).toBe('## ir body');
  });

  it('forward-time skills override init-time skills with the same id (Map.set semantics)', () => {
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: noOpRuntime,
      skills: [{ name: 'shared', content: 'init-content' }],
    });
    const internal = getInternal(myAgent);
    // Simulate the same merge runActorLoop performs on options.skills.
    ingestSkillResults(internal.currentSkillsPromptState, [
      { name: 'shared', content: 'forward-content' },
    ]);
    const loaded = internal.currentSkillsPromptState.loaded as Map<
      string,
      { id: string; name: string; content: string }
    >;
    expect(loaded.get('shared')?.content).toBe('forward-content');
  });

  it('renders stable skill ids in the loaded skills prompt', () => {
    const state = createMutableSkillsPromptState();
    ingestSkillResults(state, [
      { id: 'skill:planning', name: 'Planning', content: 'Plan well.' },
    ]);

    expect(renderSkillsPromptMarkdown(state)).toBe(
      '### Planning\n\nID: `skill:planning`\n\nPlan well.'
    );
  });
});

describe('agent() factory wires memory / skill callback options', () => {
  it('stores the option callbacks on the agent instance', () => {
    const onLoadedMemories = vi.fn();
    const onLoadedSkills = vi.fn();
    const onUsedMemories = vi.fn();
    const onUsedSkills = vi.fn();
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: noOpRuntime,
      onMemoriesSearch: async () => [{ id: 'x', content: 'X' }],
      onSkillsSearch: async () => [{ name: 'skill-a', content: '## A' }],
      onLoadedMemories,
      onLoadedSkills,
      onUsedMemories,
      onUsedSkills,
    });

    // The callbacks should be reachable on the underlying agent state.
    // (We use a minimal property check rather than `getInternal` because
    // the factory exposes them on the primary agent instance.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalAgent = (myAgent as any).primaryAgent ?? myAgent;
    expect(internalAgent.onLoadedMemories).toBe(onLoadedMemories);
    expect(internalAgent.onLoadedSkills).toBe(onLoadedSkills);
    expect(internalAgent.onUsedMemories).toBe(onUsedMemories);
    expect(internalAgent.onUsedSkills).toBe(onUsedSkills);
  });
});

describe('memory usage normalization', () => {
  it('renders stable memory ids in the prompt like skills', () => {
    expect(
      renderMemoriesPromptMarkdown([
        { id: 'mem:coffee', content: 'User prefers coffee.' },
      ])
    ).toBe('### Memory\n\nID: `mem:coffee`\n\nUser prefers coffee.');
  });

  it('keeps only loaded memory ids and annotates the stage', () => {
    const result = normalizeUsedMemoryResult(
      'a',
      'Personalized the answer',
      [
        { id: 'a', content: 'A' },
        { id: 'b', content: 'B' },
      ],
      'executor'
    );

    expect(result).toEqual({
      id: 'a',
      reason: 'Personalized the answer',
      stage: 'executor',
    });
    expect(
      normalizeUsedMemoryResult(
        'missing',
        'Not loaded',
        [{ id: 'a', content: 'A' }],
        'executor'
      )
    ).toBeUndefined();
    expect(
      normalizeUsedMemoryResult(
        'a',
        undefined,
        [{ id: 'a', content: 'A' }],
        'executor'
      )
    ).toEqual({ id: 'a', stage: 'executor' });
  });

  it('dedupes merged usage by stage, id, and reason', () => {
    const result = mergeUsedMemoryResults(
      [{ id: 'a', reason: 'R', stage: 'distiller' }],
      [
        { id: 'a', reason: 'R', stage: 'distiller' },
        { id: 'a', reason: 'R', stage: 'executor' },
      ]
    );

    expect(result).toEqual([
      { id: 'a', reason: 'R', stage: 'distiller' },
      { id: 'a', reason: 'R', stage: 'executor' },
    ]);
  });
});

describe('skill usage normalization', () => {
  it('keeps only loaded skill ids and annotates the stage', () => {
    const state = createMutableSkillsPromptState();
    ingestSkillResults(state, [
      { id: 'skill:planning', name: 'Planning', content: 'Plan well.' },
    ]);

    expect(
      normalizeUsedSkillResult('skill:planning', undefined, state, 'executor')
    ).toEqual({ id: 'skill:planning', name: 'Planning', stage: 'executor' });
    expect(
      normalizeUsedSkillResult('missing', 'Not loaded', state, 'executor')
    ).toBeUndefined();
  });

  it('dedupes merged skill usage by stage, id, and reason', () => {
    const result = mergeUsedSkillResults(
      [
        {
          id: 'skill:planning',
          name: 'Planning',
          reason: 'R',
          stage: 'executor',
        },
      ],
      [
        {
          id: 'skill:planning',
          name: 'Planning',
          reason: 'R',
          stage: 'executor',
        },
        { id: 'skill:planning', name: 'Planning', stage: 'executor' },
      ]
    );

    expect(result).toEqual([
      {
        id: 'skill:planning',
        name: 'Planning',
        reason: 'R',
        stage: 'executor',
      },
      { id: 'skill:planning', name: 'Planning', stage: 'executor' },
    ]);
  });
});
