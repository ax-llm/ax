import type { AxProgramForwardOptions } from '../dsp/types.js';
import type {
  AxAgentStateExecutorModelState,
  AxExecutorModelPolicy,
  AxResolvedContextPolicy,
  AxResolvedExecutorModelPolicy,
} from './AxAgent.js';
import type {
  AxContextPolicyBudget,
  AxContextPolicyConfig,
  AxContextPolicyPreset,
} from './rlm.js';

/** Global ceiling on total `llmQuery` child invocations per forward — guards runaway recursion. */
export const DEFAULT_RLM_MAX_LLM_CALLS = 100;
/** Max chars of turn output surfaced back to the actor; longer output gets truncated to force narrowing. */
export const DEFAULT_RLM_MAX_RUNTIME_CHARS = 3_000;
/** Max chars for the live-runtime-state summary injected into the actor prompt. */
export const DEFAULT_RLM_STATE_SUMMARY_MAX_CHARS = 1_200;
/** Concurrency for batched `llmQuery` items within a single actor turn. */
export const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
/** Cap on actor loop iterations before the forward is terminated; keeps a stuck agent from looping forever. */
export const DEFAULT_RLM_MAX_TURNS = 8;
/**
 * Max serialized chars for a `final(task, evidence)` evidence object crossing
 * the host boundary (executor→responder, or distiller→executor in fallback
 * mode). Oversized evidence throws in-turn so the actor narrows and retries;
 * shared-mode in-worker evidence descriptors are exempt.
 */
export const DEFAULT_RLM_MAX_EVIDENCE_CHARS = 50_000;
/** Per-context-field truncation budget when rendering input fields into the prompt. */
export const DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS = 1_200;
/** Turns to wait after a rank-pruning signal before actually pruning — avoids pruning entries still in use. */
export const DEFAULT_RANK_PRUNE_GRACE_TURNS = 2;
/**
 * Default for the advisory relevance ranker when `relevanceRanking` is unset.
 *
 * ON by default since the A/B gate passed (2026-07-02); set
 * `relevanceRanking: false` to opt out. Gate record
 * (src/examples/module-ranking-eval.ts, substance-judged, 49 runs per variant
 * per model): gpt-5.4-mini discover-p@1 24%->90%, substance accuracy
 * 14%->29%; gpt-5.4 control substance accuracy 63%->88% with fewer turns
 * (2.45->2.12). An earlier apparent -14pp control regression at n=21 was a
 * verbatim-judge artifact (paraphrases scored as failures) and reversed under
 * substance judging. Ranker precision@1 was 100% in every run.
 */
export const RELEVANCE_RANKING_DEFAULT = true;

/**
 * Default for the auto-upgrade smart defaults when `autoUpgrade` is unset.
 *
 * ON by default: the agent enables `functionDiscovery` when the inline tool
 * docs would be large, and keeps oversized input values runtime-only with a
 * truncated prompt preview, so callers don't have to remember either knob.
 * Set `autoUpgrade: false` to restore fully manual behavior. Explicit
 * settings always win: a caller-provided `functionDiscovery` boolean or a
 * field declared in `contextFields` is never overridden.
 */
export const AUTO_UPGRADE_DEFAULT = true;
/**
 * Auto-enable `functionDiscovery` once the estimated inline docs of
 * discoverable (non-`alwaysInclude`) functions exceed this many chars.
 * ~10k chars is roughly 12-15 mid-size tool schemas — past that, a module
 * catalog plus on-demand `discover()` beats a wall of inline schemas.
 */
export const DEFAULT_AUTO_DISCOVERY_FUNCTION_DOC_CHARS = 10_000;
/**
 * Auto-treat an undeclared input value as runtime-only context once its
 * serialized size exceeds this many chars (strictly greater). Half the
 * default 16k `targetPromptChars` budget: one field eating more than half
 * the prompt budget is pathological in every stage it touches.
 */
export const DEFAULT_AUTO_CONTEXT_PROMOTE_CHARS = 8_000;
/**
 * Chars of an auto-promoted value kept inline as a truncated preview.
 * Mirrors DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS so auto-promoted fields
 * read like declared truncate-style context fields.
 */
export const DEFAULT_AUTO_CONTEXT_PREVIEW_CHARS = 1_200;

/**
 * Smart-defaults knob: `true`/`false` toggles both upgrades; an object tunes
 * each independently (an object value implies enabled for that domain).
 */
export type AxAgentAutoUpgrade =
  | boolean
  | {
      /** Auto-enable runtime callable discovery for large tool catalogs. */
      functionDiscovery?: boolean | { aboveFunctionDocChars?: number };
      /** Auto-keep oversized undeclared input values runtime-only. */
      contextFields?:
        | boolean
        | { promoteAboveChars?: number; previewChars?: number };
    };

