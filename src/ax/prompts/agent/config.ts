import type {
  AxContextPolicyBudget,
  AxContextPolicyConfig,
  AxContextPolicyPreset,
} from './rlm.js';
import type { AxProgramForwardOptions } from '../../dsp/types.js';
import type {
  AxActorModelPolicy,
  AxAgentStateActorModelState,
  AxResolvedActorModelPolicy,
  AxResolvedContextPolicy,
} from './AxAgent.js';

export const DEFAULT_RLM_MAX_LLM_CALLS = 8;
export const DEFAULT_RLM_MAX_RUNTIME_CHARS = 3_000;
export const DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS = 1_200;
export const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
export const DEFAULT_RLM_MAX_TURNS = 8;
export const DEFAULT_RLM_MAX_RECURSION_DEPTH = 2;
export const DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS = 1_200;
export const DEFAULT_AGENT_MODULE_NAMESPACE = 'agents';
export const DEFAULT_RANK_PRUNE_GRACE_TURNS = 2;
export const ACTOR_MODEL_POLICY_MIGRATION_ERROR =
  'actorModelPolicy now expects an ordered array of { model, namespaces?, aboveErrorTurns? } entries. Manage prompt pressure with contextPolicy.budget instead of abovePromptChars.';
const CONTEXT_POLICY_MIGRATION_ERROR =
  'contextPolicy now only supports { preset?, budget? }. Use contextPolicy.budget instead of contextPolicy.state.*, contextPolicy.checkpoints.*, or other manual cutoff options.';
export const CONTEXT_POLICY_SUMMARIZER_OPTIONS_MIGRATION_ERROR =
  'contextPolicy.summarizerOptions has moved to top-level summarizerOptions.';

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
      'abovePromptChars' in rawEntry ||
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

    if (aboveErrorTurns === undefined && namespaces === undefined) {
      throw new Error(
        `actorModelPolicy[${index}] must define at least one of aboveErrorTurns or namespaces`
      );
    }

    return {
      model: normalizeOptionalModelName(
        rawEntry.model,
        `actorModelPolicy[${index}].model`
      ),
      ...(aboveErrorTurns !== undefined ? { aboveErrorTurns } : {}),
      ...(namespaces !== undefined ? { namespaces } : {}),
    };
  });
}

export function resolveContextPolicy(
  contextPolicy: AxContextPolicyConfig | undefined,
  summarizerOptions:
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined = undefined,
  maxRuntimeChars: number | undefined = undefined
): AxResolvedContextPolicy {
  const rawPolicy = contextPolicy as Record<string, unknown> | undefined;
  if (rawPolicy) {
    const allowedKeys = new Set(['preset', 'budget']);
    const disallowedKey = Object.keys(rawPolicy).find(
      (key) => !allowedKeys.has(key)
    );
    if (disallowedKey) {
      if (disallowedKey === 'state') {
        throw new Error(
          'contextPolicy.state.* has been removed. Use contextPolicy.budget instead.'
        );
      }
      if (disallowedKey === 'checkpoints') {
        throw new Error(
          'contextPolicy.checkpoints.* has been removed. Use contextPolicy.budget instead.'
        );
      }
      if (disallowedKey === 'summarizerOptions') {
        throw new Error(CONTEXT_POLICY_SUMMARIZER_OPTIONS_MIGRATION_ERROR);
      }
      throw new Error(CONTEXT_POLICY_MIGRATION_ERROR);
    }
  }

  const preset = contextPolicy?.preset ?? 'checkpointed';
  const budget = contextPolicy?.budget ?? 'balanced';
  const budgetDefaults = getContextPolicyBudgetDefaults(budget);
  const presetDefaults = getContextPolicyPresetDefaults(preset, budgetDefaults);
  const resolvedMaxRuntimeChars =
    normalizeOptionalThreshold(maxRuntimeChars, 'maxRuntimeChars') ??
    DEFAULT_RLM_MAX_RUNTIME_CHARS;

  return {
    preset,
    budget,
    summarizerOptions,
    actionReplay: presetDefaults.actionReplay,
    recentFullActions: Math.max(presetDefaults.recentFullActions, 0),
    errorPruning: presetDefaults.errorPruning,
    hindsightEvaluation: presetDefaults.hindsight,
    pruneRank: presetDefaults.pruneRank,
    rankPruneGraceTurns: DEFAULT_RANK_PRUNE_GRACE_TURNS,
    tombstoning: undefined,
    stateSummary: {
      enabled: presetDefaults.stateSummary,
      maxEntries: presetDefaults.maxEntries,
      maxChars: DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS,
    },
    stateInspection: {
      enabled: presetDefaults.inspect,
      contextThreshold: budgetDefaults.inspectThreshold,
    },
    checkpoints: {
      enabled: presetDefaults.checkpointsEnabled,
      triggerChars: presetDefaults.checkpointTriggerChars,
    },
    targetPromptChars: budgetDefaults.targetPromptChars,
    maxRuntimeChars: resolvedMaxRuntimeChars,
  };
}

function getContextPolicyBudgetDefaults(budget: AxContextPolicyBudget) {
  switch (budget) {
    case 'compact':
      return {
        targetPromptChars: 12_000,
        inspectThreshold: 10_200,
      };
    case 'expanded':
      return {
        targetPromptChars: 20_000,
        inspectThreshold: 17_000,
      };
    default:
      return {
        targetPromptChars: 16_000,
        inspectThreshold: 13_600,
      };
  }
}

function getContextPolicyPresetDefaults(
  preset: AxContextPolicyPreset,
  budgetDefaults: Readonly<{
    targetPromptChars: number;
    inspectThreshold: number;
  }>
) {
  switch (preset) {
    case 'adaptive':
      return {
        actionReplay: 'adaptive' as const,
        recentFullActions:
          budgetDefaults.targetPromptChars >= 20_000
            ? 3
            : budgetDefaults.targetPromptChars >= 16_000
              ? 2
              : 1,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        maxEntries: 8,
        checkpointsEnabled: true,
        checkpointTriggerChars: Math.floor(
          budgetDefaults.targetPromptChars * 0.75
        ),
      };
    case 'lean':
      return {
        actionReplay: 'minimal' as const,
        recentFullActions: budgetDefaults.targetPromptChars >= 20_000 ? 2 : 1,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        maxEntries: 4,
        checkpointsEnabled: true,
        checkpointTriggerChars: Math.floor(
          budgetDefaults.targetPromptChars * 0.6
        ),
      };
    case 'checkpointed':
      return {
        actionReplay: 'checkpointed' as const,
        recentFullActions:
          budgetDefaults.targetPromptChars >= 20_000
            ? 4
            : budgetDefaults.targetPromptChars >= 16_000
              ? 3
              : 2,
        errorPruning: false,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        maxEntries: 8,
        checkpointsEnabled: true,
        checkpointTriggerChars: budgetDefaults.targetPromptChars,
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
        maxEntries: undefined,
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
  consecutiveErrorTurns: number,
  matchedNamespaces: readonly string[] = []
): string | undefined {
  let selectedModel: string | undefined;
  const matchedNamespaceSet = new Set(matchedNamespaces);

  for (const entry of policy) {
    const errorTrigger =
      entry.aboveErrorTurns !== undefined &&
      consecutiveErrorTurns >= entry.aboveErrorTurns;
    const namespaceTrigger = entry.namespaces?.some((namespace) =>
      matchedNamespaceSet.has(namespace)
    );

    if (errorTrigger || namespaceTrigger) {
      selectedModel = entry.model;
    }
  }

  return selectedModel;
}
