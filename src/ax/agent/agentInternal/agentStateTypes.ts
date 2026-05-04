import type { AxFunction } from '../../ai/types.js';
import type { AxOptimizedProgram } from '../../dsp/optimizer.js';
import type {
  AxAgentUsage,
  AxChatLogEntry,
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxMessage,
  AxProgrammable,
  AxProgramUsage,
} from '../../dsp/types.js';
import { normalizeClarificationForError } from '../completion.js';
import type {
  ActionLogEntry,
  CheckpointSummaryState,
  RuntimeStateVariableProvenance,
} from '../contextManager.js';
import type { AxCodeSessionSnapshotEntry } from '../rlm.js';
import { cloneAgentState } from '../state.js';

// Re-exports to avoid unused-import warnings when types are used only transitively
export type { AxOptimizedProgram, AxAgentUsage, AxChatLogEntry, AxMessage };

/**
 * Interface for agents that can be used as child agents.
 * Provides methods to get the agent's function definition and features.
 */
export interface AxAgentic<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {
  getFunction(): AxFunction;
}

export type AxAnyAgentic = AxAgentic<any, any>;

export type AxAgentIdentity = {
  name: string;
  description: string;
  namespace?: string;
};

export type AxAgentFunctionModuleMeta = {
  namespace: string;
  title: string;
  selectionCriteria?: string;
  description?: string;
};

export type AxAgentFunctionExample = {
  code: string;
  title?: string;
  description?: string;
  language?: string;
};

export type AxAgentFunction = Omit<AxFunction, 'description'> & {
  description?: string;
  examples?: readonly AxAgentFunctionExample[];
};

export type AxAgentFunctionGroup = AxAgentFunctionModuleMeta & {
  functions: readonly Omit<AxAgentFunction, 'namespace'>[];
};

export type AxAgentTestCompletionPayload = {
  type: 'final' | 'askClarification';
  args: unknown[];
};

export type AxAgentTestResult = string | AxAgentTestCompletionPayload;

export type AxAgentClarificationKind =
  | 'text'
  | 'number'
  | 'date'
  | 'single_choice'
  | 'multiple_choice';

export type AxAgentClarificationChoice =
  | string
  | {
      label: string;
      value?: string;
    };

export type AxAgentClarification = string | AxAgentStructuredClarification;

export type AxAgentStructuredClarification = {
  question: string;
  type?: AxAgentClarificationKind;
  choices?: AxAgentClarificationChoice[];
  [key: string]: unknown;
};

export type AxAgentGuidanceLogEntry = {
  turn: number;
  guidance: string;
  triggeredBy?: string;
};

export type AxAgentStateActionLogEntry = Pick<
  ActionLogEntry,
  | 'turn'
  | 'code'
  | 'output'
  | 'actorFieldsOutput'
  | 'tags'
  | 'summary'
  | 'producedVars'
  | 'referencedVars'
  | 'stateDelta'
  | 'stepKind'
  | 'replayMode'
  | 'rank'
  | 'tombstone'
>;

export type AxAgentStateCheckpointState = CheckpointSummaryState;

export type AxAgentStateRuntimeEntry = AxCodeSessionSnapshotEntry;

type AxActorModelPolicyEntryBase = {
  model: string;
  namespaces?: readonly string[];
  aboveErrorTurns?: number;
};

export type AxActorModelPolicyEntry =
  | (AxActorModelPolicyEntryBase & { aboveErrorTurns: number })
  | (AxActorModelPolicyEntryBase & {
      namespaces: readonly string[];
    });

export type AxAgentStateActorModelState = {
  consecutiveErrorTurns: number;
  matchedNamespaces?: string[];
};

export type AxAgentDiscoveryPromptState = {
  modules?: Array<{
    module: string;
    text: string;
  }>;
  functions?: Array<{
    qualifiedName: string;
    text: string;
  }>;
};

