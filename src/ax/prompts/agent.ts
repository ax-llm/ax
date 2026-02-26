import type {
  AxAIService,
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
import type {
  AxCodeRuntime,
  AxContextManagementConfig,
  AxRLMConfig,
} from './rlm.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';
import type { ActionLogEntry } from './contextManager.js';
import {
  buildActionLog,
  buildInspectRuntimeCode,
  manageContext,
} from './contextManager.js';

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

export type AxContextFieldInput =
  | string
  | {
      field: string;
      promptMaxChars?: number;
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

export type AxAgentOptions = Omit<
  AxProgramForwardOptions<string>,
  'functions' | 'description'
> & {
  debug?: boolean;
  /**
   * Input fields used as context.
   * - `string`: runtime-only (legacy behavior)
   * - `{ field, promptMaxChars }`: runtime + conditionally inlined into Actor prompt
   */
  contextFields: readonly AxContextFieldInput[];

  /** Child agents and agent sharing configuration. */
  agents?: {
    /** Agents registered under the `agents.*` namespace (local to this agent only). */
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
    local?: AxFunction[];
    /** Agent functions to share with direct child agents (one level). */
    shared?: AxFunction[];
    /** Agent functions to share with ALL descendants recursively. */
    globallyShared?: AxFunction[];
    /** Agent function names this agent should NOT receive from parents. */
    excluded?: string[];
  };

  /** Code runtime for the REPL loop (default: AxJSRuntime). */
  runtime?: AxCodeRuntime;
  /** Cap on recursive sub-LM calls (default: 50). */
  maxLlmCalls?: number;
  /** Maximum characters for RLM runtime payloads (default: 5000). */
  maxRuntimeChars?: number;
  /** Maximum parallel llmQuery calls in batched mode (default: 8). */
  maxBatchedLlmQueryConcurrency?: number;
  /** Maximum Actor turns before forcing Responder (default: 10). */
  maxTurns?: number;
  /** @deprecated Use `contextManagement.errorPruning` instead. */
  trajectoryPruning?: boolean;
  /** Semantic context management configuration. */
  contextManagement?: AxContextManagementConfig;
  /** Output field names the Actor should produce (in addition to javascriptCode). */
  actorFields?: string[];
  /** Called after each Actor turn with the full actor result. */
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
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

type AxAgentActorResultPayload = {
  type: 'final' | 'ask_clarification';
  args: unknown[];
};

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
  private agentFunctions: AxFunction[];
  private debug?: boolean;
  private options?: Readonly<AxAgentOptions>;
  private rlmConfig: AxRLMConfig;
  private runtime: AxCodeRuntime;
  private actorFieldNames: string[];
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
  private contextPromptMaxCharsByField: Map<string, number> = new Map();

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

  constructor(
    {
      ai,
      agentIdentity,
      signature,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      agentIdentity?: Readonly<{ name: string; description: string }>;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
    }>,
    options: Readonly<AxAgentOptions>
  ) {
    const {
      debug,
      contextFields,
      runtime,
      maxLlmCalls,
      maxRuntimeChars,
      maxBatchedLlmQueryConcurrency,
      maxTurns,
      trajectoryPruning,
      contextManagement,
      actorFields,
      actorCallback,
      mode,
      recursionOptions,
      actorOptions,
      responderOptions,
    } = options;

    this.ai = ai;
    this.agents = options.agents?.local;
    this.agentFunctions = options.functions?.local ?? [];
    this.debug = debug;
    this.options = options;
    this.runtime = runtime ?? new AxJSRuntime();

    // Create the base program (used for signature/schema access)
    const { agents: _a, fields: _f, functions: _fn, ...genOptions } = options;
    this.program = new AxGen<IN, OUT>(signature, genOptions);
    const inputFields = this.program.getSignature().getInputFields();

    const normalizedContext = normalizeContextFields(
      contextFields,
      inputFields,
      DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS
    );
    this.contextPromptMaxCharsByField = normalizedContext.promptMaxCharsByField;

    this.rlmConfig = {
      contextFields: normalizedContext.contextFieldNames,
      sharedFields: options.fields?.shared,
      runtime: this.runtime,
      maxLlmCalls,
      maxRuntimeChars,
      maxBatchedLlmQueryConcurrency,
      maxTurns,
      trajectoryPruning,
      contextManagement,
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

    if (this.program.getSignature().getDescription()) {
      throw new Error(
        'AxAgent does not support signature-level descriptions. ' +
          'Use setActorDescription() and/or setResponderDescription() to customize the actor and responder prompts independently.'
      );
    }

    // --- Validate and split output fields by actorFields ---
    const originalOutputs = this.program.getSignature().getOutputFields();
    const actorFieldNames = actorFields ?? [];
    this.actorFieldNames = actorFieldNames;

    for (const af of actorFieldNames) {
      if (!originalOutputs.some((fld) => fld.name === af)) {
        throw new Error(`RLM actorField "${af}" not found in output signature`);
      }
    }

    // --- Read grouped field options ---
    const sharedFieldNames = options.fields?.shared ?? [];
    this.sharedFieldNames = sharedFieldNames;
    for (const sf of sharedFieldNames) {
      if (!inputFields.some((fld) => fld.name === sf)) {
        throw new Error(
          `sharedField "${sf}" not found in signature input fields`
        );
      }
    }

    this.excludedSharedFields = options.fields?.excluded ?? [];

    const globalSharedFieldNames = options.fields?.globallyShared ?? [];
    this.globalSharedFieldNames = globalSharedFieldNames;
    for (const gsf of globalSharedFieldNames) {
      if (!inputFields.some((fld) => fld.name === gsf)) {
        throw new Error(
          `globalSharedField "${gsf}" not found in signature input fields`
        );
      }
    }

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
    }

    // Validate reserved namespaces for agent functions
    const RESERVED_NS = new Set([
      'agents',
      'llmQuery',
      'final',
      'ask_clarification',
    ]);
    for (const fn of allAgentFns) {
      const ns = fn.namespace ?? 'utils';
      if (RESERVED_NS.has(ns)) {
        throw new Error(`Agent function namespace "${ns}" is reserved`);
      }
    }

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
    const sharedFields = [
      ...this.sharedFieldNames,
      ...this.globalSharedFieldNames,
    ];

    // Identify context field metadata
    const contextFieldMeta = inputFields.filter((fld) =>
      contextFields.includes(fld.name)
    );
    const actorInlineContextInputs = contextFieldMeta
      .filter(
        (fld) =>
          this.contextPromptMaxCharsByField.has(fld.name) &&
          !sharedFields.includes(fld.name)
      )
      .map((fld) => ({ ...fld, isOptional: true }));
    // Non-context, non-shared-only inputs (visible to Actor and Responder)
    const nonContextInputs = inputFields.filter(
      (fld) =>
        !contextFields.includes(fld.name) && !sharedFields.includes(fld.name)
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

    const effectiveMaxLlmCalls =
      this.rlmConfig.maxLlmCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
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

    const actorDef = axBuildActorDefinition(
      this.actorDescription,
      contextFieldMeta,
      responderOutputFields,
      {
        runtimeUsageInstructions: this.runtime.getUsageInstructions(),
        maxLlmCalls: effectiveMaxLlmCalls,
        maxTurns: effectiveMaxTurns,
        hasInspectRuntime: !!this.rlmConfig.contextManagement?.stateInspection,
        agents: agentMeta,
        agentFunctions: agentFunctionMeta,
      }
    );

    const responderDef = axBuildResponderDefinition(
      this.responderDescription,
      contextFieldMeta
    );

    this.actorProgram = new AxGen(actorSig, {
      ...this._genOptions,
      description: actorDef,
    });

    this.responderProgram = new AxGen(responderSig, {
      ...this._genOptions,
      description: responderDef,
    }) as unknown as AxGen<any, OUT>;
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
    this.program.setSignature(signature);
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

    // 1. Separate context from non-context values
    const contextValues: Record<string, unknown> = {};
    const nonContextValues: Record<string, unknown> = {};
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

    const sharedFieldNames = [
      ...this.sharedFieldNames,
      ...this.globalSharedFieldNames,
    ];
    for (const [k, v] of Object.entries(rawValues)) {
      if (rlm.contextFields.includes(k)) {
        contextValues[k] = v;
      } else if (!sharedFieldNames.includes(k)) {
        nonContextValues[k] = v;
      }
      // shared-only fields are excluded from nonContextValues
      // (they bypass the LLM and go directly to subagents)
    }

    // Extract shared field values for subagent injection
    const sharedFieldValues: Record<string, unknown> = {};
    for (const sf of sharedFieldNames) {
      if (sf in rawValues) {
        sharedFieldValues[sf] = rawValues[sf];
      }
      // Also include shared fields that are context fields
      if (sf in contextValues) {
        sharedFieldValues[sf] = contextValues[sf];
      }
    }

    for (const field of rlm.contextFields) {
      if (!(field in contextValues)) {
        throw new Error(
          `RLM contextField "${field}" is missing from input values`
        );
      }
    }

    const actorInlineContextValues: Record<string, unknown> = {};
    for (const [field, maxChars] of this.contextPromptMaxCharsByField) {
      if (sharedFieldNames.includes(field)) {
        continue;
      }
      if (!(field in contextValues)) {
        continue;
      }
      const value = contextValues[field];
      const size = estimateValueSize(value);
      if (size <= maxChars) {
        actorInlineContextValues[field] = value;
      }
    }

    // 2. Build runtime globals (context + llmQuery + tool functions)
    const maxLlmCalls = rlm.maxLlmCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
    const maxRuntimeChars =
      rlm.maxRuntimeChars ?? DEFAULT_RLM_MAX_RUNTIME_CHARS;
    const maxBatchedLlmQueryConcurrency = Math.max(
      1,
      rlm.maxBatchedLlmQueryConcurrency ?? DEFAULT_RLM_BATCH_CONCURRENCY
    );
    const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

    let llmCallCount = 0;
    const llmCallWarnThreshold = Math.floor(maxLlmCalls * 0.8);
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
            signature: childSignature,
          },
          {
            debug,
            ...rlm,
            agents: { local: this.agents },
            functions: { local: this.agentFunctions },
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
        if (llmCallCount > maxLlmCalls) {
          return `[ERROR] Sub-query budget exhausted (${maxLlmCalls}/${maxLlmCalls}). Use the data you have already accumulated to produce your final answer.`;
        }

        if (recursionMaxDepth <= 0 || !recursiveSubAgent) {
          return `[ERROR] Recursion depth limit reached (${configuredRecursionMaxDepth}).`;
        }

        const maxAttempts = 3;
        let lastError: unknown;

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
            lastError = err;
            if (!isTransientError(err) || attempt >= maxAttempts - 1) {
              throw err;
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
        throw lastError;
      };

      const result = await runSingleLlmQuery(query, ctx);
      if (llmCallCount === llmCallWarnThreshold) {
        return `${result}\n[WARNING] ${llmCallCount}/${maxLlmCalls} sub-queries used. Plan to wrap up soon.`;
      }
      return result;
    };

    // Build tool function globals for the runtime
    const toolGlobals = this.buildRuntimeGlobals(
      effectiveAbortSignal,
      sharedFieldValues,
      ai
    );

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
    const finalFunction = (...args: unknown[]) =>
      setActorResultPayload('final', args);
    const askClarificationFunction = (...args: unknown[]) =>
      setActorResultPayload('ask_clarification', args);

    const agentFunctionNamespaces = [
      ...new Set(this.agentFunctions.map((f) => f.namespace ?? 'utils')),
    ];
    const runtimeInputs = { ...rawValues };
    const reservedTopLevelNames = new Set([
      'inputs',
      'llmQuery',
      'agents',
      'final',
      'ask_clarification',
      ...agentFunctionNamespaces,
      ...(rlm.contextManagement?.stateInspection ? ['inspect_runtime'] : []),
      ...Object.keys(toolGlobals),
    ]);
    const runtimeTopLevelInputAliases = Object.fromEntries(
      Object.entries(runtimeInputs).filter(
        ([k]) => !reservedTopLevelNames.has(k)
      )
    );
    const reservedNames = [
      ...reservedTopLevelNames,
      ...Object.keys(runtimeTopLevelInputAliases),
    ];

    // inspect_runtime: queries worker globalThis for current variable state
    // Captures `session` by reference so it works after session restart.
    const inspectRuntime = rlm.contextManagement?.stateInspection
      ? async (): Promise<string> => {
          try {
            const code = buildInspectRuntimeCode(reservedNames);
            const result = await session.execute(code, {
              signal: effectiveAbortSignal,
              reservedNames,
            });
            return typeof result === 'string' ? result : String(result);
          } catch (err) {
            return `[inspect_runtime error: ${err instanceof Error ? err.message : String(err)}]`;
          }
        }
      : undefined;

    const createSession = () => {
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
    let session = createSession();
    let shouldRestartClosedSession = false;

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

    const executeInterpreterCode = async (
      code: string
    ): Promise<{ output: string; isError: boolean }> => {
      try {
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames,
        });
        return { output: formatInterpreterOutput(result), isError: false };
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
        if (isExecutionTimedOutError(err)) {
          shouldRestartClosedSession = true;
        }
        if (isSessionClosedError(err)) {
          if (!shouldRestartClosedSession) {
            return {
              output: formatInterpreterError(err),
              isError: true,
            };
          }
          try {
            shouldRestartClosedSession = false;
            session = createSession();
            actorResultPayload = undefined;
            const retryResult = await session.execute(code, {
              signal: effectiveAbortSignal,
              reservedNames,
            });
            return {
              output: truncateText(
                `${timeoutRestartNotice}\n${formatInterpreterOutput(retryResult)}`,
                maxRuntimeChars
              ),
              isError: false,
            };
          } catch (retryErr) {
            if (isExecutionTimedOutError(retryErr)) {
              shouldRestartClosedSession = true;
            }
            return {
              output: truncateText(
                `${timeoutRestartNotice}\n${formatInterpreterError(retryErr)}`,
                maxRuntimeChars
              ),
              isError: true,
            };
          }
        }
        if (isExecutionTimedOutError(err)) {
          return {
            output: formatInterpreterError(err),
            isError: true,
          };
        }
        throw err;
      }
    };

    // 3. Actor loop (TypeScript-managed)
    const contextMetadata =
      buildRLMVariablesInfo(contextValues, {
        promptMaxCharsByField: this.contextPromptMaxCharsByField,
        inlinedFields: new Set(Object.keys(actorInlineContextValues)),
      }) || '(none)';

    // Resolve effective context management config
    const contextMgmt = rlm.contextManagement;
    const effectiveContextConfig = {
      errorPruning: contextMgmt?.errorPruning ?? rlm.trajectoryPruning ?? false,
      hindsightEvaluation: contextMgmt?.hindsightEvaluation ?? false,
      tombstoning: contextMgmt?.tombstoning,
      pruneRank: contextMgmt?.pruneRank ?? 2,
    };

    const actionLogEntries: ActionLogEntry[] = [];

    const actorMergedOptions = {
      ...this._genOptions,
      ...this.actorForwardOptions,
      ...options,
      debug,
      abortSignal: effectiveAbortSignal,
    };

    const actorFieldValues: Record<string, unknown> = {};

    const contextThreshold = contextMgmt?.stateInspection?.contextThreshold;

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        // Build action log, adding inspect_runtime hint when it gets large
        let actionLogText =
          buildActionLog(actionLogEntries) || '(no actions yet)';
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

    const actorResult =
      actorResultPayload ??
      ({
        type: 'final',
        args: [buildActionLog(actionLogEntries) || '(no actions were taken)'],
      } satisfies AxAgentActorResultPayload);

    return {
      nonContextValues,
      contextMetadata,
      actionLog: buildActionLog(actionLogEntries),
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
      const {
        nonContextValues,
        contextMetadata,
        actorResult,
        actorFieldValues,
      } = await this._runActorLoop(ai, values, options, effectiveAbortSignal);

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
          contextMetadata,
          actorResult,
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
    ai?: AxAIService
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

      return await fn.func(callArgs, { abortSignal, ai });
    };
  }

  /**
   * Wraps an AxFunction with automatic shared field injection.
   * Shared field values are merged into call args (caller-provided args take precedence).
   */
  private static wrapFunctionWithSharedFields(
    fn: AxFunction,
    abortSignal?: AbortSignal,
    sharedFieldValues?: Record<string, unknown>,
    ai?: AxAIService
  ): (...args: unknown[]) => Promise<unknown> {
    if (!sharedFieldValues || Object.keys(sharedFieldValues).length === 0) {
      return AxAgent.wrapFunction(fn, abortSignal, ai);
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

      // Merge shared fields (caller-provided args take precedence)
      const merged = { ...sharedFieldValues, ...callArgs };
      return await fn.func(merged, { abortSignal, ai });
    };
  }

  /**
   * Wraps agent functions under namespaced globals and child agents under
   * an `agents.*` namespace for the JS runtime session.
   */
  private buildRuntimeGlobals(
    abortSignal?: AbortSignal,
    sharedFieldValues?: Record<string, unknown>,
    ai?: AxAIService
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = {};

    // Agent functions under namespace.* (e.g. utils.myFn, custom.otherFn)
    for (const agentFn of this.agentFunctions) {
      const ns = agentFn.namespace ?? 'utils';
      if (!globals[ns] || typeof globals[ns] !== 'object') {
        globals[ns] = {};
      }
      (globals[ns] as Record<string, unknown>)[agentFn.name] =
        AxAgent.wrapFunction(agentFn, abortSignal, ai);
    }

    // Child agents under agents.* namespace
    if (this.agents && this.agents.length > 0) {
      const agentsObj: Record<string, unknown> = {};
      for (const agent of this.agents) {
        const fn = agent.getFunction();

        // Determine which shared fields this agent accepts
        const excluded = new Set(agent.getExcludedSharedFields?.() ?? []);
        const applicable: Record<string, unknown> = {};
        if (sharedFieldValues) {
          for (const [k, v] of Object.entries(sharedFieldValues)) {
            if (!excluded.has(k)) {
              applicable[k] = v;
            }
          }
        }

        agentsObj[fn.name] = AxAgent.wrapFunctionWithSharedFields(
          fn,
          abortSignal,
          applicable,
          ai
        );
      }
      globals.agents = agentsObj;
    }

    return globals;
  }

  /**
   * Returns options compatible with AxGen (strips agent-specific grouped options).
   */
  private get _genOptions(): Record<string, unknown> {
    if (!this.options) return {};
    const { agents: _a, fields: _f, functions: _fn, ...rest } = this.options;
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
  extends AxAgentOptions {
  ai?: AxAIService;
  agentIdentity?: { name: string; description: string };
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
  promptMaxCharsByField: Map<string, number>;
} {
  const inputFieldNames = new Set(inputFields.map((f) => f.name));
  const seen = new Set<string>();
  const contextFieldNames: string[] = [];
  const promptMaxCharsByField = new Map<string, number>();

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
      const promptMaxChars = cf.promptMaxChars ?? defaultPromptMaxChars;
      if (!Number.isFinite(promptMaxChars) || promptMaxChars < 0) {
        throw new Error(
          `contextField "${field}" promptMaxChars must be a finite number >= 0`
        );
      }
      promptMaxCharsByField.set(field, promptMaxChars);
    }
  }

  return { contextFieldNames, promptMaxCharsByField };
}

function buildRLMVariablesInfo(
  contextValues: Record<string, unknown>,
  options?: {
    promptMaxCharsByField?: ReadonlyMap<string, number>;
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
    const threshold = options?.promptMaxCharsByField?.get(key);
    const promptMode =
      threshold === undefined
        ? 'runtime-only'
        : options?.inlinedFields?.has(key)
          ? `inline (<=${threshold} chars)`
          : `runtime-only (>${threshold} chars)`;
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
