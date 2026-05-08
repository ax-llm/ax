import type { AxAgentMemoryResult } from './memoriesTypes.js';

export type AxAgentMemoryEntry = {
  id: string;
  content: string;
};

export function normalizeMemoriesInput(input: unknown): string[] {
  const collected: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== 'string') {
      throw new Error(
        '[POLICY] recall(...) expects a string or string[] of search queries.'
      );
    }
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(
        '[POLICY] recall(...) entries must be non-empty strings.'
      );
    }
    collected.push(trimmed);
  };
  if (typeof input === 'string') {
    push(input);
  } else if (Array.isArray(input)) {
    if (input.length === 0) {
      throw new Error(
        '[POLICY] recall(...) requires at least one search query.'
      );
    }
    for (const value of input) {
      push(value);
    }
  } else {
    throw new Error(
      '[POLICY] recall(...) expects a string or string[] of search queries.'
    );
  }
  return [...new Set(collected)];
}

/**
 * Merge incoming memory results into the existing list. Dedupes by `id`
 * (last write wins) and returns a fresh array sorted by id for stable
 * prefix-cache behavior across turns.
 */
export function mergeMemoryResults(
  existing: ReadonlyArray<AxAgentMemoryEntry> | undefined,
  incoming: readonly AxAgentMemoryResult[]
): AxAgentMemoryEntry[] {
  const map = new Map<string, string>();
  for (const entry of existing ?? []) {
    if (
      entry &&
      typeof entry.id === 'string' &&
      entry.id.trim() &&
      typeof entry.content === 'string'
    ) {
      map.set(entry.id.trim(), entry.content);
    }
  }
  for (const r of incoming) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id.trim() ||
      typeof r.content !== 'string'
    ) {
      continue;
    }
    map.set(r.id.trim(), r.content);
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, content]) => ({ id, content }));
}
