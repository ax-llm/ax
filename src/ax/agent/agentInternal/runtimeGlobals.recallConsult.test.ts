import { describe, expect, it, vi } from 'vitest';
import { agent } from '../index.js';
import type { AxCodeRuntime } from '../rlm.js';
import type { AxAgentMemoryResult } from './memoriesTypes.js';
import { buildRuntimeGlobals } from './runtimeGlobals.js';
import { createMutableSkillsPromptState } from './skillsHelpers.js';
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
    agentModuleNamespace: 'agents',
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

  it('fires onUsedMemories with the matched results', async () => {
    const matched: AxAgentMemoryResult[] = [
      { id: 'a', content: 'A' },
      { id: 'b', content: 'B' },
    ];
    const self = makeSelf({
      onMemoriesSearch: async () => matched,
    });
    const onUsedMemories = vi.fn();
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
      onUsedMemories
    ) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['anything']);

    expect(onUsedMemories).toHaveBeenCalledTimes(1);
    expect(onUsedMemories).toHaveBeenCalledWith(matched);
  });

  it('does not fire onUsedMemories when search returns nothing', async () => {
    const self = makeSelf({ onMemoriesSearch: async () => [] });
    const onUsedMemories = vi.fn();
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
      onUsedMemories
    ) as Record<string, unknown>;
    const recall = globals.recall as (input: string[]) => Promise<void>;

    await recall(['nothing']);

    expect(onUsedMemories).not.toHaveBeenCalled();
  });
});

describe('consult() runtime global — void contract', () => {
  it('returns undefined even when skills are matched', async () => {
    const self = makeSelf({
      onSkillsSearch: async (): Promise<readonly AxAgentSkillResult[]> => [
        { name: 'skill-a', content: '## A' },
        { name: 'skill-b', content: '## B' },
      ],
    });

    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const consult = globals.consult as (input: string[]) => Promise<unknown>;

    expect(typeof consult).toBe('function');
    await expect(consult(['some query'])).resolves.toBeUndefined();
  });

  it('returns undefined when no skills match', async () => {
    const self = makeSelf({ onSkillsSearch: async () => [] });
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    const consult = globals.consult as (input: string[]) => Promise<unknown>;

    await expect(consult(['nothing'])).resolves.toBeUndefined();
  });

  it('is not exposed when onSkillsSearch is not configured', () => {
    const self = makeSelf();
    const globals = buildRuntimeGlobals(self) as Record<string, unknown>;
    expect(globals.consult).toBeUndefined();
  });

  it('fires onUsedSkills with the matched results', async () => {
    const matched: AxAgentSkillResult[] = [
      { name: 'skill-a', content: '## A' },
    ];
    const self = makeSelf({ onSkillsSearch: async () => matched });
    const onUsedSkills = vi.fn();
    const globals = buildRuntimeGlobals(
      self,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onUsedSkills
    ) as Record<string, unknown>;
    const consult = globals.consult as (input: string[]) => Promise<void>;

    await consult(['anything']);

    expect(onUsedSkills).toHaveBeenCalledTimes(1);
    expect(onUsedSkills).toHaveBeenCalledWith(matched);
  });
});

describe('agent() factory wires onUsedMemories / onUsedSkills options', () => {
  it('stores the option callbacks on the agent instance', () => {
    const onUsedMemories = vi.fn();
    const onUsedSkills = vi.fn();
    const myAgent = agent('query:string -> answer:string', {
      contextFields: [],
      runtime: noOpRuntime,
      onMemoriesSearch: async () => [{ id: 'x', content: 'X' }],
      onSkillsSearch: async () => [{ name: 'skill-a', content: '## A' }],
      onUsedMemories,
      onUsedSkills,
    });

    // The callbacks should be reachable on the underlying agent state.
    // (We use a minimal property check rather than `getInternal` because
    // the factory exposes them on the primary agent instance.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalAgent = (myAgent as any).primaryAgent ?? myAgent;
    expect(internalAgent.onUsedMemories).toBe(onUsedMemories);
    expect(internalAgent.onUsedSkills).toBe(onUsedSkills);
  });
});
