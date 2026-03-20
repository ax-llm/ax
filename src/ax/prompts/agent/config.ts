import type { AxContextPolicyConfig, AxContextPolicyPreset } from './rlm.js';
import type {
  AxActorModelPolicy,
  AxAgentStateActorModelState,
  AxResolvedActorModelPolicy,
  AxResolvedContextPolicy,
} from './AxAgent.js';

export const DEFAULT_RLM_MAX_LLM_CALLS = 8;
export const DEFAULT_RLM_MAX_RUNTIME_CHARS = 5_000;
export const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
export const DEFAULT_RLM_MAX_TURNS = 8;
export const DEFAULT_RLM_MAX_RECURSION_DEPTH = 2;
export const DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS = 1_200;
export const DEFAULT_AGENT_MODULE_NAMESPACE = 'agents';
export const DEFAULT_RANK_PRUNE_GRACE_TURNS = 2;
export const ACTOR_MODEL_POLICY_MIGRATION_ERROR =
  'actorModelPolicy now expects an ordered array of { model, abovePromptChars?, aboveErrorTurns? } entries. Example: actorModelPolicy: [{ model: "gpt-5.4-mini", abovePromptChars: 16000 }, { model: "gpt-5.4", aboveErrorTurns: 2 }]';

function normalizeOptionalModelName(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function normalizeOptionalThreshold(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite number >= 0`);
  }

  return value;
}

function normalizeOptionalNamespaces(
  value: unknown,
  fieldName: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a string[]`);
  }

  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} must contain only strings`);
  }

  const normalized = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty string`);
  }

  return [...new Set(normalized)];
}

export function resolveActorModelPolicy(
  policy: Readonly<AxActorModelPolicy> | undefined
): AxResolvedActorModelPolicy | undefined {
  if (policy === undefined) {
    return undefined;
  }

  if (!Array.isArray(policy)) {
    throw new Error(ACTOR_MODEL_POLICY_MIGRATION_ERROR);
  }

  if (policy.length === 0) {
    throw new Error('actorModelPolicy must contain at least one entry');
  }

  return policy.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`actorModelPolicy[${index}] must be an object`);
    }

    const rawEntry = entry as Record<string, unknown>;
    if (
      'escalatedModel' in rawEntry ||
      'baseModel' in rawEntry ||
      'escalateAtPromptChars' in rawEntry ||
      'escalateAtPromptCharsWhenCheckpointed' in rawEntry ||
      'recentErrorWindowTurns' in rawEntry ||
      'recentErrorThreshold' in rawEntry ||
      'discoveryStallTurns' in rawEntry ||
      'deescalateBelowPromptChars' in rawEntry ||
      'stableTurnsBeforeDeescalate' in rawEntry ||
      'minEscalatedTurns' in rawEntry
    ) {
      throw new Error(ACTOR_MODEL_POLICY_MIGRATION_ERROR);
    }

    const abovePromptChars = normalizeOptionalThreshold(
      rawEntry.abovePromptChars,
      `actorModelPolicy[${index}].abovePromptChars`
    );
    const aboveErrorTurns = normalizeOptionalThreshold(
      rawEntry.aboveErrorTurns,
      `actorModelPolicy[${index}].aboveErrorTurns`
    );
    const namespaces = normalizeOptionalNamespaces(
      rawEntry.namespaces,
      `actorModelPolicy[${index}].namespaces`
    );
    if (aboveErrorTurns !== undefined && !Number.isInteger(aboveErrorTurns)) {
      throw new Error(
        `actorModelPolicy[${index}].aboveErrorTurns must be an integer >= 0`
      );
    }

    if (
      abovePromptChars === undefined &&
      aboveErrorTurns === undefined &&
      namespaces === undefined
    ) {
      throw new Error(
        `actorModelPolicy[${index}] must define at least one of abovePromptChars, aboveErrorTurns, or namespaces`
      );
    }

    return {
      model: normalizeOptionalModelName(
        rawEntry.model,
        `actorModelPolicy[${index}].model`
      ),
      ...(abovePromptChars !== undefined ? { abovePromptChars } : {}),
      ...(aboveErrorTurns !== undefined ? { aboveErrorTurns } : {}),
      ...(namespaces !== undefined ? { namespaces } : {}),
    };
  });
}

