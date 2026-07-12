/**
 * `agent.improve()` orchestrator — failure-driven repair with
 * regression-validated acceptance:
 *
 *   baseline batch eval → deterministic failure clustering → per-cluster
 *   weakness mining (grounded) → bounded proposals → sequential accept gate.
 *
 * A proposal is accepted only when the held-in (train) score improves by at
 * least `minHeldInGain` AND the held-out (validation) score does not drop by
 * more than `epsilon`; rejected proposals roll back exactly. Sequential
 * evaluation gives clean per-proposal attribution — accepted scores become
 * the next proposal's baseline.
 */

import type { AxGenIn, AxGenOut } from '../../../dsp/types.js';
import { normalizeAgentEvalDataset } from '../../optimize.js';
import type {
  AxAgentEvalDataset,
  AxAgentJudgeOptions,
} from '../agentOptimizeTypes.js';
import { createAgentOptimizeMetric } from '../optimizer.js';
import type { AxAgentEvalBudget } from './evalHarness.js';
import { runAgentEvalBatch } from './evalHarness.js';
import { clusterFailures } from './failureClusters.js';
import type {
  AxAgentImproveOptions,
  AxAgentImproveProposalOutcome,
  AxAgentImproveResult,
  AxAgentImproveSurface,
  AxAgentWeakness,
} from './improveTypes.js';
import type { AxAppliedProposal } from './proposals.js';
import {
  actorInstructionText,
  applyProposal,
  buildProposal,
} from './proposals.js';
import { mineWeakness } from './weaknessMiner.js';

const DEFAULT_MAX_PROPOSALS = 4;
const DEFAULT_EPSILON = 0.01;
const DEFAULT_MIN_HELD_IN_GAIN = 0.05;
const DEFAULT_SCORE_THRESHOLD = 0.7;

