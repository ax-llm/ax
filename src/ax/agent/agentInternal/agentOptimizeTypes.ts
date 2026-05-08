import type { AxAIService } from '../../ai/types.js';
import type {
  AxGEPABootstrapOptions,
  AxMetricFn,
  AxOptimizationProgress,
  AxOptimizationStats,
  AxOptimizerArgs,
} from '../../dsp/common_types.js';
import type { AxJudgeOptions } from '../../dsp/judgeTypes.js';
import type { AxParetoResult } from '../../dsp/optimizer.js';
import type { AxOptimizerLoggerFunction } from '../../dsp/optimizerTypes.js';
import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptions,
  AxProgramUsage,
} from '../../dsp/types.js';
import type {
  AxAgentRecursiveStats,
  AxAgentRecursiveTraceNode,
} from '../agentRecursiveOptimize.js';
import type { AxContextPolicyConfig } from '../rlm.js';
import type {
  AxAgentExecutorTurnCallbackArgs,
  AxAgentFunctionCollection,
  AxAgentInputUpdateCallback,
  AxAgentStructuredClarification,
  AxAnyAgentic,
  AxContextFieldInput,
  AxExecutorModelPolicy,
} from './agentStateTypes.js';

/**
 * Demo traces for AxAgent's split architecture.
 * Actor demos use `{ javascriptCode }`.
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

type AxAgentEvalPredictionShared = {
  actionLog: string;
  guidanceLog?: string;
  functionCalls: AxAgentEvalFunctionCall[];
  toolErrors: string[];
  turnCount: number;
  usage?: AxProgramUsage[];
  recursiveTrace?: AxAgentRecursiveTraceNode;
  recursiveStats?: AxAgentRecursiveStats;
  recursiveSummary?: string;
};

export type AxAgentEvalPrediction<OUT = any> =
  | (AxAgentEvalPredictionShared & {
      completionType: 'final';
      output: OUT;
      clarification?: undefined;
    })
  | (AxAgentEvalPredictionShared & {
      completionType: 'askClarification';
      output?: undefined;
      clarification: AxAgentStructuredClarification;
    });

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
  /** Optional separate judge model. Defaults to the agent's `judgeAI`, then `teacherAI`, then the student model. */
  judgeAI?: Readonly<AxAIService>;
  teacherAI?: Readonly<AxAIService>;
  judgeOptions?: AxAgentJudgeOptions;
  /** Optional optimization scope. Defaults to `'actor'`. */
  target?: AxAgentOptimizeTarget;
  apply?: boolean;
  maxMetricCalls?: number;
  bootstrap?: boolean | AxGEPABootstrapOptions;
  /** Optional deterministic scorer. If omitted, optimize() uses the built-in LLM judge. */
  metric?: AxMetricFn;
  verbose?: boolean;
  debugOptimizer?: boolean;
  optimizerLogger?: AxOptimizerLoggerFunction;
  onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
  onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void;
} & Pick<
  AxOptimizerArgs,
  | 'numTrials'
  | 'minibatch'
  | 'minibatchSize'
  | 'earlyStoppingTrials'
  | 'minImprovementThreshold'
  | 'sampleCount'
  | 'seed'
>;

export type AxAgentOptimizeResult<OUT extends AxGenOut = AxGenOut> =
  AxParetoResult<OUT>;

export type AxAgentOptions<IN extends AxGenIn = AxGenIn> = Omit<
  AxProgramForwardOptions<string>,
  'functions' | 'description' | 'onFunctionCall'
