import type {
  ActionLogEntry,
  RuntimeStateVariableProvenance,
} from './contextManager.js';
import type {
  AxAgentState,
  AxAgentStateActionLogEntry,
  AxAgentStateRuntimeEntry,
} from './AxAgent.js';

function cloneStructured<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function cloneAgentState(state: Readonly<AxAgentState>): AxAgentState {
  return cloneStructured(state);
}

export function serializeAgentStateActionLogEntries(
  entries: readonly ActionLogEntry[]
): AxAgentStateActionLogEntry[] {
  return entries.map((entry) => ({
    turn: entry.turn,
    code: entry.code,
    output: entry.output,
    actorFieldsOutput: entry.actorFieldsOutput,
    tags: [...entry.tags],
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.producedVars ? { producedVars: [...entry.producedVars] } : {}),
    ...(entry.referencedVars
      ? { referencedVars: [...entry.referencedVars] }
      : {}),
    ...(entry.stateDelta ? { stateDelta: entry.stateDelta } : {}),
    ...(entry.stepKind ? { stepKind: entry.stepKind } : {}),
    ...(entry.replayMode ? { replayMode: entry.replayMode } : {}),
    ...(entry.rank !== undefined ? { rank: entry.rank } : {}),
    ...(entry.tombstone ? { tombstone: entry.tombstone } : {}),
  }));
}

export function deserializeAgentStateActionLogEntries(
  entries: readonly AxAgentStateActionLogEntry[] | undefined
): ActionLogEntry[] {
  return (entries ?? []).map((entry) => ({
    turn: entry.turn,
    code: entry.code,
    output: entry.output,
    actorFieldsOutput: entry.actorFieldsOutput,
    tags: [...entry.tags],
    ...(entry.summary ? { summary: entry.summary } : {}),
    ...(entry.producedVars ? { producedVars: [...entry.producedVars] } : {}),
    ...(entry.referencedVars
      ? { referencedVars: [...entry.referencedVars] }
      : {}),
    ...(entry.stateDelta ? { stateDelta: entry.stateDelta } : {}),
    ...(entry.stepKind ? { stepKind: entry.stepKind } : {}),
    ...(entry.replayMode ? { replayMode: entry.replayMode } : {}),
    ...(entry.rank !== undefined ? { rank: entry.rank } : {}),
    ...(entry.tombstone ? { tombstone: entry.tombstone } : {}),
  }));
}

export function runtimeStateProvenanceToRecord(
  provenance: ReadonlyMap<string, RuntimeStateVariableProvenance>
): Record<string, RuntimeStateVariableProvenance> {
  return Object.fromEntries(
    [...provenance.entries()].map(([name, meta]) => [
      name,
      {
        ...meta,
      },
    ])
  );
}

export function buildRuntimeRestoreNotice(
  entries: readonly AxAgentStateRuntimeEntry[],
  options?: Readonly<{
    includeLiveRuntimeState?: boolean;
  }>
): string {
  const snapshotOnlyCount = entries.filter(
    (entry) => entry.restorable === false
  ).length;
  const lines = [
    'Runtime Restore:',
    '- Runtime state was restored from a previous call.',
    '- Continue from restored values unless recomputation is actually needed.',
  ];
  if (options?.includeLiveRuntimeState !== false) {
    lines.splice(
      2,
      0,
      '- Live Runtime State below reflects the restored bindings.'
    );
  } else {
    lines.splice(
      2,
      0,
      '- Live Runtime State rendering is disabled for this run, but the restored bindings are available in the runtime session.'
    );
  }
  if (snapshotOnlyCount > 0) {
    lines.push(
      `- ${snapshotOnlyCount} prior value${snapshotOnlyCount === 1 ? ' was' : 's were'} snapshot-only and could not be restored.`
    );
  }
  return lines.join('\n');
}

export function runtimeStateProvenanceFromRecord(
  provenance:
    | Readonly<Record<string, RuntimeStateVariableProvenance>>
    | undefined
): Map<string, RuntimeStateVariableProvenance> {
  return new Map(
    Object.entries(provenance ?? {}).map(([name, meta]) => [name, { ...meta }])
  );
}

export function mergeRuntimeStateProvenance(
  base: ReadonlyMap<string, RuntimeStateVariableProvenance>,
  incoming: ReadonlyMap<string, RuntimeStateVariableProvenance>
): Map<string, RuntimeStateVariableProvenance> {
  const merged = new Map<string, RuntimeStateVariableProvenance>();

  for (const [name, meta] of base.entries()) {
    merged.set(name, { ...meta });
  }

  for (const [name, meta] of incoming.entries()) {
    merged.set(name, { ...meta });
  }

  return merged;
}
