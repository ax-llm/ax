import type { AxAgentContextStage } from '../contextEvents.js';

export type AxAgentSkillResult = {
  /** Stable identifier — dedup key, prompt label, and usage telemetry key. */
  id?: string;
  /** Human-readable title rendered in the Loaded Skills prompt section. */
  name: string;
  /** Opaque markdown body (frontmatter, if any, is not parsed). */
  content: string;
};

/**
 * A skill in a host-provided static catalog (`skillsCatalog` option). Unlike
 * `skills` (which preloads full content into the prompt), a catalog entry is
 * only loaded when matched — by the built-in local search that backs
 * `discover({ skills })` when no `onSkillsSearch` callback is provided, and by
 * the advisory relevance hint.
 */
export type AxAgentCatalogSkill = {
  /** Stable identifier — dedup key, prompt label, and usage telemetry key. */
  id: string;
  /** Human-readable title. */
  name: string;
  /** Optional short "when to use" description (high-signal for matching). */
  description?: string;
  /** Full markdown body returned when the skill is loaded. */
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
