import { normalizeRestoredActorModelState } from '../config.js';
import type { ActionLogEntry } from '../contextManager.js';
import {
  buildInspectRuntimeBaselineCode,
  buildInspectRuntimeCode,
  buildRuntimeStateProvenance,
} from '../contextManager.js';
import type { AxCodeSession } from '../rlm.js';
import {
  formatLegacyRuntimeState,
  formatStructuredRuntimeState,
  parseRuntimeStateSnapshot,
} from '../runtime.js';
import { deserializeAgentStateActionLogEntries } from '../state.js';
import type { AxAgentState, AxPreparedRestoredState } from './types.js';

export function getInspectableSession(
  runtimeSession: AxCodeSession
): AxCodeSession | undefined {
  return typeof runtimeSession.inspectGlobals === 'function'
    ? runtimeSession
    : undefined;
}

export function getPatchableSession(
  runtimeSession: AxCodeSession
): AxCodeSession {
  if (typeof runtimeSession.patchGlobals !== 'function') {
    throw new Error(
      'AxCodeSession.patchGlobals() is required when restoring AxAgent state or using inputUpdateCallback'
    );
  }
  return runtimeSession;
}

export function getSnapshotableSession(
  runtimeSession: AxCodeSession
): AxCodeSession & {
  snapshotGlobals: NonNullable<AxCodeSession['snapshotGlobals']>;
} {
  if (typeof runtimeSession.snapshotGlobals !== 'function') {
    throw new Error(
      'AxCodeSession.snapshotGlobals() is required to export AxAgent state'
    );
  }
  return runtimeSession as AxCodeSession & {
    snapshotGlobals: NonNullable<AxCodeSession['snapshotGlobals']>;
  };
}

export interface InspectHelpersDeps {
  sessionRef: { current: AxCodeSession };
  effectiveAbortSignal?: AbortSignal;
  inspectReservedNames: readonly string[];
  bootstrapGlobalNames: ReadonlySet<string>;
  runtimeActionLogEntries: readonly ActionLogEntry[];
}

export interface InspectHelpers {
  loadInspectBaselineNames: () => Promise<string[]>;
  ensureInspectBaselineNames: () => Promise<string[]>;
  inspectRuntimeState: () => Promise<string>;
  renderRuntimeState: (
    snapshot: string,
    options?: Readonly<{ maxEntries?: number; maxChars?: number }>
  ) => string;
  resetInspectBaseline: () => void;
}

export function buildInspectHelpers(deps: InspectHelpersDeps): InspectHelpers {
  const {
    sessionRef,
    effectiveAbortSignal,
    inspectReservedNames,
    bootstrapGlobalNames,
    runtimeActionLogEntries,
  } = deps;
  let inspectBaselineNames: string[] | undefined;

  const loadInspectBaselineNames = async (): Promise<string[]> => {
    try {
      const result = await sessionRef.current.execute(
        buildInspectRuntimeBaselineCode(),
        {
          signal: effectiveAbortSignal,
          reservedNames: inspectReservedNames,
        }
      );
      if (typeof result !== 'string') {
        return [];
      }
      const parsed = JSON.parse(result);
      return Array.isArray(parsed)
        ? parsed.filter(
            (value): value is string =>
              typeof value === 'string' && !bootstrapGlobalNames.has(value)
          )
        : [];
    } catch {
      return [];
    }
  };

  const ensureInspectBaselineNames = async (): Promise<string[]> => {
    if (!inspectBaselineNames) {
      inspectBaselineNames = await loadInspectBaselineNames();
    }
    return inspectBaselineNames;
  };

  const inspectRuntimeState = async (): Promise<string> => {
    try {
      const inspectableSession = getInspectableSession(sessionRef.current);
      if (inspectableSession?.inspectGlobals) {
        return await inspectableSession.inspectGlobals({
          signal: effectiveAbortSignal,
          reservedNames: inspectReservedNames,
        });
      }

      const baselineNames = await ensureInspectBaselineNames();
      const code = buildInspectRuntimeCode(inspectReservedNames, baselineNames);
      const result = await sessionRef.current.execute(code, {
        signal: effectiveAbortSignal,
        reservedNames: inspectReservedNames,
      });
      return typeof result === 'string' ? result : String(result);
    } catch (err) {
      return `[inspectRuntime error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  };

  const renderRuntimeState = (
    snapshot: string,
    options?: Readonly<{ maxEntries?: number; maxChars?: number }>
  ): string => {
    const structuredEntries = parseRuntimeStateSnapshot(snapshot);

    if (!structuredEntries) {
      return formatLegacyRuntimeState(snapshot, options);
    }

    const provenance = buildRuntimeStateProvenance(runtimeActionLogEntries);
    return formatStructuredRuntimeState(structuredEntries, provenance, options);
  };

  const resetInspectBaseline = () => {
    inspectBaselineNames = undefined;
  };

  return {
    loadInspectBaselineNames,
    ensureInspectBaselineNames,
    inspectRuntimeState,
    renderRuntimeState,
    resetInspectBaseline,
  };
}

export function prepareRestoredState(
  state: Readonly<AxAgentState>,
  inspectReservedNames: readonly string[]
): AxPreparedRestoredState {
  const skippedNames = new Set(inspectReservedNames);
  const runtimeBindings: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(state.runtimeBindings ?? {})) {
    if (!skippedNames.has(name)) {
      runtimeBindings[name] = value;
    }
  }

  const runtimeEntries = (state.runtimeEntries ?? []).filter(
    (entry) => !skippedNames.has(entry.name)
  );

  return {
    runtimeBindings,
    runtimeEntries,
    actionLogEntries: deserializeAgentStateActionLogEntries(
      state.actionLogEntries
    ),
    guidanceLogEntries: (state.guidanceLogEntries ?? []).map((entry) => ({
      turn: entry.turn,
      guidance: entry.guidance,
      ...(entry.triggeredBy ? { triggeredBy: entry.triggeredBy } : {}),
    })),
    checkpointState: state.checkpointState,
    discoveryPromptState: state.discoveryPromptState,
    skillsPromptState: state.skillsPromptState,
    provenance: { ...(state.provenance ?? {}) },
    actorModelState: normalizeRestoredActorModelState(state.actorModelState),
  };
}
