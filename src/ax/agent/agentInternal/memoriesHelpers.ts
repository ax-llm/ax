import type { AxAgentContextStage } from '../contextEvents.js';
import type {
  AxAgentMemoriesSearchFn,
  AxAgentMemoryResult,
  AxAgentUsedMemory,
} from './memoriesTypes.js';
import { rankDocuments } from './relevanceRanker.js';

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

/** Chars of content indexed per catalog memory — bounds tokenization cost. */
const MEMORIES_CATALOG_RANK_CONTENT_CHARS = 600;
/** Per-search result cap for the built-in catalog recall. */
const MEMORIES_CATALOG_SEARCH_TOP_K = 3;
/** Snippet length for the advisory memories hint. */
const MEMORY_HINT_SNIPPET_CHARS = 80;

function memoryDocument(memory: AxAgentMemoryResult) {
  return {
    id: memory.id,
    fields: [
      { text: memory.id, identifier: true },
      { text: memory.content.slice(0, MEMORIES_CATALOG_RANK_CONTENT_CHARS) },
    ],
  };
}

/**
 * Built-in `onMemoriesSearch` over a static catalog, used when the host
 * provides `memoriesCatalog` but no search callback. Preserves the
 * `alreadyLoaded` contract: entries already in scope are excluded before
 * ranking. Deliberately best-effort (guards disabled): an explicit `recall()`
 * from the model should return the closest matches, unlike the
 * strictly-guarded advisory hint.
 */
export function createCatalogMemoriesSearch(
  catalog: readonly AxAgentMemoryResult[]
): AxAgentMemoriesSearchFn {
  return (
    searches: readonly string[],
    alreadyLoaded: readonly AxAgentMemoryResult[]
  ): AxAgentMemoryResult[] => {
    const skip = new Set(alreadyLoaded.map((m) => m.id));
    const candidates = catalog.filter((m) => !skip.has(m.id));
    if (candidates.length === 0) return [];
    const docs = candidates.map(memoryDocument);
    const byId = new Map(candidates.map((m) => [m.id, m]));
    const matchedIds: string[] = [];
    for (const search of searches) {
      for (const ranked of rankDocuments(search, docs, {
        topK: MEMORIES_CATALOG_SEARCH_TOP_K,
        minScore: 0,
        marginRatio: 0,
        minDocs: 1,
      })) {
        if (!matchedIds.includes(ranked.id)) {
          matchedIds.push(ranked.id);
        }
      }
    }
    return matchedIds
      .map((id) => byId.get(id))
      .filter((m): m is AxAgentMemoryResult => m !== undefined);
  };
}

/**
 * Rank catalog memories against the task for the advisory relevance hint.
 * Uses the ranker's STRICT default guards (unlike `createCatalogMemoriesSearch`)
 * so a low-confidence hint degrades to nothing.
 */
export function rankCatalogMemories(
  task: string,
  catalog: readonly AxAgentMemoryResult[],
  opts?: Readonly<{ topK?: number; minScore?: number }>
): { id: string; snippet: string; score: number }[] {
  const contentById = new Map(catalog.map((m) => [m.id, m.content]));
  return rankDocuments(task, catalog.map(memoryDocument), opts).map((r) => ({
    id: r.id,
    snippet: (contentById.get(r.id) ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MEMORY_HINT_SNIPPET_CHARS),
    score: r.score,
  }));
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

export function renderMemoriesPromptMarkdown(
  memories: ReadonlyArray<AxAgentMemoryEntry> | undefined
): string | undefined {
  const loaded = mergeMemoryResults(undefined, memories ?? []);
  if (loaded.length === 0) {
    return undefined;
  }
  return loaded
    .map(({ id, content }) => `### Memory\n\nID: \`${id}\`\n\n${content}`)
    .join('\n\n');
}

const MAX_USED_MEMORY_REASON_CHARS = 300;

export function normalizeUsedMemoryResult(
  idInput: unknown,
  reasonInput: unknown,
  loadedMemories: ReadonlyArray<AxAgentMemoryEntry> | undefined,
  stage: AxAgentContextStage
): AxAgentUsedMemory | undefined {
  const loadedIds = new Set(
    (loadedMemories ?? [])
      .map((entry) =>
        entry && typeof entry.id === 'string' ? entry.id.trim() : ''
      )
      .filter(Boolean)
  );
  if (loadedIds.size === 0) {
    return undefined;
  }

  const id = typeof idInput === 'string' ? idInput.trim() : '';
  const reason = typeof reasonInput === 'string' ? reasonInput.trim() : '';
  if (!id || !loadedIds.has(id)) {
    return undefined;
  }
  const cappedReason =
    reason && reason.length > MAX_USED_MEMORY_REASON_CHARS
      ? reason.slice(0, MAX_USED_MEMORY_REASON_CHARS)
      : reason;
  return {
    id,
    ...(cappedReason ? { reason: cappedReason } : {}),
    stage,
  };
}

export function mergeUsedMemoryResults(
  existing: readonly AxAgentUsedMemory[] | undefined,
  incoming: readonly AxAgentUsedMemory[]
): AxAgentUsedMemory[] {
  const map = new Map<string, AxAgentUsedMemory>();
  for (const item of [...(existing ?? []), ...incoming]) {
    if (!item?.id) {
      continue;
    }
    map.set(`${item.stage}\0${item.id}\0${item.reason ?? ''}`, item);
  }
  return [...map.values()];
}
