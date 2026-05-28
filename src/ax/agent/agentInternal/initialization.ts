import { AxGen } from '../../dsp/generate.js';
import type { AxTunable, AxUsable } from '../../dsp/types.js';
import { AxJSRuntime } from '../../funcs/jsRuntime.js';
import {
  DEFAULT_CONTEXT_FIELD_PROMPT_MAX_CHARS,
  resolveExecutorModelPolicy,
} from '../config.js';
import {
  normalizeContextFields,
  shouldEnforceIncrementalConsoleTurns,
} from '../runtime.js';
import {
  normalizeAgentFunctionCollection,
  toCamelCase,
} from '../runtimeDiscovery.js';
import {
  createMutableSkillsPromptState,
  ingestSkillResults,
} from './skillsHelpers.js';

export function initializeAgentInternal(
  self: any,
  init: any,
  options: any
): void {
  const s = self as any;
  const { ai, judgeAI, agentIdentity, signature } = init;

  const {
    debug,
    contextFields = [],
    runtime,
    maxSubAgentCalls,
    maxBatchedLlmQueryConcurrency,
    maxTurns,
    maxRuntimeChars,
    contextPolicy,
    summarizerOptions,
    actorTurnCallback,
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
    onContextEvent,
    contextMapText,
  } = options;

  s.ai = ai;
  s.judgeAI = judgeAI;
  s.agentIdentity = agentIdentity ? { ...agentIdentity } : undefined;
  s.functionDiscoveryEnabled = options.functionDiscovery ?? false;
  s.onSkillsSearch = options.onSkillsSearch;
  s.onLoadedSkills = options.onLoadedSkills;
  s.onUsedSkills = options.onUsedSkills;
  s.onMemoriesSearch = options.onMemoriesSearch;
  s.onLoadedMemories = options.onLoadedMemories;
  s.onUsedMemories = options.onUsedMemories;
  s.memoryUsageTrackingEnabled =
    typeof options.onMemoriesSearch === 'function' &&
    typeof options.onUsedMemories === 'function';
  s.skillUsageTrackingEnabled = typeof options.onUsedSkills === 'function';
  s.usageTrackingEnabled =
    s.memoryUsageTrackingEnabled || s.skillUsageTrackingEnabled;
  s.currentSkillsPromptState = createMutableSkillsPromptState();
  s.presetSkills = Array.isArray(options.skills)
    ? options.skills.slice()
    : undefined;
  if (s.presetSkills && s.presetSkills.length > 0) {
    ingestSkillResults(s.currentSkillsPromptState, s.presetSkills);
  }
  s.debug = debug;
  s.options = options;
  s.contextMapText =
    typeof contextMapText === 'string' && contextMapText.trim()
      ? contextMapText
      : undefined;
  s.runtime = runtime ?? new AxJSRuntime();
  s.runtimeUsageInstructions = s.runtime.getUsageInstructions();
  s.enforceIncrementalConsoleTurns = shouldEnforceIncrementalConsoleTurns(
    s.runtimeUsageInstructions
  );

  const reservedAgentFunctionNamespaces = s._reservedAgentFunctionNamespaces();
  const localAgentFnBundle = normalizeAgentFunctionCollection(
    options.functions,
    reservedAgentFunctionNamespaces
  );
  s.agentFunctions = localAgentFnBundle.functions;
  s.agents = localAgentFnBundle.agents;
  s._mergeAgentFunctionModuleMetadata(localAgentFnBundle.moduleMetadata);

  // Create the base program (used for signature/schema access).
  // `description` is stripped because AxAgent owns the per-stage prompts;
  // letting it through would stamp the signature and trip the validator.
  const {
    functions: _fn,
    functionDiscovery: _fd,
    onSkillsSearch: _oss,
    onLoadedSkills: _ols,
    onUsedSkills: _ous,
    onMemoriesSearch: _oms,
    onLoadedMemories: _olm,
    onUsedMemories: _oum,
    judgeOptions: _jo,
    inputUpdateCallback: _iuc,
    executorModelPolicy: _amp,
    maxRuntimeChars: _mrc,
    summarizerOptions: _so,
    actorTurnCallback: _atc,
    onFunctionCall: _ofc,
    onContextEvent: _oce,
    contextMap: _cm,
    contextMapText: _cmt,
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
    maxBatchedLlmQueryConcurrency,
    maxTurns,
    maxRuntimeChars,
    contextPolicy,
    summarizerOptions,
    actorTurnCallback,
    onContextEvent,
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
  s.onContextEvent = onContextEvent;

  // Register child agents (those that arrived via `options.functions`) as
  // DSPy sub-programs so optimizer reach-through is preserved.
  for (const agent of (s.agents ?? []) as readonly {
    getFunction: () => { name: string };
  }[]) {
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
