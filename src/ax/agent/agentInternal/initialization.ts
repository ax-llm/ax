import { AxGen } from '../../dsp/generate.js';
import type { AxTunable, AxUsable } from '../../dsp/types.js';
import { AxJSRuntime } from '../../funcs/jsRuntime.js';
import {
  DEFAULT_AGENT_MODULE_NAMESPACE,
  DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS,
  resolveExecutorModelPolicy,
} from '../config.js';
import {
  DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
  DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
  MEMORIES_LOAD_NAME,
  normalizeContextFields,
  SKILLS_LOAD_NAME,
  shouldEnforceIncrementalConsoleTurns,
} from '../runtime.js';
import {
  normalizeAgentFunctionCollection,
  normalizeAgentModuleNamespace,
  toCamelCase,
} from '../runtimeDiscovery.js';
import { createMutableSkillsPromptState } from './skillsHelpers.js';

export function initializeAgentInternal(
  self: any,
  init: any,
  options: any
): void {
  const s = self as any;
  const { ai, judgeAI, agentIdentity, agentModuleNamespace, signature } = init;

  const {
    debug,
    contextFields = [],
    runtime,
    maxSubAgentCalls,
    maxSubAgentCallsPerChild,
    maxBatchedLlmQueryConcurrency,
    maxTurns,
    maxRuntimeChars,
    contextPolicy,
    summarizerOptions,
    executorTurnCallback,
    agentStatusCallback,
    mode,
    executorModelPolicy,
    recursionOptions,
    executorOptions,
    responderOptions,
    judgeOptions,
    inputUpdateCallback,
    bubbleErrors,
    onFunctionCall,
  } = options;

  s.ai = ai;
  s.judgeAI = judgeAI;
  s.agentIdentity = agentIdentity ? { ...agentIdentity } : undefined;
  s.agents = options.agents ?? [];
  s.functionDiscoveryEnabled = options.functionDiscovery ?? false;
  s.onSkillsSearch = options.onSkillsSearch;
  s.onUsedSkills = options.onUsedSkills;
  s.onMemoriesSearch = options.onMemoriesSearch;
  s.onUsedMemories = options.onUsedMemories;
  s.currentSkillsPromptState = createMutableSkillsPromptState();
  s.debug = debug;
  s.options = options;
  s.runtime = runtime ?? new AxJSRuntime();
  s.runtimeUsageInstructions = s.runtime.getUsageInstructions();
  s.enforceIncrementalConsoleTurns = shouldEnforceIncrementalConsoleTurns(
    s.runtimeUsageInstructions
  );

  const resolvedAgentModuleNamespace =
    agentModuleNamespace ??
    agentIdentity?.namespace ??
    DEFAULT_AGENT_MODULE_NAMESPACE;
  s.agentModuleNamespace = normalizeAgentModuleNamespace(
    resolvedAgentModuleNamespace,
    {
      normalize: agentModuleNamespace === undefined,
    }
  );

  const reservedAgentModuleNamespaces = new Set([
    'inputs',
    'llmQuery',
    'final',
    'askClarification',
    'success',
    'failed',
    'inspectRuntime',
    DISCOVERY_LIST_MODULE_FUNCTIONS_NAME,
    DISCOVERY_GET_FUNCTION_DEFINITIONS_NAME,
    SKILLS_LOAD_NAME,
    MEMORIES_LOAD_NAME,
  ]);
  if (reservedAgentModuleNamespaces.has(s.agentModuleNamespace)) {
    throw new Error(
      `Agent module namespace "${s.agentModuleNamespace}" is reserved`
    );
  }

  const reservedAgentFunctionNamespaces = s._reservedAgentFunctionNamespaces();
  const localAgentFnBundle = normalizeAgentFunctionCollection(
    options.functions,
    reservedAgentFunctionNamespaces
  );
  s.agentFunctions = localAgentFnBundle.functions;
  s._mergeAgentFunctionModuleMetadata(localAgentFnBundle.moduleMetadata);

  // Create the base program (used for signature/schema access).
  // `description` is stripped because AxAgent owns the per-stage prompts;
  // letting it through would stamp the signature and trip the validator.
  const {
    agents: _a,
    functions: _fn,
    functionDiscovery: _fd,
    onSkillsSearch: _oss,
    onUsedSkills: _ous,
    onMemoriesSearch: _oms,
    onUsedMemories: _oum,
    judgeOptions: _jo,
    inputUpdateCallback: _iuc,
    executorModelPolicy: _amp,
    maxRuntimeChars: _mrc,
    summarizerOptions: _so,
    onFunctionCall: _ofc,
    description: _desc,
    ...genOptions
  } = options as typeof options & { description?: string };
  s.program = new AxGen(signature, genOptions);
  const inputFields = s.program.getSignature().getInputFields();

  const normalizedContext = normalizeContextFields(
    contextFields,
    inputFields,
    DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS
  );
  s.contextPromptConfigByField = normalizedContext.promptConfigByField;

  s.rlmConfig = {
    contextFields: normalizedContext.contextFieldNames,
    promptLevel: options.promptLevel,
    runtime: s.runtime,
    maxSubAgentCalls,
    maxSubAgentCallsPerChild,
    maxBatchedLlmQueryConcurrency,
    maxTurns,
    maxRuntimeChars,
    contextPolicy,
    summarizerOptions,
    executorTurnCallback,
    agentStatusCallback,
    mode,
  };
  s.recursionForwardOptions = recursionOptions;
  s.bubbleErrors = bubbleErrors;

  const { description: executorDescription, ...executorForwardOptions } =
    executorOptions ?? {};
  // The responder description and forward options now belong to the
  // pipeline's Synthesizer stages — the actor agent itself is responder-free.
  void responderOptions;

  s.executorDescription = executorDescription;
  s.executorModelPolicy = resolveExecutorModelPolicy(executorModelPolicy);
  s.executorForwardOptions = executorForwardOptions;

  s.judgeOptions = judgeOptions ? { ...judgeOptions } : undefined;
  s.inputUpdateCallback = inputUpdateCallback;
  s.agentStatusCallback = agentStatusCallback;
  s.onFunctionCall = onFunctionCall;

  const agents = s.agents;
  for (const agent of agents ?? []) {
    // Use agent function name as the child name for DSPy-compatible IDs
    const childName = agent.getFunction().name;
    s.program.register(
      agent as unknown as Readonly<AxTunable<any, any> & AxUsable>,
      childName
    );
  }

  // Only set up function metadata when agentIdentity is provided
  if (agentIdentity) {
    s.func = {
      name: toCamelCase(agentIdentity.name),
      description: agentIdentity.description,
      parameters: s._buildFuncParameters(),
      func: async () => {
        throw new Error('Use getFunction() to get a callable wrapper');
      },
    };
  }

  // ----- Split architecture setup -----

  const allAgentFns = [...s.agentFunctions];

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

  s._validateConfiguredSignature(s.program.getSignature());
  s._validateAgentFunctionNamespaces(allAgentFns);

  // Build the Actor program from the current signature and config. The
  // Synthesizer (responder) is owned by the pipeline, not by this agent.
  s._buildSplitPrograms();

  // Register the Actor with a DSPy-compatible name so optimizers can discover
  // it via getTraces() and so setDemos()/applyOptimization() propagate.
  s.program.register(
    s.actorProgram as unknown as Readonly<AxTunable<any, any> & AxUsable>,
    'actor'
  );
}
