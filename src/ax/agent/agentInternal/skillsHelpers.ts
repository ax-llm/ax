import type { AxMutableSkillsPromptState } from './agentInternalTypes.js';
import type { AxAgentSkillsPromptState } from './agentStateTypes.js';
import type { AxAgentSkillResult } from './skillsTypes.js';

export function createMutableSkillsPromptState(): AxMutableSkillsPromptState {
  return {
    loaded: new Map<string, string>(),
  };
}

export function restoreSkillsPromptState(
  state?: Readonly<AxAgentSkillsPromptState>
): AxMutableSkillsPromptState {
  const restored = createMutableSkillsPromptState();
  for (const entry of state?.loaded ?? []) {
    if (
      entry &&
      typeof entry.name === 'string' &&
      entry.name.trim() &&
      typeof entry.content === 'string' &&
      entry.content.length > 0
    ) {
      restored.loaded.set(entry.name.trim(), entry.content);
    }
  }
  return restored;
}

export function serializeSkillsPromptState(
  state: Readonly<AxMutableSkillsPromptState>
): AxAgentSkillsPromptState | undefined {
  if (state.loaded.size === 0) {
    return undefined;
  }
  const loaded = [...state.loaded.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, content]) => ({ name, content }));
  return { loaded };
}

export function renderSkillsPromptMarkdown(
  state: Readonly<AxMutableSkillsPromptState>
): string | undefined {
  if (state.loaded.size === 0) {
    return undefined;
  }
  const blocks = [...state.loaded.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, content]) => `### ${name}\n\n${content}`);
  return blocks.join('\n\n');
}

export function ingestSkillResults(
  state: AxMutableSkillsPromptState,
  results: readonly AxAgentSkillResult[]
): void {
  for (const r of results) {
    if (
      !r ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      typeof r.content !== 'string'
    ) {
      continue;
    }
    state.loaded.set(r.name.trim(), r.content);
  }
}

export function normalizeSkillsInput(input: unknown): string[] {
  const collected: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') {
      throw new Error(
        '[POLICY] consult(...) expects a string or string[] of search queries.'
      );
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(
        '[POLICY] consult(...) entries must be non-empty strings.'
      );
    }
    collected.push(trimmed);
  };
  if (typeof input === 'string') {
    push(input);
  } else if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error(
        '[POLICY] consult(...) requires at least one search query.'
      );
    }
    for (const value of input) {
      push(value);
    }
  } else {
    throw new Error(
      '[POLICY] consult(...) expects a string or string[] of search queries.'
    );
  }
  return [...new Set(collected)];
}