> & {
  debug?: boolean;
  /**
   * Input fields used as context.
   * - `string`: runtime-only (legacy behavior)
   * - `{ field, promptMaxChars }`: runtime + conditionally inlined into the distiller prompt
   * - `{ field, keepInPromptChars, reverseTruncate? }`: runtime + truncated string excerpt in the distiller prompt
   */
  contextFields?: readonly AxContextFieldInput[];

  /** Child agents registered under the configured child-agent module namespace (default: `agents.*`). */
  agents?: AxAnyAgentic[];
  /** Agent functions registered under the configured namespace globals. */
  functions?: AxAgentFunctionCollection;
  /** Enables runtime callable discovery (modules + on-demand definitions). */
  functionDiscovery?: boolean;

  /**
   * Optional skills search callback. When set, the executor runtime gains a
   * `consult(searches: string[])` global. The callback receives the raw
   * search strings and returns matched skills (`{ name, content }`); each
   * returned skill's content is rendered into the executor system prompt for
   * subsequent turns (sorted by name to keep the prefix cache stable).
   */
  onSkillsSearch?: import('./skillsTypes.js').AxAgentSkillsSearchFn;

  /**
   * Optional memories search callback. When set, the distiller and executor
   * stages gain a `recall(searches: string[])` global, and both stages get a
   * `memories` input field. The callback receives the raw search strings and
   * returns matched memories (`{ id, content }`); the runtime appends
   * matched entries to `inputs.memories` (deduped by id, sorted) so the
   * next turn's prompt includes them. Memories loaded by the distiller
   * thread to the executor automatically; the responder does not receive
   * the memories field.
   */
  onMemoriesSearch?: import('./memoriesTypes.js').AxAgentMemoriesSearchFn;

  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: import('../rlm.js').AxCodeRuntime;
  /** Actor prompt verbosity and scaffolding level (default: 'default'). */
  promptLevel?: 'default' | 'detailed';
  /** Global cap on recursive sub-agent calls across all descendants (default: 100). */
  maxSubAgentCalls?: number;
  /** Per-child cap on recursive sub-agent calls (default: 50). */
  maxSubAgentCallsPerChild?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** Maximum characters to keep from runtime output and console/log replay. */
  maxRuntimeChars?: number;
  /** Context replay, checkpointing, and runtime-state policy. */
  contextPolicy?: AxContextPolicyConfig;
  /** Default options for the internal checkpoint summarizer. */
  summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  /**
   * Called after each executor turn is recorded with both the raw runtime
   * result and the formatted action-log output.
   */
  executorTurnCallback?: (
    args: AxAgentExecutorTurnCallbackArgs
  ) => void | Promise<void>;
  /**
   * Called when the executor signals task progress via `success(message)` or `failed(message)`.
   */
  agentStatusCallback?: (
    message: string,
    status: 'success' | 'failed'
  ) => void | Promise<void>;
  /**
   * Called before each executor turn with current input values. Return a
   * partial patch to update in-flight inputs for subsequent executor/responder
   * steps.
   */
  inputUpdateCallback?: AxAgentInputUpdateCallback<IN>;
  /**
   * Fired whenever any function registered on the agent is invoked from the
   * runtime. `kind` is `'external'` for user-registered functions, `'internal'`
   * for agent-injected ones (child agents, skills/memories loaders, discovery globals).
   */
  onFunctionCall?: import('./agentInternalTypes.js').AxAgentOnFunctionCall;
  /**
   * Ordered executor-model overrides keyed by consecutive error turns or
   * namespace matches. Later entries take precedence over earlier ones.
   */
  executorModelPolicy?: AxExecutorModelPolicy;
  /**
   * Default forward options for recursive llmQuery sub-agent calls.
   * Set `ai` to route recursive sub-agent calls to a different AI service
   * than the one used for the parent agent. Falls back to the parent
   * `forward(ai, ...)` argument when `ai` is not set.
   */
  recursionOptions?: AxAgentRecursionOptions;
  /**
   * Forward options for the **context distiller** stage. Configures the
   * REPL/turn loop and forward-to-LLM options for the context-understanding
   * stage that runs before the executor. Set `ai` to override the AI service
   * for this stage only — falls back to `forward(ai, ...)` when not set.
   */
  contextOptions?: AxStageOptions;
  /**
   * Forward options for the **task executor** stage. Set `ai` to override
   * the AI service for this stage only — falls back to `forward(ai, ...)`
   * when not set.
   */
  executorOptions?: AxStageOptions;
  /**
   * Forward options for the **final responder** stage. Set `ai` to override
   * the AI service for this stage only — falls back to `forward(ai, ...)`
   * when not set.
   */
  responderOptions?: AxStageOptions;
  /** Default options for the built-in judge used by optimize(). */
  judgeOptions?: AxAgentJudgeOptions;
  /** Error classes that should bubble up instead of being caught and returned to the LLM. */
  bubbleErrors?: ReadonlyArray<new (...args: any[]) => Error>;
};

/**
 * Per-stage forward options. Used by `contextOptions`, `executorOptions`, and
 * `responderOptions` — one shape, three peers, one per pipeline stage.
 */
export type AxStageOptions = Partial<
  Omit<AxProgramForwardOptions<string>, 'functions'> & {
    description?: string;
    /** Input field names to strip before passing values to this stage. */
    excludeFields?: readonly string[];
  }
>;

export type AxAgentJudgeInput = {
  taskInput: AxFieldValue;
  criteria: string;
  expectedOutput?: AxFieldValue;
  expectedActions?: string[];
  forbiddenActions?: string[];
  metadata?: AxFieldValue;
};

export type AxAgentJudgeOutput = {
  completionType: 'final' | 'askClarification';
  clarification?: AxFieldValue;
  finalOutput?: AxFieldValue;
  actionLog: string;
  guidanceLog?: string;
  functionCalls: AxFieldValue;
  toolErrors: string[];
  turnCount: number;
  usage: AxFieldValue;
  recursiveTrace?: AxFieldValue;
  recursiveStats?: AxFieldValue;
};

export type AxAgentJudgeEvalInput = AxAgentJudgeInput & AxAgentJudgeOutput;

export type AxAgentJudgeEvalOutput = {
  reasoning: string;
  quality: string;
};

export type AxNormalizedAgentEvalDataset<IN = any> = {
  train: readonly AxAgentEvalTask<IN>[];
  validation?: readonly AxAgentEvalTask<IN>[];
};

/** Forward options forwarded to the `AxGen` spawned by each `llmQuery(...)` call. */
export type AxAgentRecursionOptions = Partial<
  Omit<AxProgramForwardOptions<string>, 'functions'>
>;
