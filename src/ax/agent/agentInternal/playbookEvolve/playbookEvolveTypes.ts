/**
 * Public types for `agent.playbook().evolve(dataset, options)` — verified (or
 * trust-batch) playbook learning. The engine (batch eval → failure clustering
 * → grounded weakness mining → bounded playbook proposal → regression-gated
 * accept) is hidden behind the method, exactly as `optimize()` hides GEPA.
 * Verified learning produces only playbook bullets.
 */

import type { AxAIService } from '../../../ai/types.js';
import type { AxMetricFn } from '../../../dsp/common_types.js';
import type { AxPlaybookSnapshot } from '../../../dsp/playbook.js';
import type { AxGenIn, AxGenOut } from '../../../dsp/types.js';
import type {
  AxAgentEvalPrediction,
  AxAgentEvalTask,
  AxAgentJudgeOptions,
} from '../agentOptimizeTypes.js';

/** One executed (task, prediction, score) triple from the batch harness. */
export type AxAgentPlaybookEvolveRunRecord<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> = {
  task: AxAgentEvalTask<IN>;
  /** Absent when the run threw before producing a prediction. */
  prediction?: AxAgentEvalPrediction<OUT>;
  score: number;
  /** `score >= scoreThreshold` and the run neither threw nor stalled. */
  passed: boolean;
  /** Message of a thrown (non-clarification) run error. */
  error?: string;
};

/** A verifier-grounded weakness mined from one failure cluster. */
export type AxAgentPlaybookWeakness = {
  id: string;
  /** Deterministic cluster fingerprint the weakness was mined from. */
  clusterSignature: string;
  description: string;
  rootCause: string;
  /** The avoidance rule/lesson the proposal carries into the playbook. */
  proposedGuidance: string;
  /**
   * Quotes from the actual failure excerpts that ground this weakness. Only
   * quotes that substring-match the real excerpts survive; a weakness with
   * zero surviving quotes is discarded.
   */
  evidenceQuotes: readonly string[];
  /** Tasks in the cluster (by id or index). */
  taskIds: readonly string[];
  /** Report-only configuration suggestions; never auto-applied. */
  configRecommendations: readonly string[];
};

/** A bounded proposal: one curated playbook update per mined weakness. */
export type AxAgentPlaybookEvolveProposal = {
  weaknessId: string;
  /** Cluster signature recorded on the update event (dedupe ledger). */
  clusterSignature: string;
  /** Digest handed to the playbook update (curator input). */
  feedback: string;
};

export type AxAgentPlaybookEvolveOutcome = {
  proposal: AxAgentPlaybookEvolveProposal;
  accepted: boolean;
  reason: string;
  heldIn: { before: number; after: number };
  heldOut?: { before: number; after: number };
};

export type AxAgentPlaybookEvolveProgressEvent = {
  phase: 'baseline' | 'mining' | 'proposal' | 'validation' | 'done';
  message: string;
  metricCallsUsed: number;
};

export type AxAgentPlaybookEvolveOptions = {
  /**
   * Keep only proposals that provably help — re-score train + held-out after
   * each candidate bullet and accept only on a held-in gain without a
   * held-out regression, else roll it back. Default true. With `false`,
   * mined lessons are applied without the gate (fast trust-batch).
   */
  verify?: boolean;
  /** Runs the agent during evaluation. Defaults to the agent's `ai`. */
  studentAI?: Readonly<AxAIService>;
  /** Mines weaknesses. Defaults to `judgeAI`, then the student. */
  teacherAI?: Readonly<AxAIService>;
  /** Scores runs via the built-in judge. Resolution mirrors `optimize()`. */
  judgeAI?: Readonly<AxAIService>;
  judgeOptions?: AxAgentJudgeOptions;
  /** Optional deterministic scorer replacing the LLM judge. */
  metric?: AxMetricFn;
  /** Maximum weaknesses mined / proposals evaluated. Default 4. */
  maxProposals?: number;
  /**
   * Budget counting (agent run + judge) pairs across baseline and
   * re-evaluations. Default `max(100, (maxProposals + 1) * (train + validation)
   * * runsPerTask)`.
   */
  maxMetricCalls?: number;
  /**
   * Times each task runs per evaluation, with scores averaged. Default 1.
   * Use 2-3 when the dataset is small: accept/reject compares mean scores,
   * and on a handful of tasks a single lucky or unlucky run can otherwise
   * decide the gate. Each repeat spends budget.
   */
  runsPerTask?: number;
  /** Tolerated held-out drop when accepting a proposal (verify). Default 0.01. */
  epsilon?: number;
  /** Required held-in improvement to accept a proposal (verify). Default 0.05. */
  minHeldInGain?: number;
  /** Records scoring below this count as failures for mining. Default 0.7. */
  scoreThreshold?: number;
  /**
   * Keep accepted bullets on the live playbook (default). With `false`, the
   * playbook is rolled back at the end and the result's `playbookSnapshot`
   * carries the accepted state for a later `getPlaybook()?.load(...)`.
   */
  apply?: boolean;
  verbose?: boolean;
  onProgress?: (event: Readonly<AxAgentPlaybookEvolveProgressEvent>) => void;
  abortSignal?: AbortSignal;
};

export type AxAgentPlaybookEvolveResult<OUT extends AxGenOut = AxGenOut> = {
  baseline: { heldIn: number; heldOut?: number };
  final: { heldIn: number; heldOut?: number };
  weaknesses: readonly AxAgentPlaybookWeakness[];
  outcomes: readonly AxAgentPlaybookEvolveOutcome[];
  /** Config suggestions collected from mined weaknesses; never auto-applied. */
  recommendations: readonly string[];
  /** Playbook state after the accepted bullets. */
  playbookSnapshot?: AxPlaybookSnapshot;
  metricCallsUsed: number;
  /** The baseline corpus (post-run records with scores). */
  records: readonly AxAgentPlaybookEvolveRunRecord<any, OUT>[];
};
