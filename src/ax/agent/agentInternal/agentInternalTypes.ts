import type { AxIField } from '../../dsp/sig.js';
import type {
  AxNamedProgramInstance,
  AxProgramForwardOptions,
} from '../../dsp/types.js';
import type { AxAgentInternalCompletionPayload } from '../completion.js';
import type {
  ActionLogEntry,
  ActionLogHygieneMode,
  RuntimeStateVariableProvenance,
} from '../contextManager.js';
import type {
  AxContextPolicyBudget,
  AxContextPolicyPreset,
  axBuildExecutorDefinition,
} from '../rlm.js';
import type {
  AxAgentDiscoveryPromptState,
  AxAgentEvalFunctionCall,
  AxAgentGuidanceLogEntry,
  AxAgentSkillsPromptState,
  AxAgentState,
  AxAgentStateCheckpointState,
  AxAgentStateExecutorModelState,
  AxAgentStateRuntimeEntry,
  AxAgentTestCompletionPayload,
  AxAgentTestResult,
} from './agentPublicTypes.js';

// Re-export to avoid unused-import warnings when types are used only transitively
export type { AxIField };

export type AxAgentExecutorResultPayload = AxAgentTestCompletionPayload;

export type AxAgentFunctionCallRecorder = (
  call: AxAgentEvalFunctionCall
) => void;

export type AxAgentFunctionCall = {
  name: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  kind: 'internal' | 'external';
};

export type AxAgentOnFunctionCall = (
  call: Readonly<AxAgentFunctionCall>
) => void | Promise<void>;

/**
 * Budget state for llmQuery calls. Uses a shared global object for cross-tree
 * tracking plus per-agent local counters to prevent any single child from
 * starving siblings.
 */
export type AxLlmQueryBudgetState = {
  /** Global usage counter shared across all descendants (by reference). */
  global: { used: number };
  /** Global maximum across the entire agent tree. */
  globalMax: number;
  /** Local usage counter for this specific agent. */
  localUsed: number;
  /** Per-agent maximum. */
  localMax: number;
};

export type AxLlmQueryPromptMode = 'simple';

export type AxResolvedContextPolicy = {
  preset: AxContextPolicyPreset;
  budget: AxContextPolicyBudget;
  summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  actionReplay: 'full' | 'adaptive' | 'minimal' | 'checkpointed';
  recentFullActions: number;
  contextHygiene: {
    defaultMode: ActionLogHygieneMode;
    pressureMode?: ActionLogHygieneMode;
  };
  errorPruning: boolean;
  hindsightEvaluation: boolean;
  pruneRank: number;
  rankPruneGraceTurns: number;
  tombstoning:
    | boolean
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined;
  stateSummary: { enabled: boolean; maxEntries?: number; maxChars?: number };
  stateInspection: { enabled: boolean; contextThreshold?: number };
  checkpoints: {
    enabled: boolean;
    triggerChars?: number;
  };
  targetPromptChars: number;
  maxRuntimeChars: number;
};

export type AxResolvedExecutorModelPolicyEntry = {
  model: string;
  aboveErrorTurns?: number;
  namespaces?: string[];
};

export type AxResolvedExecutorModelPolicy =
  readonly AxResolvedExecutorModelPolicyEntry[];

/** One auto-upgrade context promotion, pending `field_auto_promoted` emission. */
export type AxAgentAutoPromotionRecord = {
  fieldName: string;
  originalChars: number;
  /** Chars kept inline as a preview; undefined => runtime-only. */
  promptPreviewChars?: number;
};

export type AxAgentRuntimeInputState = {
  currentInputs: Record<string, unknown>;
  signatureInputFieldNames: Set<string>;
  recomputeTurnInputs: (validateRequiredContext: boolean) => void;
  getNonContextValues: () => Record<string, unknown>;
  getActorInlineContextValues: () => Record<string, unknown>;
  getContextMetadata: () => string | undefined;
  /** Returns promotions recorded since the last drain (each field once per run). */
  drainAutoPromotionEvents: () => readonly AxAgentAutoPromotionRecord[];
};

export type AxAgentRuntimeCompletionState = {
  payload: AxAgentInternalCompletionPayload | undefined;
};

export type AxStageDefinitionBuildOptions = Parameters<
  typeof axBuildExecutorDefinition
>[3];

export type AxPreparedRestoredState = {
  runtimeBindings: Record<string, unknown>;
  runtimeEntries: AxAgentStateRuntimeEntry[];
  actionLogEntries: ActionLogEntry[];
  guidanceLogEntries: AxAgentGuidanceLogEntry[];
  discoveryPromptState?: AxAgentDiscoveryPromptState;
  skillsPromptState?: AxAgentSkillsPromptState;
  checkpointState?: AxAgentStateCheckpointState;
  provenance: Record<string, RuntimeStateVariableProvenance>;
  actorModelState?: AxAgentStateExecutorModelState;
};

export type AxAgentGuidanceState = {
  entries: AxAgentGuidanceLogEntry[];
};

export type AxAgentRuntimeExecutionContext = {
  effectiveContextConfig: AxResolvedContextPolicy;
  bootstrapContextSummary?: string;
  applyBootstrapRuntimeContext: () => Promise<string | undefined>;
  captureRuntimeStateSummary: () => Promise<string | undefined>;
  consumeDiscoveryTurnArtifacts: () => {
    summary?: string;
    texts: string[];
  };
  getActorModelMatchedNamespaces: () => readonly string[];
  exportRuntimeState: (
    options?: Readonly<{ includeBindings?: boolean }>
  ) => Promise<AxAgentState>;
  restoreRuntimeState: (
    state: Readonly<AxAgentState>,
    options?: Readonly<{ skipBindings?: boolean }>
  ) => Promise<AxPreparedRestoredState>;
  syncRuntimeInputsToSession: () => Promise<void>;
  executeActorCode: (
    code: string
  ) => Promise<{ result: unknown; output: string; isError: boolean }>;
  executeTestCode: (code: string) => Promise<AxAgentTestResult>;
  /**
   * Present only when the run participates in a pipeline-owned shared runtime
   * session. The actor loop awaits it before the first turn: the distiller
   * phase adopts the fresh session, the executor phase patches its bindings
   * over the inherited one and runs the phase-boundary snippet.
   */
  prepareSharedSession?: () => Promise<void>;
  close: () => void;
};

export type AxMutableDiscoveryPromptState = {
  modules: Map<string, string>;
  functions: Map<string, string>;
};

export type AxDiscoveryTurnSummary = {
  modules: Set<string>;
  functions: Set<string>;
  texts: Set<string>;
};

export type AxMutableSkillsPromptState = {
  loaded: Map<string, { id: string; name: string; content: string }>;
};

export type AxAgentOptimizationTargetDescriptor = {
  id: string;
  signature?: string;
  program: AxNamedProgramInstance<any, any>['program'] & {
    getInstruction?: () => string | undefined;
    setInstruction?: (instruction: string) => void;
    getSignature?: () => { getDescription?: () => string | undefined };
  };
};
