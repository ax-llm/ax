/**
 * Construction-time playbook configuration for AxAgent.
 *
 * Mirrors the `contextMap` config precedent: attach an evolving
 * {@link AxPlaybook} to an agent at construction, keep it rendered into the
 * live stage prompt, and (by default) let the agent learn from its own
 * failures — a run-end hook harvests the run's failure signals and curates
 * durable avoidance rules into the playbook so later runs stop repeating
 * them. Persistence is caller-driven via `onUpdate`.
 */

import type { AxAIService } from '../ai/types.js';
import type { AxACEPlaybook } from '../dsp/optimizers/aceTypes.js';
import type { AxPlaybookOptions, AxPlaybookSnapshot } from '../dsp/playbook.js';
import type { AxAgentFailureSignal } from './agentInternal/failureReport.js';

export type AxAgentPlaybookLearnOptions = {
  /**
   * Failure signals a run must produce before spending LLM calls on a
   * playbook update. Default 1.
   */
  minSignals?: number;
  /**
   * Skip signals whose signature was already curated into this playbook —
   * recorded on the snapshot artifact's update events, so the check is
   * deterministic and survives save/restore. Coverage lapses when every
   * bullet that update produced has since been pruned from the playbook, so
   * a lost lesson can be re-learned; an update the curator explicitly
   * answered with no operations stays covered. Default true.
   */
  dedupe?: boolean;
};

export type AxAgentPlaybookUpdateStatus = 'updated' | 'unchanged' | 'skipped';

export type AxAgentPlaybookSkipReason =
  | 'learning_disabled'
  | 'no_failures'
  | 'below_min_signals'
  | 'all_duplicates';

export type AxAgentPlaybookUpdateResult = {
  /** Snapshot of the playbook after this run (persist via `onUpdate`). */
  snapshot: AxPlaybookSnapshot;
  status: AxAgentPlaybookUpdateStatus;
  skipReason?: AxAgentPlaybookSkipReason;
  /** Failure signals this update was fed (fresh signals only when deduping). */
  signals: readonly AxAgentFailureSignal[];
  /** Digest text sent to the playbook curator. Absent on skips. */
  feedback?: string;
};

export type AxAgentPlaybookConfig = {
  /**
   * Seed content: a persisted {@link AxPlaybookSnapshot} (from `onUpdate` /
   * `handle.getState()`) or a bare playbook object.
   */
  playbook?: AxPlaybookSnapshot | AxACEPlaybook;
  /** Stage whose live prompt receives the rendered playbook. Default 'actor'. */
  target?: 'actor' | 'responder';
  /** Render the playbook into the live stage prompt. Default true. */
  apply?: boolean;
  /**
   * Run-end failure learning — ON by default (the config block itself is the
   * opt-in). After each completed run that produced failure signals (error
   * turns, repeated dead-ends, tool errors), one bounded playbook update
   * (default: 1 reflector + 1 curator call) curates avoidance rules into the
   * `failures_to_avoid` section. Clean runs cost zero extra calls. Pass an
   * object to tune gating, or `false` for a render-only playbook.
   */
  learn?: boolean | AxAgentPlaybookLearnOptions;
  /**
   * Persistence hook — fires after a run-end update actually ran
   * (`status !== 'skipped'`). Failures in the hook are swallowed; playbook
   * upkeep never breaks the completed user-facing run.
   */
  onUpdate?: (result: AxAgentPlaybookUpdateResult) => void | Promise<void>;
  /** AI running reflection/curation. Defaults to the agent's `ai`. */
  studentAI?: Readonly<AxAIService>;
  /** Stronger model for reflection/curation. Defaults to the agent's `judgeAI`. */
  teacherAI?: Readonly<AxAIService>;
} & Pick<
  AxPlaybookOptions,
  | 'maxReflectorRounds'
  | 'maxSectionSize'
  | 'allowDynamicSections'
  | 'seed'
  | 'verbose'
>;

export type AxResolvedAgentPlaybookLearn = {
  enabled: boolean;
  minSignals: number;
  dedupe: boolean;
};

export type AxResolvedAgentPlaybookConfig = {
  seedPlaybook?: AxPlaybookSnapshot | AxACEPlaybook;
  target: 'actor' | 'responder';
  apply: boolean;
  learn: AxResolvedAgentPlaybookLearn;
  onUpdate?: (result: AxAgentPlaybookUpdateResult) => void | Promise<void>;
  studentAI?: Readonly<AxAIService>;
  teacherAI?: Readonly<AxAIService>;
  playbookOptions: Pick<
    AxPlaybookOptions,
    | 'maxReflectorRounds'
    | 'maxSectionSize'
    | 'allowDynamicSections'
    | 'seed'
    | 'verbose'
  >;
};

