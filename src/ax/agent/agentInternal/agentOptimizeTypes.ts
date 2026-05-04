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
  AxActorModelPolicy,
  AxAgentFunctionCollection,
  AxAgentInputUpdateCallback,
  AxAgentStructuredClarification,
  AxAgentTurnCallbackArgs,
  AxAnyAgentic,
  AxContextFieldInput,
} from './agentStateTypes.js';

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
  'functions' | 'description'
> & {
  debug?: boolean;
  /**
   * Input fields used as context.
   * - `string`: runtime-only (legacy behavior)
   * - `{ field, promptMaxChars }`: runtime + conditionally inlined into Actor prompt
   * - `{ field, keepInPromptChars, reverseTruncate? }`: runtime + truncated string excerpt in Actor prompt
   */
  contextFields?: readonly AxContextFieldInput[];

  /** Child agents registered under the configured child-agent module namespace (default: `agents.*`). */
  agents?: AxAnyAgentic[];
  /** Agent functions registered under the configured namespace globals. */
  functions?: AxAgentFunctionCollection;
  /** Enables runtime callable discovery (modules + on-demand definitions). */
  functionDiscovery?: boolean;

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
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /**
   * Called after each Actor turn is recorded with both the raw runtime result
   * and the formatted action-log output.
   */
  actorTurnCallback?: (args: AxAgentTurnCallbackArgs) => void | Promise<void>;
  /**
   * Called when the actor signals task progress via `success(message)` or `failed(message)`.
   */
  agentStatusCallback?: (
    message: string,
    status: 'success' | 'failed'
  ) => void | Promise<void>;
  /**
   * Called before each Actor turn with current input values. Return a partial patch
   * to update in-flight inputs for subsequent Actor/Responder steps.
   */
  inputUpdateCallback?: AxAgentInputUpdateCallback<IN>;
  /**
   * Ordered Actor-model overrides keyed by consecutive error turns or namespace matches.
   * Later entries take precedence over earlier ones.
   */
  actorModelPolicy?: AxActorModelPolicy;
  /** Default forward options for recursive llmQuery sub-agent calls. */
  recursionOptions?: AxAgentRecursionOptions;
  /** Default forward options for the Actor sub-program. */
  actorOptions?: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'> & {
      description?: string;
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
  /** Error classes that should bubble up instead of being caught and returned to the LLM. */
  bubbleErrors?: ReadonlyArray<new (...args: any[]) => Error>;
  /**
   * Selects which actor prompt template this internal agent uses.
   * - `'combined'`: single-stage-actor.md — default one-stage actor.
   * - `'context'`: context-actor.md — context-understanding stage; no tools, no discovery.
   * - `'task'`: task-actor.md — tool executor; optionally consumes executorRequest/distilledContext.
   * Set automatically by the AxAgent pipeline; external callers can set it on ActorAgentRLM directly.
   */
  actorTemplateVariant?: 'combined' | 'context' | 'task';
  /**
   * When true, a prior context-understanding stage has produced
   * `inputs.executorRequest` and `inputs.distilledContext`. The task-actor
   * template surfaces a hint telling the actor to consume them instead of
   * re-probing raw context fields. Only meaningful when
   * `actorTemplateVariant === 'task'`.
   */
  hasDistilledContext?: boolean;
  /**
   * Options forwarded exclusively to the context-distillation stage when
   * `contextFields` are configured. Use this to cap the context stage
   * independently, e.g. `contextOptions: { maxTurns: 3 }`.
   */
  contextOptions?: Partial<
    Pick<
      AxAgentOptions<any>,
      | 'maxTurns'
      | 'maxRuntimeChars'
      | 'promptLevel'
      | 'actorOptions'
      | 'responderOptions'
      | 'contextPolicy'
      | 'summarizerOptions'
    >
  >;
};

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
