/**
 * The pipeline's two actor stages are the same `ActorAgentRLM` running under
 * different policies. This table is the single answer to "what does being
 * the distiller/executor mean" — every stage-conditional in the codebase
 * reads a named capability from here instead of branching on the variant
 * string, so the full behavioral difference between the stages fits on one
 * screen.
 */

export type AxAgentStageVariant = 'distiller' | 'executor';

export interface AxAgentStagePolicy {
  readonly variant: AxAgentStageVariant;
  /** Actor system-prompt template (and primitive-registry stage). */
  readonly templateId: 'rlm/distiller.md' | 'rlm/executor.md';
  /**
   * Tool callables execute. The distiller sees the full tool surface
   * (schemas, catalogs, discovery — its extraction guide) but its callables
   * are throwing stubs; execution authority stays with the executor.
   */
  readonly executesTools: boolean;
  /**
   * Child agents (arriving via `options.functions`) register as optimizer
   * sub-programs. Only the executor owns them — the distiller shares the
   * function metadata without duplicating optimizer ownership.
   */
  readonly ownsChildAgents: boolean;
  /** Receives the prompt-resident `contextMap` orientation cache. */
  readonly seesContextMap: boolean;
  /** Receives advisory relevance hints (ranked toward task execution). */
  readonly seesRelevanceHints: boolean;
  /** Ingests forward-time preset skills passed on the forward call. */
  readonly ingestsForwardSkills: boolean;
  /**
   * Enables `used(...)` skill-usage attribution for this stage. Currently
   * executor-only (pre-reconnaissance behavior); candidate to enable for the
   * distiller now that it loads skill guides too.
   */
  readonly tracksSkillUsage: boolean;
  /**
   * May declare the coordinator-wired `contextMetadata` input (the shared
   * runtime's raw-context inventory). User signatures are still guarded —
   * they validate through the distiller, which carries every user input.
   */
  readonly allowsContextMetadataInput: boolean;
  /** Synthesizes a mechanical `executorRequest` when the handoff lacks one. */
  readonly synthesizesDefaultExecutorRequest: boolean;
  /**
   * Shared session: this stage creates the session (phase 1). The other
   * stage adopts the live session and patches its phase bindings over it.
   */
  readonly createsSharedSession: boolean;
  /**
   * Shared session: exports variable bindings at end of run — the pipeline's
   * canonical cross-run state. The phase-1 stage exports bindings-free
   * (its variables live on in the session) — except when its run ends in
   * `respond()`, which skips the executor: the actor loop then exports WITH
   * bindings and the pipeline copies them onto the executor's cross-run slot.
   */
  readonly exportsSharedBindings: boolean;
  /**
   * Shared session: excludes phase-1 system/alias names from runtime
   * inspection so inherited context aliases don't render as user variables.
   */
  readonly inheritsPhase1ReservedNames: boolean;
  /**
   * Fallback mode (non-JS runtime): receives the host-carried evidence as a
   * runtime-only input value plus bare alias.
   */
  readonly receivesFallbackEvidence: boolean;
}

const DISTILLER_POLICY: AxAgentStagePolicy = {
  variant: 'distiller',
  templateId: 'rlm/distiller.md',
  executesTools: false,
  ownsChildAgents: false,
  seesContextMap: true,
  seesRelevanceHints: false,
  ingestsForwardSkills: false,
  tracksSkillUsage: false,
  allowsContextMetadataInput: false,
  synthesizesDefaultExecutorRequest: false,
  createsSharedSession: true,
  exportsSharedBindings: false,
  inheritsPhase1ReservedNames: false,
  receivesFallbackEvidence: false,
};

const EXECUTOR_POLICY: AxAgentStagePolicy = {
  variant: 'executor',
  templateId: 'rlm/executor.md',
  executesTools: true,
  ownsChildAgents: true,
  seesContextMap: false,
  seesRelevanceHints: true,
  ingestsForwardSkills: true,
  tracksSkillUsage: true,
  allowsContextMetadataInput: true,
  synthesizesDefaultExecutorRequest: true,
  createsSharedSession: false,
  exportsSharedBindings: true,
  inheritsPhase1ReservedNames: true,
  receivesFallbackEvidence: true,
};

/**
 * Standalone `ActorAgentRLM` (no stageVariant — direct per-instance use
 * outside the pipeline): executor-shaped, but without the pipeline-handoff
 * behaviors that only make sense downstream of a distiller (no synthesized
 * `executorRequest`, no coordinator-wired `contextMetadata` exemption).
 */
const STANDALONE_POLICY: AxAgentStagePolicy = {
  ...EXECUTOR_POLICY,
  allowsContextMetadataInput: false,
  synthesizesDefaultExecutorRequest: false,
};

export function resolveStagePolicy(stageVariant: unknown): AxAgentStagePolicy {
  if (stageVariant === 'distiller') return DISTILLER_POLICY;
  if (stageVariant === 'executor') return EXECUTOR_POLICY;
  return STANDALONE_POLICY;
}