export async function improveAgent<IN extends AxGenIn, OUT extends AxGenOut>(
  self: any,
  dataset: Readonly<AxAgentEvalDataset<IN>>,
  options?: Readonly<AxAgentImproveOptions>
): Promise<AxAgentImproveResult<OUT>> {
  const s = self as any;
  const normalized = normalizeAgentEvalDataset(dataset);
  if (normalized.train.length === 0) {
    throw new Error(
      'AxAgent.improve(): at least one training task is required.'
    );
  }

  const studentAI = options?.studentAI ?? s.init?.ai ?? s.ai;
  if (!studentAI) {
    throw new Error(
      'AxAgent.improve(): studentAI is required when the agent has no default ai.'
    );
  }
  const agentJudgeAI = s.init?.judgeAI ?? s.judgeAI;
  const teacherAI = options?.teacherAI ?? agentJudgeAI ?? studentAI;
  const judgeAI =
    options?.judgeAI ?? agentJudgeAI ?? options?.teacherAI ?? studentAI;
  const judgeOptions: AxAgentJudgeOptions = {
    ...(s.judgeOptions ?? {}),
    ...(options?.judgeOptions ?? {}),
  };
  const metric =
    options?.metric ?? createAgentOptimizeMetric(self, judgeAI, judgeOptions);

  const maxProposals = Math.max(
    1,
    Math.floor(options?.maxProposals ?? DEFAULT_MAX_PROPOSALS)
  );
  const runsPerTask = Math.max(1, Math.floor(options?.runsPerTask ?? 1));
  const datasetSize =
    (normalized.train.length + (normalized.validation?.length ?? 0)) *
    runsPerTask;
  const maxMetricCalls = Math.max(
    1,
    Math.floor(
      options?.maxMetricCalls ?? Math.max(100, (maxProposals + 1) * datasetSize)
    )
  );
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;
  const minHeldInGain = options?.minHeldInGain ?? DEFAULT_MIN_HELD_IN_GAIN;
  const scoreThreshold = options?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const surfaces: readonly AxAgentImproveSurface[] = options?.surfaces?.length
    ? options.surfaces
    : (['playbook', 'instructions'] as const);
  const budget: AxAgentEvalBudget = { remaining: maxMetricCalls };
  const usedCalls = () => maxMetricCalls - budget.remaining;

  const progress = (
    phase: 'baseline' | 'mining' | 'proposal' | 'validation' | 'done',
    message: string
  ) => {
    options?.onProgress?.({ phase, message, metricCallsUsed: usedCalls() });
    if (options?.verbose) {
      console.log(`[improve] ${phase}: ${message}`);
    }
  };

  const batchArgs = {
    agent: s,
    ai: studentAI,
    metric,
    scoreThreshold,
    budget,
    runsPerTask,
    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
  };

  // ---- Baseline ----
  progress('baseline', `evaluating ${normalized.train.length} train tasks`);
  const baselineTrain = await runAgentEvalBatch<IN, OUT>({
    ...batchArgs,
    tasks: normalized.train,
  });
  let heldIn = baselineTrain.mean;
  let heldOut: number | undefined;
  if (normalized.validation?.length) {
    progress(
      'baseline',
      `evaluating ${normalized.validation.length} validation tasks`
    );
    heldOut = (
      await runAgentEvalBatch<IN, OUT>({
        ...batchArgs,
        tasks: normalized.validation,
      })
    ).mean;
  }
  const baseline = {
    heldIn,
    ...(heldOut !== undefined ? { heldOut } : {}),
  };

  // ---- Mine weaknesses from failure clusters ----
  const clusters = clusterFailures(
    baselineTrain.records,
    scoreThreshold,
    maxProposals
  );
  progress(
    'mining',
    `${clusters.length} failure cluster(s) from ${baselineTrain.records.length} records`
  );

  const playbookHandle = (() => {
    const existing = s.getPlaybook?.();
    if (existing || !surfaces.includes('playbook')) {
      return existing;
    }
    // Lazily attach a playbook so accepted lessons stay live and inspectable
    // via getPlaybook(); improve() owns curation, so run-end learning stays
    // whatever the user configured.
    const handle = s._buildStagePlaybook({
      target: 'actor',
      studentAI,
      teacherAI,
      maxReflectorRounds: 1,
    });
    s.playbookHandle = handle;
    return handle;
  })();

  const currentInstruction = actorInstructionText(s);

  const weaknesses: AxAgentWeakness[] = [];
  for (const [index, cluster] of clusters.entries()) {
    if (options?.abortSignal?.aborted) {
      throw new Error('AxAgent.improve(): aborted');
    }
    try {
      const weakness = await mineWeakness({
        ai: teacherAI,
        cluster,
        allowedSurfaces: surfaces,
        currentInstruction,
        currentPlaybook: playbookHandle?.render?.() || undefined,
        index,
      });
      if (weakness) {
        weaknesses.push(weakness);
        progress(
          'mining',
          `${weakness.id} [${weakness.clusterSignature}] -> ${weakness.surface}`
        );
      } else {
        progress(
          'mining',
          `cluster [${cluster.signature}] discarded (no grounded evidence)`
        );
      }
    } catch (err) {
      progress(
        'mining',
        `cluster [${cluster.signature}] miner failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ---- Sequential propose -> validate -> accept/reject ----
  const outcomes: AxAgentImproveProposalOutcome[] = [];
  const accepted: AxAppliedProposal[] = [];
  const appliedInstructionAddenda: string[] = [];

  for (const weakness of weaknesses) {
    if (options?.abortSignal?.aborted) {
      throw new Error('AxAgent.improve(): aborted');
    }
    const proposal = buildProposal(weakness);
    const requiredCalls =
      (normalized.train.length + (normalized.validation?.length ?? 0)) *
      runsPerTask;
    if (budget.remaining < requiredCalls) {
      outcomes.push({
        proposal,
        accepted: false,
        reason: 'metric_budget exhausted before validation',
        heldIn: { before: heldIn, after: heldIn },
      });
      progress('validation', `${weakness.id}: budget exhausted, skipped`);
      continue;
    }

    progress('proposal', `${weakness.id}: applying ${proposal.kind} proposal`);
    let applied: AxAppliedProposal;
    try {
      applied = await applyProposal({
        agent: s,
        proposal,
        playbookHandle,
      });
    } catch (err) {
      outcomes.push({
        proposal,
        accepted: false,
        reason: `apply failed: ${err instanceof Error ? err.message : String(err)}`,
        heldIn: { before: heldIn, after: heldIn },
      });
      continue;
    }

    const revalTrain = await runAgentEvalBatch<IN, OUT>({
      ...batchArgs,
      tasks: normalized.train,
    });
    let revalHeldOut: number | undefined;
    if (normalized.validation?.length) {
      revalHeldOut = (
        await runAgentEvalBatch<IN, OUT>({
          ...batchArgs,
          tasks: normalized.validation,
        })
      ).mean;
    }

    const gainOk = revalTrain.mean - heldIn >= minHeldInGain;
    const heldOutOk =
      revalHeldOut === undefined ||
      heldOut === undefined ||
      revalHeldOut - heldOut >= -epsilon;
    const accept = gainOk && heldOutOk;

    outcomes.push({
      proposal,
      accepted: accept,
      reason: accept
        ? heldOut === undefined
          ? 'held-in improved (no held-out set provided — consider one)'
          : 'held-in improved, held-out non-regressing'
        : !gainOk
          ? `held-in gain ${(revalTrain.mean - heldIn).toFixed(3)} below ${minHeldInGain}`
          : `held-out regressed ${((revalHeldOut ?? 0) - (heldOut ?? 0)).toFixed(3)}`,
      heldIn: { before: heldIn, after: revalTrain.mean },
      ...(revalHeldOut !== undefined && heldOut !== undefined
        ? { heldOut: { before: heldOut, after: revalHeldOut } }
        : {}),
    });

    if (accept) {
      accepted.push(applied);
      heldIn = revalTrain.mean;
      if (revalHeldOut !== undefined) {
        heldOut = revalHeldOut;
      }
      if (proposal.kind === 'instructions') {
        appliedInstructionAddenda.push(proposal.addendum);
      }
      progress('validation', `${weakness.id}: ACCEPTED`);
    } else {
      applied.rollback();
      progress('validation', `${weakness.id}: rejected, rolled back`);
    }
  }

  // ---- Finalize ----
  const playbookTouched = accepted.some((a) => a.proposal.kind === 'playbook');
  const playbookSnapshot = playbookTouched
    ? playbookHandle?.getState()
    : undefined;

  if (options?.apply === false) {
    for (const applied of [...accepted].reverse()) {
      applied.rollback();
    }
  }

  progress(
    'done',
    `${accepted.length}/${outcomes.length} proposals accepted; held-in ${baseline.heldIn.toFixed(3)} -> ${heldIn.toFixed(3)}`
  );

  return {
    baseline,
    final: { heldIn, ...(heldOut !== undefined ? { heldOut } : {}) },
    weaknesses,
    outcomes,
    recommendations: weaknesses.flatMap((w) => w.configRecommendations),
    ...(playbookSnapshot ? { playbookSnapshot } : {}),
    ...(appliedInstructionAddenda.length > 0
      ? { appliedInstructionAddenda }
      : {}),
    metricCallsUsed: usedCalls(),
    records: baselineTrain.records,
  };
}
