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
