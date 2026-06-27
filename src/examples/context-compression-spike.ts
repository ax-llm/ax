/**
 * Context-compression baseline spike (offline, deterministic — no API key).
 *
 * Sweeps the four shipped `contextPolicy` presets across three fixed scenarios
 * and prints the headline context metrics (peak prompt size, compaction ratio,
 * tokens, checkpoints, pressure distribution). This captures the CURRENT
 * (hindsight) trajectory-compaction baseline.
 *
 * A future plan-aware "foresight" retention strategy is A/B'd by adding its
 * preset to `AX_CONTEXT_PRESETS` (in contextScenarios.ts) — the harness and the
 * aggregator measure it with no other change.
 *
 * Run: `npx tsx src/examples/context-compression-spike.ts`
 * Live (real-model) sibling: `context-compression-live.ts`.
 */
import {
  type AxContextMetricsRow,
  renderMetricsTable,
} from '../ax/agent/benchmarks/contextMetrics.js';
import {
  AX_CONTEXT_PRESETS,
  AX_CONTEXT_SCENARIOS,
  runOfflineScenario,
} from '../ax/agent/benchmarks/contextScenarios.js';

const rows: AxContextMetricsRow[] = [];
for (const scenario of AX_CONTEXT_SCENARIOS) {
  for (const preset of AX_CONTEXT_PRESETS) {
    const summary = await runOfflineScenario(scenario, preset);
    rows.push({ scenario: scenario.name, preset, summary });
  }
}

console.log('AxAgent context-compression baseline (offline, deterministic)\n');
console.log(renderMetricsTable(rows));

console.log('\nPer-turn mutablePromptChars (long-padded):');
for (const preset of AX_CONTEXT_PRESETS) {
  const row = rows.find(
    (entry) => entry.scenario === 'long-padded' && entry.preset === preset
  );
  const series = (row?.summary.series ?? [])
    .map(
      (sample) =>
        `${sample.stage[0]}${sample.turn}:${sample.mutablePromptChars}`
    )
    .join('  ');
  console.log(`  ${preset.padEnd(12)} ${series}`);
}

console.log('\nBaseline captured.');