export function resolveContextPolicy(
  contextPolicy: AxContextPolicyConfig | undefined
): AxResolvedContextPolicy {
  const preset = contextPolicy?.preset ?? 'full';
  const presetDefaults = getContextPolicyPresetDefaults(preset);
  const rankPruning = contextPolicy?.expert?.rankPruning;
  const rankPruningEnabled =
    rankPruning?.enabled ??
    (rankPruning?.minRank !== undefined ? true : presetDefaults.hindsight);
  const stateSummaryEnabled =
    contextPolicy?.state?.summary ?? presetDefaults.stateSummary;
  const stateInspectEnabled =
    contextPolicy?.state?.inspect ?? presetDefaults.inspect;
  const checkpointsEnabled =
    contextPolicy?.checkpoints?.enabled ?? presetDefaults.checkpointsEnabled;

  if (checkpointsEnabled && !stateSummaryEnabled && !stateInspectEnabled) {
    throw new Error(
      'contextPolicy.checkpoints requires either state.summary or state.inspect to be enabled'
    );
  }

  return {
    preset,
    summarizerOptions: contextPolicy?.summarizerOptions,
    actionReplay: contextPolicy?.expert?.replay ?? presetDefaults.actionReplay,
    recentFullActions: Math.max(
      contextPolicy?.expert?.recentFullActions ??
        presetDefaults.recentFullActions,
      0
    ),
    errorPruning: contextPolicy?.pruneErrors ?? presetDefaults.errorPruning,
    hindsightEvaluation: rankPruningEnabled,
    pruneRank: rankPruning?.minRank ?? presetDefaults.pruneRank,
    rankPruneGraceTurns: DEFAULT_RANK_PRUNE_GRACE_TURNS,
    tombstoning: contextPolicy?.expert?.tombstones,
    stateSummary: {
      enabled: stateSummaryEnabled,
      maxEntries: contextPolicy?.state?.maxEntries ?? presetDefaults.maxEntries,
      maxChars: contextPolicy?.state?.maxChars ?? presetDefaults.maxStateChars,
    },
    stateInspection: {
      enabled: stateInspectEnabled,
      contextThreshold:
        contextPolicy?.state?.inspectThresholdChars ??
        presetDefaults.inspectThreshold,
    },
    checkpoints: {
      enabled: checkpointsEnabled,
      triggerChars:
        contextPolicy?.checkpoints?.triggerChars ??
        presetDefaults.checkpointTriggerChars,
    },
  };
}

function getContextPolicyPresetDefaults(preset: AxContextPolicyPreset) {
  switch (preset) {
    case 'adaptive':
      return {
        actionReplay: 'adaptive' as const,
        recentFullActions: 3,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 16_000,
        maxEntries: 8,
        maxStateChars: 1_600,
        checkpointsEnabled: true,
        checkpointTriggerChars: 22_000,
      };
    case 'lean':
      return {
        actionReplay: 'minimal' as const,
        recentFullActions: 1,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 12_000,
        maxEntries: 4,
        maxStateChars: 800,
        checkpointsEnabled: true,
        checkpointTriggerChars: 15_000,
      };
    case 'checkpointed':
      return {
        actionReplay: 'checkpointed' as const,
        recentFullActions: 3,
        errorPruning: false,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 16_000,
        maxEntries: 8,
        maxStateChars: 1_600,
        checkpointsEnabled: true,
        checkpointTriggerChars: 18_000,
      };
    default:
      return {
        actionReplay: 'full' as const,
        recentFullActions: 1,
        errorPruning: false,
        hindsight: false,
        pruneRank: 2,
        stateSummary: false,
        inspect: false,
        inspectThreshold: undefined,
        maxEntries: undefined,
        maxStateChars: undefined,
        checkpointsEnabled: false,
        checkpointTriggerChars: undefined,
      };
  }
}

