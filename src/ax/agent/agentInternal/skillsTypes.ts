export type AxAgentSkillResult = {
  name: string;
  /** Opaque markdown body (frontmatter, if any, is not parsed). */
  content: string;
};

export type AxAgentSkillsSearchFn = (
  searches: readonly string[]
) => readonly AxAgentSkillResult[] | Promise<readonly AxAgentSkillResult[]>;
