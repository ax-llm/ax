import type { AxAgentContextStage } from '../contextEvents.js';

export type AxAgentMemoryResult = {
  /** Stable identifier — dedup key and label in `inputs.memories`. */
  id: string;
  /** Opaque markdown body (frontmatter, if any, is not parsed). */
  content: string;
};

export type AxAgentUsedMemory = {
  /** Stable identifier of a memory present in `inputs.memories`. */
  id: string;
  /** Short actor-declared explanation of how the memory influenced the run. */
  reason?: string;
  /** Actor stage that declared this memory as used. */
  stage: AxAgentContextStage;
};

export type AxAgentUsedMemoriesCallback = (
  usedMemories: readonly AxAgentUsedMemory[]
) => void | Promise<void>;

/**
 * Memories search callback. Receives the raw search strings and the
 * snapshot of `inputs.memories` already loaded for the current run
 * (deduped by id, sorted). Use the second argument to skip work for
 * entries that are already in scope — for example, filter your vector
 * search by `id NOT IN alreadyLoaded` so you don't re-fetch and the
 * actor doesn't pay tokens for duplicates. Returning already-loaded
 * entries is still safe (the runtime dedupes by id) but wastes work.
 */
export type AxAgentMemoriesSearchFn = (
  searches: readonly string[],
  alreadyLoaded: readonly AxAgentMemoryResult[]
) => readonly AxAgentMemoryResult[] | Promise<readonly AxAgentMemoryResult[]>;
