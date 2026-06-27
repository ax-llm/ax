/**
 * Context-engineering measurement aggregator (benchmark/spike helper).
 *
 * Subscribes to AxAgent `onContextEvent` telemetry and `getUsage()` to compute
 * the headline context-compression metrics for a single agent run:
 *   - peak mutable prompt size (chars)
 *   - compaction ratio (chars removed / chars seen)
 *   - cumulative tokens
 *   - pressure distribution, checkpoint/tombstone counts
 *
 * This is policy-agnostic: it only reads the public event stream, so it measures
 * any `contextPolicy` (today's hindsight presets) unchanged. A future
 * plan-aware "foresight" retention strategy would surface through the same
 * events and be measured here without modification.
 *
 * Internal benchmark helper — intentionally NOT exported from `src/ax/index.ts`.
 */
import type { AxAgentUsage, AxProgramUsage } from '../../dsp/types.js';
import type {
  AxAgentContextEvent,
  AxAgentContextPressure,
  AxAgentContextStage,
} from '../contextEvents.js';

export type AxContextTurnSample = {
  stage: AxAgentContextStage;
  turn: number;
  pressure: AxAgentContextPressure;
  mutablePromptChars: number;
  effectiveBudgetChars: number;
  actionLogEntryCount: number;
};

export type AxContextMetricsSummary = {
  /** Number of `budget_check` events observed (one per actor turn). */
  turns: number;
  peakMutablePromptChars: number;
  finalMutablePromptChars: number;
  checkpoints: number;
  tombstones: number;
  compactions: number;
  totalOriginalChars: number;
  totalRenderedChars: number;
  /** (originalChars - renderedChars) / originalChars across all compactions; 0 when nothing compacted. */
  compactionRatio: number;
  pressureCounts: Record<AxAgentContextPressure, number>;
  cumulativeTokens: number;
  promptTokens: number;
  completionTokens: number;
  series: AxContextTurnSample[];
};

/**
 * Accumulates context telemetry for one agent run. Pass {@link onEvent} directly
 * as the agent's `onContextEvent` handler, then call {@link summarize} with
 * `agent.getUsage()` once `forward()` resolves.
 */
export class AxContextMetricsCollector {
  private readonly series: AxContextTurnSample[] = [];
  private checkpoints = 0;
  private tombstones = 0;
  private compactions = 0;
  private totalOriginalChars = 0;
  private totalRenderedChars = 0;
  private peakMutablePromptChars = 0;
  private finalMutablePromptChars = 0;
  private readonly pressureCounts: Record<AxAgentContextPressure, number> = {
    ok: 0,
    watch: 0,
    critical: 0,
  };

  // Bound so it can be passed by reference as `onContextEvent`.
  readonly onEvent = (event: Readonly<AxAgentContextEvent>): void => {
    switch (event.kind) {
      case 'budget_check': {
        this.peakMutablePromptChars = Math.max(
          this.peakMutablePromptChars,
          event.mutablePromptChars
        );
        this.finalMutablePromptChars = event.mutablePromptChars;
        this.pressureCounts[event.pressure] += 1;
        this.series.push({
          stage: event.stage,
          turn: event.turn,
          pressure: event.pressure,
          mutablePromptChars: event.mutablePromptChars,
          effectiveBudgetChars: event.effectiveBudgetChars,
          actionLogEntryCount: event.actionLogEntryCount,
        });
        break;
      }
      case 'checkpoint_created':
        this.checkpoints += 1;
        break;
      case 'tombstone_created':
        this.tombstones += 1;
        break;
      case 'action_compacted':
        this.compactions += 1;
        this.totalOriginalChars += event.originalChars;
        this.totalRenderedChars += event.renderedChars;
        break;
      default:
        // 'checkpoint_cleared' and any future kinds are not aggregated here.
        break;
    }
  };

  summarize(
    usage?: readonly AxProgramUsage[] | AxAgentUsage | undefined
  ): AxContextMetricsSummary {
    // `AxAgent.getUsage()` is declared as `AxProgramUsage[]` but can return the
    // `AxAgentUsage` shape ({ actor, responder }); flatten both defensively.
    const flat: readonly AxProgramUsage[] = !usage
      ? []
      : 'actor' in usage
        ? [...usage.actor, ...usage.responder]
        : usage;

    let cumulativeTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    for (const entry of flat) {
      cumulativeTokens += entry.tokens?.totalTokens ?? 0;
      promptTokens += entry.tokens?.promptTokens ?? 0;
      completionTokens += entry.tokens?.completionTokens ?? 0;
    }

    const compactionRatio =
      this.totalOriginalChars > 0
        ? (this.totalOriginalChars - this.totalRenderedChars) /
          this.totalOriginalChars
        : 0;

    return {
      turns: this.series.length,
      peakMutablePromptChars: this.peakMutablePromptChars,
      finalMutablePromptChars: this.finalMutablePromptChars,
      checkpoints: this.checkpoints,
      tombstones: this.tombstones,
      compactions: this.compactions,
      totalOriginalChars: this.totalOriginalChars,
      totalRenderedChars: this.totalRenderedChars,
      compactionRatio,
      pressureCounts: { ...this.pressureCounts },
      cumulativeTokens,
      promptTokens,
      completionTokens,
      series: [...this.series],
    };
  }
}

export type AxContextMetricsRow = {
  scenario: string;
  preset: string;
  summary: AxContextMetricsSummary;
  /** Wall-clock time for the run, in ms (live runs only; omit for mock). */
  elapsedMs?: number;
};

const TABLE_COLUMNS = [
  'scenario',
  'preset',
  'turns',
  'mgmtCalls',
  'peakChars',
  'ratio',
  'tokens',
  'ms',
  'ok/watch/crit',
] as const;

function formatRowCells(row: AxContextMetricsRow): string[] {
  const s = row.summary;
  // Extra LLM round-trips spent on context management (each summarizes to
  // shrink the prompt) — the work that trades latency for fewer tokens.
  const mgmtCalls = s.checkpoints + s.tombstones;
  return [
    row.scenario,
    row.preset,
    String(s.turns),
    String(mgmtCalls),
    String(s.peakMutablePromptChars),
    s.compactionRatio.toFixed(2),
    String(s.cumulativeTokens),
    row.elapsedMs != null ? String(Math.round(row.elapsedMs)) : '-',
    `${s.pressureCounts.ok}/${s.pressureCounts.watch}/${s.pressureCounts.critical}`,
  ];
}

/** Render the sweep results as a fixed-width ASCII grid for human inspection. */
export function renderMetricsTable(
  rows: readonly AxContextMetricsRow[]
): string {
  const headerCells = [...TABLE_COLUMNS];
  const bodyRows = rows.map((row) => formatRowCells(row));
  const widths = headerCells.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...bodyRows.map((cells) => cells[columnIndex]?.length ?? 0)
    )
  );

  const renderLine = (cells: readonly string[]): string =>
    cells
      .map((cell, columnIndex) => cell.padEnd(widths[columnIndex] ?? 0))
      .join('  ')
      .trimEnd();

  const separator = widths.map((width) => '-'.repeat(width)).join('  ');

  return [renderLine(headerCells), separator, ...bodyRows.map(renderLine)].join(
    '\n'
  );
}
