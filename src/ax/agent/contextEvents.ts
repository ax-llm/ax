export type AxAgentContextStage = 'distiller' | 'executor';

export type AxAgentContextPressure = 'ok' | 'watch' | 'critical';

export type AxAgentContextEvent =
  | {
      kind: 'budget_check';
      stage: AxAgentContextStage;
      turn: number;
      pressure: AxAgentContextPressure;
      mutablePromptChars: number;
      fixedPromptChars: number;
      effectiveBudgetChars: number;
      targetPromptChars: number;
      checkpointActive: boolean;
      actionLogEntryCount: number;
      guidanceLogEntryCount: number;
    }
  | {
      kind: 'checkpoint_created' | 'checkpoint_cleared';
      stage: AxAgentContextStage;
      turn: number;
      coveredTurns: number[];
      summaryChars?: number;
      reason: 'over_budget' | 'under_budget' | 'disabled';
    }
  | {
      kind: 'tombstone_created';
      stage: AxAgentContextStage;
      turn: number;
      resolvedByTurn: number;
      source: 'deterministic' | 'model';
      summaryChars: number;
    }
  | {
      kind: 'action_compacted';
      stage: AxAgentContextStage;
      turn: number;
      mode: 'distill' | 'compact';
      reason:
        | 'structured_output'
        | 'superseded'
        | 'pressure'
        | 'proactive'
        | 'lean';
      originalChars: number;
      renderedChars: number;
    }
  /**
   * Emitted once per ranked domain per forward when the advisory relevance
   * ranker runs (`relevanceRanking` plus the domain's prerequisite: modules
   * need `functionDiscovery`; skills/memories need their catalogs). Records
   * the shortlist actually surfaced to the model.
   *
   * To measure whether the hint helps, an observer joins per forward:
   * `shortlist.map((s) => s.id)` against what the model then loaded — for
   * modules the internal `discover` calls (`onFunctionCall` with
   * `kind:'internal'`, `name:'discover'`, `args.request`) and the module part
   * of external `qualifiedName`s; for skills `onLoadedSkills`/`used(id)`; for
   * memories `onLoadedMemories`/`used(id)`.
   */
  | {
      kind: 'relevance_ranking';
      stage: AxAgentContextStage;
      domain: 'modules' | 'skills' | 'memories';
      /** Length of the ranked task string (not the text — avoids log bloat). */
      taskChars: number;
      /** Items surfaced to the model, most relevant first ([] if suppressed). */
      shortlist: { id: string; score: number }[];
      /** True when the low-confidence guard emitted nothing. */
      suppressed: boolean;
    }
  /**
   * Emitted once per field per run when `autoUpgrade.contextFields` keeps an
   * oversized undeclared input value runtime-only. The value stays available
   * in the code runtime as `inputs.<fieldName>`; the prompt carries a
   * truncated preview (or nothing when `promptPreviewChars` is undefined)
   * plus a `contextMetadata` entry.
   */
  | {
      kind: 'field_auto_promoted';
      stage: AxAgentContextStage;
      turn: number;
      fieldName: string;
      originalChars: number;
      /** Chars kept inline as a preview; undefined => runtime-only. */
      promptPreviewChars?: number;
    };

export type AxAgentOnContextEvent = (
  event: Readonly<AxAgentContextEvent>
) => void | Promise<void>;

export function normalizeContextStage(value: unknown): AxAgentContextStage {
  return value === 'distiller' ? 'distiller' : 'executor';
}

export function classifyContextPressure({
  mutablePromptChars,
  effectiveBudgetChars,
  checkpointActive,
}: Readonly<{
  mutablePromptChars: number;
  effectiveBudgetChars: number;
  checkpointActive: boolean;
}>): AxAgentContextPressure {
  if (checkpointActive) {
    return 'critical';
  }

  if (!Number.isFinite(effectiveBudgetChars) || effectiveBudgetChars <= 0) {
    return 'ok';
  }

  const usageRatio = mutablePromptChars / effectiveBudgetChars;
  if (usageRatio >= 0.9) {
    return 'critical';
  }
  if (usageRatio >= 0.7) {
    return 'watch';
  }
  return 'ok';
}

export function renderContextPressure(
  pressure: AxAgentContextPressure
): string {
  switch (pressure) {
    case 'critical':
      return 'critical - prefer compact inspections, avoid large logs, and rely on liveRuntimeState/checkpoints for older work.';
    case 'watch':
      return 'watch - keep inspections compact and avoid logging large raw values.';
    default:
      return 'ok - normal context pressure; continue with focused, useful inspections.';
  }
}

export async function emitContextEvent(
  handler: AxAgentOnContextEvent | undefined,
  event: Readonly<AxAgentContextEvent>
): Promise<void> {
  if (!handler) {
    return;
  }

  try {
    await handler(event);
  } catch {
    // Context telemetry must never affect agent execution.
  }
}
