import type {
  AxAIService,
  AxAgentCompletionProtocol,
  AxFunction,
  AxFunctionHandler,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import type { AxIField, AxSignatureConfig } from '../dsp/sig.js';
import { AxSignature, f } from '../dsp/sig.js';
import type { ParseSignature } from '../dsp/sigtypes.js';
import type {
  AxFieldValue,
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramDemos,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
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
  buildActionLogWithPolicy,
  buildInspectRuntimeBaselineCode,
  buildInspectRuntimeCode,
  type CheckpointSummaryState,
  generateCheckpointSummaryAsync,
  manageContext,
} from './contextManager.js';
import type {
  AxCodeRuntime,
  AxCodeSession,
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

export type AxAgentNamespace = {
  name: string;
  title: string;
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

  /** Optional metadata for discovery modules rendered by `listModuleFunctions(...)`. */
  namespaces?: readonly AxAgentNamespace[];

  /** Agent function configuration. */
  functions?: {
    /** Agent functions local to this agent (registered under namespace globals). */
    local?: AxAgentFunction[];
    /** Agent functions to share with direct child agents (one level). */
    shared?: AxAgentFunction[];
    /** Agent functions to share with ALL descendants recursively. */
    globallyShared?: AxAgentFunction[];
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
  /** Called after each Actor turn with the full actor result. */
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
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
    }
  >;
  /** Default forward options for the Responder sub-program. */
  responderOptions?: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'> & {
      description?: string;
    }
  >;
};

export type AxAgentRecursionOptions = Partial<
  Omit<AxProgramForwardOptions<string>, 'functions'>
> & {
  /** Maximum nested recursion depth for llmQuery sub-agent calls. */
  maxDepth?: number;
};

// ----- Constants -----

const DEFAULT_RLM_MAX_LLM_CALLS = 50;
const DEFAULT_RLM_MAX_RUNTIME_CHARS = 5_000;
const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
const DEFAULT_RLM_MAX_TURNS = 10;
const DEFAULT_RLM_MAX_RECURSION_DEPTH = 2;
const DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS = 1_200;
const DEFAULT_AGENT_MODULE_NAMESPACE = 'agents';
const DISCOVERY_LIST_MODULE_FUNCTIONS_NAME = 'listModuleFunctions';
const DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME = 'getFunctionDefinitions';

type AxResolvedContextPolicy = {
  preset: AxContextPolicyPreset;
  actionReplay: 'full' | 'adaptive' | 'minimal';
  recentFullActions: number;
  errorPruning: boolean;
  hindsightEvaluation: boolean;
  pruneRank: number;
  tombstoning:
    | boolean
    | Omit<AxProgramForwardOptions<string>, 'functions'>
    | undefined;
  stateSummary: { enabled: boolean; maxEntries?: number };
  stateInspection: { enabled: boolean; contextThreshold?: number };
  checkpoints: { enabled: boolean; triggerChars?: number };
};

type AxAgentActorResultPayload = {
  type: 'final' | 'ask_clarification';
  args: unknown[];
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
    actionReplay: contextPolicy?.expert?.replay ?? presetDefaults.actionReplay,
    recentFullActions: Math.max(
      contextPolicy?.expert?.recentFullActions ??
        presetDefaults.recentFullActions,
      0
    ),
    errorPruning:
      contextPolicy?.expert?.pruneErrors ?? presetDefaults.errorPruning,
    hindsightEvaluation: rankPruningEnabled,
    pruneRank: rankPruning?.minRank ?? presetDefaults.pruneRank,
    tombstoning: contextPolicy?.expert?.tombstones,
    stateSummary: {
      enabled: stateSummaryEnabled,
      maxEntries: contextPolicy?.state?.maxEntries ?? presetDefaults.maxEntries,
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
        recentFullActions: 1,
        errorPruning: true,
        hindsight: false,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 2_000,
        maxEntries: 6,
        checkpointsEnabled: true,
        checkpointTriggerChars: 2_000,
      };
    case 'lean':
      return {
        actionReplay: 'minimal' as const,
        recentFullActions: 0,
        errorPruning: true,
        hindsight: true,
        pruneRank: 2,
        stateSummary: true,
        inspect: true,
        inspectThreshold: 1_500,
        maxEntries: 6,
        checkpointsEnabled: true,
        checkpointTriggerChars: 1_500,
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
  private program: AxGen<IN, OUT>;
  private actorProgram!: AxGen<any, any>;
  private responderProgram!: AxGen<any, OUT>;
  private agents?: AxAnyAgentic[];
  private agentFunctions: AxAgentFunction[];
  private discoveryNamespaces: AxAgentNamespace[] = [];
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
  private responderDescription?: string;
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
      agentIdentity,
      agentModuleNamespace,
      signature,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
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
      actorCallback,
      mode,
      recursionOptions,
      actorOptions,
      responderOptions,
      inputUpdateCallback,
    } = options;

    this.ai = ai;
    this.agents = options.agents?.local;
    this.agentFunctions = options.functions?.local ?? [];
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

    // Create the base program (used for signature/schema access)
    const {
      agents: _a,
      fields: _f,
      functions: _fn,
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
      actorCallback,
      mode,
    };
    this.recursionForwardOptions = recursionOptions;

    const { description: actorDescription, ...actorForwardOptions } =
      actorOptions ?? {};
    const { description: responderDescription, ...responderForwardOptions } =
      responderOptions ?? {};

    this.actorDescription = actorDescription;
    this.actorForwardOptions = actorForwardOptions;

    this.responderDescription = responderDescription;
    this.responderForwardOptions = responderForwardOptions;
    this.inputUpdateCallback = inputUpdateCallback;
    this.discoveryNamespaces = normalizeAgentNamespaces(
      options.namespaces,
      new Set([
        'inputs',
        'llmQuery',
        'final',
        'ask_clarification',
        'inspect_runtime',
        DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
        DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
      ])
    );

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
    const sharedAgentFnList = options.functions?.shared ?? [];
    const globalSharedAgentFnList = options.functions?.globallyShared ?? [];
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
        childAgent._extendForSharedAgentFunctions(sharedAgentFnList);
      }
    }

    // Propagate global shared agent functions to ALL descendants (recursive)
    if (globalSharedAgentFnList.length > 0 && agents) {
      for (const childAgent of agents) {
        if (!(childAgent instanceof AxAgent)) continue;
        childAgent._extendForGlobalSharedAgentFunctions(
          globalSharedAgentFnList
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
    const availableModules = [...moduleSet].sort((a, b) => a.localeCompare(b));

    const actorDef = axBuildActorDefinition(
      this.actorDescription,
      contextFieldMeta,
      responderOutputFields,
      {
        runtimeUsageInstructions: this.runtimeUsageInstructions,
        maxSubAgentCalls: effectiveMaxSubAgentCalls,
        maxTurns: effectiveMaxTurns,
        hasInspectRuntime: resolveContextPolicy(this.rlmConfig.contextPolicy)
          .stateInspection.enabled,
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
  private _extendForSharedAgentFunctions(newFns: readonly AxFunction[]): void {
    if (newFns.length === 0) return;

    const existingKeys = new Set(
      this.agentFunctions.map((f) => `${f.namespace ?? 'utils'}.${f.name}`)
    );
    const excluded = new Set(this.excludedAgentFunctions);
    const toAdd: AxFunction[] = [];

    for (const fn of newFns) {
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

    if (toAdd.length === 0) return;
    this.agentFunctions = [...this.agentFunctions, ...toAdd];
    this._buildSplitPrograms();
  }

  /**
   * Extends this agent and all its descendants with globally shared agent functions.
   */
  private _extendForGlobalSharedAgentFunctions(
    newFns: readonly AxFunction[]
  ): void {
    // Collect children BEFORE extending to avoid recursing into newly added items
    const childrenToRecurse = this.agents
      ? this.agents.filter((a): a is AxAgent<any, any> => a instanceof AxAgent)
      : [];

    this._extendForSharedAgentFunctions(newFns);

    for (const childAgent of childrenToRecurse) {
      childAgent._extendForGlobalSharedAgentFunctions(newFns);
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

  public getExcludedAgents(): readonly string[] {
    return this.excludedAgents;
  }

  public getExcludedAgentFunctions(): readonly string[] {
    return this.excludedAgentFunctions;
  }

  public getSignature(): AxSignature {
    return this.program.getSignature();
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
    effectiveAbortSignal: AbortSignal | undefined
  ): Promise<{
    nonContextValues: Record<string, unknown>;
    contextMetadata: string;
    actionLog: string;
    actorResult: AxAgentActorResultPayload;
    actorFieldValues: Record<string, unknown>;
  }> {
    const rlm = this.rlmConfig;
    const runtime = this.runtime;

    const debug =
      options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;

    // 1. Build mutable in-flight input state
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

    const currentInputs: Record<string, unknown> = { ...rawValues };
    const signatureInputFieldNames = new Set(
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
        .filter((f) => rlm.contextFields.includes(f.name) && f.isOptional)
        .map((f) => f.name)
    );

    const recomputeTurnInputs = (validateRequiredContext: boolean): void => {
      const nextContextValues: Record<string, unknown> = {};
      const nextNonContextValues: Record<string, unknown> = {};

      for (const [k, v] of Object.entries(currentInputs)) {
        if (rlm.contextFields.includes(k)) {
          nextContextValues[k] = v;
        } else if (!bypassedSharedFields.has(k)) {
          nextNonContextValues[k] = v;
        }
        // Shared/global fields that are not marked local are excluded from
        // nonContextValues (they bypass the LLM and go directly to subagents).
      }

      if (validateRequiredContext) {
        for (const field of rlm.contextFields) {
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

      for (const k of Object.keys(sharedFieldValues)) {
        delete sharedFieldValues[k];
      }
      for (const sf of sharedFieldNames) {
        if (sf in currentInputs) {
          sharedFieldValues[sf] = currentInputs[sf];
        }
        // Also include shared fields that are context fields
        if (sf in contextValues) {
          sharedFieldValues[sf] = contextValues[sf];
        }
      }

      contextMetadata =
        buildRLMVariablesInfo(contextValues, {
          promptConfigByField: this.contextPromptConfigByField,
          inlinedFields: new Set(Object.keys(actorInlineContextValues)),
        }) || '(none)';
    };

    recomputeTurnInputs(false);

    // 2. Build runtime globals (context + llmQuery + tool functions)
    const maxSubAgentCalls = rlm.maxSubAgentCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
    const maxRuntimeChars =
      rlm.maxRuntimeChars ?? DEFAULT_RLM_MAX_RUNTIME_CHARS;
    const maxBatchedLlmQueryConcurrency = Math.max(
      1,
      rlm.maxBatchedLlmQueryConcurrency ?? DEFAULT_RLM_BATCH_CONCURRENCY
    );
    const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

    let llmCallCount = 0;
    const llmCallWarnThreshold = Math.floor(maxSubAgentCalls * 0.8);
    const configuredRecursionMaxDepth =
      this.recursionForwardOptions?.maxDepth ?? DEFAULT_RLM_MAX_RECURSION_DEPTH;
    const recursionMaxDepth = Math.max(0, configuredRecursionMaxDepth);

    const { maxDepth: _, ...recursionForwardOptions } =
      this.recursionForwardOptions ?? {};
    const {
      functions: __,
      description: ___,
      mem: ____,
      sessionId: _____,
      ...parentForwardOptions
    } = options ?? {};
    const childRecursionOptions: AxAgentRecursionOptions = {
      ...(this.recursionForwardOptions ?? {}),
      maxDepth: Math.max(0, recursionMaxDepth - 1),
    };
    const childContextFields = ['context'];
    const childSignature = f()
      .input('task', f.string('Task for recursive analysis'))
      .input('context', f.json('Optional context for the recursive task'))
      .output('answer', f.string('Answer from recursive analysis'))
      .build();

    const rlmMode = rlm.mode ?? 'simple';
    const childRlmMode =
      rlmMode === 'advanced' && (childRecursionOptions.maxDepth ?? 0) > 0
        ? 'advanced'
        : 'simple';

    let recursiveSubAgent:
      | AxGen<any, { answer: AxFieldValue }>
      | AxAgent<any, { answer: AxFieldValue }>
      | undefined;

    if (recursionMaxDepth > 0) {
      if (childRlmMode === 'advanced') {
        const advancedAgent = new AxAgent<any, { answer: AxFieldValue }>(
          {
            agentModuleNamespace: this.agentModuleNamespace,
            signature: childSignature,
          },
          {
            debug,
            ...rlm,
            agents: { local: this.agents },
            functions: {
              local: this.agentFunctions,
              discovery: this.functionDiscoveryEnabled,
            },
            contextFields: childContextFields,
            actorFields: undefined,
            recursionOptions: childRecursionOptions,
            actorOptions: this.actorForwardOptions,
            responderOptions: this.responderForwardOptions,
          }
        );

        recursiveSubAgent = advancedAgent;
      } else {
        recursiveSubAgent = new AxGen<any, { answer: AxFieldValue }>(
          childSignature,
          childRecursionOptions
        );
      }
    }

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

    const llmQuery = async (
      queryOrQueries:
        | string
        | { query: string; context?: unknown }
        | readonly { query: string; context?: unknown }[],
      ctx?: unknown
    ): Promise<string | string[]> => {
      // Normalize single-object form
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

      if (Array.isArray(queryOrQueries)) {
        return runWithConcurrency(
          queryOrQueries,
          maxBatchedLlmQueryConcurrency,
          async (q) => {
            try {
              return (await llmQuery(q.query, q.context)) as string;
            } catch (err) {
              if (err instanceof AxAIServiceAbortedError) {
                throw err;
              }
              return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
            }
          }
        );
      }

      const query = queryOrQueries as string;

      const runSingleLlmQuery = async (
        singleQuery: string,
        singleCtx?: unknown
      ): Promise<string> => {
        const normalizedCtx =
          singleCtx === undefined
            ? undefined
            : typeof singleCtx === 'string'
              ? truncateText(singleCtx, maxRuntimeChars)
              : singleCtx;

        llmCallCount++;
        if (llmCallCount > maxSubAgentCalls) {
          return `[ERROR] Sub-query budget exhausted (${maxSubAgentCalls}/${maxSubAgentCalls}). Use the data you have already accumulated to produce your final answer.`;
        }

        if (recursionMaxDepth <= 0 || !recursiveSubAgent) {
          return `[ERROR] Recursion depth limit reached (${configuredRecursionMaxDepth}).`;
        }

        const maxAttempts = 3;
        let lastError: unknown;
        const formatSubAgentError = (error: unknown) =>
          `[ERROR] ${error instanceof Error ? error.message : String(error)}`;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const recursiveResult = await recursiveSubAgent.forward(
              ai,
              {
                task: singleQuery,
                ...(normalizedCtx !== undefined
                  ? { context: normalizedCtx }
                  : childRlmMode === 'advanced'
                    ? { context: '' }
                    : {}),
              },
              {
                ...(parentForwardOptions as Partial<
                  Omit<AxProgramForwardOptions<string>, 'functions'>
                >),
                ...(recursionForwardOptions as Partial<
                  Omit<AxProgramForwardOptions<string>, 'functions'>
                >),
                abortSignal: effectiveAbortSignal,
                debug,
              }
            );
            return normalizeSubAgentAnswer(recursiveResult.answer);
          } catch (err) {
            if (err instanceof AxAIServiceAbortedError) {
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
                if (effectiveAbortSignal && onAbort) {
                  effectiveAbortSignal.removeEventListener('abort', onAbort);
                }
              };

              const onResolve = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
              };

              const timer = setTimeout(onResolve, delay);
              if (!effectiveAbortSignal) {
                return;
              }

              onAbort = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                cleanup();
                reject(
                  new AxAIServiceAbortedError(
                    'rlm-llm-query-retry-backoff',
                    effectiveAbortSignal.reason
                      ? String(effectiveAbortSignal.reason)
                      : 'Aborted during retry backoff'
                  )
                );
              };

              if (effectiveAbortSignal.aborted) {
                onAbort();
                return;
              }

              effectiveAbortSignal.addEventListener('abort', onAbort, {
                once: true,
              });
            });
          }
        }
        return formatSubAgentError(lastError);
      };

      const result = await runSingleLlmQuery(query, ctx);
      if (llmCallCount === llmCallWarnThreshold) {
        return `${result}\n[WARNING] ${llmCallCount}/${maxSubAgentCalls} sub-queries used. Plan to wrap up soon.`;
      }
      return result;
    };

    let actorResultPayload: AxAgentActorResultPayload | undefined;
    const setActorResultPayload = (
      type: AxAgentActorResultPayload['type'],
      args: unknown[]
    ) => {
      if (args.length === 0) {
        throw new Error(`${type}() requires at least one argument`);
      }
      actorResultPayload = { type, args };
    };
    const { finalFunction, askClarificationFunction, protocol } =
      createCompletionBindings(setActorResultPayload);
    // Build tool function globals for the runtime
    const toolGlobals = this.buildRuntimeGlobals(
      effectiveAbortSignal,
      sharedFieldValues,
      ai,
      protocol
    );
    const effectiveContextConfig = resolveContextPolicy(rlm.contextPolicy);

    const agentFunctionNamespaces = [
      ...new Set(this.agentFunctions.map((f) => f.namespace ?? 'utils')),
    ];
    const runtimeInputs = { ...currentInputs };
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
      ...new Set([...Object.keys(runtimeInputs), ...signatureInputFieldNames]),
    ].filter((k) => !reservedTopLevelNames.has(k));
    const runtimeTopLevelInputAliases: Record<string, unknown> = {};
    for (const key of runtimeAliasKeys) {
      runtimeTopLevelInputAliases[key] = runtimeInputs[key];
    }

    const refreshRuntimeBindings = () => {
      for (const key of Object.keys(runtimeInputs)) {
        delete runtimeInputs[key];
      }
      for (const [key, value] of Object.entries(currentInputs)) {
        runtimeInputs[key] = value;
      }

      for (const key of runtimeAliasKeys) {
        runtimeTopLevelInputAliases[key] = currentInputs[key];
      }
    };

    const protectedRuntimeNames = [...reservedTopLevelNames];
    const inspectReservedNames = [
      ...reservedTopLevelNames,
      ...runtimeAliasKeys,
    ];
    let session!: AxCodeSession;
    let inspectBaselineNames: string[] | undefined;

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
          ? parsed.filter((value): value is string => typeof value === 'string')
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

    // inspect_runtime: queries worker globalThis for current variable state.
    const inspectRuntime = effectiveContextConfig.stateInspection.enabled
      ? async (): Promise<string> => inspectRuntimeState()
      : undefined;

    const formatStateSummary = (snapshot: string): string => {
      const maxEntries =
        effectiveContextConfig.stateSummary.maxEntries &&
        effectiveContextConfig.stateSummary.maxEntries > 0
          ? effectiveContextConfig.stateSummary.maxEntries
          : 8;

      return snapshot
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, maxEntries)
        .join('\n');
    };

    const captureRuntimeStateSummary = async (): Promise<
      string | undefined
    > => {
      if (!effectiveContextConfig.stateSummary.enabled) {
        return undefined;
      }

      const snapshot = await inspectRuntimeState();
      const formatted = formatStateSummary(snapshot);
      return formatted || '(no user variables)';
    };

    const createSession = () => {
      inspectBaselineNames = undefined;
      return runtime.createSession({
        ...runtimeTopLevelInputAliases,
        inputs: runtimeInputs,
        llmQuery,
        final: finalFunction,
        ask_clarification: askClarificationFunction,
        ...(inspectRuntime ? { inspect_runtime: inspectRuntime } : {}),
        ...toolGlobals,
      });
    };

    const timeoutRestartNotice = `[The JavaScript runtime was restarted; all global state was lost and must be recreated if needed.]`;
    session = createSession();

    const isSessionClosedError = (err: unknown): boolean => {
      return err instanceof Error && err.message === 'Session is closed';
    };

    const isExecutionTimedOutError = (err: unknown): boolean => {
      return err instanceof Error && err.message === 'Execution timed out';
    };

    const formatInterpreterOutput = (result: unknown) => {
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
    };

    const formatInterpreterError = (err: unknown): string => {
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
          if (depth > 4) return '[cause chain truncated]';
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
    };

    const hasCompletionSignalCall = (code: string): boolean => {
      const sanitized = stripJsStringsAndComments(code);
      return (
        /\bfinal\s*\(/.test(sanitized) ||
        /\bask_clarification\s*\(/.test(sanitized)
      );
    };

    const looksLikePromisePlaceholder = (result: unknown): boolean => {
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof (result as { then?: unknown }).then === 'function'
      ) {
        return true;
      }
      return typeof result === 'string' && result.trim() === '[object Promise]';
    };

    const waitForActorCompletionSignal = async (): Promise<void> => {
      if (actorResultPayload) {
        return;
      }
      for (let i = 0; i < 3 && !actorResultPayload; i++) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    };

    const executeInterpreterCode = async (
      code: string
    ): Promise<{ output: string; isError: boolean }> => {
      const completionOutput = {
        output: formatInterpreterOutput(undefined),
        isError: false,
      };

      try {
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames: protectedRuntimeNames,
        });
        if (actorResultPayload) {
          return completionOutput;
        }
        if (
          hasCompletionSignalCall(code) &&
          looksLikePromisePlaceholder(result)
        ) {
          await waitForActorCompletionSignal();
          if (actorResultPayload) {
            return completionOutput;
          }
        }
        return { output: formatInterpreterOutput(result), isError: false };
      } catch (err) {
        if (
          err instanceof AxAgentProtocolCompletionSignal ||
          actorResultPayload
        ) {
          return completionOutput;
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
        // Timeout: worker was reset internally, next execute() auto-creates a new worker.
        if (isExecutionTimedOutError(err)) {
          return {
            output: truncateText(
              `${timeoutRestartNotice}\n${formatInterpreterError(err)}`,
              maxRuntimeChars
            ),
            isError: true,
          };
        }
        // Unexpected session close: restart with a new session and retry.
        if (isSessionClosedError(err)) {
          try {
            session = createSession();
            actorResultPayload = undefined;
            const retryResult = await session.execute(code, {
              signal: effectiveAbortSignal,
              reservedNames: protectedRuntimeNames,
            });
            return {
              output: truncateText(
                `${timeoutRestartNotice}\n${formatInterpreterOutput(retryResult)}`,
                maxRuntimeChars
              ),
              isError: false,
            };
          } catch (retryErr) {
            return {
              output: truncateText(
                `${timeoutRestartNotice}\n${formatInterpreterError(retryErr)}`,
                maxRuntimeChars
              ),
              isError: true,
            };
          }
        }
        return {
          output: truncateText(formatInterpreterError(err), maxRuntimeChars),
          isError: true,
        };
      }
    };

    const applyInputUpdateCallback = async () => {
      if (!this.inputUpdateCallback) {
        return;
      }
      const patch = await this.inputUpdateCallback({
        ...(currentInputs as IN),
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
        if (signatureInputFieldNames.has(key)) {
          currentInputs[key] = value;
        }
      }
    };

    const getPatchableSession = (runtimeSession: AxCodeSession) => {
      if (typeof runtimeSession.patchGlobals !== 'function') {
        throw new Error(
          'AxCodeSession.patchGlobals() is required when using inputUpdateCallback'
        );
      }
      return runtimeSession;
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
          `Failed to sync runtime inputs: ${formatInterpreterError(err)}`
        );
      }
    };

    // 3. Actor loop (TypeScript-managed)
    const actionLogEntries: ActionLogEntry[] = [];
    let runtimeStateSummary: string | undefined;

    const actorMergedOptions = {
      ...this._genOptions,
      ...this.actorForwardOptions,
      ...options,
      debug,
      abortSignal: effectiveAbortSignal,
    };

    const actorFieldValues: Record<string, unknown> = {};
    const contextThreshold = effectiveContextConfig.stateInspection.enabled
      ? effectiveContextConfig.stateInspection.contextThreshold
      : undefined;
    let checkpointState: CheckpointSummaryState | undefined;

    const getCheckpointCandidates = () => {
      const checkpointableCount = Math.max(
        actionLogEntries.length - effectiveContextConfig.recentFullActions,
        0
      );

      return actionLogEntries
        .slice(0, checkpointableCount)
        .filter((entry) => !entry.tags.includes('error'));
    };

    const renderActionLog = () =>
      buildActionLogWithPolicy(actionLogEntries, {
        actionReplay: effectiveContextConfig.actionReplay,
        recentFullActions: effectiveContextConfig.recentFullActions,
        stateSummary: runtimeStateSummary,
        checkpointSummary: checkpointState?.summary,
        checkpointTurns: checkpointState?.turns,
      }) || '(no actions yet)';

    const refreshCheckpointSummary = async () => {
      if (!effectiveContextConfig.checkpoints.enabled) {
        checkpointState = undefined;
        return;
      }

      const rawActionLog = buildActionLogWithPolicy(actionLogEntries, {
        actionReplay: effectiveContextConfig.actionReplay,
        recentFullActions: effectiveContextConfig.recentFullActions,
        stateSummary: runtimeStateSummary,
      });

      const triggerChars = effectiveContextConfig.checkpoints.triggerChars;
      if (!triggerChars || rawActionLog.length <= triggerChars) {
        checkpointState = undefined;
        return;
      }

      const checkpointEntries = getCheckpointCandidates();
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
        summary: await generateCheckpointSummaryAsync(ai, checkpointEntries),
      };
    };

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        await applyInputUpdateCallback();
        recomputeTurnInputs(true);
        runtimeStateSummary = await captureRuntimeStateSummary();
        await refreshCheckpointSummary();

        // Build action log, adding inspect_runtime hint when it gets large
        let actionLogText = renderActionLog();
        if (contextThreshold && actionLogText.length > contextThreshold) {
          actionLogText +=
            '\n\n[HINT: Action log is large. Call `const state = await inspect_runtime()` for a compact snapshot of current variables instead of re-reading old outputs.]';
        }

        const actorResult = await this.actorProgram.forward(
          ai,
          {
            ...nonContextValues,
            ...actorInlineContextValues,
            contextMetadata,
            actionLog: actionLogText,
          },
          actorMergedOptions
        );

        // After the first actor turn, hide the system prompt from debug logs
        if (turn === 0) {
          actorMergedOptions.debugHideSystemPrompt = true;
        }

        // Call actorCallback if provided
        if (rlm.actorCallback) {
          await rlm.actorCallback(actorResult as Record<string, unknown>);
        }

        // Capture actorField values from this turn
        for (const fieldName of this.actorFieldNames) {
          if (fieldName in actorResult) {
            actorFieldValues[fieldName] = actorResult[fieldName];
          }
        }

        let code = actorResult.javascriptCode as string | undefined;
        const trimmedCode = code?.trim();
        if (!code || !trimmedCode) {
          break;
        }
        code = trimmedCode;

        // Build actorFields output for actionLog
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

        // Reset Actor completion payload before execution.
        actorResultPayload = undefined;

        if (this.enforceIncrementalConsoleTurns) {
          const policyViolation = validateActorTurnCodePolicy(code);
          if (policyViolation) {
            actionLogEntries.push({
              turn: turn + 1,
              code,
              output: policyViolation,
              actorFieldsOutput,
              tags: ['error'],
            });

            await manageContext(
              actionLogEntries,
              actionLogEntries.length - 1,
              effectiveContextConfig,
              ai
            );
            runtimeStateSummary = await captureRuntimeStateSummary();
            await refreshCheckpointSummary();
            continue;
          }
        }

        if (this.inputUpdateCallback) {
          await syncRuntimeInputsToSession();
        }
        const { output, isError } = await executeInterpreterCode(code);

        actionLogEntries.push({
          turn: turn + 1,
          code,
          output,
          actorFieldsOutput,
          tags: isError ? ['error'] : [],
        });

        // Semantic context management: hindsight eval, tombstoning, pruning
        await manageContext(
          actionLogEntries,
          actionLogEntries.length - 1,
          effectiveContextConfig,
          ai
        );
        runtimeStateSummary = await captureRuntimeStateSummary();
        await refreshCheckpointSummary();

        // Exit when Actor signaled completion via final(...) or ask_clarification(...).
        if (actorResultPayload) {
          break;
        }
      }
    } finally {
      try {
        session.close();
      } catch {
        // Ignore close errors
      }
    }

    await refreshCheckpointSummary();

    const actorResult =
      actorResultPayload ??
      ({
        type: 'final',
        args: [
          buildActionEvidenceSummary(actionLogEntries, {
            stateSummary: runtimeStateSummary,
            checkpointSummary: checkpointState?.summary,
            checkpointTurns: checkpointState?.turns,
          }),
        ],
      } satisfies AxAgentActorResultPayload);

    return {
      nonContextValues,
      contextMetadata,
      actionLog: renderActionLog(),
      actorResult,
      actorFieldValues,
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
    try {
      const ai = this.ai ?? parentAi;

      const debug =
        options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;

      const { nonContextValues, actorResult, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

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
    try {
      const ai = this.ai ?? parentAi;

      const debug =
        options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;

      // Actor loop runs non-streaming
      const { nonContextValues, actorResult, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

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
    protocol?: AxAgentCompletionProtocol
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

      return await fn.func(callArgs, { abortSignal, ai, protocol });
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
    protocol?: AxAgentCompletionProtocol
  ): (...args: unknown[]) => Promise<unknown> {
    if (
      typeof sharedFieldValues !== 'function' &&
      (!sharedFieldValues || Object.keys(sharedFieldValues).length === 0)
    ) {
      return AxAgent.wrapFunction(fn, abortSignal, ai, protocol);
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
      return await fn.func(merged, { abortSignal, ai, protocol });
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
    protocol?: AxAgentCompletionProtocol
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = {};
    const callableLookup = new Map<string, DiscoveryCallableMeta>();
    const moduleLookup = new Map<string, string[]>();
    const moduleMetaLookup = new Map<string, AxAgentNamespace>();
    for (const namespaceMeta of this.discoveryNamespaces) {
      moduleMetaLookup.set(namespaceMeta.name, namespaceMeta);
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
      (globals[ns] as Record<string, unknown>)[agentFn.name] =
        AxAgent.wrapFunction(agentFn, abortSignal, ai, protocol);
      registerCallable(
        {
          module: ns,
          name: agentFn.name,
          description: agentFn.description,
          parameters: agentFn.parameters,
          returns: agentFn.returns,
          examples: agentFn.examples,
        },
        `${ns}.${agentFn.name}`
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

        agentsObj[fn.name] = AxAgent.wrapFunctionWithSharedFields(
          fn,
          abortSignal,
          getApplicableSharedFields,
          ai,
          protocol
        );
        registerCallable(
          {
            module: this.agentModuleNamespace,
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
          },
          `${this.agentModuleNamespace}.${fn.name}`
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

/**
 * Configuration options for creating an agent using the agent() factory function.
 */
export interface AxAgentConfig<_IN extends AxGenIn, _OUT extends AxGenOut>
  extends AxAgentOptions<_IN> {
  ai?: AxAIService;
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
  const { ai, agentIdentity, ...options } = config;

  return new AxAgent(
    {
      ai,
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
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  if (items.length === 0) {
    return [];
  }

  const results: TOut[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
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

function normalizeAgentNamespaces(
  namespaces: readonly AxAgentNamespace[] | undefined,
  reservedNames: ReadonlySet<string>
): AxAgentNamespace[] {
  if (!namespaces || namespaces.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  return namespaces.map((namespaceMeta) => {
    const name = namespaceMeta.name.trim();
    const title = namespaceMeta.title.trim();
    const description = namespaceMeta.description.trim();

    if (!name) {
      throw new Error(
        'Agent namespace metadata name must be a non-empty string'
      );
    }
    if (!title) {
      throw new Error(
        `Agent namespace "${name}" must define a non-empty title`
      );
    }
    if (!description) {
      throw new Error(
        `Agent namespace "${name}" must define a non-empty description`
      );
    }
    if (reservedNames.has(name)) {
      throw new Error(`Agent namespace "${name}" is reserved`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate agent namespace "${name}"`);
    }
    seen.add(name);

    return {
      name,
      title,
      description,
    };
  });
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
  moduleMetaLookup: ReadonlyMap<string, AxAgentNamespace>
): string {
  return modules
    .map((module) => {
      const functions = [...(moduleLookup.get(module) ?? [])].sort((a, b) =>
        a.localeCompare(b)
      );
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
