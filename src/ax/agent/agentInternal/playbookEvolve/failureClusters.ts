/**
 * Deterministic failure clustering for `agent.playbook().evolve()` — zero LLM calls.
 *
 * Failures group by a stable signature so the miner sees one cluster per
 * failure mode. Key resolution order per record: majority signature among the
 * run's structured failure signals (P1 harvest) → first tool-error line →
 * first `XxxError:` line in the action log → `'behavioral:no_error'` (the
 * judge failed an error-free run: wrong output, forbidden actions, stalls).
 */

import { extractErrorSignature } from '../../contextManager.js';
import type { AxAgentPlaybookEvolveRunRecord } from './playbookEvolveTypes.js';

export type AxAgentFailureCluster = {
  signature: string;
  records: AxAgentPlaybookEvolveRunRecord[];
  /** count x mean(1 - score): frequent, badly-scored clusters rank first. */
  severity: number;
  taskIds: readonly string[];
};

export const BEHAVIORAL_CLUSTER_SIGNATURE = 'behavioral:no_error';

export function isFailureRecord(
  record: AxAgentPlaybookEvolveRunRecord,
  scoreThreshold: number
): boolean {
  if (record.error) {
    return true;
  }
  if (record.prediction?.completionType === 'askClarification') {
    return true;
  }
  return record.score < scoreThreshold;
}

function recordSignature(record: AxAgentPlaybookEvolveRunRecord): string {
  const signals = record.prediction?.failureSignals ?? [];
  if (signals.length > 0) {
    const counts = new Map<string, number>();
    for (const signal of signals) {
      counts.set(
        signal.signature,
        (counts.get(signal.signature) ?? 0) + signal.occurrences
      );
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [signature, count] of counts) {
      if (count > bestCount) {
        best = signature;
        bestCount = count;
      }
    }
    if (best) {
      return best;
    }
  }

  const toolError = record.prediction?.toolErrors?.[0];
  if (toolError) {
    return toolError.split('\n')[0]?.slice(0, 100) ?? toolError.slice(0, 100);
  }

  if (record.error) {
    return extractErrorSignature(record.error);
  }

  const actionLog = record.prediction?.actionLog ?? '';
  const errorLine = actionLog.match(/^\s*(\w+Error:\s*.{0,60})/m)?.[1];
  if (errorLine) {
    return extractErrorSignature(errorLine);
  }

  return BEHAVIORAL_CLUSTER_SIGNATURE;
}

export function taskLabel(
  record: AxAgentPlaybookEvolveRunRecord,
  index: number
): string {
  return record.task.id ?? `task-${index}`;
}

/**
 * Cluster the failing records and rank clusters by severity. `maxClusters`
 * bounds the output (severity order); dropped clusters are simply not mined
 * this round.
 */
export function clusterFailures(
  records: readonly AxAgentPlaybookEvolveRunRecord[],
  scoreThreshold: number,
  maxClusters: number
): AxAgentFailureCluster[] {
  const bySignature = new Map<
    string,
    { records: AxAgentPlaybookEvolveRunRecord[]; taskIds: string[] }
  >();
  records.forEach((record, index) => {
    if (!isFailureRecord(record, scoreThreshold)) {
      return;
    }
    const signature = recordSignature(record);
    const entry = bySignature.get(signature) ?? { records: [], taskIds: [] };
    entry.records.push(record);
    entry.taskIds.push(taskLabel(record, index));
    bySignature.set(signature, entry);
  });

  const clusters: AxAgentFailureCluster[] = [...bySignature.entries()].map(
    ([signature, entry]) => {
      const meanMiss =
        entry.records.reduce((sum, r) => sum + (1 - r.score), 0) /
        entry.records.length;
      return {
        signature,
        records: entry.records,
        severity: entry.records.length * meanMiss,
        taskIds: entry.taskIds,
      };
    }
  );

  clusters.sort((a, b) => b.severity - a.severity);
  return clusters.slice(0, Math.max(0, maxClusters));
}
