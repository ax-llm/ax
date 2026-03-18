import type {
  AxAgentCompletionProtocol,
  AxAIService,
  AxFunction,
  AxFunctionHandler,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import type {
  AxMetricFn,
  AxOptimizationProgress,
  AxOptimizationStats,
  AxTypedExample,
} from '../dsp/common_types.js';
import { AxGen } from '../dsp/generate.js';
import { AxJudge, type AxJudgeOptions } from '../dsp/judge.js';
import { AxGEPA } from '../dsp/optimizers/gepa.js';
import type { AxParetoResult } from '../dsp/optimizer.js';
import type { AxOptimizerLoggerFunction } from '../dsp/optimizerTypes.js';
import type { AxIField, AxSignatureConfig } from '../dsp/sig.js';
import { AxSignature, f } from '../dsp/sig.js';
import type { ParseSignature } from '../dsp/sigtypes.js';
import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxNamedProgramInstance,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgramTrace,
  AxProgramUsage,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxTunable,
  AxUsable,
} from '../dsp/types.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { mergeAbortSignals } from '../util/abort.js';
import {
  AxAIServiceAbortedError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import type { ActionLogEntry } from './contextManager.js';
import {
  buildActionEvidenceSummary,
  buildActionLogReplayPlan,
  buildActionLogWithPolicy,
  buildInspectRuntimeBaselineCode,
  buildInspectRuntimeCode,
  buildRuntimeStateProvenance,
  type CheckpointSummaryState,
  generateCheckpointSummaryAsync,
  getPromptFacingActionLogEntries,
  manageContext,
  type RuntimeStateSnapshotEntry,
  type RuntimeStateVariableProvenance,
} from './contextManager.js';
import type {
  AxCodeRuntime,
  AxCodeSession,
  AxCodeSessionSnapshotEntry,
  AxContextPolicyConfig,
  AxContextPolicyPreset,
  AxRLMConfig,
} from './rlm.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';

/**
 * Interface for agents that can be used as child agents.
 * Provides methods to get the agent's function definition and features.
 */
export interface AxAgentic<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {
  getFunction(): AxFunction;
  /** Returns the list of shared fields this agent wants to exclude. */
  getExcludedSharedFields?(): readonly string[];
  /** Returns the list of shared agents this agent wants to exclude (by function name). */
  getExcludedAgents?(): readonly string[];
  /** Returns the list of shared agent functions this agent wants to exclude (by name). */
  getExcludedAgentFunctions?(): readonly string[];
}

type AxAnyAgentic = AxAgentic<any, any>;

type AxAgentIdentity = {
  name: string;
  description: string;
  namespace?: string;
};

type AxAgentFunctionModuleMeta = {
  namespace: string;
  title: string;
  selectionCriteria: string;
  description: string;
};

export type AxAgentFunctionExample = {
  code: string;
  title?: string;
  description?: string;
  language?: string;
};

export type AxAgentFunction = AxFunction & {
  examples?: readonly AxAgentFunctionExample[];
};

export type AxAgentFunctionGroup = AxAgentFunctionModuleMeta & {
  functions: readonly Omit<AxAgentFunction, 'namespace'>[];
};

export type AxAgentTestCompletionPayload = {
  type: 'final' | 'ask_clarification';
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

export type AxAgentState = {
  version: 1;
  runtimeBindings: Record<string, unknown>;
  runtimeEntries: AxAgentStateRuntimeEntry[];
  actionLogEntries: AxAgentStateActionLogEntry[];
  checkpointState?: AxAgentStateCheckpointState;
  provenance: Record<string, RuntimeStateVariableProvenance>;
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

type AxAgentFunctionCollection =
  | readonly AxAgentFunction[]
  | readonly AxAgentFunctionGroup[];

type NormalizedAgentFunctionCollection = {
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

type AxContextFieldPromptConfig =
  | {
      kind: 'threshold';
      promptMaxChars: number;
    }
  | {
      kind: 'truncate';
      keepInPromptChars: number;
      reverseTruncate: boolean;
    };

/**
 * Demo traces for AxAgent's split architecture.
 * Actor demos use `{ javascriptCode }` + optional actorFields.
 * Responder demos use the agent's output type + optional input fields.
 */
export type AxAgentDemos<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  PREFIX extends string = string,
> =
  | {
      programId: `${PREFIX}.actor`;
      traces: (Record<string, AxFieldValue> & { javascriptCode: string })[];
    }
  | {
      programId: `${PREFIX}.responder`;
      traces: (OUT & Partial<IN>)[];
    };

export type AxAgentInputUpdateCallback<IN extends AxGenIn> = (
  currentInputs: Readonly<IN>
) => Promise<Partial<IN> | undefined> | Partial<IN> | undefined;

export type AxAgentTurnCallbackArgs = {
  /** 1-based actor turn number. */
  turn: number;
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
};

export type AxAgentJudgeOptions = Partial<Omit<AxJudgeOptions, 'ai'>>;

export type AxAgentOptimizeTarget =
  | 'actor'
  | 'responder'
  | 'all'
  | readonly string[];

export type AxAgentEvalFunctionCall = {
  qualifiedName: string;
  name: string;
  arguments: AxFieldValue;
  result?: AxFieldValue;
  error?: string;
};

export type AxAgentEvalPrediction<OUT = any> =
  | {
      completionType: 'final';
      output: OUT;
      clarification?: undefined;
      actionLog: string;
      functionCalls: AxAgentEvalFunctionCall[];
      toolErrors: string[];
      turnCount: number;
      usage?: AxProgramUsage[];
    }
  | {
      completionType: 'ask_clarification';
      output?: undefined;
      clarification: AxAgentStructuredClarification;
      actionLog: string;
      functionCalls: AxAgentEvalFunctionCall[];
      toolErrors: string[];
      turnCount: number;
      usage?: AxProgramUsage[];
    };

export type AxAgentEvalTask<IN = any> = {
  input: IN;
  criteria: string;
  id?: string;
  expectedOutput?: AxFieldValue;
  expectedActions?: string[];
  forbiddenActions?: string[];
  weight?: number;
  metadata?: AxFieldValue;
};

export type AxAgentEvalDataset<IN = any> =
  | readonly AxAgentEvalTask<IN>[]
  | {
      train: readonly AxAgentEvalTask<IN>[];
      validation?: readonly AxAgentEvalTask<IN>[];
    };

export type AxAgentOptimizeOptions<
  _IN extends AxGenIn = AxGenIn,
  _OUT extends AxGenOut = AxGenOut,
> = {
  studentAI?: Readonly<AxAIService>;
  judgeAI?: Readonly<AxAIService>;
  teacherAI?: Readonly<AxAIService>;
  judgeOptions?: AxAgentJudgeOptions;
  target?: AxAgentOptimizeTarget;
  apply?: boolean;
  maxMetricCalls?: number;
  metric?: AxMetricFn;
  verbose?: boolean;
  debugOptimizer?: boolean;
  optimizerLogger?: AxOptimizerLoggerFunction;
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void;
};

export type AxAgentOptimizeResult<OUT extends AxGenOut = AxGenOut> =
  AxParetoResult<OUT>;

export type AxAgentOptions<IN extends AxGenIn = AxGenIn> = Omit<
  AxProgramForwardOptions<string>,
  'functions' | 'description'
> & {
  debug?: boolean;
  /**
   * Input fields used as context.
   * - `string`: runtime-only (legacy behavior)
   * - `{ field, promptMaxChars }`: runtime + conditionally inlined into Actor prompt
   * - `{ field, keepInPromptChars, reverseTruncate? }`: runtime + truncated string excerpt in Actor prompt
   */
  contextFields: readonly AxContextFieldInput[];

  /** Child agents and agent sharing configuration. */
  agents?: {
    /** Agents registered under the configured child-agent module namespace (default: `agents.*`). */
    local?: AxAnyAgentic[];
    /** Agents to automatically add to all direct child agents (one level). */
    shared?: AxAnyAgentic[];
    /** Agents to automatically add to ALL descendants recursively (entire agent tree). */
    globallyShared?: AxAnyAgentic[];
    /** Agent function names this agent should NOT receive from parents. */
    excluded?: string[];
  };

  /** Field sharing configuration. */
  fields?: {
    /**
     * Shared/global fields that should remain available in this agent's own
     * Actor/Responder flow instead of bypassing it.
     */
    local?: string[];
    /** Input fields to pass directly to subagents, bypassing the top-level LLM. */
    shared?: string[];
    /** Fields to pass to ALL descendants recursively (entire agent tree). */
    globallyShared?: string[];
    /** Shared fields from a parent agent that this agent should NOT receive. */
    excluded?: string[];
  };

  /** Agent function configuration. */
  functions?: {
    /** Agent functions local to this agent (registered under namespace globals). */
    local?: AxAgentFunctionCollection;
    /** Agent functions to share with direct child agents (one level). */
    shared?: AxAgentFunctionCollection;
    /** Agent functions to share with ALL descendants recursively. */
    globallyShared?: AxAgentFunctionCollection;
    /** Agent function names this agent should NOT receive from parents. */
    excluded?: string[];
    /** Enables runtime callable discovery (modules + on-demand definitions). */
    discovery?: boolean;
  };

  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: AxCodeRuntime;
  /** Cap on recursive sub-agent calls (default: 50). */
  maxSubAgentCalls?: number;
  /** Maximum characters for RLM runtime payloads (default: 5000). */
  maxRuntimeChars?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** Context replay, checkpointing, and runtime-state policy. */
  contextPolicy?: AxContextPolicyConfig;
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /**
   * Called after each Actor turn is recorded with both the raw runtime result
   * and the formatted action-log output.
   */
  actorTurnCallback?: (args: AxAgentTurnCallbackArgs) => void | Promise<void>;
  /**
   * Called before each Actor turn with current input values. Return a partial patch
   * to update in-flight inputs for subsequent Actor/Responder steps.
   */
  inputUpdateCallback?: AxAgentInputUpdateCallback<IN>;
  /** Sub-query execution mode (default: 'simple'). */
  mode?: 'simple' | 'advanced';
  /** Default forward options for recursive llmQuery sub-agent calls. */
  recursionOptions?: AxAgentRecursionOptions;
  /** Default forward options for the Actor sub-program. */
  actorOptions?: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'> & {
      description?: string;
      promptLevel?: AxActorPromptLevel;
    }
  >;
  /** Default forward options for the Responder sub-program. */
  responderOptions?: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'> & {
      description?: string;
    }
  >;
  /** Default options for the built-in judge used by optimize(). */
  judgeOptions?: AxAgentJudgeOptions;
};

type AxAgentJudgeInput = {
  taskInput: AxFieldValue;
  criteria: string;
  expectedOutput?: AxFieldValue;
  expectedActions?: string[];
  forbiddenActions?: string[];
  metadata?: AxFieldValue;
};

type AxAgentJudgeOutput = {
  completionType: 'final' | 'ask_clarification';
  clarification?: AxFieldValue;
  finalOutput?: AxFieldValue;
  actionLog: string;
  functionCalls: AxFieldValue;
  toolErrors: string[];
  turnCount: number;
  usage: AxFieldValue;
};

type AxNormalizedAgentEvalDataset<IN = any> = {
  train: readonly AxAgentEvalTask<IN>[];
  validation?: readonly AxAgentEvalTask<IN>[];
};

type AxAgentFunctionCallRecorder = (call: AxAgentEvalFunctionCall) => void;

export type AxAgentRecursionOptions = Partial<
  Omit<AxProgramForwardOptions<string>, 'functions'>
> & {
  /** Maximum nested recursion depth for llmQuery sub-agent calls. */
  maxDepth?: number;
  /** Prompt detail level for recursive child agents (default: inherits parent). */
  promptLevel?: AxActorPromptLevel;
};

export type AxActorPromptLevel = 'detailed' | 'basic';

type AxLlmQueryPromptMode =
  | 'simple'
  | 'advanced-recursive'
  | 'simple-at-terminal-depth';

// ----- Constants -----

const DEFAULT_RLM_MAX_LLM_CALLS = 50;
const DEFAULT_RLM_MAX_RUNTIME_CHARS = 5_000;
const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
const DEFAULT_RLM_MAX_TURNS = 10;
const DEFAULT_RLM_MAX_RECURSION_DEPTH = 2;
const DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS = 1_200;
const DEFAULT_AGENT_MODULE_NAMESPACE = 'agents';
const DEFAULT_RANK_PRUNE_GRACE_TURNS = 2;
const DEFAULT_AGENT_OPTIMIZE_MAX_METRIC_CALLS = 100;
const SAFE_BOOTSTRAP_GLOBAL_IDENTIFIER = /^[$A-Z_a-z][$0-9A-Z_a-z]*$/;
const UNSAFE_BOOTSTRAP_GLOBAL_NAMES = new Set([
  'context',
  '__proto__',
  'prototype',
  'constructor',
  'globalThis',
  'global',
  'self',
  'window',
  'console',
  'JSON',
  'Math',
  'Reflect',
  'Atomics',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'Symbol',
  'Date',
  'RegExp',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Proxy',
  'Function',
  'Intl',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'AbortController',
  'AbortSignal',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'eval',
  'undefined',
  'Infinity',
  'NaN',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);
const DISCOVERY_LIST_MODULE_FUNCTIONS_NAME = 'listModuleFunctions';
const DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME = 'getFunctionDefinitions';
const TEST_HARNESS_LLM_QUERY_AI_REQUIRED_ERROR =
  'AI service is required to use llmQuery(...) in AxAgent.test(). Pass options.ai or configure ai on the agent.';
const RUNTIME_RESTART_NOTICE =
  '[The JavaScript runtime was restarted; all global state was lost and must be recreated if needed.]';

const AX_AGENT_OPTIMIZE_JUDGE_SIGNATURE = new AxSignature<
  AxAgentJudgeInput,
  AxAgentJudgeOutput
>(`
    taskInput:json "The structured task input passed to the agent",
    criteria:string "Task-specific success criteria",
    expectedOutput?:json "Optional expected final output",
    expectedActions?:string[] "Optional function names that should appear in the run",
    forbiddenActions?:string[] "Optional function names that should not appear in the run",
    metadata?:json "Optional task metadata"
    ->
    completionType:class "final, ask_clarification" "How the agent completed the run",
    clarification?:json "Structured clarification payload when the agent asked for more information",
    finalOutput?:json "The final structured output returned by the agent when it completed normally",
    actionLog:string "Chronological action log produced by the actor loop",
    functionCalls:json "Ordered function call records with names, arguments, results, and errors",
    toolErrors:string[] "Function-call errors observed during the run",
    turnCount:number "Number of actor turns executed",
    usage:json "Optional usage summary for the run"
  `);

const AX_AGENT_OPTIMIZE_PROGRAM_SIGNATURE = new AxSignature<
  Record<'taskRecord', AxFieldValue>,
  Record<'agentRunReport', AxFieldValue>
>(`
    taskRecord:json "Full optimization task record, including the agent input and evaluation criteria"
    ->
    agentRunReport:json "Agent run report containing completion type, clarification or final output, action log, function calls, errors, and turn count"
  `);

function normalizeAgentEvalDataset<IN>(
  dataset: Readonly<AxAgentEvalDataset<IN>>
): AxNormalizedAgentEvalDataset<IN> {
  if ('train' in dataset) {
    return {
      train: dataset.train,
      validation: dataset.validation,
    };
  }

  return { train: dataset };
}

function serializeForEval(value: unknown): AxFieldValue {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    try {
      return JSON.parse(JSON.stringify(value)) as AxFieldValue;
    } catch {
      return value.map((item) => serializeForEval(item));
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value)) as AxFieldValue;
    } catch {
      return String(value) as AxFieldValue;
    }
  }

  return String(value) as AxFieldValue;
}

function normalizeActorJavascriptCode(code: string): string {
  let normalized = code.trim();

  for (;;) {
    const before = normalized;

    normalized = normalized.replace(/^```(?:[A-Za-z0-9_-]+)?[ \t]*\r?\n/, '');
    normalized = normalized.replace(/\r?\n?```[ \t]*$/, '');
    normalized = normalized.trim();

    if (normalized === before) {
      return normalized;
    }
  }
}

function buildAgentJudgeCriteria(additionalCriteria?: string): string {
  const builtInCriteria = `
Use the input field named "criteria" as the task-specific rubric for success.
- Reward actual task completion over polished wording.
- Reward correct tool choice and correct arguments.
- Penalize wrong tools, unnecessary retries, ignored tool errors, and contradictions between the final output and the function call trace.
- If completionType is ask_clarification, judge whether the clarification was necessary, precise, and limited to the missing information.
- Reward clarifications that identify the exact missing information instead of guessing.
- Penalize clarifications that are vague, unnecessary, or ask for information the agent could have gathered from available tools or context.
- If expectedOutput is present and completionType is final, compare the final output against it.
- If expectedActions is present, confirm that the functionCalls align with them.
- If forbiddenActions is present, strongly penalize any matching function calls.
`.trim();

  const extra = additionalCriteria?.trim();
  if (!extra) {
    return builtInCriteria;
  }

  return `${builtInCriteria}\n\nAdditional Evaluation Guidance:\n${extra}`;
}

function actionNameMatches(
  expectedName: string,
  call: Readonly<AxAgentEvalFunctionCall>
): boolean {
  return (
    call.qualifiedName === expectedName ||
    call.name === expectedName ||
    call.qualifiedName.endsWith(`.${expectedName}`)
  );
}

function adjustEvalScoreForActions(
  score: number,
  task: Readonly<AxAgentEvalTask>,
  prediction: Readonly<AxAgentEvalPrediction>
): number {
  let adjusted = Math.max(0, Math.min(1, score));

  const expectedActions = task.expectedActions ?? [];
  if (expectedActions.length > 0) {
    const matched = expectedActions.filter((expectedName) =>
      prediction.functionCalls.some((call) =>
        actionNameMatches(expectedName, call)
      )
    ).length;
    adjusted *= 0.5 + 0.5 * (matched / expectedActions.length);
  }

  const forbiddenActions = task.forbiddenActions ?? [];
  if (
    forbiddenActions.some((expectedName) =>
      prediction.functionCalls.some((call) =>
        actionNameMatches(expectedName, call)
      )
    )
  ) {
    adjusted *= 0.2;
  }

  return Math.max(0, Math.min(1, adjusted));
}

function resolveAgentOptimizeTargetIds(
  availablePrograms: readonly { id: string }[],
  target: Readonly<AxAgentOptimizeTarget>
): string[] {
  const availableIds = new Set(availablePrograms.map((program) => program.id));

  if (target === 'actor') {
    if (!availableIds.has('root.actor')) {
      throw new Error('AxAgent.optimize(): root.actor is not available');
    }
    return ['root.actor'];
  }
  if (target === 'responder') {
    if (!availableIds.has('root.responder')) {
      throw new Error('AxAgent.optimize(): root.responder is not available');
    }
    return ['root.responder'];
  }
  if (target === 'all') {
    return [...availableIds];
  }

  const explicit = [...target];
  for (const id of explicit) {
    if (!availableIds.has(id)) {
      throw new Error(`AxAgent.optimize(): unknown target program ID "${id}"`);
    }
  }
  return explicit;
}

type AxResolvedContextPolicy = {
  preset: AxContextPolicyPreset;
  summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  pruneUsedDocs: boolean;
  actionReplay: 'full' | 'adaptive' | 'minimal';
  recentFullActions: number;
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
};

type AxAgentActorResultPayload = AxAgentTestCompletionPayload;

type AxAgentRuntimeInputState = {
  currentInputs: Record<string, unknown>;
  signatureInputFieldNames: Set<string>;
  sharedFieldValues: Record<string, unknown>;
  recomputeTurnInputs: (validateRequiredContext: boolean) => void;
  getNonContextValues: () => Record<string, unknown>;
  getActorInlineContextValues: () => Record<string, unknown>;
  getContextMetadata: () => string;
};

type AxAgentRuntimeCompletionState = {
  payload: AxAgentActorResultPayload | undefined;
};

type AxPreparedRestoredState = {
  runtimeBindings: Record<string, unknown>;
  runtimeEntries: AxAgentStateRuntimeEntry[];
  actionLogEntries: ActionLogEntry[];
  checkpointState?: AxAgentStateCheckpointState;
  provenance: Record<string, RuntimeStateVariableProvenance>;
};

