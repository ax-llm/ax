/**
 * Benchmark: context-compression baseline sweep.
 *
 * Captures the CURRENT (hindsight) trajectory-compaction behavior of AxAgent
 * across the four shipped `contextPolicy` presets and three fixed scenarios,
 * deterministically and offline (mock AI). This is the baseline a future
 * plan-aware foresight retention strategy is A/B'd against.
 *
 * Run `AX_PRINT_METRICS=1 npx vitest run src/ax/agent/benchmarks/context-compression.test.ts`
 * to print the metrics grid.
 */
import { describe, expect, it } from 'vitest';
import {
  type AxContextMetricsRow,
  type AxContextMetricsSummary,
  renderMetricsTable,
} from './contextMetrics.js';
import {
  AX_CONTEXT_PRESETS,
  AX_CONTEXT_SCENARIOS,
  runOfflineScenario,
} from './contextScenarios.js';

describe('context-compression baseline sweep', () => {
  it('captures peak/ratio/checkpoint metrics across presets and scenarios', async () => {
    const rows: AxContextMetricsRow[] = [];
    const byKey = new Map<string, AxContextMetricsSummary>();
    for (const scenario of AX_CONTEXT_SCENARIOS) {
      for (const preset of AX_CONTEXT_PRESETS) {
        const summary = await runOfflineScenario(scenario, preset);
        rows.push({ scenario: scenario.name, preset, summary });
        byKey.set(`${scenario.name}:${preset}`, summary);
      }
    }

    if (process.env.AX_PRINT_METRICS) {
      console.log(`\n${renderMetricsTable(rows)}\n`);
    }

    const get = (scenario: string, preset: string): AxContextMetricsSummary => {
      const summary = byKey.get(`${scenario}:${preset}`);
      if (!summary) {
        throw new Error(`missing metrics for ${scenario}:${preset}`);
      }
      return summary;
    };

    // Every run produced per-turn telemetry and token usage.
    for (const row of rows) {
      expect(row.summary.turns).toBeGreaterThan(0);
      expect(row.summary.cumulativeTokens).toBeGreaterThan(0);
    }

    // 'full' replays the action log raw — it never compacts or checkpoints.
    for (const scenario of AX_CONTEXT_SCENARIOS) {
      expect(get(scenario.name, 'full').compactionRatio).toBe(0);
      expect(get(scenario.name, 'full').checkpoints).toBe(0);
    }

    // long-padded: trimming presets keep peak context <= raw 'full'.
    const lpFull = get('long-padded', 'full');
    for (const preset of ['checkpointed', 'adaptive', 'lean']) {
      expect(
        get('long-padded', preset).peakMutablePromptChars
      ).toBeLessThanOrEqual(lpFull.peakMutablePromptChars);
    }
    // ...and at least one trimming preset actually checkpoints under pressure.
    const trimmingCheckpoints = (['checkpointed', 'adaptive', 'lean'] as const)
      .map((preset) => get('long-padded', preset).checkpoints)
      .reduce((sum, count) => sum + count, 0);
    expect(trimmingCheckpoints).toBeGreaterThan(0);
    // The core thesis: the most aggressive preset strictly beats raw replay,
    // and compaction is actually happening (non-zero chars removed).
    expect(get('long-padded', 'lean').peakMutablePromptChars).toBeLessThan(
      lpFull.peakMutablePromptChars
    );
    expect(get('long-padded', 'checkpointed').compactionRatio).toBeGreaterThan(
      0
    );

    // short-clean: no pressure → no checkpoints under any preset.
    for (const preset of AX_CONTEXT_PRESETS) {
      expect(get('short-clean', preset).checkpoints).toBe(0);
    }

    // error-recovery: an errorPruning preset (lean) tombstones the resolved error.
    expect(get('error-recovery', 'lean').tombstones).toBeGreaterThan(0);
  });
});
