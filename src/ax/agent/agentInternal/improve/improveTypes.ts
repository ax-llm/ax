/**
 * Public types for `agent.improve()` — failure-driven agent repair with
 * regression-validated acceptance. The repair engine (weakness mining over
 * batch-eval failure clusters, bounded proposals, sequential accept gates) is
 * an implementation detail hidden behind the method, exactly as `optimize()`
 * hides its optimizer and `playbook()` hides its evolution engine.
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

export type AxAgentImproveSurface = 'playbook' | 'instructions';

/** One executed (task, prediction, score) triple from the batch harness. */
export type AxAgentImproveRunRecord<
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
export type AxAgentWeakness = {
  id: string;
  /** Deterministic cluster fingerprint the weakness was mined from. */
  clusterSignature: string;
  description: string;
  rootCause: string;
  /** Surface the proposal targets. */
  surface: AxAgentImproveSurface;
  /** The guidance/rule text the proposal carries. */
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

export type AxAgentImproveProposal =
  | {
      kind: 'playbook';
      weaknessId: string;
      /** Cluster signature recorded on the update event (P1 dedupe ledger). */
      clusterSignature: string;
      /** Digest handed to the playbook update (curator input). */
      feedback: string;
    }
  | {
      kind: 'instructions';
      weaknessId: string;
      /** Standing rule appended to the executor's instruction addenda. */
      addendum: string;
    };

export type AxAgentImproveProposalOutcome = {
  proposal: AxAgentImproveProposal;
  accepted: boolean;
  reason: string;
  heldIn: { before: number; after: number };
  heldOut?: { before: number; after: number };
};

export type AxAgentImproveProgressEvent = {
  phase: 'baseline' | 'mining' | 'proposal' | 'validation' | 'done';
  message: string;
  metricCallsUsed: number;
};

export type AxAgentImproveOptions = {
  /** Runs the agent during evaluation. Defaults to the agent's `ai`. */
  studentAI?: Readonly<AxAIService>;
  /** Mines weaknesses and writes proposals. Defaults to `judgeAI`, then the student. */
  teacherAI?: Readonly<AxAIService>;
  /** Scores runs via the built-in judge. Resolution mirrors `optimize()`. */
  judgeAI?: Readonly<AxAIService>;
  judgeOptions?: AxAgentJudgeOptions;
  /** Optional deterministic scorer replacing the LLM judge. */
  metric?: AxMetricFn;
  /** Bounded edit surfaces proposals may touch. Default: both. */
  surfaces?: readonly AxAgentImproveSurface[];
  /** Maximum weaknesses mined / proposals evaluated. Default 4. */
  maxProposals?: number;
  /**
   * Budget counting (agent run + judge) pairs across baseline and
   * re-evaluations. Default `max(100, (maxProposals + 1) * datasetSize *
   * runsPerTask)`.
   */
  maxMetricCalls?: number;
  /**
   * Times each task runs per evaluation, with scores averaged. Default 1.
   * Use 2-3 when the dataset is small: accept/reject compares mean scores,
   * and on a handful of tasks a single lucky or unlucky run can otherwise
   * decide the gate. Each repeat spends budget.
   */
  runsPerTask?: number;
  /** Tolerated held-out drop when accepting a proposal. Default 0.01. */
  epsilon?: number;
  /** Required held-in improvement to accept a proposal. Default 0.05. */
  minHeldInGain?: number;
  /** Records scoring below this count as failures for mining. Default 0.7. */
  scoreThreshold?: number;
  /**
   * Keep accepted proposals applied to the live agent (default). With
   * `false`, everything is rolled back at the end and the result's
   * `playbookSnapshot` / `appliedComponents` carry the accepted state for a
   * later `getPlaybook()?.load(...)` / `applyOptimizedComponents(...)`.
   */
  apply?: boolean;
  verbose?: boolean;
  onProgress?: (event: Readonly<AxAgentImproveProgressEvent>) => void;
  abortSignal?: AbortSignal;
};

export type AxAgentImproveResult<OUT extends AxGenOut = AxGenOut> = {
  baseline: { heldIn: number; heldOut?: number };
  final: { heldIn: number; heldOut?: number };
  weaknesses: readonly AxAgentWeakness[];
  outcomes: readonly AxAgentImproveProposalOutcome[];
  /** Config suggestions collected from mined weaknesses; never auto-applied. */
  recommendations: readonly string[];
  /** Playbook state after the accepted proposals (when any touched it). */
  playbookSnapshot?: AxPlaybookSnapshot;
  /**
   * Accepted standing instruction addenda. Live on the agent when
   * `apply: true`; re-apply later (e.g. after a restart) via
   * `agent.addActorInstruction(...)`. For durable persistence prefer the
   * playbook surface, whose snapshot rides `playbookSnapshot`.
   */
  appliedInstructionAddenda?: readonly string[];
  metricCallsUsed: number;
  /** The baseline corpus (post-run records with scores). */
  records: readonly AxAgentImproveRunRecord<any, OUT>[];
};