export function getActorModelConsecutiveErrorTurns(
  state: Readonly<AxAgentStateActorModelState> | undefined
): number {
  return state?.consecutiveErrorTurns ?? 0;
}

export function getActorModelMatchedNamespaces(
  state: Readonly<AxAgentStateActorModelState> | undefined
): string[] {
  const matchedNamespaces = state?.matchedNamespaces;
  if (!Array.isArray(matchedNamespaces)) {
    return [];
  }

  return [
    ...new Set(
      matchedNamespaces
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function resetActorModelErrorTurns(
  state?: Readonly<AxAgentStateActorModelState>
): AxAgentStateActorModelState {
  const matchedNamespaces = getActorModelMatchedNamespaces(state);

  return {
    consecutiveErrorTurns: 0,
    ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
  };
}

export function normalizeRestoredActorModelState(
  state: unknown
): AxAgentStateActorModelState | undefined {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return undefined;
  }

  const rawState = state as Record<string, unknown>;
  const consecutiveErrorTurns = rawState.consecutiveErrorTurns;
  const matchedNamespaces =
    normalizeOptionalNamespaces(
      rawState.matchedNamespaces,
      'actorModelState.matchedNamespaces'
    ) ?? [];
  if (
    typeof consecutiveErrorTurns === 'number' &&
    Number.isFinite(consecutiveErrorTurns) &&
    consecutiveErrorTurns >= 0
  ) {
    return {
      consecutiveErrorTurns: Math.floor(consecutiveErrorTurns),
      ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
    };
  }

  if (
    'escalated' in rawState ||
    'escalatedTurns' in rawState ||
    'stableBelowThresholdTurns' in rawState
  ) {
    return resetActorModelErrorTurns({
      consecutiveErrorTurns: 0,
      ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
    });
  }

  return undefined;
}

export function updateActorModelErrorTurns(
  state: Readonly<AxAgentStateActorModelState> | undefined,
  isError: boolean
): AxAgentStateActorModelState {
  const matchedNamespaces = getActorModelMatchedNamespaces(state);

  return {
    consecutiveErrorTurns: isError
      ? getActorModelConsecutiveErrorTurns(state) + 1
      : 0,
    ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
  };
}

export function updateActorModelMatchedNamespaces(
  state: Readonly<AxAgentStateActorModelState> | undefined,
  namespaces: readonly string[]
): AxAgentStateActorModelState {
  const matchedNamespaces = [
    ...new Set([
      ...getActorModelMatchedNamespaces(state),
      ...namespaces
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ]),
  ];

  return {
    consecutiveErrorTurns: getActorModelConsecutiveErrorTurns(state),
    ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
  };
}

export function selectActorModelFromPolicy(
  policy: Readonly<AxResolvedActorModelPolicy>,
  promptFacingChars: number,
  consecutiveErrorTurns: number,
  matchedNamespaces: readonly string[] = []
): string | undefined {
  let selectedModel: string | undefined;
  const matchedNamespaceSet = new Set(matchedNamespaces);

  for (const entry of policy) {
    const promptTrigger =
      entry.abovePromptChars !== undefined &&
      promptFacingChars >= entry.abovePromptChars;
    const errorTrigger =
      entry.aboveErrorTurns !== undefined &&
      consecutiveErrorTurns >= entry.aboveErrorTurns;
    const namespaceTrigger = entry.namespaces?.some((namespace) =>
      matchedNamespaceSet.has(namespace)
    );

    if (promptTrigger || errorTrigger || namespaceTrigger) {
      selectedModel = entry.model;
    }
  }

  return selectedModel;
}