export type AxResolvedAutoUpgrade = {
  functionDiscovery: { enabled: boolean; aboveFunctionDocChars: number };
  contextFields: {
    enabled: boolean;
    promoteAboveChars: number;
    previewChars: number;
  };
};

function normalizeAutoUpgradeThreshold(
  value: unknown,
  fieldName: string,
  fallback: number,
  minExclusive: number
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= minExclusive
  ) {
    throw new Error(`${fieldName} must be a finite number > ${minExclusive}`);
  }

  return value;
}

export function resolveAutoUpgrade(
  value: AxAgentAutoUpgrade | undefined
): AxResolvedAutoUpgrade {
  const root = value ?? AUTO_UPGRADE_DEFAULT;
  let discoveryOpt: boolean | { aboveFunctionDocChars?: number } | undefined;
  let contextOpt:
    | boolean
    | { promoteAboveChars?: number; previewChars?: number }
    | undefined;
  if (typeof root === 'boolean') {
    discoveryOpt = root;
    contextOpt = root;
  } else {
    discoveryOpt = root.functionDiscovery;
    contextOpt = root.contextFields;
  }

  const discoveryEnabled =
    discoveryOpt === undefined ? true : discoveryOpt !== false;
  const contextEnabled = contextOpt === undefined ? true : contextOpt !== false;
  const discoveryTuning = typeof discoveryOpt === 'object' ? discoveryOpt : {};
  const contextTuning = typeof contextOpt === 'object' ? contextOpt : {};

  return {
    functionDiscovery: {
      enabled: discoveryEnabled,
      aboveFunctionDocChars: normalizeAutoUpgradeThreshold(
        discoveryTuning.aboveFunctionDocChars,
        'autoUpgrade.functionDiscovery.aboveFunctionDocChars',
        DEFAULT_AUTO_DISCOVERY_FUNCTION_DOC_CHARS,
        0
      ),
    },
    contextFields: {
      enabled: contextEnabled,
      promoteAboveChars: normalizeAutoUpgradeThreshold(
        contextTuning.promoteAboveChars,
        'autoUpgrade.contextFields.promoteAboveChars',
        DEFAULT_AUTO_CONTEXT_PROMOTE_CHARS,
        0
      ),
      previewChars: normalizeAutoUpgradeThreshold(
        contextTuning.previewChars,
        'autoUpgrade.contextFields.previewChars',
        DEFAULT_AUTO_CONTEXT_PREVIEW_CHARS,
        -1
      ),
    },
  };
}

/**
 * Direct-respond knob: lets the distiller end the run with
 * `respond(task, evidence)` and skip the executor stage entirely (zero
 * executor model calls) when the task needs no user-provided functions.
 *
 * - `'auto'` (default): agents with zero functions/child agents run
 *   respond-only (the skip is deterministic — `final` is not offered);
 *   agents WITH functions offer `respond` alongside `final` under a
 *   conservative covenant (no live/fresh-state asks, no side effects, no
 *   task covered by a listed function/module domain).
 * - `'off'`: the primitive is absent from the prompt and the runtime, and a
 *   respond payload reaching the pipeline is rejected.
 */
export type AxAgentDirectResponse = 'auto' | 'off';

/**
 * Default for `directResponse` when unset.
 *
 * ON by default ('auto'). Gate record: see src/examples/direct-respond-eval.ts
 * — the landing bar was 0 false-skips on the must-not-skip scenario set
 * (tool-required facts, stale-context traps, effectful asks) with skip recall
 * >=80% on pure context-Q&A tasks and distiller evidence-quality parity in
 * the 'auto' vs 'off' A/B. (Results recorded here when the gate runs.)
 */
export const DIRECT_RESPONSE_DEFAULT: AxAgentDirectResponse = 'auto';

