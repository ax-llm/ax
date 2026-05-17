import type { AxAgentContextStage } from '../contextEvents.js';
import type { AxMutableSkillsPromptState } from './agentInternalTypes.js';
import type { AxAgentSkillsPromptState } from './agentStateTypes.js';
import type { AxAgentSkillResult, AxAgentUsedSkill } from './skillsTypes.js';

export function createMutableSkillsPromptState(): AxMutableSkillsPromptState {
  return {
    loaded: new Map(),
  };
}

function normalizeSkillEntry(
  entry: unknown
): { id: string; name: string; content: string } | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const id =
    typeof record.id === 'string' && record.id.trim() ? record.id.trim() : name;
  if (!id || !name || typeof record.content !== 'string') {
    return undefined;
  }
  const content = record.content;
  return { id, name, content };
}

export function restoreSkillsPromptState(
  state?: Readonly<AxAgentSkillsPromptState>
): AxMutableSkillsPromptState {
  const restored = createMutableSkillsPromptState();
  for (const entry of state?.loaded ?? []) {
    const normalized = normalizeSkillEntry(entry);
    if (normalized) {
      restored.loaded.set(normalized.id, normalized);
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
  const loaded = [...state.loaded.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  return { loaded };
}

export function renderSkillsPromptMarkdown(
  state: Readonly<AxMutableSkillsPromptState>
): string | undefined {
  if (state.loaded.size === 0) {
    return undefined;
  }
  const blocks = [...state.loaded.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(
      ({ id, name, content }) => `### ${name}\n\nID: \`${id}\`\n\n${content}`
    );
  return blocks.join('\n\n');
}

export function ingestSkillResults(
  state: AxMutableSkillsPromptState,
  results: readonly AxAgentSkillResult[]
): void {
  for (const r of results) {
    const normalized = normalizeSkillEntry(r);
    if (!normalized) {
      continue;
    }
    state.loaded.set(normalized.id, normalized);
  }
}

export function normalizeSkillsInput(input: unknown): string[] {
  const collected: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') {
      throw new Error(
        '[POLICY] discover({ skills }) expects a string or string[] of search queries.'
      );
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(
        '[POLICY] discover({ skills }) entries must be non-empty strings.'
      );
    }
    collected.push(trimmed);
  };
  if (typeof input === 'string') {
    push(input);
  } else if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error(
        '[POLICY] discover({ skills }) requires at least one search query.'
      );
    }
    for (const value of input) {
      push(value);
    }
  } else {
    throw new Error(
      '[POLICY] discover({ skills }) expects a string or string[] of search queries.'
    );
  }
  return [...new Set(collected)];
}

const MAX_USED_SKILL_REASON_CHARS = 300;

export function normalizeUsedSkillResult(
  idInput: unknown,
  reasonInput: unknown,
  state: Readonly<AxMutableSkillsPromptState> | undefined,
  stage: AxAgentContextStage
): AxAgentUsedSkill | undefined {
  const id = typeof idInput === 'string' ? idInput.trim() : '';
  const entry = id ? state?.loaded.get(id) : undefined;
  if (!entry) {
    return undefined;
  }
  const reason =
    typeof reasonInput === 'string' ? reasonInput.trim() : undefined;
  const cappedReason =
    reason && reason.length > MAX_USED_SKILL_REASON_CHARS
      ? reason.slice(0, MAX_USED_SKILL_REASON_CHARS)
      : reason;
  return {
    id,
    name: entry.name,
    ...(cappedReason ? { reason: cappedReason } : {}),
    stage,
  };
}

export function mergeUsedSkillResults(
  existing: readonly AxAgentUsedSkill[] | undefined,
  incoming: readonly AxAgentUsedSkill[]
): AxAgentUsedSkill[] {
  const map = new Map<string, AxAgentUsedSkill>();
  for (const item of [...(existing ?? []), ...incoming]) {
    if (!item?.id) {
      continue;
    }
    map.set(`${item.stage}\0${item.id}\0${item.reason ?? ''}`, item);
  }
  return [...map.values()];
}