export type AxActorModelPolicy = readonly [
  AxActorModelPolicyEntry,
  ...AxActorModelPolicyEntry[],
];

export type AxAgentState = {
  version: 1;
  runtimeBindings: Record<string, unknown>;
  runtimeEntries: AxAgentStateRuntimeEntry[];
  actionLogEntries: AxAgentStateActionLogEntry[];
  guidanceLogEntries?: AxAgentGuidanceLogEntry[];
  discoveryPromptState?: AxAgentDiscoveryPromptState;
  checkpointState?: AxAgentStateCheckpointState;
  provenance: Record<string, RuntimeStateVariableProvenance>;
  actorModelState?: AxAgentStateActorModelState;
};

export class AxAgentClarificationError extends Error {
  public readonly question: string;
  public readonly clarification: AxAgentStructuredClarification;
  private readonly stateSnapshot: AxAgentState | undefined;
  private readonly stateErrorMessage: string | undefined;

  constructor(
    clarification: AxAgentClarification,
    options?: Readonly<{
      state?: AxAgentState;
      stateError?: string;
    }>
  ) {
    const normalized = normalizeClarificationForError(clarification);
    super(normalized.question);
    this.name = 'AxAgentClarificationError';
    this.question = normalized.question;
    this.clarification = normalized;
    this.stateSnapshot = options?.state
      ? cloneAgentState(options.state)
      : undefined;
    this.stateErrorMessage = options?.stateError;
  }

  public getState(): AxAgentState | undefined {
    if (this.stateErrorMessage) {
      throw new Error(this.stateErrorMessage);
    }

    return this.stateSnapshot ? cloneAgentState(this.stateSnapshot) : undefined;
  }
}

export type AxAgentFunctionCollection =
  | readonly AxAgentFunction[]
  | readonly AxAgentFunctionGroup[];

export type NormalizedAgentFunctionCollection = {
  functions: AxAgentFunction[];
  moduleMetadata: AxAgentFunctionModuleMeta[];
};

export type AxContextFieldInput =
  | string
  | {
      field: string;
      promptMaxChars?: number;
      keepInPromptChars?: number;
      reverseTruncate?: boolean;
    };

export type AxContextFieldPromptConfig =
  | {
      kind: 'threshold';
      promptMaxChars: number;
    }
  | {
      kind: 'truncate';
      keepInPromptChars: number;
      reverseTruncate: boolean;
    };

export type AxAgentInputUpdateCallback<IN extends AxGenIn> = (
  currentInputs: Readonly<IN>
) => Promise<Partial<IN> | undefined> | Partial<IN> | undefined;

export type AxAgentTurnCallbackArgs = {
  /** 1-based actor turn number. */
  turn: number;
  /** Number of action log entries recorded after processing this turn. */
  actionLogEntryCount: number;
  /** Number of guidance log entries recorded after processing this turn. */
  guidanceLogEntryCount: number;
  /** Full actor AxGen output for the turn, including javascriptCode and any actor fields. */
  actorResult: Record<string, unknown>;
  /** Normalized JavaScript that was executed for this turn. */
  code: string;
  /**
   * Raw runtime execution result before formatting or truncation.
   * For policy-violation turns and completion-signal turns, this is undefined.
   */
  result: unknown;
  /** Action-log-safe runtime output string after formatting/truncation. */
  output: string;
  /** True when the turn recorded an error output. */
  isError: boolean;
  /** Thought text returned by the actor AxGen when available. */
  thought?: string;
  /** Token usage for this turn only. */
  usage?: AxProgramUsage[];
  /** Model used for this turn, when explicitly set via actorModelPolicy. */
  model?: string;
  /** Raw ChatML conversation for this turn (system, user, assistant). Only populated when actorTurnCallback is set. */
  chatLogMessages?: ReadonlyArray<{ role: string; content: string }>;
};

// Re-export for consumers that only import from this module
export type { AxFieldValue };
