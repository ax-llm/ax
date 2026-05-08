export type AxAgentMemoryResult = {
  /** Stable identifier — dedup key and label in `inputs.memories`. */
  id: string;
  /** Opaque markdown body (frontmatter, if any, is not parsed). */
  content: string;
};

export type AxAgentMemoriesSearchFn = (
  searches: readonly string[]
) => readonly AxAgentMemoryResult[] | Promise<readonly AxAgentMemoryResult[]>;