export const PLAYBOOK_LEARN_DEFAULT = true;
export const DEFAULT_PLAYBOOK_MIN_SIGNALS = 1;
/**
 * Run-end updates default to a single reflection round (the ACE engine's own
 * default is 2) so a harvested run costs at most 1 reflector + 1 curator
 * call.
 */
export const DEFAULT_PLAYBOOK_MAX_REFLECTOR_ROUNDS = 1;

export function isPlaybookSnapshotSeed(
  value: AxPlaybookSnapshot | AxACEPlaybook
): value is AxPlaybookSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'playbook' in value &&
    'artifact' in value
  );
}

/**
 * Failure signatures the playbook still covers, for the run-end dedupe gate.
 *
 * A signature is covered while the update event that curated it is still
 * "alive": either the curator ran and deliberately produced no operations
 * (declined — don't re-spend on the same signature), the event predates
 * `updatedBulletIds` tracking (legacy snapshots keep the old always-covered
 * behavior), or at least one bullet that update created/updated still exists
 * in the playbook. Once every such bullet has been pruned, coverage lapses
 * and the signature can be re-learned.
 *
 * A transient reflector/curator failure is NOT treated as a deliberate
 * decline: it leaves no delta AND no `curator` on the feedback event (the
 * ACE engine sets `curator` only when the curator actually ran), so the
 * signature stays uncovered and re-learns on the next run instead of being
 * permanently suppressed by one bad LLM call.
 */
export function collectCoveredFailureSignatures(
  snapshot: Readonly<AxPlaybookSnapshot>
): Set<string> {
  const covered = new Set<string>();
  const liveBulletIds = new Set<string>();
  for (const bullets of Object.values(snapshot.playbook?.sections ?? {})) {
    for (const bullet of bullets ?? []) {
      liveBulletIds.add(bullet.id);
    }
  }
  const history = snapshot.artifact?.history ?? [];
  (snapshot.artifact?.feedback ?? []).forEach((event, index) => {
    const sigs = (event.example as { failureSignatures?: unknown })
      ?.failureSignatures;
    if (!Array.isArray(sigs) || sigs.length === 0) {
      return;
    }
    const deltas = history.filter(
      (entry) => entry.source === 'online' && entry.exampleIndex === index
    );
    const curatorRan = (event as { curator?: unknown }).curator !== undefined;
    const alive =
      deltas.length === 0
        ? curatorRan
        : deltas.some(
            (entry) =>
              entry.updatedBulletIds === undefined ||
              entry.updatedBulletIds.some((id) => liveBulletIds.has(id))
          );
    if (alive) {
      for (const sig of sigs) {
        covered.add(String(sig));
      }
    }
  });
  return covered;
}

export function resolveAgentPlaybookConfig(
  config: Readonly<AxAgentPlaybookConfig> | undefined
): AxResolvedAgentPlaybookConfig | undefined {
  if (config === undefined) {
    return undefined;
  }

  const learnInput = config.learn ?? PLAYBOOK_LEARN_DEFAULT;
  const learn: AxResolvedAgentPlaybookLearn =
    typeof learnInput === 'boolean'
      ? {
          enabled: learnInput,
          minSignals: DEFAULT_PLAYBOOK_MIN_SIGNALS,
          dedupe: true,
        }
      : {
          enabled: true,
          minSignals: learnInput.minSignals ?? DEFAULT_PLAYBOOK_MIN_SIGNALS,
          dedupe: learnInput.dedupe ?? true,
        };
  if (!Number.isInteger(learn.minSignals) || learn.minSignals < 1) {
    throw new Error(
      'AxAgent: playbook.learn.minSignals must be a positive integer.'
    );
  }

  return {
    ...(config.playbook !== undefined ? { seedPlaybook: config.playbook } : {}),
    target: config.target ?? 'actor',
    apply: config.apply !== false,
    learn,
    ...(config.onUpdate ? { onUpdate: config.onUpdate } : {}),
    ...(config.studentAI ? { studentAI: config.studentAI } : {}),
    ...(config.teacherAI ? { teacherAI: config.teacherAI } : {}),
    playbookOptions: {
      maxReflectorRounds:
        config.maxReflectorRounds ?? DEFAULT_PLAYBOOK_MAX_REFLECTOR_ROUNDS,
      maxSectionSize: config.maxSectionSize,
      allowDynamicSections: config.allowDynamicSections,
      seed: config.seed,
      verbose: config.verbose,
    },
  };
}