type AxAgentRuntimeExecutionContext = {
  effectiveContextConfig: AxResolvedContextPolicy;
  bootstrapContextSummary?: string;
  applyBootstrapRuntimeContext: () => Promise<string | undefined>;
  captureRuntimeStateSummary: () => Promise<string | undefined>;
  exportRuntimeState: () => Promise<AxAgentState>;
  restoreRuntimeState: (
    state: Readonly<AxAgentState>
  ) => Promise<AxPreparedRestoredState>;
  syncRuntimeInputsToSession: () => Promise<void>;
  executeActorCode: (
    code: string
  ) => Promise<{ result: unknown; output: string; isError: boolean }>;
  executeTestCode: (code: string) => Promise<AxAgentTestResult>;
  close: () => void;
};

class AxAgentProtocolCompletionSignal extends Error {
  constructor(public readonly type: AxAgentActorResultPayload['type']) {
    super(`AxAgent protocol completion: ${type}`);
    this.name = 'AxAgentProtocolCompletionSignal';
  }
}

function createCompletionBindings(
  setActorResultPayload: (
    type: AxAgentActorResultPayload['type'],
    args: unknown[]
  ) => void
): {
  finalFunction: (...args: unknown[]) => void;
  askClarificationFunction: (...args: unknown[]) => void;
  protocol: AxAgentCompletionProtocol;
} {
  const finalFunction = (...args: unknown[]) => {
    setActorResultPayload('final', args);
  };

  const askClarificationFunction = (...args: unknown[]) => {
    setActorResultPayload('ask_clarification', args);
  };

  const protocol: AxAgentCompletionProtocol = {
    final: (...args: unknown[]): never => {
      setActorResultPayload('final', args);
      throw new AxAgentProtocolCompletionSignal('final');
    },
    askClarification: (...args: unknown[]): never => {
      setActorResultPayload('ask_clarification', args);
      throw new AxAgentProtocolCompletionSignal('ask_clarification');
    },
  };

  return {
    finalFunction,
    askClarificationFunction,
    protocol,
  };
}

function buildInternalSummaryRequestOptions(
  options: Readonly<AxProgramForwardOptions<string>> | undefined,
  debug: boolean,
  abortSignal: AbortSignal | undefined
): Omit<AxProgramForwardOptions<string>, 'functions'> {
  return {
    model: options?.model,
    modelConfig: options?.modelConfig,
    debug,
    verbose: options?.verbose,
    rateLimiter: options?.rateLimiter,
    fetch: options?.fetch,
    tracer: options?.tracer,
    meter: options?.meter,
    timeout: options?.timeout,
    excludeContentFromTrace: options?.excludeContentFromTrace,
    abortSignal,
    logger: options?.logger,
    sessionId: options?.sessionId,
    debugHideSystemPrompt: options?.debugHideSystemPrompt,
    traceContext: options?.traceContext,
    thinkingTokenBudget: options?.thinkingTokenBudget,
    showThoughts: options?.showThoughts,
    useExpensiveModel: options?.useExpensiveModel,
    corsProxy: options?.corsProxy,
    retry: options?.retry,
    contextCache: options?.contextCache,
    examplesInSystem: options?.examplesInSystem,
    customLabels: options?.customLabels,
  };
}

