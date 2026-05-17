import type { AxAgentContextStage } from '../contextEvents.js';

export type AxAgentSkillResult = {
  /** Stable identifier — dedup key, prompt label, and usage telemetry key. */
  id?: string;
  /** Human-readable title rendered in the Loaded Skills prompt section. */
  name: string;
  /** Opaque markdown body (frontmatter, if any, is not parsed). */
  content: string;
};

export type AxAgentSkillsSearchFn = (
  searches: readonly string[]
) => readonly AxAgentSkillResult[] | Promise<readonly AxAgentSkillResult[]>;

export type AxAgentUsedSkill = {
  /** Stable skill id present in the Loaded Skills prompt state. */
  id: string;
  /** Human-readable skill title. */
  name: string;
  /** Optional actor-declared explanation of how the skill influenced the run. */
  reason?: string;
  /** Actor stage that declared this skill as used. */
  stage: AxAgentContextStage;
};

export type AxAgentUsedSkillsCallback = (
  usedSkills: readonly AxAgentUsedSkill[]
) => void | Promise<void>;
