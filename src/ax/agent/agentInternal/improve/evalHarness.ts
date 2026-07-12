/**
 * Sequential agent-layer batch evaluation for `agent.improve()`.
 *
 * Strictly sequential by design: `_forwardForEvaluation` saves/clears/
 * restores the primary actor's state, discovery state, and llmQuery budget
 * around each call — concurrent calls on one agent instance would interleave
 * those save/restore pairs and corrupt state.
 */

import type { AxAIService } from '../../../ai/types.js';
import type { AxMetricFn } from '../../../dsp/common_types.js';
import type { AxGenIn, AxGenOut } from '../../../dsp/types.js';
import type { AxAgentEvalTask } from '../agentOptimizeTypes.js';
import type { AxAgentImproveRunRecord } from './improveTypes.js';

/** Mutable (run + judge) pair budget shared across all improve() batches. */
export type AxAgentEvalBudget = { remaining: number };

export type AxAgentEvalBatchResult<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> = {
  records: AxAgentImproveRunRecord<IN, OUT>[];
  /** Weighted mean score over executed records (0 when none ran). */
  mean: number;
  /** True when the budget ran out before every task executed. */
  exhausted: boolean;
};

export async function runAgentEvalBatch<
  IN extends AxGenIn,
  OUT extends AxGenOut,
>(args: {
  agent: any;
  ai: Readonly<AxAIService>;
  tasks: readonly AxAgentEvalTask<IN>[];
  metric: AxMetricFn;
  scoreThreshold: number;
  budget: AxAgentEvalBudget;
  abortSignal?: AbortSignal;
}): Promise<AxAgentEvalBatchResult<IN, OUT>> {
  const records: AxAgentImproveRunRecord<IN, OUT>[] = [];
  let exhausted = false;

  for (const task of args.tasks) {
    if (args.abortSignal?.aborted) {
      throw new Error('AxAgent.improve(): aborted');
    }
    if (args.budget.remaining <= 0) {
      exhausted = true;
      break;
    }
    args.budget.remaining--;

    try {
      const prediction = await args.agent._forwardForEvaluation(args.ai, task, {
        ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
      });
      const score = await args.metric({
        prediction: prediction as Record<string, unknown>,
        example: task as unknown as Parameters<AxMetricFn>[0]['example'],
      });
      const numeric =
        typeof score === 'number' && Number.isFinite(score) ? score : 0;
      records.push({
        task,
        prediction,
        score: numeric,
        passed:
          numeric >= args.scoreThreshold &&
          prediction.completionType === 'final',
      });
    } catch (err) {
      if (args.abortSignal?.aborted) {
        throw err;
      }
      records.push({
        task,
        score: 0,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let weightSum = 0;
  let scoreSum = 0;
  for (const record of records) {
    const weight = record.task.weight ?? 1;
    weightSum += weight;
    scoreSum += weight * record.score;
  }
  return {
    records,
    mean: weightSum > 0 ? scoreSum / weightSum : 0,
    exhausted,
  };
}