function resolveContextPolicy(
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
    pruneUsedDocs: contextPolicy?.pruneUsedDocs ?? presetDefaults.pruneUsedDocs,
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
        pruneUsedDocs: false,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 10_000,
        maxEntries: 8,
        maxStateChars: 1_600,
        checkpointsEnabled: true,
        checkpointTriggerChars: 16_000,
      };
    case 'lean':
      return {
        actionReplay: 'minimal' as const,
        recentFullActions: 1,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        pruneUsedDocs: true,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 6_000,
        maxEntries: 4,
        maxStateChars: 800,
        checkpointsEnabled: true,
        checkpointTriggerChars: 9_000,
      };
    default:
      return {
        actionReplay: 'full' as const,
        recentFullActions: 1,
        errorPruning: false,
        hindsight: false,
        pruneRank: 2,
        pruneUsedDocs: false,
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

// ----- AxAgent Class -----

/**
 * A split-architecture AI agent that uses two AxGen programs:
 * - **Actor**: generates code to gather information (inputs, actionLog -> code)
 * - **Responder**: synthesizes the final answer from actorResult payload (inputs, actorResult -> outputs)
 *
 * The execution loop is managed by TypeScript, not the LLM:
 * 1. Actor generates code → executed in runtime → result appended to actionLog
 * 2. Loop until Actor calls final(...) / ask_clarification(...) or maxTurns reached
 * 3. Responder synthesizes final answer from actorResult payload
 */
export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic<IN, OUT>
{
  private ai?: AxAIService;
  private judgeAI?: AxAIService;
  private program: AxGen<IN, OUT>;
  private actorProgram!: AxGen<any, any>;
  private responderProgram!: AxGen<any, OUT>;
  private agents?: AxAnyAgentic[];
  private agentFunctions: AxAgentFunction[];
  private agentFunctionModuleMetadata = new Map<
    string,
    AxAgentFunctionModuleMeta
  >();
  private debug?: boolean;
  private options?: Readonly<AxAgentOptions<IN>>;
  private rlmConfig: AxRLMConfig;
  private runtime: AxCodeRuntime;
  private actorFieldNames: string[];
  private localFieldNames: string[];
  private sharedFieldNames: string[];
  private globalSharedFieldNames: string[];
  private excludedSharedFields: string[];
  private excludedAgents: string[];
  private excludedAgentFunctions: string[];
  private actorDescription?: string;
  private actorPromptLevel?: AxActorPromptLevel;
  private responderDescription?: string;
  private judgeOptions?: AxAgentJudgeOptions;
  private recursionForwardOptions?: AxAgentRecursionOptions;
  private actorForwardOptions?: Partial<AxProgramForwardOptions<string>>;
  private responderForwardOptions?: Partial<AxProgramForwardOptions<string>>;
  private inputUpdateCallback?: AxAgentInputUpdateCallback<IN>;
  private contextPromptConfigByField: Map<string, AxContextFieldPromptConfig> =
    new Map();
  private agentModuleNamespace = DEFAULT_AGENT_MODULE_NAMESPACE;
  private functionDiscoveryEnabled = false;
  private runtimeUsageInstructions = '';
  private enforceIncrementalConsoleTurns = false;

  private activeAbortControllers = new Set<AbortController>();
  private _stopRequested = false;
  private state: AxAgentState | undefined;
  private stateError: string | undefined;
  private runtimeBootstrapContext: unknown = undefined;
  private llmQueryBudgetState: { used: number } | undefined;

  private func: AxFunction | undefined;
  // Field names injected by a parent agent via shared-field propagation.
  // These are auto-injected at runtime and must not appear in getFunction().parameters.
  private _parentSharedFields: Set<string> = new Set();
  // Agent names injected by a parent via shared-agent propagation.
  private _parentSharedAgents: Set<string> = new Set();
  // Agent function keys (namespace.name) injected by a parent.
  private _parentSharedAgentFunctions: Set<string> = new Set();

  private _reservedAgentFunctionNamespaces(): Set<string> {
    return new Set([
      'inputs',
      'llmQuery',
      'final',
      'ask_clarification',
      'inspect_runtime',
      DEFAULT_AGENT_MODULE_NAMESPACE,
      this.agentModuleNamespace,
      ...(this.functionDiscoveryEnabled
        ? [
            DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
            DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
          ]
        : []),
    ]);
  }

  private _mergeAgentFunctionModuleMetadata(
    newMetadata: readonly AxAgentFunctionModuleMeta[]
  ): boolean {
    let changed = false;

    for (const meta of newMetadata) {
      const existing = this.agentFunctionModuleMetadata.get(meta.namespace);
      if (!existing) {
        this.agentFunctionModuleMetadata.set(meta.namespace, meta);
        changed = true;
        continue;
      }

      if (
        existing.title !== meta.title ||
        existing.selectionCriteria !== meta.selectionCriteria ||
        existing.description !== meta.description
      ) {
        throw new Error(
          `Conflicting agent function group metadata for namespace "${meta.namespace}"`
        );
      }
    }

    return changed;
  }

  private _validateConfiguredSignature(signature: Readonly<AxSignature>): void {
    if (signature.getDescription()) {
      throw new Error(
        'AxAgent does not support signature-level descriptions. ' +
          'Use setActorDescription() and/or setResponderDescription() to customize the actor and responder prompts independently.'
      );
    }

    const inputFieldNames = new Set(
      signature.getInputFields().map((field) => field.name)
    );
    const outputFieldNames = new Set(
      signature.getOutputFields().map((field) => field.name)
    );

    for (const field of this.rlmConfig.contextFields) {
      if (!inputFieldNames.has(field)) {
        throw new Error(`RLM contextField "${field}" not found in signature`);
      }
    }

    for (const field of this.sharedFieldNames) {
      if (!inputFieldNames.has(field)) {
        throw new Error(
          `sharedField "${field}" not found in signature input fields`
        );
      }
    }

    for (const field of this.globalSharedFieldNames) {
      if (!inputFieldNames.has(field)) {
        throw new Error(
          `globalSharedField "${field}" not found in signature input fields`
        );
      }
    }

    for (const field of this.actorFieldNames) {
      if (!outputFieldNames.has(field)) {
        throw new Error(
          `RLM actorField "${field}" not found in output signature`
        );
      }
    }
  }

  private _validateAgentFunctionNamespaces(
    functions: readonly AxAgentFunction[]
  ): void {
    const reservedNamespaces = this._reservedAgentFunctionNamespaces();
    for (const fn of functions) {
      const ns = fn.namespace ?? 'utils';
      if (reservedNamespaces.has(ns)) {
        throw new Error(
          `Agent function namespace "${ns}" conflicts with an AxAgent runtime global and is reserved`
        );
      }
    }
  }

  constructor(
    {
      ai,
      judgeAI,
      agentIdentity,
      agentModuleNamespace,
      signature,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      judgeAI?: Readonly<AxAIService>;
      agentIdentity?: Readonly<AxAgentIdentity>;
      agentModuleNamespace?: string;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
    }>,
    options: Readonly<AxAgentOptions<IN>>
  ) {
    const {
      debug,
      contextFields,
      runtime,
      maxSubAgentCalls,
      maxRuntimeChars,
      maxBatchedLlmQueryConcurrency,
      maxTurns,
      contextPolicy,
      actorFields,
      actorTurnCallback,
      mode,
      recursionOptions,
      actorOptions,
      responderOptions,
      judgeOptions,
      inputUpdateCallback,
    } = options;

    this.ai = ai;
    this.judgeAI = judgeAI;
    this.agents = options.agents?.local;
    this.functionDiscoveryEnabled = options.functions?.discovery ?? false;
    this.debug = debug;
    this.options = options;
    this.runtime = runtime ?? new AxJSRuntime();
    this.runtimeUsageInstructions = this.runtime.getUsageInstructions();
    this.enforceIncrementalConsoleTurns = shouldEnforceIncrementalConsoleTurns(
      this.runtimeUsageInstructions
    );

    const resolvedAgentModuleNamespace =
      agentModuleNamespace ??
      agentIdentity?.namespace ??
      DEFAULT_AGENT_MODULE_NAMESPACE;
    this.agentModuleNamespace = normalizeAgentModuleNamespace(
      resolvedAgentModuleNamespace,
      {
        normalize: agentModuleNamespace === undefined,
      }
    );

    const reservedAgentModuleNamespaces = new Set([
      'inputs',
      'llmQuery',
      'final',
      'ask_clarification',
      'inspect_runtime',
      DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
      DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
    ]);
    if (reservedAgentModuleNamespaces.has(this.agentModuleNamespace)) {
      throw new Error(
        `Agent module namespace "${this.agentModuleNamespace}" is reserved`
      );
    }

    const reservedAgentFunctionNamespaces =
      this._reservedAgentFunctionNamespaces();
    const localAgentFnBundle = normalizeAgentFunctionCollection(
      options.functions?.local,
      reservedAgentFunctionNamespaces
    );
    const sharedAgentFnBundle = normalizeAgentFunctionCollection(
      options.functions?.shared,
      reservedAgentFunctionNamespaces
    );
    const globalSharedAgentFnBundle = normalizeAgentFunctionCollection(
      options.functions?.globallyShared,
      reservedAgentFunctionNamespaces
    );
    this.agentFunctions = localAgentFnBundle.functions;
    this._mergeAgentFunctionModuleMetadata(localAgentFnBundle.moduleMetadata);

    // Create the base program (used for signature/schema access)
    const {
      agents: _a,
      fields: _f,
      functions: _fn,
      judgeOptions: _jo,
      inputUpdateCallback: _iuc,
      ...genOptions
    } = options;
    this.program = new AxGen<IN, OUT>(signature, genOptions);
    const inputFields = this.program.getSignature().getInputFields();

    const normalizedContext = normalizeContextFields(
      contextFields,
      inputFields,
      DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS
    );
    this.contextPromptConfigByField = normalizedContext.promptConfigByField;

    this.rlmConfig = {
      contextFields: normalizedContext.contextFieldNames,
      sharedFields: options.fields?.shared,
      runtime: this.runtime,
      maxSubAgentCalls,
      maxRuntimeChars,
      maxBatchedLlmQueryConcurrency,
      maxTurns,
      contextPolicy,
      actorFields,
      actorTurnCallback,
      mode,
    };
    this.recursionForwardOptions = recursionOptions;

    const {
      description: actorDescription,
      promptLevel: actorPromptLevel,
      ...actorForwardOptions
    } = actorOptions ?? {};
    const { description: responderDescription, ...responderForwardOptions } =
      responderOptions ?? {};

    this.actorDescription = actorDescription;
    this.actorPromptLevel = actorPromptLevel ?? 'detailed';
    this.actorForwardOptions = actorForwardOptions;

    this.responderDescription = responderDescription;
    this.responderForwardOptions = responderForwardOptions;
    this.judgeOptions = judgeOptions ? { ...judgeOptions } : undefined;
    this.inputUpdateCallback = inputUpdateCallback;

    const agents = this.agents;
    for (const agent of agents ?? []) {
      // Use agent function name as the child name for DSPy-compatible IDs
      const childName = agent.getFunction().name;
      this.program.register(
        agent as unknown as Readonly<AxTunable<IN, OUT> & AxUsable>,
        childName
      );
    }

    // Only set up function metadata when agentIdentity is provided
    if (agentIdentity) {
      this.func = {
        name: toCamelCase(agentIdentity.name),
        description: agentIdentity.description,
        parameters: this._buildFuncParameters(),
        func: async () => {
          throw new Error('Use getFunction() to get a callable wrapper');
        },
      };
    }

    // ----- Split architecture setup -----

    const actorFieldNames = actorFields ?? [];
    this.actorFieldNames = actorFieldNames;

    // --- Read grouped field options ---
    const sharedFieldNames = options.fields?.shared ?? [];
    this.sharedFieldNames = sharedFieldNames;

    this.excludedSharedFields = options.fields?.excluded ?? [];

    const globalSharedFieldNames = options.fields?.globallyShared ?? [];
    this.globalSharedFieldNames = globalSharedFieldNames;
    this.localFieldNames = options.fields?.local ?? [];

    // --- Read grouped agent options ---
    const sharedAgentsList = options.agents?.shared ?? [];
    const globalSharedAgentsList = options.agents?.globallyShared ?? [];
    this.excludedAgents = options.agents?.excluded ?? [];

    // --- Read grouped function options ---
    const sharedAgentFnList = sharedAgentFnBundle.functions;
    const globalSharedAgentFnList = globalSharedAgentFnBundle.functions;
    this.excludedAgentFunctions = options.functions?.excluded ?? [];

    const allAgentFns = [
      ...this.agentFunctions,
      ...sharedAgentFnList,
      ...globalSharedAgentFnList,
    ];

    for (const fn of allAgentFns) {
      if (!fn.parameters) {
        throw new Error(
          `Agent function "${fn.name}" must define parameters schema for agent runtime usage.`
        );
      }
      if (fn.examples) {
        for (const [index, example] of fn.examples.entries()) {
          if (!example.code.trim()) {
            throw new Error(
              `Agent function "${fn.name}" example at index ${index} must define non-empty code`
            );
          }
        }
      }
    }

    this._validateConfiguredSignature(this.program.getSignature());
    this._validateAgentFunctionNamespaces(allAgentFns);

    // Propagate shared fields to child agents (one level)
    if (sharedFieldNames.length > 0 && agents) {
      const sharedFieldMeta = inputFields.filter((fld) =>
        sharedFieldNames.includes(fld.name)
      );
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;

        // Filter out fields the child has excluded
        const excluded = new Set(childAgent.getExcludedSharedFields());
        const applicableFields = sharedFieldMeta.filter(
          (fld) => !excluded.has(fld.name)
        );
        if (applicableFields.length === 0) continue;

        childAgent._extendForSharedFields(
          applicableFields,
          this.rlmConfig.contextFields
        );
      }
    }

    // Propagate shared agents to direct child agents (one level)
    if (sharedAgentsList.length > 0 && agents) {
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        childAgent._extendForSharedAgents(sharedAgentsList);
      }
    }

    // Propagate global shared fields to ALL descendants (recursive)
    if (globalSharedFieldNames.length > 0 && agents) {
      const globalSharedFieldMeta = inputFields.filter((fld) =>
        globalSharedFieldNames.includes(fld.name)
      );
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;

        const excluded = new Set(childAgent.getExcludedSharedFields());
        const applicableFields = globalSharedFieldMeta.filter(
          (fld) => !excluded.has(fld.name)
        );
        if (applicableFields.length === 0) continue;

        childAgent._extendForGlobalSharedFields(
          applicableFields,
          this.rlmConfig.contextFields
        );
      }
    }

    // Propagate global shared agents to ALL descendants (recursive)
    if (globalSharedAgentsList.length > 0 && agents) {
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        childAgent._extendForGlobalSharedAgents(globalSharedAgentsList);
      }
    }

    // Propagate shared agent functions to direct child agents (one level)
    if (sharedAgentFnList.length > 0 && agents) {
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        childAgent._extendForSharedAgentFunctions(sharedAgentFnBundle);
      }
    }

    // Propagate global shared agent functions to ALL descendants (recursive)
    if (globalSharedAgentFnList.length > 0 && agents) {
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        childAgent._extendForGlobalSharedAgentFunctions(
          globalSharedAgentFnBundle
        );
      }
    }

    // Build Actor/Responder programs from current signature and config
    this._buildSplitPrograms();

    // Register Actor/Responder with DSPy-compatible names so optimizers
    // can discover them via getTraces(), and setDemos()/applyOptimization() propagate.
    this.program.register(
      this.actorProgram as unknown as Readonly<AxTunable<IN, OUT> & AxUsable>,
      'actor'
    );
    this.program.register(
      this.responderProgram as unknown as Readonly<
        AxTunable<IN, OUT> & AxUsable
      >,
      'responder'
    );
  }

  /**
   * Builds (or rebuilds) Actor and Responder programs from the current
   * base signature, contextFields, sharedFields, and actorFieldNames.
   */
  private _buildSplitPrograms(): void {
    const inputFields = this.program.getSignature().getInputFields();
    const contextFields = this.rlmConfig.contextFields;
    const bypassedSharedFields = this._getBypassedSharedFieldNames();

    // Identify context field metadata
    const contextFieldMeta = inputFields.filter((fld) =>
      contextFields.includes(fld.name)
    );
    const actorInlineContextInputs = contextFieldMeta
      .filter(
        (fld) =>
          this.contextPromptConfigByField.has(fld.name) &&
          !bypassedSharedFields.has(fld.name)
      )
      .map((fld) => ({ ...fld, isOptional: true }));
    // Non-context, non-shared-only inputs (visible to Actor and Responder)
    const nonContextInputs = inputFields.filter(
      (fld) =>
        !contextFields.includes(fld.name) && !bypassedSharedFields.has(fld.name)
    );

    const originalOutputs = this.program.getSignature().getOutputFields();
    const actorOutputFields = originalOutputs.filter((fld) =>
      this.actorFieldNames.includes(fld.name)
    );
    const responderOutputFields = originalOutputs.filter(
      (fld) => !this.actorFieldNames.includes(fld.name)
    );

    // --- Actor signature: inputs + contextMetadata + actionLog -> javascriptCode (+ actorFields) ---
    let actorSigBuilder = f()
      .addInputFields(nonContextInputs)
      .addInputFields(actorInlineContextInputs)
      .input(
        'contextMetadata',
        f.string('Metadata about pre-loaded context variables (type and size)')
      )
      .input(
        'actionLog',
        f.string(
          'Chronological trace of code executions or actions and their outputs so far'
        )
      )
      .output(
        'javascriptCode',
        f.code('JavaScript code to execute in runtime session')
      ) as any;

    if (actorOutputFields.length > 0) {
      actorSigBuilder = actorSigBuilder.addOutputFields(actorOutputFields);
    }

    const actorSig = actorSigBuilder.build();

    // --- Responder signature: inputs + contextData -> responderOutputFields ---
    const responderSig = f()
      .addInputFields(nonContextInputs)
      .input(
        'contextData',
        f.json('Context data to help synthesize the final answer.')
      )
      .addOutputFields(responderOutputFields)
      .build();

    const effectiveMaxSubAgentCalls =
      this.rlmConfig.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
    const effectiveMaxTurns = this.rlmConfig.maxTurns ?? DEFAULT_RLM_MAX_TURNS;
    const configuredRecursionMaxDepth =
      this.recursionForwardOptions?.maxDepth ?? DEFAULT_RLM_MAX_RECURSION_DEPTH;
    const effectiveLlmQueryPromptMode: AxLlmQueryPromptMode =
      (this.rlmConfig.mode ?? 'simple') === 'advanced'
        ? Math.max(0, configuredRecursionMaxDepth) > 0
          ? 'advanced-recursive'
          : 'simple-at-terminal-depth'
        : 'simple';

    // Collect metadata from child agents and tool functions so the actor prompt
    // describes what's available in the JS runtime session.
    const agentMeta =
      this.agents?.map((a) => {
        const fn = a.getFunction();
        return {
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
        };
      }) ?? [];

    const agentFunctionMeta = this.agentFunctions.map((fn) => ({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters!,
      returns: fn.returns,
      namespace: fn.namespace ?? 'utils',
    }));
    const moduleSet = new Set(
      agentFunctionMeta.map((fn) => fn.namespace ?? 'utils')
    );
    if (agentMeta.length > 0) {
      moduleSet.add(this.agentModuleNamespace);
    }
    const availableModules = [...moduleSet]
      .sort((a, b) => a.localeCompare(b))
      .map((namespace) => ({
        namespace,
        selectionCriteria:
          this.agentFunctionModuleMetadata.get(namespace)?.selectionCriteria,
      }));
    const effectiveContextPolicy = resolveContextPolicy(
      this.rlmConfig.contextPolicy
    );

    const actorDef = axBuildActorDefinition(
      this.actorDescription,
      contextFieldMeta,
      responderOutputFields,
      {
        runtimeUsageInstructions: this.runtimeUsageInstructions,
        promptLevel: this.actorPromptLevel,
        maxSubAgentCalls: effectiveMaxSubAgentCalls,
        maxTurns: effectiveMaxTurns,
        hasInspectRuntime: effectiveContextPolicy.stateInspection.enabled,
        hasLiveRuntimeState: effectiveContextPolicy.stateSummary.enabled,
        hasCompressedActionReplay:
          effectiveContextPolicy.actionReplay !== 'full' ||
          effectiveContextPolicy.checkpoints.enabled ||
          effectiveContextPolicy.errorPruning ||
          Boolean(effectiveContextPolicy.tombstoning) ||
          (this.functionDiscoveryEnabled &&
            effectiveContextPolicy.pruneUsedDocs),
        llmQueryPromptMode: effectiveLlmQueryPromptMode,
        enforceIncrementalConsoleTurns: this.enforceIncrementalConsoleTurns,
        agentModuleNamespace: this.agentModuleNamespace,
        discoveryMode: this.functionDiscoveryEnabled,
        availableModules,
        agents: agentMeta,
        agentFunctions: agentFunctionMeta,
      }
    );

    const responderDef = axBuildResponderDefinition(
      this.responderDescription,
      contextFieldMeta
    );

    if (this.actorProgram) {
      this.actorProgram.setSignature(actorSig);
      this.actorProgram.setDescription(actorDef);
    } else {
      this.actorProgram = new AxGen(actorSig, {
        ...this._genOptions,
        description: actorDef,
      });
    }

    if (this.responderProgram) {
      this.responderProgram.setSignature(responderSig);
      this.responderProgram.setDescription(responderDef);
    } else {
      this.responderProgram = new AxGen(responderSig, {
        ...this._genOptions,
        description: responderDef,
      }) as unknown as AxGen<any, OUT>;
    }
  }

  /**
   * Extends this agent's input signature and context fields for shared fields
   * propagated from a parent agent. Called by a parent during its constructor.
   */
  private _extendForSharedFields(
    fields: readonly AxIField[],
    parentContextFieldNames: readonly string[]
  ): void {
    // getSignature() returns a copy, so we must set it back after modification
    const sig = this.program.getSignature();
    const existingInputs = sig.getInputFields();
    let modified = false;

    for (const field of fields) {
      if (existingInputs.some((f) => f.name === field.name)) {
        // Already injected by a parent — duplicate propagation
        if (this._parentSharedFields.has(field.name)) {
          throw new Error(
            `Duplicate shared field "${field.name}" — already propagated from a parent`
          );
        }
        // Child owns this field in its own signature — skip silently
        continue;
      }
      // Track that this field was injected by a parent — it must not appear in
      // getFunction().parameters because wrapFunctionWithSharedFields auto-injects it.
      this._parentSharedFields.add(field.name);
      sig.addInputField(field);
      modified = true;
    }

    if (modified) {
      this.program.setSignature(sig);
    }

    // Auto-extend contextFields for shared fields that are context in parent
    for (const field of fields) {
      if (
        parentContextFieldNames.includes(field.name) &&
        !this.rlmConfig.contextFields.includes(field.name)
      ) {
        this.rlmConfig.contextFields.push(field.name);
      }
    }

    // Rebuild Actor/Responder with updated signature and contextFields
    this._buildSplitPrograms();

    // Update function metadata (input-only schema, minus parent-injected shared fields)
    if (this.func) {
      this.func.parameters = this._buildFuncParameters();
    }
  }

  /**
   * Extends this agent's agents list with shared agents from a parent.
   * Called by a parent during its constructor. Throws on duplicate propagation.
   */
  private _extendForSharedAgents(newAgents: readonly AxAnyAgentic[]): void {
    if (newAgents.length === 0) return;

    const existingNames = new Set(
      (this.agents ?? []).map((a) => a.getFunction().name)
    );
    const excluded = new Set(this.excludedAgents);
    const toAdd: AxAnyAgentic[] = [];

    for (const agent of newAgents) {
      if (agent === this) continue;
      const name = agent.getFunction().name;
      if (excluded.has(name)) continue;
      if (existingNames.has(name)) {
        if (this._parentSharedAgents.has(name)) {
          throw new Error(
            `Duplicate shared agent "${name}" — already propagated from a parent`
          );
        }
        // Child owns this agent locally — skip silently
        continue;
      }
      this._parentSharedAgents.add(name);
      existingNames.add(name);
      toAdd.push(agent);
    }

    if (toAdd.length === 0) return;

    this.agents = [...(this.agents ?? []), ...toAdd];

    // Register new agents with the base program for optimizer discovery
    for (const agent of toAdd) {
      const childName = agent.getFunction().name;
      this.program.register(
        agent as unknown as Readonly<AxTunable<IN, OUT> & AxUsable>,
        childName
      );
    }

    // Rebuild Actor/Responder to include the new agents in the prompt
    this._buildSplitPrograms();
  }

  /**
   * Extends this agent and all its descendants with global shared fields.
   * Adds fields to this agent's signature and sharedFieldNames, then
   * recursively propagates to this agent's own children.
   */
  private _extendForGlobalSharedFields(
    fields: readonly AxIField[],
    parentContextFieldNames: readonly string[]
  ): void {
    // Extend THIS agent's signature (same logic as _extendForSharedFields)
    const sig = this.program.getSignature();
    const existingInputs = sig.getInputFields();
    let modified = false;

    for (const field of fields) {
      if (existingInputs.some((f) => f.name === field.name)) {
        if (this._parentSharedFields.has(field.name)) {
          throw new Error(
            `Duplicate shared field "${field.name}" — already propagated from a parent`
          );
        }
        continue;
      }
      this._parentSharedFields.add(field.name);
      sig.addInputField(field);
      modified = true;
    }

    if (modified) {
      this.program.setSignature(sig);
    }

    // Auto-extend contextFields for fields that are context in the original parent
    for (const field of fields) {
      if (
        parentContextFieldNames.includes(field.name) &&
        !this.rlmConfig.contextFields.includes(field.name)
      ) {
        this.rlmConfig.contextFields.push(field.name);
      }
    }

    // Add field names to this agent's own sharedFieldNames so that at runtime,
    // this agent will extract their values and inject them to ITS children too.
    for (const field of fields) {
      if (!this.sharedFieldNames.includes(field.name)) {
        this.sharedFieldNames.push(field.name);
      }
    }

    // Rebuild Actor/Responder with updated signature
    this._buildSplitPrograms();

    // Update function metadata
    if (this.func) {
      this.func.parameters = this._buildFuncParameters();
    }

    // Recursively propagate to this agent's own children
    if (this.agents) {
      for (const childAgent of this.agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        const excluded = new Set(childAgent.getExcludedSharedFields());
        const applicableFields = fields.filter(
          (fld) => !excluded.has(fld.name)
        );
        if (applicableFields.length === 0) continue;
        childAgent._extendForGlobalSharedFields(
          applicableFields,
          parentContextFieldNames
        );
      }
    }
  }

  /**
   * Extends this agent and all its descendants with global shared agents.
   * Adds agents to this agent's agents list, then recursively propagates
   * to this agent's own children.
   */
  private _extendForGlobalSharedAgents(
    newAgents: readonly AxAnyAgentic[]
  ): void {
    // Collect children to recurse into BEFORE extending (to avoid recursing
    // into the newly added agents themselves, which could cause infinite loops).
    const childrenToRecurse = this.agents
      ? this.agents.filter((a): a is AxAgent<any, any> => a instanceof AxAgent)
      : [];

    // Extend THIS agent
    this._extendForSharedAgents(newAgents);

    // Recursively propagate to this agent's original children
    for (const childAgent of childrenToRecurse) {
      childAgent._extendForGlobalSharedAgents(newAgents);
    }
  }

  /**
   * Extends this agent's agent functions list with shared agent functions
   * from a parent. Throws on duplicate propagation.
   */
  private _extendForSharedAgentFunctions(
    bundle: Readonly<NormalizedAgentFunctionCollection>
  ): void {
    if (bundle.functions.length === 0 && bundle.moduleMetadata.length === 0) {
      return;
    }

    const existingKeys = new Set(
      this.agentFunctions.map((f) => `${f.namespace ?? 'utils'}.${f.name}`)
    );
    const excluded = new Set(this.excludedAgentFunctions);
    const toAdd: AxAgentFunction[] = [];
    const metadataChanged = this._mergeAgentFunctionModuleMetadata(
      bundle.moduleMetadata
    );

    for (const fn of bundle.functions) {
      if (excluded.has(fn.name)) continue;
      const key = `${fn.namespace ?? 'utils'}.${fn.name}`;
      if (existingKeys.has(key)) {
        if (this._parentSharedAgentFunctions.has(key)) {
          throw new Error(
            `Duplicate shared agent function "${key}" — already propagated from a parent`
          );
        }
        // Child owns this function locally — skip silently
        continue;
      }
      this._parentSharedAgentFunctions.add(key);
      existingKeys.add(key);
      toAdd.push(fn);
    }

    if (toAdd.length === 0 && !metadataChanged) return;
    if (toAdd.length > 0) {
      this.agentFunctions = [...this.agentFunctions, ...toAdd];
    }
    this._buildSplitPrograms();
  }

  /**
   * Extends this agent and all its descendants with globally shared agent functions.
   */
  private _extendForGlobalSharedAgentFunctions(
    bundle: Readonly<NormalizedAgentFunctionCollection>
  ): void {
    // Collect children BEFORE extending to avoid recursing into newly added items
    const childrenToRecurse = this.agents
      ? this.agents.filter((a): a is AxAgent<any, any> => a instanceof AxAgent)
      : [];

    this._extendForSharedAgentFunctions(bundle);

    for (const childAgent of childrenToRecurse) {
      childAgent._extendForGlobalSharedAgentFunctions(bundle);
    }
  }

  /**
   * Stops an in-flight forward/streamingForward call. Causes the call
   * to throw `AxAIServiceAbortedError`.
   */
  public stop(): void {
    this._stopRequested = true;
    for (const controller of this.activeAbortControllers) {
      controller.abort('Stopped by user');
    }
    this.program.stop();
    this.actorProgram.stop();
    this.responderProgram.stop();
  }

  public getId(): string {
    return this.program.getId();
  }

  public setId(id: string) {
    this.program.setId(id);
  }

  public namedPrograms(): Array<{ id: string; signature?: string }> {
    return this.program.namedPrograms();
  }

  public namedProgramInstances(): AxNamedProgramInstance<IN, OUT>[] {
    return this.program.namedProgramInstances();
  }

  public getTraces() {
    return this.program.getTraces();
  }

  public setDemos(
    demos: readonly (AxAgentDemos<IN, OUT> | AxProgramDemos<IN, OUT>)[],
    options?: { modelConfig?: Record<string, unknown> }
  ) {
    this.program.setDemos(demos as readonly AxProgramDemos<IN, OUT>[], options);
  }

  public getUsage() {
    return this.program.getUsage();
  }

  public resetUsage() {
    this.program.resetUsage();
  }

  public getState(): AxAgentState | undefined {
    if (this.stateError) {
      throw new Error(this.stateError);
    }

    return this.state ? cloneAgentState(this.state) : undefined;
  }

  public setState(state?: AxAgentState): void {
    if (state && state.version !== 1) {
      throw new Error(
        `Unsupported AxAgentState version "${String((state as { version?: unknown }).version)}"`
      );
    }

    if (state) {
      const session = this.runtime.createSession();
      try {
        if (typeof session.patchGlobals !== 'function') {
          throw new Error(
            'AxCodeSession.patchGlobals() is required to restore AxAgent state'
          );
        }
      } finally {
        try {
          session.close();
        } catch {
          // Ignore close errors from capability probing
        }
      }
    }

    this.state = state ? cloneAgentState(state) : undefined;
    this.stateError = undefined;
  }

  public async optimize(
    dataset: Readonly<AxAgentEvalDataset<IN>>,
    options?: Readonly<AxAgentOptimizeOptions<IN, OUT>>
  ): Promise<AxAgentOptimizeResult<OUT>> {
    const normalizedDataset = normalizeAgentEvalDataset(dataset);
    if (normalizedDataset.train.length === 0) {
      throw new Error(
        'AxAgent.optimize(): at least one training task is required.'
      );
    }

    const studentAI = options?.studentAI ?? this.ai;
    if (!studentAI) {
      throw new Error(
        'AxAgent.optimize(): studentAI is required when the agent has no default ai.'
      );
    }

    const resolvedJudgeAI =
      options?.judgeAI ??
      this.judgeAI ??
      options?.teacherAI ??
      this.ai ??
      studentAI;
    const mergedJudgeOptions: AxAgentJudgeOptions = {
      ...(this.judgeOptions ?? {}),
      ...(options?.judgeOptions ?? {}),
    };
    const targetIds = resolveAgentOptimizeTargetIds(
      this.namedPrograms(),
      options?.target ?? 'actor'
    );
    const metric =
      options?.metric ??
      this._createAgentOptimizeMetric(resolvedJudgeAI, mergedJudgeOptions);
    const optimizationProgram = this._createOptimizationProgram(targetIds);
    const maxMetricCalls = Math.max(
      1,
      Math.floor(
        options?.maxMetricCalls ??
          Math.max(
            DEFAULT_AGENT_OPTIMIZE_MAX_METRIC_CALLS,
            normalizedDataset.train.length * 4
          )
      )
    );

    const optimizer = new AxGEPA({
      studentAI,
      teacherAI: options?.teacherAI ?? resolvedJudgeAI,
      verbose: options?.verbose,
      debugOptimizer: options?.debugOptimizer,
      optimizerLogger: options?.optimizerLogger,
      onProgress: options?.onProgress,
      onEarlyStop: options?.onEarlyStop,
    });

    const result = await optimizer.compile(
      optimizationProgram as AxProgrammable<
        AxAgentEvalTask<IN>,
        AxAgentEvalPrediction<OUT>
      >,
      normalizedDataset.train as readonly AxTypedExample<AxAgentEvalTask<IN>>[],
      metric,
      {
        validationExamples: normalizedDataset.validation as
          | readonly AxTypedExample<AxAgentEvalTask<IN>>[]
          | undefined,
        maxMetricCalls,
        verbose: options?.verbose,
      }
    );

    if (options?.apply !== false && result.optimizedProgram) {
      this.applyOptimization(result.optimizedProgram);
    }

    return result as unknown as AxAgentOptimizeResult<OUT>;
  }

  private _createOptimizationProgram(
    targetIds: readonly string[]
  ): AxProgrammable<AxAgentEvalTask<IN>, AxAgentEvalPrediction<OUT>> {
    return {
      getId: () => this.getId(),
      setId: (id: string) => this.setId(id),
      getSignature: () => AX_AGENT_OPTIMIZE_PROGRAM_SIGNATURE,
      forward: async (
        ai: Readonly<AxAIService>,
        task: AxAgentEvalTask<IN>,
        options?: Readonly<AxProgramForwardOptions<string>>
      ) => this._forwardForEvaluation(ai, task, options),
      streamingForward: async function* (
        ai: Readonly<AxAIService>,
        task: AxAgentEvalTask<IN>,
        options?: Readonly<
          AxProgramStreamingForwardOptionsWithModels<AxAIService>
        >
      ): AxGenStreamingOut<AxAgentEvalPrediction<OUT>> {
        yield {
          version: 1,
          index: 0,
          delta: await this.forward(
            ai,
            task,
            options as Readonly<AxProgramForwardOptions<string>> | undefined
          ),
        };
      },
      getTraces: () =>
        this.getTraces() as unknown as AxProgramTrace<
          AxAgentEvalTask<IN>,
          AxAgentEvalPrediction<OUT>
        >[],
      namedProgramInstances: () =>
        this.namedProgramInstances().filter((entry) =>
          targetIds.includes(entry.id)
        ) as AxNamedProgramInstance<any, any>[],
      setDemos: (demos, demoOptions) =>
        this.setDemos(
          demos as unknown as readonly AxProgramDemos<IN, OUT>[],
          demoOptions
        ),
      applyOptimization: (optimizedProgram) =>
        this.applyOptimization(optimizedProgram as any),
      getUsage: () => this.getUsage(),
      resetUsage: () => this.resetUsage(),
    };
  }

  private _createAgentOptimizeMetric(
    judgeAI: Readonly<AxAIService>,
    judgeOptions: Readonly<AxAgentJudgeOptions>
  ): AxMetricFn {
    const mergedJudgeCriteria = buildAgentJudgeCriteria(judgeOptions.criteria);
    const judge = new AxJudge(AX_AGENT_OPTIMIZE_JUDGE_SIGNATURE, {
      ai: judgeAI,
      ...judgeOptions,
      criteria: mergedJudgeCriteria,
    });

    return async ({ example, prediction }) => {
      const task = example as AxAgentEvalTask<IN>;
      const evalPrediction = prediction as AxAgentEvalPrediction<OUT>;
      const judgeInput: AxAgentJudgeInput = {
        taskInput: serializeForEval(task.input),
        criteria: task.criteria,
        expectedOutput: task.expectedOutput,
        expectedActions: task.expectedActions,
        forbiddenActions: task.forbiddenActions,
        metadata: task.metadata,
      };
      const judgeOutput: AxAgentJudgeOutput = {
        completionType: evalPrediction.completionType,
        clarification: serializeForEval(evalPrediction.clarification),
        finalOutput: serializeForEval(evalPrediction.output),
        actionLog: evalPrediction.actionLog,
        functionCalls: serializeForEval(evalPrediction.functionCalls),
        toolErrors: evalPrediction.toolErrors,
        turnCount: evalPrediction.turnCount,
        usage: serializeForEval(evalPrediction.usage ?? []),
      };

      const result = await judge.evaluate(judgeInput, judgeOutput);
      return adjustEvalScoreForActions(result.score, task, evalPrediction);
    };
  }

  private async _forwardForEvaluation<T extends Readonly<AxAIService>>(
    parentAi: T,
    task: Readonly<AxAgentEvalTask<IN>>,
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<AxAgentEvalPrediction<OUT>> {
    const savedState = this.state ? cloneAgentState(this.state) : undefined;
    const savedStateError = this.stateError;
    this.state = undefined;
    this.stateError = undefined;

    const abortController = new AbortController();
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );

    this.activeAbortControllers.add(abortController);
    const createdBudgetState = this._ensureLlmQueryBudgetState();
    try {
      const ai = this.ai ?? parentAi;
      const debug =
        options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;
      const functionCalls: AxAgentEvalFunctionCall[] = [];

      const {
        nonContextValues,
        actorResult,
        actorFieldValues,
        actionLog,
        turnCount,
      } = await this._runActorLoop(
        ai,
        task.input,
        options,
        effectiveAbortSignal,
        functionCalls
      );
      const toolErrors = functionCalls
        .filter((call) => Boolean(call.error))
        .map(
          (call) => `${call.qualifiedName}: ${call.error ?? 'unknown error'}`
        );

      if (actorResult.type === 'ask_clarification') {
        return {
          completionType: 'ask_clarification',
          clarification: normalizeClarificationForError(
            actorResult.args[0] as AxAgentClarification
          ),
          actionLog,
          functionCalls,
          toolErrors,
          turnCount,
        };
      }

      const responderMergedOptions = {
        ...this._genOptions,
        ...this.responderForwardOptions,
        ...options,
        debug,
        abortSignal: effectiveAbortSignal,
        maxSteps: 1,
      };

      const responderResult = await this.responderProgram.forward(
        ai,
        {
          ...nonContextValues,
          contextData: actorResult,
        },
        responderMergedOptions
      );

      return {
        completionType: 'final',
        output: { ...responderResult, ...actorFieldValues } as OUT,
        actionLog,
        functionCalls,
        toolErrors,
        turnCount,
      };
    } finally {
      this.state = savedState ? cloneAgentState(savedState) : undefined;
      this.stateError = savedStateError;
      if (createdBudgetState) {
        this.llmQueryBudgetState = undefined;
      }
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  public getFunction(): AxFunction {
    if (!this.func) {
      throw new Error(
        'getFunction() requires agentIdentity to be set in the constructor'
      );
    }

    const boundFunc = this.forward.bind(this);
    const funcMeta = this.func;

    const wrappedFunc: AxFunctionHandler = async (
      values: IN,
      options?
    ): Promise<string> => {
      const ai = this.ai ?? options?.ai;
      if (!ai) {
        throw new Error('AI service is required to run the agent');
      }
      const ret = await boundFunc(ai, values as unknown as IN, options);

      const sig = this.program.getSignature();
      const outFields = sig.getOutputFields();
      const result = Object.keys(ret)
        .map((k) => {
          const field = outFields.find((f) => f.name === k);
          if (field) {
            return `${field.title}: ${ret[k]}`;
          }
          return `${k}: ${ret[k]}`;
        })
        .join('\n');

      return result;
    };

    return {
      ...funcMeta,
      func: wrappedFunc,
    };
  }

  public getExcludedSharedFields(): readonly string[] {
    return this.excludedSharedFields;
  }

  private _getBypassedSharedFieldNames(): Set<string> {
    const bypassed = new Set([
      ...this.sharedFieldNames,
      ...this.globalSharedFieldNames,
    ]);
    for (const fieldName of this.localFieldNames) {
      bypassed.delete(fieldName);
    }
    return bypassed;
  }

  private _createRuntimeInputState(
    values: IN | AxMessage<IN>[] | Partial<IN>,
    options?: Readonly<{
      allowedFieldNames?: readonly string[];
      validateInputKeys?: boolean;
    }>
  ): AxAgentRuntimeInputState {
    let rawValues: Record<string, unknown>;

    if (Array.isArray(values)) {
      rawValues = values
        .filter((msg) => msg.role === 'user')
        .reduce<Record<string, unknown>>(
          (acc, msg) => ({
            ...acc,
            ...(msg.values as Record<string, unknown>),
          }),
          {}
        );
    } else {
      rawValues = values as Record<string, unknown>;
    }

    const allowedFieldNames = options?.allowedFieldNames
      ? new Set(options.allowedFieldNames)
      : undefined;
    if (allowedFieldNames && options?.validateInputKeys) {
      for (const key of Object.keys(rawValues)) {
        if (!allowedFieldNames.has(key)) {
          throw new Error(
            `AxAgent.test() only accepts context field values. "${key}" is not configured in contextFields.`
          );
        }
      }
    }

    const currentInputs: Record<string, unknown> = { ...rawValues };
    const signatureInputFieldNames = allowedFieldNames
      ? new Set(allowedFieldNames)
      : new Set(
          this.program
            .getSignature()
            .getInputFields()
            .map((f) => f.name)
        );

    const sharedFieldNames = [
      ...this.sharedFieldNames,
      ...this.globalSharedFieldNames,
    ];
    const bypassedSharedFields = this._getBypassedSharedFieldNames();
    const sharedFieldValues: Record<string, unknown> = {};
    let contextValues: Record<string, unknown> = {};
    let nonContextValues: Record<string, unknown> = {};
    let actorInlineContextValues: Record<string, unknown> = {};
    let contextMetadata = '(none)';

    const optionalContextFields = new Set(
      this.program
        .getSignature()
        .getInputFields()
        .filter(
          (f) => this.rlmConfig.contextFields.includes(f.name) && f.isOptional
        )
        .map((f) => f.name)
    );

    const recomputeTurnInputs = (validateRequiredContext: boolean): void => {
      const nextContextValues: Record<string, unknown> = {};
      const nextNonContextValues: Record<string, unknown> = {};

      for (const [k, v] of Object.entries(currentInputs)) {
        if (this.rlmConfig.contextFields.includes(k)) {
          nextContextValues[k] = v;
        } else if (!bypassedSharedFields.has(k)) {
          nextNonContextValues[k] = v;
        }
      }

      if (validateRequiredContext) {
        for (const field of this.rlmConfig.contextFields) {
          if (optionalContextFields.has(field)) {
            continue;
          }
          if (
            !(field in nextContextValues) ||
            nextContextValues[field] === undefined
          ) {
            throw new Error(
              `RLM contextField "${field}" is missing from input values`
            );
          }
        }
      }

      const nextInlineContextValues: Record<string, unknown> = {};
      for (const [field, promptConfig] of this.contextPromptConfigByField) {
        if (bypassedSharedFields.has(field)) {
          continue;
        }
        if (!(field in nextContextValues)) {
          continue;
        }
        const inlined = buildContextFieldPromptInlineValue(
          nextContextValues[field],
          promptConfig
        );
        if (inlined !== undefined) {
          nextInlineContextValues[field] = inlined;
        }
      }

      contextValues = nextContextValues;
      nonContextValues = nextNonContextValues;
      actorInlineContextValues = nextInlineContextValues;

      for (const key of Object.keys(sharedFieldValues)) {
        delete sharedFieldValues[key];
      }
      for (const field of sharedFieldNames) {
        if (field in currentInputs) {
          sharedFieldValues[field] = currentInputs[field];
        }
        if (field in contextValues) {
          sharedFieldValues[field] = contextValues[field];
        }
      }

      contextMetadata =
        buildRLMVariablesInfo(contextValues, {
          promptConfigByField: this.contextPromptConfigByField,
          inlinedFields: new Set(Object.keys(actorInlineContextValues)),
        }) || '(none)';
    };

    return {
      currentInputs,
      signatureInputFieldNames,
      sharedFieldValues,
      recomputeTurnInputs,
      getNonContextValues: () => nonContextValues,
      getActorInlineContextValues: () => actorInlineContextValues,
      getContextMetadata: () => contextMetadata,
    };
  }

  private _ensureLlmQueryBudgetState(): boolean {
    if (this.llmQueryBudgetState) {
      return false;
    }

    this.llmQueryBudgetState = { used: 0 };
    return true;
  }

  private _createRuntimeExecutionContext({
    ai,
    inputState,
    options,
    effectiveAbortSignal,
    debug,
    completionState,
    completionBindings,
    actionLogEntries,
    functionCallRecorder,
  }: Readonly<{
    ai?: AxAIService;
    inputState: AxAgentRuntimeInputState;
    options?: Readonly<
      Partial<Omit<AxProgramForwardOptions<string>, 'functions'>>
    >;
    effectiveAbortSignal?: AbortSignal;
    debug: boolean;
    completionState: AxAgentRuntimeCompletionState;
    completionBindings: ReturnType<typeof createCompletionBindings>;
    actionLogEntries?: ActionLogEntry[];
    functionCallRecorder?: AxAgentFunctionCallRecorder;
  }>): AxAgentRuntimeExecutionContext {
    const rlm = this.rlmConfig;
    const runtime = this.runtime;
    const maxSubAgentCalls = rlm.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
    const maxRuntimeChars =
      rlm.maxRuntimeChars ?? DEFAULT_RLM_MAX_RUNTIME_CHARS;
    const maxBatchedLlmQueryConcurrency = Math.max(
      1,
      rlm.maxBatchedLlmQueryConcurrency ?? DEFAULT_RLM_BATCH_CONCURRENCY
    );
    const configuredRecursionMaxDepth =
      this.recursionForwardOptions?.maxDepth ?? DEFAULT_RLM_MAX_RECURSION_DEPTH;
    const recursionMaxDepth = Math.max(0, configuredRecursionMaxDepth);
    const effectiveContextConfig = resolveContextPolicy(rlm.contextPolicy);
    const llmQueryBudgetState = this.llmQueryBudgetState ?? { used: 0 };
    const activeRecursiveSubAgents = new Set<
      AxAgent<any, { answer: AxFieldValue }>
    >();

    const llmCallWarnThreshold = Math.floor(maxSubAgentCalls * 0.8);

    const { maxDepth: _, ...recursionForwardOptions } =
      this.recursionForwardOptions ?? {};
    const {
      description: ___,
      mem: ____,
      sessionId: _____,
      ...parentForwardOptions
    } = options ?? {};
    const childRecursionOptions: AxAgentRecursionOptions = {
      ...(this.recursionForwardOptions ?? {}),
      maxDepth: Math.max(0, recursionMaxDepth - 1),
    };
    const recursiveChildSignature = f()
      .input('task', f.string('Task for recursive analysis'))
      .output('answer', f.string('Answer from recursive analysis'))
      .build();
    const simpleChildSignature = f()
      .input('task', f.string('Task for recursive analysis'))
      .input('context', f.json('Optional context for the recursive task'))
      .output('answer', f.string('Answer from recursive analysis'))
      .build();

    const rlmMode = rlm.mode ?? 'simple';
    const useAdvancedLlmQuery = rlmMode === 'advanced' && recursionMaxDepth > 0;

    const childPromptLevel =
      this.recursionForwardOptions?.promptLevel ?? this.actorPromptLevel;

    const createRecursiveSubAgent = () =>
      new AxAgent<any, { answer: AxFieldValue }>(
        {
          agentModuleNamespace: this.agentModuleNamespace,
          signature: recursiveChildSignature,
        },
        {
          debug,
          ...rlm,
          agents: { local: this.agents },
          functions: {
            local: this.agentFunctions,
            discovery: this.functionDiscoveryEnabled,
          },
          contextFields: [],
          actorFields: undefined,
          recursionOptions: childRecursionOptions,
          actorOptions: {
            ...this.actorForwardOptions,
            promptLevel: childPromptLevel,
          },
          responderOptions: this.responderForwardOptions,
        }
      );

    const wireRecursiveSubAgent = (
      recursiveSubAgent: AxAgent<any, { answer: AxFieldValue }>
    ) => {
      recursiveSubAgent.llmQueryBudgetState = llmQueryBudgetState;
      return recursiveSubAgent;
    };

    const stopActiveRecursiveSubAgents = () => {
      for (const recursiveSubAgent of [...activeRecursiveSubAgents]) {
        recursiveSubAgent.stop();
      }
    };

    const createSimpleSubAgent = () =>
      new AxGen<any, { answer: AxFieldValue }>(
        simpleChildSignature,
        childRecursionOptions
      );

    const llmQuery = async (
      queryOrQueries:
        | string
        | { query: string; context?: unknown }
        | readonly { query: string; context?: unknown }[],
      ctx?: unknown
    ): Promise<string | string[]> => {
      if (
        !Array.isArray(queryOrQueries) &&
        typeof queryOrQueries === 'object' &&
        queryOrQueries !== null &&
        'query' in queryOrQueries
      ) {
        return llmQuery(queryOrQueries.query, queryOrQueries.context ?? ctx);
      }

      if (effectiveAbortSignal?.aborted) {
        throw new AxAIServiceAbortedError(
          'rlm-llm-query',
          effectiveAbortSignal.reason
            ? String(effectiveAbortSignal.reason)
            : 'Aborted'
        );
      }

      if (!ai) {
        throw new Error(TEST_HARNESS_LLM_QUERY_AI_REQUIRED_ERROR);
      }

      const query = queryOrQueries as string;
      const normalizeSubAgentAnswer = (value: AxFieldValue): string => {
        if (value === undefined || value === null) {
          return '';
        }
        if (typeof value === 'string') {
          return truncateText(value, maxRuntimeChars);
        }
        try {
          return truncateText(JSON.stringify(value), maxRuntimeChars);
        } catch {
          return truncateText(String(value), maxRuntimeChars);
        }
      };

      const runSingleLlmQuery = async (
        singleQuery: string,
        singleCtx?: unknown,
        abortSignal: AbortSignal | undefined = effectiveAbortSignal
      ): Promise<string> => {
        if (abortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            'rlm-llm-query',
            abortSignal.reason ? String(abortSignal.reason) : 'Aborted'
          );
        }

        const normalizedCtx =
          singleCtx === undefined
            ? undefined
            : typeof singleCtx === 'string'
              ? truncateText(singleCtx, maxRuntimeChars)
              : singleCtx;

        if (llmQueryBudgetState.used >= maxSubAgentCalls) {
          return `[ERROR] Sub-query budget exhausted (${maxSubAgentCalls}/${maxSubAgentCalls}). Complete the task using data already gathered or handle remaining work directly in JS.`;
        }
        llmQueryBudgetState.used++;

        const maxAttempts = 3;
        let lastError: unknown;
        const formatSubAgentError = (error: unknown) =>
          `[ERROR] ${error instanceof Error ? error.message : String(error)}. Retry with a simpler query, handle in JS, or proceed with data already gathered.`;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const recursiveResult = useAdvancedLlmQuery
              ? await (() => {
                  const recursiveSubAgent = wireRecursiveSubAgent(
                    createRecursiveSubAgent()
                  );
                  activeRecursiveSubAgents.add(recursiveSubAgent);
                  recursiveSubAgent.runtimeBootstrapContext = normalizedCtx;
                  return recursiveSubAgent
                    .forward(
                      ai,
                      {
                        task: singleQuery,
                      },
                      {
                        ...(parentForwardOptions as Partial<
                          Omit<AxProgramForwardOptions<string>, 'functions'>
                        >),
                        ...(recursionForwardOptions as Partial<
                          Omit<AxProgramForwardOptions<string>, 'functions'>
                        >),
                        abortSignal,
                        debug,
                      }
                    )
                    .finally(() => {
                      activeRecursiveSubAgents.delete(recursiveSubAgent);
                    });
                })()
              : await createSimpleSubAgent().forward(
                  ai,
                  {
                    task: singleQuery,
                    ...(normalizedCtx !== undefined
                      ? { context: normalizedCtx }
                      : {}),
                  },
                  {
                    ...(parentForwardOptions as Partial<
                      Omit<AxProgramForwardOptions<string>, 'functions'>
                    >),
                    ...(recursionForwardOptions as Partial<
                      Omit<AxProgramForwardOptions<string>, 'functions'>
                    >),
                    abortSignal,
                    debug,
                  }
                );
            return normalizeSubAgentAnswer(recursiveResult.answer);
          } catch (err) {
            if (
              err instanceof AxAIServiceAbortedError ||
              err instanceof AxAgentClarificationError
            ) {
              throw err;
            }
            lastError = err;
            if (!isTransientError(err) || attempt >= maxAttempts - 1) {
              return formatSubAgentError(err);
            }
            const delay = Math.min(60_000, 1000 * Math.pow(2, attempt));
            await new Promise<void>((resolve, reject) => {
              let settled = false;
              let onAbort: (() => void) | undefined;

              const cleanup = () => {
                if (abortSignal && onAbort) {
                  abortSignal.removeEventListener('abort', onAbort);
                }
              };

              const onResolve = () => {
                if (settled) {
                  return;
                }
                settled = true;
                cleanup();
                resolve();
              };

              const timer = setTimeout(onResolve, delay);
              if (!abortSignal) {
                return;
              }

              onAbort = () => {
                if (settled) {
                  return;
                }
                settled = true;
                clearTimeout(timer);
                cleanup();
                reject(
                  new AxAIServiceAbortedError(
                    'rlm-llm-query-retry-backoff',
                    abortSignal.reason
                      ? String(abortSignal.reason)
                      : 'Aborted during retry backoff'
                  )
                );
              };

              if (abortSignal.aborted) {
                onAbort();
                return;
              }

              abortSignal.addEventListener('abort', onAbort, {
                once: true,
              });
            });
          }
        }

        return formatSubAgentError(lastError);
      };

      if (Array.isArray(queryOrQueries)) {
        const batchAbortController = new AbortController();
        const batchAbortSignal =
          mergeAbortSignals(
            effectiveAbortSignal,
            batchAbortController.signal
          ) ?? batchAbortController.signal;
        let terminalBatchError:
          | AxAgentClarificationError
          | AxAIServiceAbortedError
          | undefined;
        const onBatchAbort = () => {
          stopActiveRecursiveSubAgents();
        };
        batchAbortSignal.addEventListener('abort', onBatchAbort, {
          once: true,
        });

        try {
          return await runWithConcurrency(
            queryOrQueries,
            maxBatchedLlmQueryConcurrency,
            async (q) => {
              try {
                return await runSingleLlmQuery(
                  q.query,
                  q.context,
                  batchAbortSignal
                );
              } catch (err) {
                if (
                  err instanceof AxAIServiceAbortedError ||
                  err instanceof AxAgentClarificationError
                ) {
                  if (
                    err instanceof AxAgentClarificationError ||
                    !terminalBatchError
                  ) {
                    terminalBatchError = err;
                  }
                  if (!batchAbortController.signal.aborted) {
                    batchAbortController.abort(
                      err instanceof AxAgentClarificationError
                        ? 'Child clarification'
                        : err.message
                    );
                  }
                  throw terminalBatchError;
                }
                return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
              }
            },
            batchAbortSignal
          );
        } finally {
          batchAbortSignal.removeEventListener('abort', onBatchAbort);
        }
      }

      const result = await runSingleLlmQuery(query, ctx);
      if (llmQueryBudgetState.used === llmCallWarnThreshold) {
        return `${result}\n[WARNING] ${llmQueryBudgetState.used}/${maxSubAgentCalls} sub-queries used (${maxSubAgentCalls - llmQueryBudgetState.used} remaining). Consolidate remaining work.`;
      }
      return result;
    };

    const toolGlobals = this.buildRuntimeGlobals(
      effectiveAbortSignal,
      inputState.sharedFieldValues,
      ai,
      completionBindings.protocol,
      functionCallRecorder
    );
    const agentFunctionNamespaces = [
      ...new Set(this.agentFunctions.map((f) => f.namespace ?? 'utils')),
    ];
    const runtimeInputs = { ...inputState.currentInputs };
    const reservedTopLevelNames = new Set([
      'inputs',
      'llmQuery',
      DEFAULT_AGENT_MODULE_NAMESPACE,
      this.agentModuleNamespace,
      'final',
      'ask_clarification',
      ...agentFunctionNamespaces,
      ...(effectiveContextConfig.stateInspection.enabled
        ? ['inspect_runtime']
        : []),
      ...Object.keys(toolGlobals),
    ]);
    const runtimeAliasKeys = [
      ...new Set([
        ...Object.keys(runtimeInputs),
        ...inputState.signatureInputFieldNames,
      ]),
    ].filter((key) => !reservedTopLevelNames.has(key));
    const runtimeTopLevelInputAliases: Record<string, unknown> = {};
    for (const key of runtimeAliasKeys) {
      runtimeTopLevelInputAliases[key] = runtimeInputs[key];
    }

    const refreshRuntimeBindings = () => {
      for (const key of Object.keys(runtimeInputs)) {
        delete runtimeInputs[key];
      }
      for (const [key, value] of Object.entries(inputState.currentInputs)) {
        runtimeInputs[key] = value;
      }

      for (const key of runtimeAliasKeys) {
        runtimeTopLevelInputAliases[key] = inputState.currentInputs[key];
      }
    };

    const protectedRuntimeNames = [...reservedTopLevelNames];
    const inspectReservedNames = [
      ...reservedTopLevelNames,
      ...runtimeAliasKeys,
    ];
    const bootstrapReservedNames = new Set(inspectReservedNames);
    const bootstrapContext = this.runtimeBootstrapContext;
    this.runtimeBootstrapContext = undefined;
    const bootstrapGlobals = buildBootstrapRuntimeGlobals(
      bootstrapContext,
      bootstrapReservedNames
    );
    const bootstrapGlobalNames = new Set(Object.keys(bootstrapGlobals));
    const runtimeActionLogEntries = actionLogEntries ?? [];
    let session!: AxCodeSession;
    let inspectBaselineNames: string[] | undefined;
    const getInspectableSession = (runtimeSession: AxCodeSession) =>
      typeof runtimeSession.inspectGlobals === 'function'
        ? runtimeSession
        : undefined;

    const loadInspectBaselineNames = async (): Promise<string[]> => {
      try {
        const result = await session.execute(
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
        const inspectableSession = getInspectableSession(session);
        if (inspectableSession?.inspectGlobals) {
          return await inspectableSession.inspectGlobals({
            signal: effectiveAbortSignal,
            reservedNames: inspectReservedNames,
          });
        }

        const baselineNames = await ensureInspectBaselineNames();
        const code = buildInspectRuntimeCode(
          inspectReservedNames,
          baselineNames
        );
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames: inspectReservedNames,
        });
        return typeof result === 'string' ? result : String(result);
      } catch (err) {
        return `[inspect_runtime error: ${err instanceof Error ? err.message : String(err)}]`;
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
      return formatStructuredRuntimeState(
        structuredEntries,
        provenance,
        options
      );
    };

    const inspectRuntime = effectiveContextConfig.stateInspection.enabled
      ? async (): Promise<string> =>
          renderRuntimeState(await inspectRuntimeState())
      : undefined;

    const createSession = () => {
      inspectBaselineNames = undefined;
      return runtime.createSession({
        ...runtimeTopLevelInputAliases,
        inputs: runtimeInputs,
        ...bootstrapGlobals,
        llmQuery,
        final: completionBindings.finalFunction,
        ask_clarification: completionBindings.askClarificationFunction,
        ...(inspectRuntime ? { inspect_runtime: inspectRuntime } : {}),
        ...toolGlobals,
      });
    };

    session = createSession();

    const getRuntimeStateSummaryOptions = () => ({
      maxEntries:
        effectiveContextConfig.stateSummary.maxEntries &&
        effectiveContextConfig.stateSummary.maxEntries > 0
          ? effectiveContextConfig.stateSummary.maxEntries
          : 8,
      maxChars:
        effectiveContextConfig.stateSummary.maxChars &&
        effectiveContextConfig.stateSummary.maxChars > 0
          ? effectiveContextConfig.stateSummary.maxChars
          : undefined,
    });
    const getBootstrapContextSummaryOptions = () => ({
      maxEntries:
        effectiveContextConfig.stateSummary.maxEntries &&
        effectiveContextConfig.stateSummary.maxEntries > 0
          ? effectiveContextConfig.stateSummary.maxEntries
          : 6,
      maxChars:
        effectiveContextConfig.stateSummary.maxChars &&
        effectiveContextConfig.stateSummary.maxChars > 0
          ? effectiveContextConfig.stateSummary.maxChars
          : Math.min(maxRuntimeChars, 1_200),
    });
    const bootstrapContextSummary =
      Object.keys(bootstrapGlobals).length > 0
        ? formatBootstrapContextSummary(bootstrapGlobals, {
            ...getBootstrapContextSummaryOptions(),
            budgetRemaining: Math.max(
              0,
              maxSubAgentCalls - llmQueryBudgetState.used
            ),
            budgetTotal: maxSubAgentCalls,
          })
        : undefined;

    const waitForCompletionSignal = async (): Promise<void> => {
      if (completionState.payload) {
        return;
      }
      for (let i = 0; i < 3 && !completionState.payload; i++) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    };

    const captureRuntimeStateSummary = async (): Promise<
      string | undefined
    > => {
      if (!effectiveContextConfig.stateSummary.enabled) {
        return undefined;
      }

      const snapshot = await inspectRuntimeState();
      const formatted = renderRuntimeState(
        snapshot,
        getRuntimeStateSummaryOptions()
      );
      return formatted || '(no user variables)';
    };

    const getPatchableSession = (runtimeSession: AxCodeSession) => {
      if (typeof runtimeSession.patchGlobals !== 'function') {
        throw new Error(
          'AxCodeSession.patchGlobals() is required when restoring AxAgent state or using inputUpdateCallback'
        );
      }
      return runtimeSession;
    };

    const getSnapshotableSession = (runtimeSession: AxCodeSession) => {
      if (typeof runtimeSession.snapshotGlobals !== 'function') {
        throw new Error(
          'AxCodeSession.snapshotGlobals() is required to export AxAgent state'
        );
      }
      return runtimeSession as AxCodeSession & {
        snapshotGlobals: NonNullable<AxCodeSession['snapshotGlobals']>;
      };
    };

    const prepareRestoredState = (
      state: Readonly<AxAgentState>
    ): AxPreparedRestoredState => {
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
        checkpointState: state.checkpointState,
        provenance: { ...(state.provenance ?? {}) },
      };
    };

    const restoreRuntimeState = async (
      state: Readonly<AxAgentState>
    ): Promise<AxPreparedRestoredState> => {
      const preparedState = prepareRestoredState(state);
      const patchableSession = getPatchableSession(session);
      await patchableSession.patchGlobals(preparedState.runtimeBindings, {
        signal: effectiveAbortSignal,
      });
      return preparedState;
    };

    const exportRuntimeState = async (): Promise<AxAgentState> => {
      const snapshotableSession = getSnapshotableSession(session);
      const snapshot = await snapshotableSession.snapshotGlobals({
        signal: effectiveAbortSignal,
        reservedNames: inspectReservedNames,
      });
      const provenance = buildRuntimeStateProvenance(runtimeActionLogEntries);

      return {
        version: 1,
        runtimeBindings: snapshot.bindings,
        runtimeEntries: snapshot.entries,
        actionLogEntries: serializeAgentStateActionLogEntries(
          runtimeActionLogEntries
        ),
        provenance: runtimeStateProvenanceToRecord(provenance),
      };
    };

    const syncRuntimeInputsToSession = async (): Promise<void> => {
      refreshRuntimeBindings();

      const patchGlobals = async (targetSession: AxCodeSession) => {
        const patchableSession = getPatchableSession(targetSession);
        await patchableSession.patchGlobals(
          {
            inputs: { ...runtimeInputs },
            ...runtimeTopLevelInputAliases,
          },
          { signal: effectiveAbortSignal }
        );
      };

      try {
        await patchGlobals(session);
      } catch (err) {
        if (effectiveAbortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            'rlm-session',
            effectiveAbortSignal.reason ?? 'Aborted'
          );
        }
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.startsWith('Aborted'))
        ) {
          throw err;
        }
        if (isSessionClosedError(err)) {
          session = createSession();
          await patchGlobals(session);
          return;
        }
        throw new Error(
          `Failed to sync runtime inputs: ${formatInterpreterError(err, maxRuntimeChars)}`
        );
      }
    };

    const applyBootstrapRuntimeContext = async (): Promise<
      string | undefined
    > => {
      if (Object.keys(bootstrapGlobals).length === 0) {
        return undefined;
      }

      if (!effectiveContextConfig.stateSummary.enabled) {
        return undefined;
      }

      const snapshot = await inspectRuntimeState();
      const formatted = renderRuntimeState(
        snapshot,
        getRuntimeStateSummaryOptions()
      );
      return formatted || '(no user variables)';
    };

    const executeActorCode = async (
      code: string
    ): Promise<{ result: unknown; output: string; isError: boolean }> => {
      const completionOutput = {
        result: undefined,
        output: formatInterpreterOutput(undefined, maxRuntimeChars),
        isError: false,
      };

      try {
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames: protectedRuntimeNames,
        });
        if (completionState.payload) {
          return completionOutput;
        }
        if (
          hasCompletionSignalCall(code) &&
          looksLikePromisePlaceholder(result)
        ) {
          await waitForCompletionSignal();
          if (completionState.payload) {
            return completionOutput;
          }
        }
        return {
          result,
          output: formatInterpreterOutput(result, maxRuntimeChars),
          isError: false,
        };
      } catch (err) {
        if (
          err instanceof AxAgentProtocolCompletionSignal ||
          completionState.payload
        ) {
          return completionOutput;
        }
        if (
          err instanceof AxAgentClarificationError ||
          err instanceof AxAIServiceAbortedError
        ) {
          throw err;
        }
        if (effectiveAbortSignal?.aborted) {
          throw new AxAIServiceAbortedError(
            'rlm-session',
            effectiveAbortSignal.reason ?? 'Aborted'
          );
        }
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.startsWith('Aborted'))
        ) {
          throw err;
        }
        if (isExecutionTimedOutError(err)) {
          return {
            result: undefined,
            output: truncateText(
              `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterError(err, maxRuntimeChars)}`,
              maxRuntimeChars
            ),
            isError: true,
          };
        }
        if (isSessionClosedError(err)) {
          try {
            session = createSession();
            completionState.payload = undefined;
            const retryResult = await session.execute(code, {
              signal: effectiveAbortSignal,
              reservedNames: protectedRuntimeNames,
            });
            return {
              result: retryResult,
              output: truncateText(
                `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterOutput(retryResult, maxRuntimeChars)}`,
                maxRuntimeChars
              ),
              isError: false,
            };
          } catch (retryErr) {
            if (
              retryErr instanceof AxAgentClarificationError ||
              retryErr instanceof AxAIServiceAbortedError
            ) {
              throw retryErr;
            }
            return {
              result: undefined,
              output: truncateText(
                `${RUNTIME_RESTART_NOTICE}\n${formatInterpreterError(retryErr, maxRuntimeChars)}`,
                maxRuntimeChars
              ),
              isError: true,
            };
          }
        }
        return {
          result: undefined,
          output: truncateText(
            formatInterpreterError(err, maxRuntimeChars),
            maxRuntimeChars
          ),
          isError: true,
        };
      }
    };

    const executeTestCode = async (
      code: string
    ): Promise<AxAgentTestResult> => {
      try {
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames: protectedRuntimeNames,
        });
        if (
          hasCompletionSignalCall(code) &&
          looksLikePromisePlaceholder(result)
        ) {
          await waitForCompletionSignal();
        }
        if (completionState.payload) {
          return completionState.payload;
        }
        const output = formatInterpreterOutput(result, maxRuntimeChars);
        if (isLikelyRuntimeErrorOutput(output)) {
          throw new Error(output);
        }
        return output;
      } catch (err) {
        if (
          err instanceof AxAgentProtocolCompletionSignal ||
          completionState.payload
        ) {
          if (completionState.payload) {
            return completionState.payload;
          }
        }
        throw err;
      }
    };

    return {
      effectiveContextConfig,
      bootstrapContextSummary,
      applyBootstrapRuntimeContext,
      captureRuntimeStateSummary,
      exportRuntimeState,
      restoreRuntimeState,
      syncRuntimeInputsToSession,
      executeActorCode,
      executeTestCode,
      close: () => {
        session.close();
      },
    };
  }

  public getExcludedAgents(): readonly string[] {
    return this.excludedAgents;
  }

  public getExcludedAgentFunctions(): readonly string[] {
    return this.excludedAgentFunctions;
  }

  public getSignature(): AxSignature {
    return this.program.getSignature();
  }

  public async test(
    code: string,
    values?: Partial<IN>,
    options?: Readonly<{
      ai?: AxAIService;
      abortSignal?: AbortSignal;
      debug?: boolean;
    }>
  ): Promise<AxAgentTestResult> {
    const ai = this.ai ?? options?.ai;
    const debug =
      options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;
    const inputState = this._createRuntimeInputState(values ?? {}, {
      allowedFieldNames: this.rlmConfig.contextFields,
      validateInputKeys: true,
    });
    inputState.recomputeTurnInputs(false);

    const completionState: AxAgentRuntimeCompletionState = {
      payload: undefined,
    };
    const completionBindings = createCompletionBindings((type, args) => {
      completionState.payload = normalizeCompletionPayload(type, args);
    });
    const createdBudgetState = this._ensureLlmQueryBudgetState();

    const runtimeContext = this._createRuntimeExecutionContext({
      ai,
      inputState,
      options: undefined,
      effectiveAbortSignal: options?.abortSignal,
      debug,
      completionState,
      completionBindings,
      actionLogEntries: [],
    });

    try {
      return await runtimeContext.executeTestCode(code);
    } finally {
      if (createdBudgetState) {
        this.llmQueryBudgetState = undefined;
      }
      runtimeContext.close();
    }
  }

  public setSignature(
    signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>
  ) {
    const nextSignature = new AxSignature(signature);
    this._validateConfiguredSignature(nextSignature);

    const previousSignature = this.program.getSignature();
    try {
      this.program.setSignature(nextSignature);
      this._buildSplitPrograms();
      if (this.func) {
        this.func.parameters = this._buildFuncParameters();
      }
    } catch (err) {
      this.program.setSignature(previousSignature);
      this._buildSplitPrograms();
      if (this.func) {
        this.func.parameters = this._buildFuncParameters();
      }
      throw err;
    }
  }

  public applyOptimization(optimizedProgram: any): void {
    (this.program as any).applyOptimization?.(optimizedProgram);
  }

  // ----- Forward (split architecture) -----

  /**
   * Runs the Actor loop: sets up the runtime session, executes code iteratively,
   * and returns the state needed by the Responder. Closes the session before returning.
   */
  private async _runActorLoop(
    ai: AxAIService,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions<string>> | undefined,
    effectiveAbortSignal: AbortSignal | undefined,
    functionCallRecords?: AxAgentEvalFunctionCall[]
  ): Promise<{
    nonContextValues: Record<string, unknown>;
    contextMetadata: string;
    actionLog: string;
    actorResult: AxAgentActorResultPayload;
    actorFieldValues: Record<string, unknown>;
    turnCount: number;
  }> {
    const rlm = this.rlmConfig;
    const debug =
      options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;
    const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

    const inputState = this._createRuntimeInputState(values);
    inputState.recomputeTurnInputs(false);

    const completionState: AxAgentRuntimeCompletionState = {
      payload: undefined,
    };
    const completionBindings = createCompletionBindings((type, args) => {
      completionState.payload = normalizeCompletionPayload(type, args);
    });
    const actionLogEntries: ActionLogEntry[] = [];
    let runtimeStateSummary: string | undefined;
    const runtimeContext = this._createRuntimeExecutionContext({
      ai,
      inputState,
      options,
      effectiveAbortSignal,
      debug,
      completionState,
      completionBindings,
      actionLogEntries,
      functionCallRecorder: functionCallRecords
        ? (call) => {
            functionCallRecords.push(call);
          }
        : undefined,
    });
    const delegatedContextSummary = runtimeContext.effectiveContextConfig
      .stateSummary.enabled
      ? undefined
      : runtimeContext.bootstrapContextSummary;

    const applyInputUpdateCallback = async () => {
      if (!this.inputUpdateCallback) {
        return;
      }
      const patch = await this.inputUpdateCallback({
        ...(inputState.currentInputs as IN),
      } as Readonly<IN>);
      if (patch === undefined) {
        return;
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error(
          'inputUpdateCallback must return an object patch or undefined'
        );
      }
      for (const [key, value] of Object.entries(
        patch as Record<string, unknown>
      )) {
        if (inputState.signatureInputFieldNames.has(key)) {
          inputState.currentInputs[key] = value;
        }
      }
    };

    const actorMergedOptions = {
      ...this._genOptions,
      ...this.actorForwardOptions,
      ...options,
      debug,
      abortSignal: effectiveAbortSignal,
    };

    const actorFieldValues: Record<string, unknown> = {};
    const contextThreshold = runtimeContext.effectiveContextConfig
      .stateInspection.enabled
      ? runtimeContext.effectiveContextConfig.stateInspection.contextThreshold
      : undefined;
    const summaryForwardOptions = buildInternalSummaryRequestOptions(
      options,
      debug,
      effectiveAbortSignal
    );
    const shouldPruneUsedDocs =
      this.functionDiscoveryEnabled &&
      runtimeContext.effectiveContextConfig.pruneUsedDocs;
    let checkpointState: CheckpointSummaryState | undefined;
    let restoreNotice: string | undefined;

    const getPromptFacingEntries = () =>
      getPromptFacingActionLogEntries(actionLogEntries, {
        pruneUsedDocs: shouldPruneUsedDocs,
      });

    const renderActionLog = () =>
      buildActionLogWithPolicy(getPromptFacingEntries(), {
        actionReplay: runtimeContext.effectiveContextConfig.actionReplay,
        recentFullActions:
          runtimeContext.effectiveContextConfig.recentFullActions,
        restoreNotice,
        delegatedContextSummary,
        stateSummary: runtimeStateSummary,
        checkpointSummary: checkpointState?.summary,
        checkpointTurns: checkpointState?.turns,
      }) || '(no actions yet)';

    const refreshCheckpointSummary = async () => {
      if (!runtimeContext.effectiveContextConfig.checkpoints.enabled) {
        checkpointState = undefined;
        return;
      }

      const replayPlan = buildActionLogReplayPlan(actionLogEntries, {
        actionReplay: runtimeContext.effectiveContextConfig.actionReplay,
        recentFullActions:
          runtimeContext.effectiveContextConfig.recentFullActions,
        pruneUsedDocs: shouldPruneUsedDocs,
      });

      const triggerChars =
        runtimeContext.effectiveContextConfig.checkpoints.triggerChars;
      if (!triggerChars || replayPlan.historyChars <= triggerChars) {
        checkpointState = undefined;
        return;
      }

      const checkpointEntries = replayPlan.checkpointEntries;
      if (checkpointEntries.length === 0) {
        checkpointState = undefined;
        return;
      }

      const fingerprint = JSON.stringify(
        checkpointEntries.map((entry) => ({
          turn: entry.turn,
          code: entry.code,
          output: entry.output,
          actorFieldsOutput: entry.actorFieldsOutput,
          tags: entry.tags,
          tombstone: entry.tombstone,
        }))
      );

      if (checkpointState?.fingerprint === fingerprint) {
        return;
      }

      checkpointState = {
        fingerprint,
        turns: checkpointEntries.map((entry) => entry.turn),
        summary: await generateCheckpointSummaryAsync(
          ai,
          runtimeContext.effectiveContextConfig.summarizerOptions,
          summaryForwardOptions,
          checkpointEntries
        ),
      };
    };

    try {
      if (this.state) {
        const restoredState = await runtimeContext.restoreRuntimeState(
          this.state
        );
        const shouldRenderRestoredRuntimeState =
          runtimeContext.effectiveContextConfig.stateSummary.enabled;
        actionLogEntries.push(...restoredState.actionLogEntries);
        checkpointState = restoredState.checkpointState
          ? {
              fingerprint: restoredState.checkpointState.fingerprint,
              turns: [...restoredState.checkpointState.turns],
              summary: restoredState.checkpointState.summary,
            }
          : undefined;
        const restoredProvenance = mergeRuntimeStateProvenance(
          buildRuntimeStateProvenance(actionLogEntries),
          runtimeStateProvenanceFromRecord(restoredState.provenance)
        );
        runtimeStateSummary = shouldRenderRestoredRuntimeState
          ? formatStructuredRuntimeState(
              restoredState.runtimeEntries,
              restoredProvenance,
              {
                maxEntries:
                  runtimeContext.effectiveContextConfig.stateSummary
                    .maxEntries &&
                  runtimeContext.effectiveContextConfig.stateSummary
                    .maxEntries > 0
                    ? runtimeContext.effectiveContextConfig.stateSummary
                        .maxEntries
                    : 8,
                maxChars:
                  runtimeContext.effectiveContextConfig.stateSummary.maxChars &&
                  runtimeContext.effectiveContextConfig.stateSummary.maxChars >
                    0
                    ? runtimeContext.effectiveContextConfig.stateSummary
                        .maxChars
                    : 1_200,
              }
            ) || '(no user variables)'
          : undefined;
        restoreNotice = buildRuntimeRestoreNotice(
          restoredState.runtimeEntries,
          {
            includeLiveRuntimeState: shouldRenderRestoredRuntimeState,
          }
        );
      }

      const bootstrappedRuntimeState =
        await runtimeContext.applyBootstrapRuntimeContext();
      if (bootstrappedRuntimeState !== undefined) {
        runtimeStateSummary = bootstrappedRuntimeState;
      }

      for (let turn = 0; turn < maxTurns; turn++) {
        await applyInputUpdateCallback();
        inputState.recomputeTurnInputs(true);
        await refreshCheckpointSummary();

        let actionLogText = renderActionLog();
        const replayPlan = buildActionLogReplayPlan(actionLogEntries, {
          actionReplay: runtimeContext.effectiveContextConfig.actionReplay,
          recentFullActions:
            runtimeContext.effectiveContextConfig.recentFullActions,
          pruneUsedDocs: shouldPruneUsedDocs,
          checkpointTurns: checkpointState?.turns,
        });
        if (contextThreshold && replayPlan.historyChars > contextThreshold) {
          actionLogText +=
            '\n\n[HINT: Action log is large. Call `const state = await inspect_runtime()` for a compact snapshot of current variables instead of re-reading old outputs.]';
        }

        const actorResult = await this.actorProgram.forward(
          ai,
          {
            ...inputState.getNonContextValues(),
            ...inputState.getActorInlineContextValues(),
            contextMetadata: inputState.getContextMetadata(),
            actionLog: actionLogText,
          },
          actorMergedOptions
        );

        if (turn === 0) {
          actorMergedOptions.debugHideSystemPrompt = true;
          restoreNotice = undefined;
        }

        let code = actorResult.javascriptCode as string | undefined;
        const trimmedCode = code?.trim();
        if (!code || !trimmedCode) {
          break;
        }
        code = normalizeActorJavascriptCode(trimmedCode);
        actorResult.javascriptCode = code;

        for (const fieldName of this.actorFieldNames) {
          if (fieldName in actorResult) {
            actorFieldValues[fieldName] = actorResult[fieldName];
          }
        }

        let actorFieldsOutput = '';
        if (this.actorFieldNames.length > 0) {
          const fieldEntries = this.actorFieldNames
            .filter((name) => name in actorResult)
            .map((name) => `${name}: ${actorResult[name]}`)
            .join('\n');
          if (fieldEntries) {
            actorFieldsOutput = `\nActor fields:\n${fieldEntries}`;
          }
        }

        completionState.payload = undefined;

        if (this.enforceIncrementalConsoleTurns) {
          const policyViolation = validateActorTurnCodePolicy(code);
          if (policyViolation) {
            const entryTurn = actionLogEntries.length + 1;
            actionLogEntries.push({
              turn: entryTurn,
              code,
              output: policyViolation,
              actorFieldsOutput,
              tags: ['error'],
            });

            if (rlm.actorTurnCallback) {
              await rlm.actorTurnCallback({
                turn: entryTurn,
                actorResult: actorResult as Record<string, unknown>,
                code,
                result: undefined,
                output: policyViolation,
                isError: true,
                thought:
                  typeof actorResult.thought === 'string'
                    ? actorResult.thought
                    : undefined,
              });
            }

            await manageContext(
              actionLogEntries,
              actionLogEntries.length - 1,
              runtimeContext.effectiveContextConfig,
              ai,
              summaryForwardOptions
            );
            await refreshCheckpointSummary();
            continue;
          }
        }

        if (this.inputUpdateCallback) {
          await runtimeContext.syncRuntimeInputsToSession();
        }
        let result: unknown;
        let output: string;
        let isError: boolean;

        try {
          const executionResult = await runtimeContext.executeActorCode(code);
          result = executionResult.result;
          output = executionResult.output;
          isError = executionResult.isError;
        } catch (err) {
          if (
            err instanceof AxAgentClarificationError ||
            err instanceof AxAIServiceAbortedError
          ) {
            if (rlm.actorTurnCallback) {
              await rlm.actorTurnCallback({
                turn: actionLogEntries.length + 1,
                actorResult: actorResult as Record<string, unknown>,
                code,
                result: undefined,
                output: formatBubbledActorTurnOutput(
                  err,
                  rlm.maxRuntimeChars ?? DEFAULT_RLM_MAX_RUNTIME_CHARS
                ),
                isError: err instanceof AxAIServiceAbortedError,
                thought:
                  typeof actorResult.thought === 'string'
                    ? actorResult.thought
                    : undefined,
              });
            }
          }
          throw err;
        }

        const entryTurn = actionLogEntries.length + 1;
        actionLogEntries.push({
          turn: entryTurn,
          code,
          output,
          actorFieldsOutput,
          tags: isError ? ['error'] : [],
        });

        if (rlm.actorTurnCallback) {
          await rlm.actorTurnCallback({
            turn: entryTurn,
            actorResult: actorResult as Record<string, unknown>,
            code,
            result,
            output,
            isError,
            thought:
              typeof actorResult.thought === 'string'
                ? actorResult.thought
                : undefined,
          });
        }

        await manageContext(
          actionLogEntries,
          actionLogEntries.length - 1,
          runtimeContext.effectiveContextConfig,
          ai,
          summaryForwardOptions
        );
        if (!isError) {
          runtimeStateSummary =
            await runtimeContext.captureRuntimeStateSummary();
        }
        await refreshCheckpointSummary();

        if (completionState.payload) {
          break;
        }
      }
      await refreshCheckpointSummary();

      try {
        const nextState = await runtimeContext.exportRuntimeState();
        nextState.checkpointState = checkpointState
          ? {
              fingerprint: checkpointState.fingerprint,
              turns: [...checkpointState.turns],
              summary: checkpointState.summary,
            }
          : undefined;
        this.state = nextState;
        this.stateError = undefined;
      } catch (err) {
        this.state = undefined;
        this.stateError =
          err instanceof Error
            ? err.message
            : `Failed to export AxAgent state: ${String(err)}`;
      }
    } finally {
      try {
        runtimeContext.close();
      } catch {
        // Ignore close errors
      }
    }

    const actorResult =
      completionState.payload ??
      ({
        type: 'final',
        args: [
          buildActionEvidenceSummary(actionLogEntries, {
            stateSummary: runtimeStateSummary,
            checkpointSummary: checkpointState?.summary,
            checkpointTurns: checkpointState?.turns,
            pruneUsedDocs: shouldPruneUsedDocs,
          }),
        ],
      } satisfies AxAgentActorResultPayload);

    return {
      nonContextValues: inputState.getNonContextValues(),
      contextMetadata: inputState.getContextMetadata(),
      actionLog: renderActionLog(),
      actorResult,
      actorFieldValues,
      turnCount: actionLogEntries.length,
    };
  }

  public async forward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    const abortController = new AbortController();
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );

    this.activeAbortControllers.add(abortController);
    const createdBudgetState = this._ensureLlmQueryBudgetState();
    try {
      const ai = this.ai ?? parentAi;

      const debug =
        options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;

      const { nonContextValues, actorResult, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

      if (actorResult.type === 'ask_clarification') {
        throw new AxAgentClarificationError(
          actorResult.args[0] as AxAgentClarification,
          {
            state: this.state,
            stateError: this.stateError,
          }
        );
      }

      const responderMergedOptions = {
        ...this._genOptions,
        ...this.responderForwardOptions,
        ...options,
        debug,
        abortSignal: effectiveAbortSignal,
        maxSteps: 1,
      };

      const responderResult = await this.responderProgram.forward(
        ai,
        {
          ...nonContextValues,
          contextData: actorResult,
        },
        responderMergedOptions
      );

      return { ...responderResult, ...actorFieldValues } as OUT;
    } finally {
      if (createdBudgetState) {
        this.llmQueryBudgetState = undefined;
      }
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    const abortController = new AbortController();
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );

    this.activeAbortControllers.add(abortController);
    const createdBudgetState = this._ensureLlmQueryBudgetState();
    try {
      const ai = this.ai ?? parentAi;

      const debug =
        options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;

      // Actor loop runs non-streaming
      const { nonContextValues, actorResult, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

      if (actorResult.type === 'ask_clarification') {
        throw new AxAgentClarificationError(
          actorResult.args[0] as AxAgentClarification,
          {
            state: this.state,
            stateError: this.stateError,
          }
        );
      }

      const responderMergedOptions = {
        ...this._genOptions,
        ...this.responderForwardOptions,
        ...options,
        debug,
        abortSignal: effectiveAbortSignal,
        maxSteps: 1,
      };

      // Stream the Responder output
      for await (const delta of this.responderProgram.streamingForward(
        ai,
        {
          ...nonContextValues,
          contextData: actorResult,
        },
        responderMergedOptions
      )) {
        yield delta;
      }

      // Yield actorFieldValues as a final delta
      if (Object.keys(actorFieldValues).length > 0) {
        yield {
          version: 1,
          index: 0,
          delta: actorFieldValues as Partial<OUT>,
        };
      }
    } finally {
      if (createdBudgetState) {
        this.llmQueryBudgetState = undefined;
      }
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  /**
   * Wraps an AxFunction as an async callable that handles both
   * named ({ key: val }) and positional (val1, val2) argument styles.
   */
  private static wrapFunction(
    fn: AxFunction,
    abortSignal?: AbortSignal,
    ai?: AxAIService,
    protocol?: AxAgentCompletionProtocol,
    qualifiedName?: string,
    functionCallRecorder?: AxAgentFunctionCallRecorder
  ): (...args: unknown[]) => Promise<unknown> {
    return async (...args: unknown[]) => {
      let callArgs: Record<string, unknown>;

      if (
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null &&
        !Array.isArray(args[0])
      ) {
        callArgs = args[0] as Record<string, unknown>;
      } else {
        const paramNames = fn.parameters?.properties
          ? Object.keys(fn.parameters.properties)
          : [];
        callArgs = {};
        paramNames.forEach((name, i) => {
          if (i < args.length) {
            callArgs[name] = args[i];
          }
        });
      }

      try {
        const result = await fn.func(callArgs, { abortSignal, ai, protocol });
        functionCallRecorder?.({
          qualifiedName: qualifiedName ?? fn.name,
          name: fn.name,
          arguments: serializeForEval(callArgs),
          result: serializeForEval(result),
        });
        return result;
      } catch (err) {
        functionCallRecorder?.({
          qualifiedName: qualifiedName ?? fn.name,
          name: fn.name,
          arguments: serializeForEval(callArgs),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
  }

  /**
   * Wraps an AxFunction with automatic shared field injection.
   * Shared field values are merged into call args (caller-provided args take precedence).
   */
  private static wrapFunctionWithSharedFields(
    fn: AxFunction,
    abortSignal?: AbortSignal,
    sharedFieldValues?:
      | Record<string, unknown>
      | (() => Record<string, unknown>),
    ai?: AxAIService,
    protocol?: AxAgentCompletionProtocol,
    qualifiedName?: string,
    functionCallRecorder?: AxAgentFunctionCallRecorder
  ): (...args: unknown[]) => Promise<unknown> {
    if (
      typeof sharedFieldValues !== 'function' &&
      (!sharedFieldValues || Object.keys(sharedFieldValues).length === 0)
    ) {
      return AxAgent.wrapFunction(
        fn,
        abortSignal,
        ai,
        protocol,
        qualifiedName,
        functionCallRecorder
      );
    }
    return async (...args: unknown[]) => {
      let callArgs: Record<string, unknown>;

      if (
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null &&
        !Array.isArray(args[0])
      ) {
        callArgs = args[0] as Record<string, unknown>;
      } else {
        const paramNames = fn.parameters?.properties
          ? Object.keys(fn.parameters.properties)
          : [];
        callArgs = {};
        paramNames.forEach((name, i) => {
          if (i < args.length) {
            callArgs[name] = args[i];
          }
        });
      }

      const currentSharedFieldValues =
        typeof sharedFieldValues === 'function'
          ? sharedFieldValues()
          : sharedFieldValues;

      // Merge shared fields (caller-provided args take precedence)
      const merged = currentSharedFieldValues
        ? { ...currentSharedFieldValues, ...callArgs }
        : callArgs;
      try {
        const result = await fn.func(merged, { abortSignal, ai, protocol });
        functionCallRecorder?.({
          qualifiedName: qualifiedName ?? fn.name,
          name: fn.name,
          arguments: serializeForEval(merged),
          result: serializeForEval(result),
        });
        return result;
      } catch (err) {
        functionCallRecorder?.({
          qualifiedName: qualifiedName ?? fn.name,
          name: fn.name,
          arguments: serializeForEval(merged),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
  }

  /**
   * Wraps agent functions under namespaced globals and child agents under
   * a configurable `<module>.*` namespace for the JS runtime session.
   */
  private buildRuntimeGlobals(
    abortSignal?: AbortSignal,
    sharedFieldValues?: Record<string, unknown>,
    ai?: AxAIService,
    protocol?: AxAgentCompletionProtocol,
    functionCallRecorder?: AxAgentFunctionCallRecorder
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = {};
    const callableLookup = new Map<string, DiscoveryCallableMeta>();
    const moduleLookup = new Map<string, string[]>();
    const moduleMetaLookup = new Map<string, AxAgentFunctionModuleMeta>();
    for (const [namespace, meta] of this.agentFunctionModuleMetadata) {
      moduleMetaLookup.set(namespace, meta);
    }
    const registerCallable = (
      meta: DiscoveryCallableMeta,
      qualifiedName: string
    ) => {
      callableLookup.set(qualifiedName, meta);
      if (!moduleLookup.has(meta.module)) {
        moduleLookup.set(meta.module, []);
      }
      moduleLookup.get(meta.module)?.push(qualifiedName);
    };

    // Agent functions under namespace.* (e.g. utils.myFn, custom.otherFn)
    for (const agentFn of this.agentFunctions) {
      const ns = agentFn.namespace ?? 'utils';
      if (!globals[ns] || typeof globals[ns] !== 'object') {
        globals[ns] = {};
      }
      const qualifiedName = `${ns}.${agentFn.name}`;
      (globals[ns] as Record<string, unknown>)[agentFn.name] =
        AxAgent.wrapFunction(
          agentFn,
          abortSignal,
          ai,
          protocol,
          qualifiedName,
          functionCallRecorder
        );
      registerCallable(
        {
          module: ns,
          name: agentFn.name,
          description: agentFn.description,
          parameters: agentFn.parameters,
          returns: agentFn.returns,
          examples: agentFn.examples,
        },
        qualifiedName
      );
    }

    // Child agents under <module>.* namespace
    if (this.agents && this.agents.length > 0) {
      const agentsObj: Record<string, unknown> = {};
      for (const agent of this.agents) {
        const fn = agent.getFunction();

        // Determine which shared fields this agent accepts
        const excluded = new Set(agent.getExcludedSharedFields?.() ?? []);
        const getApplicableSharedFields = (): Record<string, unknown> => {
          const applicable: Record<string, unknown> = {};
          if (sharedFieldValues) {
            for (const [k, v] of Object.entries(sharedFieldValues)) {
              if (!excluded.has(k)) {
                applicable[k] = v;
              }
            }
          }
          return applicable;
        };

        const qualifiedName = `${this.agentModuleNamespace}.${fn.name}`;
        agentsObj[fn.name] = AxAgent.wrapFunctionWithSharedFields(
          fn,
          abortSignal,
          getApplicableSharedFields,
          ai,
          protocol,
          qualifiedName,
          functionCallRecorder
        );
        registerCallable(
          {
            module: this.agentModuleNamespace,
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
          },
          qualifiedName
        );
      }
      globals[this.agentModuleNamespace] = agentsObj;
    }

    if (this.functionDiscoveryEnabled) {
      globals[DISCOVERY_LIST_MODULE_FUNCTIONS_NAME] = async (
        modulesInput: unknown
      ): Promise<string> => {
        const modules = normalizeDiscoveryStringInput(modulesInput, 'modules');
        return renderDiscoveryModuleListMarkdown(
          modules,
          moduleLookup,
          moduleMetaLookup
        );
      };

      globals[DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME] = async (
        functionsInput: unknown
      ): Promise<string> => {
        const items = normalizeDiscoveryStringInput(
          functionsInput,
          'functions'
        );
        return renderDiscoveryFunctionDefinitionsMarkdown(
          items,
          callableLookup
        );
      };
    }

    return globals;
  }

  /**
   * Returns options compatible with AxGen (strips agent-specific grouped options).
   */
  private get _genOptions(): Record<string, unknown> {
    if (!this.options) return {};
    const {
      agents: _a,
      fields: _f,
      functions: _fn,
      judgeOptions: _jo,
      inputUpdateCallback: _iuc,
      ...rest
    } = this.options;
    return rest;
  }

  /**
   * Builds the clean AxFunction parameters schema: input fields only, with any
   * parent-injected shared fields stripped out (they are auto-injected at runtime).
   */
  private _buildFuncParameters(): AxFunctionJSONSchema {
    const schema = this.program.getSignature().toInputJSONSchema();
    return this._parentSharedFields.size > 0
      ? stripSchemaProperties(schema, this._parentSharedFields)
      : schema;
  }
}

// ----- Factory Function -----

function normalizeCompletionPayload(
  type: AxAgentActorResultPayload['type'],
  args: unknown[]
): AxAgentActorResultPayload {
  if (args.length === 0) {
    throw new Error(`${type}() requires at least one argument`);
  }

  if (type === 'ask_clarification') {
    if (args.length !== 1) {
      throw new Error('ask_clarification() requires exactly one argument');
    }

    return {
      type,
      args: [normalizeClarificationPayload(args[0])],
    };
  }

  return { type, args };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeClarificationChoice(
  choice: unknown
): AxAgentClarificationChoice {
  if (isNonEmptyString(choice)) {
    return choice;
  }

  if (!isPlainObject(choice)) {
    throw new Error(
      'ask_clarification() choice entries must be non-empty strings or objects with a non-empty label'
    );
  }

  if (!isNonEmptyString(choice.label)) {
    throw new Error(
      'ask_clarification() choice objects require a non-empty label'
    );
  }

  if (choice.value !== undefined && !isNonEmptyString(choice.value)) {
    throw new Error(
      'ask_clarification() choice object values must be non-empty strings'
    );
  }

  return {
    label: choice.label,
    ...(choice.value !== undefined ? { value: choice.value } : {}),
  };
}

function normalizeClarificationPayload(payload: unknown): AxAgentClarification {
  if (isNonEmptyString(payload)) {
    return payload;
  }

  if (!isPlainObject(payload)) {
    throw new Error(
      'ask_clarification() requires a non-empty string or an object payload'
    );
  }

  if (!isNonEmptyString(payload.question)) {
    throw new Error(
      'ask_clarification() object payload requires a non-empty question'
    );
  }

  const allowedTypes = new Set<AxAgentClarificationKind>([
    'text',
    'number',
    'date',
    'single_choice',
    'multiple_choice',
  ]);

  let normalizedType: AxAgentClarificationKind | undefined;
  if (payload.type === undefined) {
    normalizedType =
      Array.isArray(payload.choices) && payload.choices.length > 0
        ? 'single_choice'
        : undefined;
  } else {
    if (
      typeof payload.type !== 'string' ||
      !allowedTypes.has(payload.type as AxAgentClarificationKind)
    ) {
      throw new Error(
        'ask_clarification() object payload type must be one of: text, number, date, single_choice, multiple_choice'
      );
    }
    normalizedType = payload.type as AxAgentClarificationKind;
  }

  const wantsChoices =
    normalizedType === 'single_choice' || normalizedType === 'multiple_choice';
  const rawChoices = payload.choices;
  if (rawChoices !== undefined) {
    if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
      throw new Error(
        'ask_clarification() choices must be a non-empty array when provided'
      );
    }
  } else if (wantsChoices) {
    throw new Error(
      'ask_clarification() choice payloads require a non-empty choices array'
    );
  }

  return {
    ...payload,
    question: payload.question,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(rawChoices
      ? {
          choices: rawChoices.map(normalizeClarificationChoice),
        }
      : {}),
  };
}

function normalizeClarificationForError(
  clarification: AxAgentClarification
): AxAgentStructuredClarification {
  const normalized = normalizeClarificationPayload(clarification);
  if (typeof normalized === 'string') {
    return {
      question: normalized,
      type: 'text',
    };
  }

  return {
    ...normalized,
    type:
      normalized.type ??
      (normalized.choices && normalized.choices.length > 0
        ? 'single_choice'
        : 'text'),
  };
}

function cloneStructured<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSafeBootstrapGlobalName(
  name: string,
  reservedNames: ReadonlySet<string>
): boolean {
  return (
    !reservedNames.has(name) &&
    !UNSAFE_BOOTSTRAP_GLOBAL_NAMES.has(name) &&
    SAFE_BOOTSTRAP_GLOBAL_IDENTIFIER.test(name)
  );
}

function buildBootstrapRuntimeGlobals(
  context: unknown,
  reservedNames: ReadonlySet<string>
): Record<string, unknown> {
  if (context === undefined) {
    return {};
  }

  const globals: Record<string, unknown> = {
    context,
  };

  if (!isPlainObject(context)) {
    return globals;
  }

  for (const [key, value] of Object.entries(context)) {
    if (!isSafeBootstrapGlobalName(key, reservedNames)) {
      continue;
    }
    globals[key] = value;
  }

  return globals;
}

function describeBootstrapRuntimeValue(value: unknown): {
  type: string;
  ctor?: string;
} {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { type: 'array', ctor: 'Array' };
  }
  if (value instanceof Map) {
    return { type: 'map', ctor: 'Map' };
  }
  if (value instanceof Set) {
    return { type: 'set', ctor: 'Set' };
  }
  if (value instanceof Date) {
    return { type: 'date', ctor: 'Date' };
  }
  if (value instanceof Error) {
    return {
      type: 'error',
      ctor:
        typeof value.name === 'string' && value.name.trim()
          ? value.name
          : 'Error',
    };
  }

  const type = typeof value;
  if (type !== 'object') {
    return { type };
  }

  const ctor =
    value &&
    (value as { constructor?: { name?: unknown } }).constructor &&
    typeof (value as { constructor?: { name?: unknown } }).constructor?.name ===
      'string'
      ? (value as { constructor?: { name: string } }).constructor?.name
      : undefined;

  return { type: 'object', ctor };
}

function previewBootstrapRuntimeAtom(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }

  const valueType = typeof value;
  if (valueType === 'string') {
    return JSON.stringify(truncateToCharBudget(value as string, 40));
  }
  if (
    valueType === 'number' ||
    valueType === 'boolean' ||
    valueType === 'bigint'
  ) {
    return String(value);
  }
  if (valueType === 'symbol') {
    return String(value);
  }
  if (valueType === 'function') {
    return `[function ${(value as { name?: string }).name || 'anonymous'}]`;
  }
  if (Array.isArray(value)) {
    return `[array(${value.length})]`;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? value.toISOString()
      : String(value);
  }
  if (value instanceof Error) {
    return `${value.name || 'Error'}: ${value.message || ''}`;
  }
  if (value instanceof Map) {
    return `[map(${value.size})]`;
  }
  if (value instanceof Set) {
    return `[set(${value.size})]`;
  }

  const ctorName =
    value &&
    (value as { constructor?: { name?: unknown } }).constructor &&
    typeof (value as { constructor?: { name?: unknown } }).constructor?.name ===
      'string'
      ? (value as { constructor?: { name: string } }).constructor?.name
      : '';
  return ctorName && ctorName !== 'Object' ? `[${ctorName}]` : '[object]';
}

function previewBootstrapRuntimeValue(
  value: unknown,
  type: string,
  ctor?: string
): string {
  if (type === 'array' && Array.isArray(value)) {
    const items = value
      .slice(0, 3)
      .map((item) => previewBootstrapRuntimeAtom(item));
    return `[${items.join(', ')}${value.length > 3 ? ', ...' : ''}]`;
  }
  if (type === 'map' && value instanceof Map) {
    const items = [...value.entries()]
      .slice(0, 3)
      .map(
        ([key, item]) =>
          `${previewBootstrapRuntimeAtom(key)} => ${previewBootstrapRuntimeAtom(item)}`
      );
    return `Map(${value.size}) {${items.join(', ')}${value.size > 3 ? ', ...' : ''}}`;
  }
  if (type === 'set' && value instanceof Set) {
    const items = [...value.values()]
      .slice(0, 5)
      .map((item) => previewBootstrapRuntimeAtom(item));
    return `Set(${value.size}) {${items.join(', ')}${value.size > 5 ? ', ...' : ''}}`;
  }
  if (type === 'object' && value && typeof value === 'object') {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 4);
    const prefix = ctor && ctor !== 'Object' ? `${ctor} ` : '';
    return `${prefix}{${shown.join(', ')}${keys.length > shown.length ? ', ...' : ''}}`;
  }

  return previewBootstrapRuntimeAtom(value);
}

function describeBootstrapRuntimeSize(
  value: unknown,
  type: string
): string | undefined {
  if (type === 'string' && typeof value === 'string') {
    return `${value.length} chars`;
  }
  if (type === 'array' && Array.isArray(value)) {
    return `${value.length} items`;
  }
  if ((type === 'map' || type === 'set') && value instanceof Map) {
    return `${value.size} items`;
  }
  if ((type === 'map' || type === 'set') && value instanceof Set) {
    return `${value.size} items`;
  }
  if (type === 'object' && value && typeof value === 'object') {
    return `${Object.keys(value).length} keys`;
  }
  return undefined;
}

function describeArrayElementKeys(value: unknown[]): string | undefined {
  if (value.length === 0) {
    return undefined;
  }
  const first = value[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const keys = Object.keys(first).slice(0, 8);
    if (keys.length > 0) {
      return keys.join(', ');
    }
  }
  return undefined;
}

function createBootstrapRuntimeSnapshotEntries(
  bindings: Readonly<Record<string, unknown>>
): RuntimeStateSnapshotEntry[] {
  return Object.entries(bindings).map(([name, value]) => {
    try {
      const meta = describeBootstrapRuntimeValue(value);
      const size = describeBootstrapRuntimeSize(value, meta.type);
      const preview = previewBootstrapRuntimeValue(value, meta.type, meta.ctor);

      // For arrays of objects, show element schema keys as a compact structural hint
      let elementKeysHint: string | undefined;
      if (meta.type === 'array' && Array.isArray(value)) {
        elementKeysHint = describeArrayElementKeys(value);
      }

      const compactPreview = preview
        ? truncateToCharBudget(preview, 40)
        : undefined;
      const fullPreview = elementKeysHint
        ? compactPreview
          ? `${compactPreview} — element keys: ${elementKeysHint}`
          : `element keys: ${elementKeysHint}`
        : compactPreview;

      return {
        name,
        type: meta.type,
        ...(meta.ctor ? { ctor: meta.ctor } : {}),
        ...(size ? { size } : {}),
        ...(fullPreview ? { preview: fullPreview } : {}),
      };
    } catch {
      return {
        name,
        type: 'unknown',
        preview: '[unavailable]',
      };
    }
  });
}

function formatBootstrapContextSummary(
  bindings: Readonly<Record<string, unknown>>,
  options?: Readonly<{
    maxEntries?: number;
    maxChars?: number;
    budgetRemaining?: number;
    budgetTotal?: number;
  }>
): string {
  const entries = createBootstrapRuntimeSnapshotEntries(bindings);
  const state = formatStructuredRuntimeState(entries, new Map(), options);
  const budgetLine =
    options?.budgetRemaining !== undefined && options?.budgetTotal !== undefined
      ? `\nSub-query budget: ${options.budgetRemaining}/${options.budgetTotal} remaining`
      : '';
  return `Explore with code — do not assume values from these previews.\n${state}${budgetLine}`;
}

function formatBubbledActorTurnOutput(
  error: AxAgentClarificationError | AxAIServiceAbortedError,
  maxRuntimeChars: number
): string {
  if (error instanceof AxAgentClarificationError) {
    return truncateText(`[CLARIFICATION] ${error.question}`, maxRuntimeChars);
  }

  return truncateText(`[ABORTED] ${error.message}`, maxRuntimeChars);
}

function cloneAgentState(state: Readonly<AxAgentState>): AxAgentState {
  return cloneStructured(state);
}

function serializeAgentStateActionLogEntries(
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

function deserializeAgentStateActionLogEntries(
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

function runtimeStateProvenanceToRecord(
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

function buildRuntimeRestoreNotice(
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

function runtimeStateProvenanceFromRecord(
  provenance:
    | Readonly<Record<string, RuntimeStateVariableProvenance>>
    | undefined
): Map<string, RuntimeStateVariableProvenance> {
  return new Map(
    Object.entries(provenance ?? {}).map(([name, meta]) => [name, { ...meta }])
  );
}

function mergeRuntimeStateProvenance(
  primary: ReadonlyMap<string, RuntimeStateVariableProvenance>,
  fallback: ReadonlyMap<string, RuntimeStateVariableProvenance>
): Map<string, RuntimeStateVariableProvenance> {
  const merged = new Map<string, RuntimeStateVariableProvenance>();

  for (const [name, meta] of fallback.entries()) {
    merged.set(name, { ...meta });
  }
  for (const [name, meta] of primary.entries()) {
    merged.set(name, { ...meta });
  }

  return merged;
}

/**
 * Configuration options for creating an agent using the agent() factory function.
 */
export interface AxAgentConfig<_IN extends AxGenIn, _OUT extends AxGenOut>
  extends AxAgentOptions<_IN> {
  ai?: AxAIService;
  judgeAI?: AxAIService;
  agentIdentity?: AxAgentIdentity;
}

/**
 * Creates a strongly-typed AI agent from a signature.
 * This is the recommended way to create agents, providing better type inference and cleaner syntax.
 *
 * @param signature - The input/output signature as a string or AxSignature object
 * @param config - Configuration options for the agent (contextFields is required)
 * @returns A typed agent instance
 *
 * @example
 * ```typescript
 * const myAgent = agent('context:string, query:string -> answer:string', {
 *   contextFields: ['context'],
 *   runtime: new AxJSRuntime(),
 * });
 * ```
 */
// --- String signature ---
export function agent<
  const T extends string,
  const CF extends readonly AxContextFieldInput[],
>(
  signature: T,
  config: Omit<
    AxAgentConfig<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>,
    'contextFields'
  > & {
    contextFields: CF;
  }
): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>;
// --- AxSignature object ---
export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  const CF extends readonly AxContextFieldInput[],
>(
  signature: AxSignature<TInput, TOutput>,
  config: Omit<AxAgentConfig<TInput, TOutput>, 'contextFields'> & {
    contextFields: CF;
  }
): AxAgent<TInput, TOutput>;
// --- Implementation ---
export function agent(
  signature: string | AxSignature<any, any>,
  config: AxAgentConfig<any, any>
): AxAgent<any, any> {
  const typedSignature =
    typeof signature === 'string' ? AxSignature.create(signature) : signature;
  const { ai, judgeAI, agentIdentity, ...options } = config;

  return new AxAgent(
    {
      ai,
      judgeAI,
      agentIdentity,
      signature: typedSignature,
    },
    options
  );
}

// ----- Utility Functions -----

function isTransientError(error: unknown): boolean {
  if (
    error instanceof AxAIServiceStatusError &&
    error.status >= 500 &&
    error.status < 600
  ) {
    return true;
  }
  return (
    error instanceof AxAIServiceNetworkError ||
    error instanceof AxAIServiceTimeoutError
  );
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function truncateToCharBudget(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function isRuntimeStateSnapshotEntry(
  value: unknown
): value is RuntimeStateSnapshotEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.type === 'string' &&
    (candidate.ctor === undefined || typeof candidate.ctor === 'string') &&
    (candidate.size === undefined || typeof candidate.size === 'string') &&
    (candidate.preview === undefined ||
      typeof candidate.preview === 'string') &&
    (candidate.restorable === undefined ||
      typeof candidate.restorable === 'boolean')
  );
}

function parseRuntimeStateSnapshot(
  snapshot: string
): RuntimeStateSnapshotEntry[] | undefined {
  const trimmed = snapshot.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as
      | { entries?: unknown[] }
      | unknown[]
      | null;
    const rawEntries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)
        ? parsed.entries
        : undefined;

    if (!rawEntries) {
      return undefined;
    }

    return rawEntries.filter(isRuntimeStateSnapshotEntry);
  } catch {
    return undefined;
  }
}

function formatRuntimeStateLines(
  lines: readonly string[],
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const maxEntries =
    options?.maxEntries && options.maxEntries > 0
      ? options.maxEntries
      : undefined;
  const maxChars =
    options?.maxChars && options.maxChars > 0 ? options.maxChars : undefined;
  const boundedLines = maxEntries ? lines.slice(0, maxEntries) : [...lines];

  if (!maxChars) {
    return boundedLines.join('\n');
  }

  const result: string[] = [];
  let usedChars = 0;
  for (const line of boundedLines) {
    const separatorChars = result.length > 0 ? 1 : 0;
    const remainingChars = maxChars - usedChars - separatorChars;
    if (remainingChars <= 0) {
      break;
    }
    if (line.length <= remainingChars) {
      result.push(line);
      usedChars += separatorChars + line.length;
      continue;
    }
    result.push(truncateToCharBudget(line, remainingChars));
    usedChars = maxChars;
    break;
  }

  return result.join('\n');
}

function formatLegacyRuntimeState(
  snapshot: string,
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const lines = snapshot
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return formatRuntimeStateLines(lines, options);
}

function getRuntimeStateSalience(
  entry: Readonly<RuntimeStateSnapshotEntry>,
  provenance: Readonly<RuntimeStateVariableProvenance> | undefined
): number {
  let score = 0;

  if (provenance) {
    score += 1_000_000;
    score += provenance.createdTurn * 100;
    score += (provenance.lastReadTurn ?? provenance.createdTurn) * 10_000;
    if (provenance.source) {
      score += 25;
    }
  }

  if (entry.type === 'accessor') {
    score -= 100;
  } else if (entry.type === 'function') {
    score -= 10;
  }

  return score;
}

function formatRuntimeStateType(
  entry: Readonly<RuntimeStateSnapshotEntry>
): string {
  let label = entry.type;

  if (entry.type === 'object' && entry.ctor && entry.ctor !== 'Object') {
    label = `object<${entry.ctor}>`;
  } else if (entry.type === 'error' && entry.ctor && entry.ctor !== 'Error') {
    label = `error<${entry.ctor}>`;
  }

  if (entry.size) {
    label += ` (${entry.size})`;
  }

  return label;
}

function formatRuntimeStateProvenance(
  provenance: Readonly<RuntimeStateVariableProvenance> | undefined
): string {
  if (!provenance) {
    return '';
  }

  const details = [
    `from t${provenance.createdTurn}${provenance.source ? ` via ${provenance.source}` : ''}`,
  ];
  if (
    provenance.lastReadTurn !== undefined &&
    provenance.lastReadTurn > provenance.createdTurn
  ) {
    details.push(`read t${provenance.lastReadTurn}`);
  }

  return ` [${details.join('; ')}]`;
}

function formatStructuredRuntimeState(
  entries: readonly RuntimeStateSnapshotEntry[],
  provenance: ReadonlyMap<string, RuntimeStateVariableProvenance>,
  options?: Readonly<{ maxEntries?: number; maxChars?: number }>
): string {
  const lines = [...entries]
    .sort((left, right) => {
      const leftScore = getRuntimeStateSalience(
        left,
        provenance.get(left.name)
      );
      const rightScore = getRuntimeStateSalience(
        right,
        provenance.get(right.name)
      );
      return rightScore - leftScore || left.name.localeCompare(right.name);
    })
    .map((entry) => {
      const preview = entry.preview ? ` = ${entry.preview}` : '';
      const provenanceSuffix = formatRuntimeStateProvenance(
        provenance.get(entry.name)
      );
      const restoreSuffix =
        'restorable' in entry && entry.restorable === false
          ? ' [snapshot only]'
          : '';

      return `${entry.name}: ${formatRuntimeStateType(entry)}${preview}${provenanceSuffix}${restoreSuffix}`;
    });

  if (lines.length === 0) {
    return '(no user variables)';
  }

  return formatRuntimeStateLines(lines, options);
}

function formatInterpreterOutput(
  result: unknown,
  maxRuntimeChars: number
): string {
  if (result === undefined) {
    return '(no output)';
  }
  if (typeof result === 'string') {
    return truncateText(result || '(no output)', maxRuntimeChars);
  }
  try {
    return truncateText(JSON.stringify(result, null, 2), maxRuntimeChars);
  } catch {
    return truncateText(String(result), maxRuntimeChars);
  }
}

function formatInterpreterError(err: unknown, maxRuntimeChars: number): string {
  const typedErr = err as {
    name?: string;
    message?: string;
    cause?: unknown;
    data?: unknown;
  };
  const name = typedErr?.name ?? 'Error';
  const message = typedErr?.message ?? String(err);
  const parts: string[] = [`${name}: ${message}`];

  if (typedErr?.data !== undefined) {
    try {
      parts.push(`Data: ${JSON.stringify(typedErr.data, null, 2)}`);
    } catch {
      parts.push(`Data: ${String(typedErr.data)}`);
    }
  }

  if (typedErr?.cause !== undefined) {
    const fmtCause = (cause: unknown, depth: number): string => {
      if (depth > 4) {
        return '[cause chain truncated]';
      }
      const c = cause as typeof typedErr;
      const cName = c?.name ?? 'Error';
      const cMsg = c?.message ?? String(cause);
      const cParts: string[] = [`${cName}: ${cMsg}`];
      if (c?.data !== undefined) {
        try {
          cParts.push(`Data: ${JSON.stringify(c.data, null, 2)}`);
        } catch {
          cParts.push(`Data: ${String(c.data)}`);
        }
      }
      if (c?.cause !== undefined) {
        cParts.push(`Caused by: ${fmtCause(c.cause, depth + 1)}`);
      }
      return cParts.join('\n');
    };
    parts.push(`Caused by: ${fmtCause(typedErr.cause, 1)}`);
  }

  return truncateText(parts.join('\n'), maxRuntimeChars);
}

function hasCompletionSignalCall(code: string): boolean {
  const sanitized = stripJsStringsAndComments(code);
  return (
    /\bfinal\s*\(/.test(sanitized) || /\bask_clarification\s*\(/.test(sanitized)
  );
}

function looksLikePromisePlaceholder(result: unknown): boolean {
  if (
    result &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result &&
    typeof (result as { then?: unknown }).then === 'function'
  ) {
    return true;
  }
  return typeof result === 'string' && result.trim() === '[object Promise]';
}

function isSessionClosedError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Session is closed';
}

function isExecutionTimedOutError(err: unknown): boolean {
  return err instanceof Error && err.message === 'Execution timed out';
}

function isLikelyRuntimeErrorOutput(output: string): boolean {
  if (output.startsWith('[ERROR]')) {
    return true;
  }
  if (output.startsWith(RUNTIME_RESTART_NOTICE)) {
    return true;
  }
  return /^(AggregateError|Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError): /.test(
    output
  );
}

function buildContextFieldPromptInlineValue(
  value: unknown,
  promptConfig: AxContextFieldPromptConfig
): unknown {
  if (promptConfig.kind === 'threshold') {
    return estimateValueSize(value) <= promptConfig.promptMaxChars
      ? value
      : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const keepChars = promptConfig.keepInPromptChars;
  if (value.length <= keepChars) {
    return value;
  }

  const truncatedChars = value.length - keepChars;
  if (promptConfig.reverseTruncate) {
    const suffix = keepChars > 0 ? value.slice(-keepChars) : '';
    return `[truncated ${truncatedChars} chars]...${suffix}`;
  }

  const prefix = keepChars > 0 ? value.slice(0, keepChars) : '';
  return `${prefix}...[truncated ${truncatedChars} chars]`;
}

function describeContextFieldPromptMode(
  value: unknown,
  promptConfig: AxContextFieldPromptConfig,
  isInlined: boolean
): string {
  if (promptConfig.kind === 'threshold') {
    return isInlined
      ? `inline (<=${promptConfig.promptMaxChars} chars)`
      : `runtime-only (>${promptConfig.promptMaxChars} chars)`;
  }

  if (typeof value !== 'string') {
    return 'runtime-only (keepInPromptChars requires string)';
  }

  if (!isInlined) {
    return 'runtime-only';
  }

  if (value.length <= promptConfig.keepInPromptChars) {
    return `inline (<=${promptConfig.keepInPromptChars} chars)`;
  }

  return promptConfig.reverseTruncate
    ? `inline-truncated(last ${promptConfig.keepInPromptChars} chars of ${value.length})`
    : `inline-truncated(first ${promptConfig.keepInPromptChars} chars of ${value.length})`;
}

function estimateValueSize(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function normalizeContextFields(
  contextFields: readonly AxContextFieldInput[],
  inputFields: readonly AxIField[],
  defaultPromptMaxChars: number
): {
  contextFieldNames: string[];
  promptConfigByField: Map<string, AxContextFieldPromptConfig>;
} {
  const inputFieldNames = new Set(inputFields.map((f) => f.name));
  const seen = new Set<string>();
  const contextFieldNames: string[] = [];
  const promptConfigByField = new Map<string, AxContextFieldPromptConfig>();

  for (const cf of contextFields) {
    const field = typeof cf === 'string' ? cf : cf.field;

    if (!inputFieldNames.has(field)) {
      throw new Error(`RLM contextField "${field}" not found in signature`);
    }
    if (seen.has(field)) {
      throw new Error(`Duplicate contextField "${field}"`);
    }
    seen.add(field);
    contextFieldNames.push(field);

    if (typeof cf !== 'string') {
      const hasKeepInPromptChars = cf.keepInPromptChars !== undefined;
      const hasPromptMaxChars = cf.promptMaxChars !== undefined;

      if (hasKeepInPromptChars && hasPromptMaxChars) {
        throw new Error(
          `contextField "${field}" cannot set both promptMaxChars and keepInPromptChars`
        );
      }

      if ('reverseTruncate' in cf && !hasKeepInPromptChars) {
        throw new Error(
          `contextField "${field}" reverseTruncate requires keepInPromptChars`
        );
      }

      if (hasKeepInPromptChars) {
        const keepInPromptChars = cf.keepInPromptChars;
        if (
          !Number.isFinite(keepInPromptChars) ||
          keepInPromptChars === undefined ||
          keepInPromptChars < 0
        ) {
          throw new Error(
            `contextField "${field}" keepInPromptChars must be a finite number >= 0`
          );
        }
        promptConfigByField.set(field, {
          kind: 'truncate',
          keepInPromptChars,
          reverseTruncate: cf.reverseTruncate === true,
        });
        continue;
      }

      const promptMaxChars = cf.promptMaxChars ?? defaultPromptMaxChars;
      if (!Number.isFinite(promptMaxChars) || promptMaxChars < 0) {
        throw new Error(
          `contextField "${field}" promptMaxChars must be a finite number >= 0`
        );
      }
      promptConfigByField.set(field, {
        kind: 'threshold',
        promptMaxChars,
      });
    }
  }

  return { contextFieldNames, promptConfigByField };
}

function buildRLMVariablesInfo(
  contextValues: Record<string, unknown>,
  options?: {
    promptConfigByField?: ReadonlyMap<string, AxContextFieldPromptConfig>;
    inlinedFields?: ReadonlySet<string>;
  }
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(contextValues)) {
    const valueType = Array.isArray(value) ? 'array' : typeof value;
    const size =
      typeof value === 'string'
        ? `${value.length} chars`
        : Array.isArray(value)
          ? `${value.length} items`
          : value && typeof value === 'object'
            ? `${Object.keys(value as Record<string, unknown>).length} keys`
            : 'n/a';
    const promptConfig = options?.promptConfigByField?.get(key);
    const promptMode =
      promptConfig === undefined
        ? 'runtime-only'
        : describeContextFieldPromptMode(
            value,
            promptConfig,
            options?.inlinedFields?.has(key) === true
          );
    lines.push(
      `- ${key}: type=${valueType}, size=${size}, prompt=${promptMode}`
    );
  }
  return lines.join('\n');
}

async function runWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
  stopSignal?: AbortSignal
): Promise<TOut[]> {
  if (items.length === 0) {
    return [];
  }

  const results: TOut[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      if (stopSignal?.aborted) {
        return;
      }
      const current = cursor++;
      if (current >= items.length) {
        return;
      }
      const item = items[current];
      if (item === undefined) {
        return;
      }
      results[current] = await worker(item, current);
    }
  });

  await Promise.all(workers);
  return results;
}

function shouldEnforceIncrementalConsoleTurns(
  runtimeUsageInstructions: string
): boolean {
  return runtimeUsageInstructions.includes('console.log');
}

function validateActorTurnCodePolicy(code: string): string | undefined {
  const sanitized = stripJsStringsAndComments(code);
  const hasFinal = /\bfinal\s*\(/.test(sanitized);
  const hasAskClarification = /\bask_clarification\s*\(/.test(sanitized);
  const completionSignalCount = Number(hasFinal) + Number(hasAskClarification);
  const consoleLogCalls = findConsoleLogCalls(sanitized);

  if (completionSignalCount > 1) {
    return '[POLICY] Use exactly one completion signal per turn: either final(...) or ask_clarification(...), not both.';
  }

  if (completionSignalCount === 1) {
    if (consoleLogCalls.length > 0) {
      return '[POLICY] Do not combine console.log(...) with final(...)/ask_clarification(...) in the same turn. Inspect in one turn, then complete in the next turn.';
    }
    return undefined;
  }

  if (consoleLogCalls.length === 0) {
    return '[POLICY] Non-final turns must include exactly one console.log(...) so the next turn can reason from its output.';
  }

  if (consoleLogCalls.length > 1) {
    return '[POLICY] Use exactly one console.log(...) per non-final turn, then stop.';
  }

  const onlyLog = consoleLogCalls[0];
  if (onlyLog === undefined) {
    return '[POLICY] Unable to verify console.log(...) usage. Emit exactly one console.log(...) per non-final turn.';
  }
  if (onlyLog.closeParenIndex === undefined) {
    return '[POLICY] Could not parse console.log(...). Keep a single valid console.log(...) call as the last statement in non-final turns.';
  }

  const trailing = sanitized
    .slice(onlyLog.closeParenIndex + 1)
    .replace(/^[\s;]+/, '');
  if (trailing.length > 0) {
    return '[POLICY] End non-final turns immediately after console.log(...). Do not execute additional statements after logging.';
  }

  return undefined;
}

function stripJsStringsAndComments(code: string): string {
  let out = '';
  let i = 0;
  let state:
    | 'normal'
    | 'single'
    | 'double'
    | 'template'
    | 'lineComment'
    | 'blockComment' = 'normal';
  let escaped = false;

  while (i < code.length) {
    const ch = code[i] ?? '';
    const next = code[i + 1] ?? '';

    if (state === 'lineComment') {
      if (ch === '\n') {
        out += '\n';
        state = 'normal';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        out += '  ';
        i += 2;
        state = 'normal';
      } else {
        out += ch === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (escaped) {
        out += ch === '\n' ? '\n' : ' ';
        escaped = false;
        i++;
        continue;
      }
      if (ch === '\\') {
        out += ' ';
        escaped = true;
        i++;
        continue;
      }
      if (ch === quote) {
        out += ' ';
        state = 'normal';
        i++;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      out += '  ';
      i += 2;
      state = 'lineComment';
      continue;
    }

    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      state = 'blockComment';
      continue;
    }

    if (ch === "'") {
      out += ' ';
      i++;
      state = 'single';
      continue;
    }

    if (ch === '"') {
      out += ' ';
      i++;
      state = 'double';
      continue;
    }

    if (ch === '`') {
      out += ' ';
      i++;
      state = 'template';
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function findConsoleLogCalls(
  sanitizedCode: string
): Array<{ closeParenIndex?: number }> {
  const matches = sanitizedCode.matchAll(/\bconsole\s*\.\s*log\s*\(/g);
  const calls: Array<{ closeParenIndex?: number }> = [];

  for (const match of matches) {
    const fullMatch = match[0];
    if (fullMatch === undefined) {
      continue;
    }
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    const openParenOffset = fullMatch.lastIndexOf('(');
    const openParenIndex = matchIndex + openParenOffset;
    const closeParenIndex = findMatchingParenIndex(
      sanitizedCode,
      openParenIndex
    );
    calls.push({ closeParenIndex });
  }

  return calls;
}

function findMatchingParenIndex(
  code: string,
  openParenIndex: number
): number | undefined {
  if (openParenIndex < 0 || code[openParenIndex] !== '(') {
    return undefined;
  }

  let depth = 0;
  for (let i = openParenIndex; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return undefined;
}

/**
 * Returns a copy of `schema` with the listed property names removed from
 * both `properties` and `required`.  Used to strip parent-injected shared
 * fields from a child agent's public function signature.
 */
function stripSchemaProperties(
  schema: AxFunctionJSONSchema,
  namesToRemove: ReadonlySet<string>
): AxFunctionJSONSchema {
  if (!schema.properties || namesToRemove.size === 0) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => !namesToRemove.has(k))
  );
  const required = schema.required?.filter((k) => !namesToRemove.has(k));
  return {
    ...schema,
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

type DiscoveryCallableMeta = {
  module: string;
  name: string;
  description: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
  examples?: readonly AxAgentFunctionExample[];
};

function normalizeAgentModuleNamespace(
  namespace: string,
  options?: Readonly<{ normalize?: boolean }>
): string {
  const trimmed = namespace.trim();
  const shouldNormalize = options?.normalize ?? true;
  const normalized = shouldNormalize ? toCamelCase(trimmed) : trimmed;
  if (!normalized) {
    throw new Error('Agent module namespace must contain letters or numbers');
  }
  return normalized;
}

function isAgentFunctionGroup(
  value: AxAgentFunction | AxAgentFunctionGroup
): value is AxAgentFunctionGroup {
  return Array.isArray((value as AxAgentFunctionGroup).functions);
}

function normalizeAgentFunctionCollection(
  collection: AxAgentFunctionCollection | undefined,
  reservedNames: ReadonlySet<string>
): NormalizedAgentFunctionCollection {
  if (!collection || collection.length === 0) {
    return { functions: [], moduleMetadata: [] };
  }

  const allGroups = collection.every((item) =>
    isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );
  const allFunctions = collection.every(
    (item) =>
      !isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );

  if (!allGroups && !allFunctions) {
    throw new Error(
      'Agent functions collections must contain either flat functions or grouped function modules, not both'
    );
  }

  if (allFunctions) {
    return {
      functions: [...(collection as readonly AxAgentFunction[])],
      moduleMetadata: [],
    };
  }

  const seenNamespaces = new Set<string>();
  const moduleMetadata: AxAgentFunctionModuleMeta[] = [];
  const functions: AxAgentFunction[] = [];

  for (const group of collection as readonly AxAgentFunctionGroup[]) {
    const namespace = group.namespace.trim();
    const title = group.title.trim();
    const selectionCriteria = group.selectionCriteria.trim();
    const description = group.description.trim();

    if (!namespace) {
      throw new Error(
        'Agent function group namespace must be a non-empty string'
      );
    }
    if (!title) {
      throw new Error(
        `Agent function group "${namespace}" must define a non-empty title`
      );
    }
    if (!selectionCriteria) {
      throw new Error(
        `Agent function group "${namespace}" must define a non-empty selectionCriteria`
      );
    }
    if (!description) {
      throw new Error(
        `Agent function group "${namespace}" must define a non-empty description`
      );
    }
    if (reservedNames.has(namespace)) {
      throw new Error(
        `Agent function namespace "${namespace}" conflicts with an AxAgent runtime global and is reserved`
      );
    }
    if (seenNamespaces.has(namespace)) {
      throw new Error(
        `Duplicate agent function group namespace "${namespace}"`
      );
    }
    if (group.functions.length === 0) {
      throw new Error(
        `Agent function group "${namespace}" must contain at least one function`
      );
    }

    seenNamespaces.add(namespace);
    moduleMetadata.push({
      namespace,
      title,
      selectionCriteria,
      description,
    });

    for (const fn of group.functions) {
      if ('namespace' in fn && fn.namespace !== undefined) {
        throw new Error(
          `Grouped agent function "${namespace}.${fn.name}" must not define namespace; use the parent group namespace instead`
        );
      }

      functions.push({
        ...fn,
        namespace,
      });
    }
  }

  return { functions, moduleMetadata };
}

function normalizeDiscoveryStringInput(
  value: unknown,
  fieldName: string
): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${fieldName} must be a non-empty string`);
    }
    return [trimmed];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a string or string[]`);
  }

  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} must contain only strings`);
  }

  const normalized = value
    .map((item) => item as string)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty string`);
  }

  return [...new Set(normalized)];
}

function normalizeSchemaTypesForDiscovery(
  schema: AxFunctionJSONSchema
): string[] {
  const rawType = (schema as { type?: unknown }).type;
  if (Array.isArray(rawType)) {
    return rawType.filter((t): t is string => typeof t === 'string');
  }
  if (typeof rawType === 'string') {
    if (rawType.includes(',')) {
      return rawType
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [rawType];
  }
  return [];
}

function isJsonAnyTypeUnionForDiscovery(types: readonly string[]): boolean {
  const normalized = new Set(types);
  return (
    normalized.has('object') &&
    normalized.has('array') &&
    normalized.has('string') &&
    normalized.has('number') &&
    normalized.has('boolean') &&
    normalized.has('null')
  );
}

function schemaTypeToShortStringForDiscovery(
  schema: AxFunctionJSONSchema
): string {
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ');

  const types = normalizeSchemaTypesForDiscovery(schema);
  if (types.length === 0) return 'unknown';
  if (isJsonAnyTypeUnionForDiscovery(types)) return 'any';

  const rendered = [...new Set(types)].map((type) => {
    if (type === 'array') {
      const itemType = schema.items
        ? schemaTypeToShortStringForDiscovery(schema.items)
        : 'unknown';
      return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
    }
    if (type === 'object') {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        return renderObjectTypeForDiscovery(schema);
      }
      return 'object';
    }
    return type;
  });

  return rendered.length > 1
    ? rendered.join(' | ')
    : (rendered[0] ?? 'unknown');
}

function renderObjectTypeForDiscovery(
  schema: AxFunctionJSONSchema | undefined,
  options?: Readonly<{ respectRequired?: boolean }>
): string {
  if (!schema) {
    return '{}';
  }

  const hasProperties =
    !!schema.properties && Object.keys(schema.properties).length > 0;
  const supportsExtraProps = schema.additionalProperties === true;

  if (!hasProperties) {
    return supportsExtraProps ? '{ [key: string]: unknown }' : '{}';
  }

  const required = new Set(schema.required ?? []);
  const respectRequired = options?.respectRequired ?? false;
  const parts = Object.entries(schema.properties!).map(([key, prop]) => {
    const typeStr = schemaTypeToShortStringForDiscovery(prop);
    const optionalMarker = respectRequired && !required.has(key) ? '?' : '';
    return `${key}${optionalMarker}: ${typeStr}`;
  });
  if (schema.additionalProperties === true) {
    parts.push('[key: string]: unknown');
  }

  return `{ ${parts.join(', ')} }`;
}

function renderCallableEntryForDiscovery(args: {
  qualifiedName: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  const paramType = renderObjectTypeForDiscovery(args.parameters, {
    respectRequired: true,
  });
  const returnType = args.returns
    ? `: Promise<${schemaTypeToShortStringForDiscovery(args.returns)}>`
    : '';
  return `- \`${args.qualifiedName}(args: ${paramType})${returnType}\``;
}

type DiscoveryArgDoc = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

function collectDiscoveryArgumentDocs(
  schema: AxFunctionJSONSchema | undefined,
  prefix = '',
  includeRequired = true
): DiscoveryArgDoc[] {
  if (!schema?.properties) {
    return [];
  }

  const required = new Set(schema.required ?? []);
  const docs: DiscoveryArgDoc[] = [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const description = prop.description?.trim();
    if (description) {
      docs.push({
        name: path,
        type: schemaTypeToShortStringForDiscovery(prop),
        required: includeRequired ? required.has(key) : undefined,
        description,
      });
    }

    const propTypes = normalizeSchemaTypesForDiscovery(prop);
    if (propTypes.includes('object') && prop.properties) {
      docs.push(...collectDiscoveryArgumentDocs(prop, path, false));
    }

    if (propTypes.includes('array') && prop.items) {
      const itemDescription = (
        prop.items as AxFunctionJSONSchema & { description?: string }
      ).description?.trim();
      const itemPath = `${path}[]`;
      if (itemDescription) {
        docs.push({
          name: itemPath,
          type: schemaTypeToShortStringForDiscovery(prop.items),
          description: itemDescription,
        });
      }
      const itemTypes = normalizeSchemaTypesForDiscovery(prop.items);
      if (itemTypes.includes('object') && prop.items.properties) {
        docs.push(...collectDiscoveryArgumentDocs(prop.items, itemPath, false));
      }
    }
  }

  return docs;
}

function renderDiscoveryArgumentDocsMarkdown(
  schema: AxFunctionJSONSchema | undefined
): string | undefined {
  const docs = collectDiscoveryArgumentDocs(schema);
  if (docs.length === 0) {
    return undefined;
  }

  return [
    '#### Arguments',
    ...docs.map((doc) => {
      const suffix =
        doc.required === undefined
          ? `\`${doc.type}\``
          : `\`${doc.type}\`, ${doc.required ? 'required' : 'optional'}`;
      return `- \`${doc.name}\` (${suffix}): ${doc.description}`;
    }),
  ].join('\n');
}

function renderDiscoveryExamplesMarkdown(
  examples: readonly AxAgentFunctionExample[] | undefined
): string | undefined {
  if (!examples || examples.length === 0) {
    return undefined;
  }

  const blocks = examples
    .map((example) => {
      const parts: string[] = [];
      if (example.title?.trim()) {
        parts.push(`##### ${example.title.trim()}`);
      }
      if (example.description?.trim()) {
        parts.push(example.description.trim());
      }
      parts.push(`\`\`\`${example.language?.trim() || 'typescript'}`);
      parts.push(example.code);
      parts.push('```');
      return parts.join('\n');
    })
    .join('\n\n');

  return ['#### Examples', blocks].join('\n');
}

function renderDiscoveryModuleListMarkdown(
  modules: readonly string[],
  moduleLookup: ReadonlyMap<string, readonly string[]>,
  moduleMetaLookup: ReadonlyMap<string, AxAgentFunctionModuleMeta>
): string {
  return modules
    .map((module) => {
      const functions = [...(moduleLookup.get(module) ?? [])]
        .map((qualifiedName) => qualifiedName.split('.').pop() ?? qualifiedName)
        .sort((a, b) => a.localeCompare(b));
      const exists = functions.length > 0;
      const meta = exists ? moduleMetaLookup.get(module) : undefined;
      const body = exists
        ? functions.map((name) => `- \`${name}\``).join('\n')
        : `- Error: module \`${module}\` does not exist.`;
      const parts = [`### Module \`${module}\``];
      if (meta) {
        parts.push(`**${meta.title}**`);
        parts.push(meta.description);
      }
      parts.push(body);
      return parts.join('\n');
    })
    .join('\n\n');
}

function renderDiscoveryFunctionDefinitionsMarkdown(
  identifiers: readonly string[],
  callableLookup: ReadonlyMap<string, DiscoveryCallableMeta>
): string {
  return identifiers
    .map((rawIdentifier) => {
      const qualifiedName = rawIdentifier.includes('.')
        ? rawIdentifier
        : `utils.${rawIdentifier}`;
      const meta = callableLookup.get(qualifiedName);
      if (!meta) {
        return `### \`${qualifiedName}\`\n- Not found.`;
      }
      return [
        `### \`${qualifiedName}\``,
        meta.description,
        renderCallableEntryForDiscovery({
          qualifiedName,
          parameters: meta.parameters,
          returns: meta.returns,
        }),
        renderDiscoveryArgumentDocsMarkdown(meta.parameters),
        renderDiscoveryExamplesMarkdown(meta.examples),
      ]
        .filter((part): part is string => !!part)
        .join('\n');
    })
    .join('\n\n');
}

function toCamelCase(inputString: string): string {
  const words = inputString.split(/[^a-zA-Z0-9]/);
  const camelCaseString = words
    .map((word, index) => {
      const lowerWord = word.toLowerCase();
      if (index > 0 && lowerWord && lowerWord[0]) {
        return lowerWord[0].toUpperCase() + lowerWord.slice(1);
      }
      return lowerWord;
    })
    .join('');
  return camelCaseString;
}