export function resolveDirectResponse(
  value: AxAgentDirectResponse | undefined
): AxAgentDirectResponse {
  if (value === undefined) {
    return DIRECT_RESPONSE_DEFAULT;
  }
  if (value !== 'auto' && value !== 'off') {
    throw new Error(
      `directResponse must be 'auto' or 'off', got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/** System prompt size at which the chat budget hits the floor ratio. */
const BUDGET_CURVE_MAX_SYSTEM_CHARS = 30_000;
/** Minimum fraction of targetPromptChars always reserved for chat context. */
const BUDGET_CURVE_MIN_RATIO = 0.25;

/**
 * Compute an effective chat-context budget by scaling down the base target
 * as the fixed overhead (system prompt + examples) grows.
 *
 * Formula: effectiveBudget = baseBudget * clamp(1 - fixedChars / maxSystemChars, minRatio, 1.0)
 */
export function computeEffectiveChatBudget(
  baseBudget: number,
  fixedOverheadChars: number,
  maxSystemChars = BUDGET_CURVE_MAX_SYSTEM_CHARS,
  minRatio = BUDGET_CURVE_MIN_RATIO
): number {
  if (maxSystemChars <= 0) {
    return Math.floor(baseBudget * minRatio);
  }
  const ratio = Math.max(
    minRatio,
    Math.min(1, 1 - fixedOverheadChars / maxSystemChars)
  );
  return Math.floor(baseBudget * ratio);
}

export const ACTOR_MODEL_POLICY_MIGRATION_ERROR =
  'executorModelPolicy now expects an ordered array of { model, namespaces?, aboveErrorTurns? } entries. Manage prompt pressure with contextPolicy.budget instead of abovePromptChars.';
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

export function resolveExecutorModelPolicy(
  policy: Readonly<AxExecutorModelPolicy> | undefined
): AxResolvedExecutorModelPolicy | undefined {
  if (policy === undefined) {
    return undefined;
  }

  if (!Array.isArray(policy)) {
    throw new Error(ACTOR_MODEL_POLICY_MIGRATION_ERROR);
  }

  if (policy.length === 0) {
    throw new Error('executorModelPolicy must contain at least one entry');
  }

  return policy.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`executorModelPolicy[${index}] must be an object`);
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
      `executorModelPolicy[${index}].aboveErrorTurns`
    );
    const namespaces = normalizeOptionalNamespaces(
      rawEntry.namespaces,
      `executorModelPolicy[${index}].namespaces`
    );
    if (aboveErrorTurns !== undefined && !Number.isInteger(aboveErrorTurns)) {
      throw new Error(
        `executorModelPolicy[${index}].aboveErrorTurns must be an integer >= 0`
      );
    }

    if (aboveErrorTurns === undefined && namespaces === undefined) {
      throw new Error(
        `executorModelPolicy[${index}] must define at least one of aboveErrorTurns or namespaces`
      );
    }

    return {
      model: normalizeOptionalModelName(
        rawEntry.model,
        `executorModelPolicy[${index}].model`
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
    contextHygiene: presetDefaults.contextHygiene,
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
        contextHygiene: {
          defaultMode: 'proactive' as const,
          pressureMode: 'proactive' as const,
        },
        checkpointsEnabled: true,
        // Trigger a checkpoint once the prompt fills to 75% of budget — leaves
        // headroom for the summarized state to fit alongside recent turns.
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
        contextHygiene: {
          defaultMode: 'aggressive' as const,
          pressureMode: 'aggressive' as const,
        },
        checkpointsEnabled: true,
        // 'lean' preset trims aggressively — checkpoint earlier (60% of budget)
        // because less prior context is retained in full form.
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
        inspect: false,
        maxEntries: 8,
        contextHygiene: {
          defaultMode: 'none' as const,
          pressureMode: 'pressure' as const,
        },
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
        contextHygiene: {
          defaultMode: 'none' as const,
        },
        checkpointsEnabled: false,
        checkpointTriggerChars: undefined,
      };
  }
}

export function getActorModelConsecutiveErrorTurns(
  state: Readonly<AxAgentStateExecutorModelState> | undefined
): number {
  return state?.consecutiveErrorTurns ?? 0;
}

export function getActorModelMatchedNamespaces(
  state: Readonly<AxAgentStateExecutorModelState> | undefined
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
  state?: Readonly<AxAgentStateExecutorModelState>
): AxAgentStateExecutorModelState {
  const matchedNamespaces = getActorModelMatchedNamespaces(state);

  return {
    consecutiveErrorTurns: 0,
    ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
  };
}

export function normalizeRestoredActorModelState(
  state: unknown
): AxAgentStateExecutorModelState | undefined {
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
  state: Readonly<AxAgentStateExecutorModelState> | undefined,
  isError: boolean
): AxAgentStateExecutorModelState {
  const matchedNamespaces = getActorModelMatchedNamespaces(state);

  return {
    consecutiveErrorTurns: isError
      ? getActorModelConsecutiveErrorTurns(state) + 1
      : 0,
    ...(matchedNamespaces.length > 0 ? { matchedNamespaces } : {}),
  };
}

export function updateActorModelMatchedNamespaces(
  state: Readonly<AxAgentStateExecutorModelState> | undefined,
  namespaces: readonly string[]
): AxAgentStateExecutorModelState {
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
  policy: Readonly<AxResolvedExecutorModelPolicy>,
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
