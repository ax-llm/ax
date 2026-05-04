import type {
  AxAIService,
  AxFunction,
  AxFunctionHandler,
} from '../../ai/types.js';
import { createCompletionBindings } from '../completion.js';
import { cloneAgentState } from '../state.js';
import type {
  AxAgentGuidanceState,
  AxAgentRuntimeCompletionState,
} from './agentInternalTypes.js';
import type { AxAgentState, AxAgentTestResult } from './agentPublicTypes.js';
import { restoreDiscoveryPromptState } from './discoveryHelpers.js';

export function applyOptimization(self: any, optimizedProgram: any): void {
  const s = self as any;
  (s.program as any).applyOptimization?.(optimizedProgram);
}

export async function testAgent(
  self: any,
  code: string,
  values?: Record<string, unknown>,
  options?: Readonly<{
    ai?: AxAIService;
    abortSignal?: AbortSignal;
    debug?: boolean;
  }>
): Promise<AxAgentTestResult> {
  const s = self as any;
  const ai = s.ai ?? options?.ai;
  const debug = options?.debug ?? s.debug ?? ai?.getOptions()?.debug ?? false;
  const inputState = s._createRuntimeInputState(values ?? {}, {
    allowedFieldNames: s.rlmConfig.contextFields,
    validateInputKeys: true,
  });
  inputState.recomputeTurnInputs(false);
  s.currentDiscoveryPromptState = restoreDiscoveryPromptState(
    s.state?.discoveryPromptState
  );

  const completionState: AxAgentRuntimeCompletionState = {
    payload: undefined,
  };
  const guidanceState: AxAgentGuidanceState = {
    entries: [],
  };
  const completionBindings = createCompletionBindings((payload) => {
    completionState.payload = payload;
  }, s.agentStatusCallback);
  const createdBudgetState = s._ensureLlmQueryBudgetState();

  const runtimeContext = s._createRuntimeExecutionContext({
    ai,
    inputState,
    options: undefined,
    effectiveAbortSignal: options?.abortSignal,
    debug,
    completionState,
    guidanceState,
    completionBindings,
    actionLogEntries: [],
  });

  try {
    return await runtimeContext.executeTestCode(code);
  } finally {
    if (createdBudgetState) {
      s.llmQueryBudgetState = undefined;
    }
    runtimeContext.close();
  }
}

export function setState(self: any, state?: AxAgentState): void {
  const s = self as any;
  if (state && state.version !== 1) {
    throw new Error(
      `Unsupported AxAgentState version "${String((state as { version?: unknown }).version)}"`
    );
  }

  if (state) {
    const session = s.runtime.createSession();
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

  s.state = state ? cloneAgentState(state) : undefined;
  s.currentDiscoveryPromptState = restoreDiscoveryPromptState(
    s.state?.discoveryPromptState
  );
  s.stateError = undefined;
  if (s.actorProgram) {
    const instruction = s._buildActorInstruction();
    s.actorProgram.setDescription(instruction);
    s.actorProgram.clearInstruction();
  }
}

export function getFunction(self: any): AxFunction {
  const s = self as any;
  if (!s.func) {
    throw new Error(
      'getFunction() requires agentIdentity to be set in the constructor'
    );
  }

  // ActorAgentRLM no longer owns a `forward()` — synthesis lives in the
  // pipeline. Return the function metadata with a callable that delegates
  // to the actor loop and serializes its `final(task, evidence)` payload.
  const funcMeta = s.func;
  const wrappedFunc: AxFunctionHandler = async (
    values: any,
    options?
  ): Promise<string> => {
    const ai = s.ai ?? options?.ai;
    if (!ai) {
      throw new Error('AI service is required to run the agent');
    }
    const run = await s.run(ai, values, options);
    const result = run.actorResult;
    if (result?.type === 'askClarification') {
      const q = result.args?.[0];
      return typeof q === 'string'
        ? q
        : (q?.question ?? 'Clarification requested');
    }
    const task = result?.args?.[0];
    const evidence = result?.args?.[1];
    return [
      typeof task === 'string' ? task : JSON.stringify(task ?? ''),
      evidence !== undefined
        ? `\n${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`
        : '',
      Object.keys(run.actorFieldValues ?? {}).length > 0
        ? `\n${JSON.stringify(run.actorFieldValues)}`
        : '',
    ].join('');
  };

  return {
    ...funcMeta,
    func: wrappedFunc,
  };
}
