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
import type { AxPlaybookOptions } from '../../dsp/playbook.js';
import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgramStreamingForwardOptionsWithModels,
  AxProgramUsage,
} from '../../dsp/types.js';
import type {
  AxAgentRecursiveStats,
  AxAgentRecursiveTraceNode,
} from '../agentRecursiveOptimize.js';
import type { AxAgentAutoUpgrade } from '../config.js';
import type { AxAgentOnContextEvent } from '../contextEvents.js';
import type { AxAgentContextMapConfig } from '../contextMap.js';
import type { AxContextPolicyConfig } from '../rlm.js';
import type {
  AxAgentActorTurnCallback,
  AxAgentFunctionCollection,
  AxAgentInputUpdateCallback,
  AxAgentStructuredClarification,
  AxContextFieldInput,
  AxExecutorModelPolicy,
} from './agentStateTypes.js';

/**
 * Demo traces for AxAgent's split architecture.
 * Actor demos use the runtime code field (`javascriptCode` for JavaScript,
 * `<language>Code` for other runtimes such as `pythonCode`).
 * Responder demos use the agent's output type + optional input fields.
 */
export type AxAgentDemos<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  PREFIX extends string = string,
> =
  | {
      programId: `${PREFIX}.actor`;
      traces: Record<string, AxFieldValue>[];
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

/**
 * Options for `AxAgent.playbook()`. Builds an `AxPlaybook` bound to an agent
 * stage (the actor by default). The evolution engine (ACE) is hidden, exactly
 * as in the standalone `playbook()` factory.
 */
export type AxAgentPlaybookOptions = {
  studentAI?: Readonly<AxAIService>;
  teacherAI?: Readonly<AxAIService>;
  /** Which agent stage to evolve a playbook for. Defaults to `'actor'`. */
  target?: 'actor' | 'responder';
  /** Render the evolving playbook into the live stage. Defaults to `true`. */
  apply?: boolean;
} & Pick<
  AxPlaybookOptions,
  | 'verbose'
  | 'seed'
  | 'maxEpochs'
  | 'maxReflectorRounds'
  | 'maxSectionSize'
  | 'allowDynamicSections'
  | 'initialPlaybook'
  | 'auto'
>;

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

  /**
   * Optional persistent context map for recurring long-context work.
   * When configured, Ax injects the map into the distiller prompt and updates
   * it once after each successful completed run. Use `onUpdate` to persist the
   * updated snapshot.
   */
  contextMap?: AxAgentContextMapConfig;

  /**
   * Tools registered under their configured namespace globals. May contain
   * `AxFunction` / `AxAgentFunction` entries, grouped function modules, or
   * `AxAgentic` instances — agents are auto-converted via `.getFunction()` and
   * land under their `agentIdentity.namespace` (or `utils` if unset), exactly
   * like a plain function. Pass an `AxAgent` here to use it as a child tool.
   */
  functions?: AxAgentFunctionCollection;
  /** Enables runtime callable discovery (modules + on-demand definitions). */
  functionDiscovery?: boolean;

  /**
   * Smart defaults — ON by default (set `false` to opt out). Two upgrades,
   * both driven by character counts so callers don't have to remember the
   * underlying knobs:
   *
   * - `functionDiscovery`: when the option is left unset and the estimated
   *   inline docs of discoverable functions exceed `aboveFunctionDocChars`
   *   (default 10_000), discovery is enabled automatically. An explicit
   *   `functionDiscovery: true | false` always wins.
   * - `contextFields`: per run, an undeclared input value whose serialized
   *   size exceeds `promoteAboveChars` (default 8_000, strictly greater) is
   *   kept runtime-only like a declared context field: the prompt gets a
   *   truncated preview (`previewChars`, default 1_200) plus a
   *   `contextMetadata` entry, while the full value stays addressable in the
   *   code runtime as `inputs.<field>`. Fields declared in `contextFields`
   *   keep their declared config. Values in required non-string fields
   *   (arrays, objects, numbers, media) are left inline — declare those in
   *   `contextFields` explicitly. Each promotion emits a
   *   `field_auto_promoted` context event for observability.
   *
   * Pass an object to tune or disable each side independently. TS-first: the
   * 5 non-TS ports do not ship auto-upgrade yet.
   */
  autoUpgrade?: AxAgentAutoUpgrade;

  /**
   * Advisory local relevance ranker — ON by default (set `false` to opt out).
   * Enabled by default since its A/B gate passed (substance-judged,
   * n=49/variant/model: small model discover-precision 24%->90% and answer
   * substance 14%->29%; frontier-model control substance 63%->88% with fewer
   * turns). TS-first: the 5 non-TS ports do not ship the ranker yet, so
   * cross-language behavior diverges here until they catch up.
   *
   * When enabled, a cheap deterministic token-overlap ranker scores this
   * agent's discoverable capabilities against the task and injects a
   * non-authoritative "Likely Relevant" hint into the executor turn. Ranked
   * domains light up with their prerequisites: modules require
   * `functionDiscovery`; skills/memories require their catalogs. The hint
   * lands in a dynamic, non-cached field, so it does not affect the prompt
   * cache; the full lists and the `discover()`/`recall()` flows are unchanged
   * and the model may still choose anything. Pass an object to tune `topK`
   * (default 3) / `minScore` (default 0.08).
   */
  relevanceRanking?: boolean | { topK?: number; minScore?: number };

  /**
   * Optional skills search callback. When set, the executor runtime gains a
   * `discover({ skills })` path. The callback receives the raw search strings
   * and returns matched skills (`{ id?, name, content }`); each returned skill's
   * content is rendered into the executor system prompt for subsequent turns
   * (sorted by id to keep the prefix cache stable). `discover(...)` itself
   * returns nothing — the actor inspects the **Loaded Skills** section of the
   * next turn's prompt to see what landed.
   */
  onSkillsSearch?: import('./skillsTypes.js').AxAgentSkillsSearchFn;

  /**
   * Static skill catalog. When set and no `onSkillsSearch` callback is
   * provided, ax backs `discover({ skills })` with a built-in deterministic
   * local search over the catalog — skills work batteries-included with zero
   * host search code. A host `onSkillsSearch` always takes precedence for
   * search; the catalog still powers the advisory relevance hint (with
   * `relevanceRanking`). Unlike `skills`, catalog content is NOT preloaded
   * into the prompt — entries load only when matched.
   */
  skillsCatalog?: readonly import('./skillsTypes.js').AxAgentCatalogSkill[];

  /**
   * Skills to preload into the executor prompt at startup, in the same
   * shape returned by `onSkillsSearch` ({ id?, name, content }). Useful when
   * the caller already knows which skills are relevant and wants to
   * skip the actor's `discover({ skills })` round-trip. Merged with skills
   * passed at forward()-time (forward overrides by id). Does NOT
   * fire `onLoadedSkills` — that callback is for runtime-loaded skills.
   */
  skills?: readonly import('./skillsTypes.js').AxAgentSkillResult[];

  /**
   * Optional callback fired whenever `discover({ skills })` loads skills. Receives
   * the matched `{ id?, name, content }[]` from `onSkillsSearch`. Use this for
   * analytics, telemetry, or feedback loops on skill relevance — it does
   * not affect runtime behaviour.
   */
  onLoadedSkills?: (
    results: readonly import('./skillsTypes.js').AxAgentSkillResult[]
  ) => void | Promise<void>;

  /**
   * Optional callback fired once per agent forward when skill usage tracking
   * is enabled. Receives actor-declared skills that actually influenced the
   * executor (`{ id, name, reason?, stage }`). Unknown ids are dropped.
   */
  onUsedSkills?: import('./skillsTypes.js').AxAgentUsedSkillsCallback;

  /**
   * Optional memories search callback. When set, the distiller and executor
   * stages gain a `recall(searches: string[]): void` global, and both
   * stages get a `memories` input field. The callback receives the raw
   * search strings plus a snapshot of `inputs.memories` already loaded
   * for the current run (`alreadyLoaded`), and returns matched memories
   * (`{ id, content }`); the runtime appends matched entries to
   * `inputs.memories` (deduped by id, sorted) so the next turn's prompt
   * includes them. Use `alreadyLoaded` to skip work for entries the
   * actor already has — e.g. filter your vector search by `id NOT IN
   * alreadyLoaded`. `recall()` itself returns nothing — the actor reads
   * `inputs.memories` next turn to see what landed. Memories loaded by
   * the distiller thread to the executor automatically; the responder
   * does not receive the memories field. Memories live for one
   * `.forward()` call; persist them externally to carry across calls.
   */
  onMemoriesSearch?: import('./memoriesTypes.js').AxAgentMemoriesSearchFn;

  /**
   * Static memory catalog. When set and no `onMemoriesSearch` callback is
   * provided, ax backs `recall(...)` with a built-in deterministic local
   * search over the catalog — memories work batteries-included with zero host
   * search code. A host `onMemoriesSearch` always takes precedence for
   * search; the catalog still powers the advisory relevance hint (with
   * `relevanceRanking`). Catalog content is NOT preloaded into the prompt —
   * entries load only when recalled. To preload specific memories for a run,
   * pass them as the `memories` input value at forward time:
   * `forward(ai, { ..., memories: [{ id, content }] })`.
   */
  memoriesCatalog?: readonly import('./memoriesTypes.js').AxAgentMemoryResult[];

  /**
   * Optional callback fired whenever `recall(...)` loads memories. Receives
   * the matched `{ id, content }[]` from `onMemoriesSearch`. Use this for
   * load telemetry, cache warming, or feedback loops on retrieval relevance —
   * it does not mean the actor used every memory in its final reasoning.
   */
  onLoadedMemories?: (
    results: readonly import('./memoriesTypes.js').AxAgentMemoryResult[]
  ) => void | Promise<void>;

  /**
   * Optional callback fired once per agent forward when memory usage tracking
   * is enabled. Receives actor-declared memories that actually influenced the
   * distiller or executor (`{ id, reason?, stage }`). Unknown ids are dropped.
   */
  onUsedMemories?: import('./memoriesTypes.js').AxAgentUsedMemoriesCallback;

  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: import('../rlm.js').AxCodeRuntime;
  /** Actor prompt verbosity and scaffolding level (default: 'default'). */
  promptLevel?: 'default' | 'detailed';
  /** Global cap on recursive sub-agent calls across all descendants (default: 100). */
  maxSubAgentCalls?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** Maximum characters to keep from runtime output and console/log replay. */
  maxRuntimeChars?: number;
  /**
   * Maximum serialized characters for a `final(task, evidence)` evidence
   * object crossing the host boundary (default: 50000). Oversized evidence
   * throws inside the actor turn so the model narrows and retries.
   */
  maxEvidenceChars?: number;
  /** Context replay, checkpointing, and runtime-state policy. */
  contextPolicy?: AxContextPolicyConfig;
  /** Default options for the internal checkpoint summarizer. */
  summarizerOptions?: Omit<AxProgramForwardOptions<string>, 'functions'>;
  /**
   * Called after each actor turn is recorded with both the raw runtime
   * result and the formatted action-log output.
   */
  actorTurnCallback?: AxAgentActorTurnCallback;
  /**
   * Called when AxAgent measures context pressure or creates/clears compacted
   * context. Use for observability and evaluation; failures are ignored.
   */
  onContextEvent?: AxAgentOnContextEvent;
  /**
   * Called when the executor signals task progress via `reportSuccess(message)` or `reportFailure(message)`.
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
/**
 * Forward options for `AxAgent.forward(...)`. Extends the dsp-layer
 * `AxProgramForwardOptionsWithModels` with agent-specific knobs that only
 * make sense at the agent boundary (currently `skills` for one-shot
 * preloading). Forward-time `skills` merge on top of init-time `skills`
 * (forward overrides by id).
 */
export type AxAgentForwardOptions<T extends Readonly<AxAIService>> =
  AxProgramForwardOptionsWithModels<T> & {
    skills?: readonly import('./skillsTypes.js').AxAgentSkillResult[];
    onUsedMemories?: import('./memoriesTypes.js').AxAgentUsedMemoriesCallback;
    onUsedSkills?: import('./skillsTypes.js').AxAgentUsedSkillsCallback;
  };

export type AxAgentStreamingForwardOptions<T extends Readonly<AxAIService>> =
  AxProgramStreamingForwardOptionsWithModels<T> & {
    skills?: readonly import('./skillsTypes.js').AxAgentSkillResult[];
    onUsedMemories?: import('./memoriesTypes.js').AxAgentUsedMemoriesCallback;
    onUsedSkills?: import('./skillsTypes.js').AxAgentUsedSkillsCallback;
  };

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
