import type {
  AxAIService,
  AxChatResponse,
  AxFunction,
  AxFunctionHandler,
} from '../ai/types.js';
import type { AxInputFunctionType } from '../dsp/functions.js';
import { AxGen } from '../dsp/generate.js';
import type { AxSignatureConfig } from '../dsp/sig.js';
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
import type { AxRLMConfig } from './rlm.js';
import { axBuildActorDefinition, axBuildResponderDefinition } from './rlm.js';

/**
 * Interface for agents that can be used as child agents.
 * Provides methods to get the agent's function definition and features.
 */
export interface AxAgentic<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {
  getFunction(): AxFunction;
}

type AxAnyAgentic = AxAgentic<any, any>;

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
  /** RLM configuration (required — AxAgent always uses split architecture) */
  rlm: AxRLMConfig;
  /** Default forward options for the Actor sub-program. */
  actorOptions?: Partial<Omit<AxProgramForwardOptions<string>, 'functions'>>;
  /** Default forward options for the Responder sub-program. */
  responderOptions?: Partial<
    Omit<AxProgramForwardOptions<string>, 'functions'>
  >;
};

// ----- Constants -----

const DEFAULT_RLM_MAX_LLM_CALLS = 50;
const DEFAULT_RLM_MAX_RUNTIME_CHARS = 5_000;
const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
const DEFAULT_RLM_MAX_TURNS = 10;

/**
 * Detects the "done" exit signal from the Actor.
 * Primary: done()  — the canonical form.
 * Legacy / defensive: DONE, "DONE", 'DONE' — for backward compat.
 */
function isDoneSignal(code: string): boolean {
  return /^(?:done\(\)|"?DONE"?|'DONE')$/.test(code);
}

// ----- AxAgent Class -----

/**
 * A split-architecture AI agent that uses two AxGen programs:
 * - **Actor**: generates code to gather information (inputs, actionLog -> code)
 * - **Responder**: synthesizes the final answer from execution log (inputs, actionLog -> outputs)
 *
 * The execution loop is managed by TypeScript, not the LLM:
 * 1. Actor generates code → executed in runtime → result appended to actionLog
 * 2. Loop until Actor outputs done() or maxTurns reached
 * 3. Responder synthesizes final answer from complete actionLog
 */
export class AxAgent<IN extends AxGenIn, OUT extends AxGenOut>
  implements AxAgentic<IN, OUT>
{
  private ai?: AxAIService;
  private program: AxGen<IN, OUT>;
  private actorProgram: AxGen<any, any>;
  private responderProgram: AxGen<any, OUT>;
  private functions?: AxInputFunctionType;
  private agents?: AxAnyAgentic[];
  private debug?: boolean;
  private options?: Readonly<AxAgentOptions>;
  private rlmConfig: AxRLMConfig;
  private actorBaseDefinition!: string;
  private responderBaseDefinition!: string;
  private actorFieldNames: string[];
  private actorForwardOptions?: Partial<AxProgramForwardOptions<string>>;
  private responderForwardOptions?: Partial<AxProgramForwardOptions<string>>;

  private activeAbortControllers = new Set<AbortController>();
  private _stopRequested = false;

  private func: AxFunction | undefined;

  constructor(
    {
      ai,
      agentIdentity,
      signature,
      agents,
      functions,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      agentIdentity?: Readonly<{ name: string; description: string }>;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
      agents?: AxAnyAgentic[];
      functions?: AxInputFunctionType;
    }>,
    options: Readonly<AxAgentOptions>
  ) {
    const { debug, rlm, actorOptions, responderOptions } = options;

    this.ai = ai;
    this.agents = agents;
    this.functions = functions;
    this.debug = debug;
    this.options = options;
    this.rlmConfig = rlm;
    this.actorForwardOptions = actorOptions;
    this.responderForwardOptions = responderOptions;

    // Create the base program (used for signature/schema access)
    this.program = new AxGen<IN, OUT>(signature, {
      ...options,
    });

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
        parameters: this.program.getSignature().toJSONSchema(),
        func: async () => {
          throw new Error('Use getFunction() to get a callable wrapper');
        },
      };
    }

    // ----- Split architecture setup -----
    const runtime = rlm.runtime ?? new AxJSRuntime();

    // Validate contextFields exist in signature
    const inputFields = this.program.getSignature().getInputFields();
    for (const cf of rlm.contextFields) {
      if (!inputFields.some((f) => f.name === cf)) {
        throw new Error(`RLM contextField "${cf}" not found in signature`);
      }
    }

    // Identify context field metadata
    const contextFieldMeta = inputFields.filter((fld) =>
      rlm.contextFields.includes(fld.name)
    );
    // Non-context inputs (shared by Actor and Responder)
    const nonContextInputs = inputFields.filter(
      (fld) => !rlm.contextFields.includes(fld.name)
    );

    if (this.program.getSignature().getDescription()) {
      throw new Error(
        'AxAgent does not support signature-level descriptions. ' +
          'Use setActorDescription() and/or setResponderDescription() to customize the actor and responder prompts independently.'
      );
    }

    // --- Validate and split output fields by actorFields ---
    const originalOutputs = this.program.getSignature().getOutputFields();
    const actorFieldNames = rlm.actorFields ?? [];
    this.actorFieldNames = actorFieldNames;

    for (const af of actorFieldNames) {
      if (!originalOutputs.some((fld) => fld.name === af)) {
        throw new Error(`RLM actorField "${af}" not found in output signature`);
      }
    }

    const actorOutputFields = originalOutputs.filter((fld) =>
      actorFieldNames.includes(fld.name)
    );
    const responderOutputFields = originalOutputs.filter(
      (fld) => !actorFieldNames.includes(fld.name)
    );

    // --- Actor signature: inputs + contextMetadata + actionLog -> javascriptCode (+ actorFields) ---
    let actorSigBuilder = f()
      .addInputFields(nonContextInputs)
      .input(
        'contextMetadata',
        f.string(
          'Auto-generated metadata about pre-loaded context variables (type and size)'
        )
      )
      .input(
        'actionLog',
        f.string(
          'Chronological trace of code executions and their outputs so far'
        )
      )
      .output(
        'javascriptCode',
        f.string(
          'JavaScript code to execute in runtime session, or done() to signal completion'
        )
      ) as any;

    if (actorOutputFields.length > 0) {
      actorSigBuilder = actorSigBuilder.addOutputFields(actorOutputFields);
    }

    const actorSig = actorSigBuilder.build();

    // --- Responder signature: inputs + contextMetadata + actionLog -> responderOutputFields ---
    const responderSig = f()
      .addInputFields(nonContextInputs)
      .input(
        'contextMetadata',
        f.string(
          'Auto-generated metadata about pre-loaded context variables (type and size)'
        )
      )
      .input(
        'actionLog',
        f.string(
          'Chronological trace of code executions and their outputs so far'
        )
      )
      .addOutputFields(responderOutputFields)
      .build();

    // Collect tool functions for Actor definition (excludes child agents)
    const toolFunctions = this.collectFunctions();

    const maxLlmCalls = rlm.maxLlmCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
    const maxTurns = rlm.maxTurns ?? DEFAULT_RLM_MAX_TURNS;

    const actorDef = axBuildActorDefinition(undefined, contextFieldMeta, {
      toolFunctions,
      agentFunctions: this.agents?.map((a) => a.getFunction()),
      runtimeUsageInstructions: runtime.getUsageInstructions?.(),
      maxLlmCalls,
      maxTurns,
      actorFieldNames,
    });
    this.actorBaseDefinition = actorDef;

    const responderDef = axBuildResponderDefinition(
      undefined,
      contextFieldMeta
    );
    this.responderBaseDefinition = responderDef;

    this.actorProgram = new AxGen(actorSig, {
      ...options,
      description: actorDef,
    });

    this.responderProgram = new AxGen(responderSig, {
      ...options,
      description: responderDef,
    }) as unknown as AxGen<any, OUT>;

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
   * Collects tool functions (from this.functions only, not child agents).
   */
  private collectFunctions(): AxFunction[] {
    const result: AxFunction[] = [];
    if (this.functions) {
      for (const fnDef of this.functions) {
        if (typeof fnDef === 'object' && 'func' in fnDef) {
          result.push(fnDef as AxFunction);
        }
      }
    }
    return result;
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

  /**
   * Appends additional text to the Actor's existing RLM system prompt.
   * The base RLM prompt is preserved; the additional text is appended after it.
   */
  public setActorDescription(additionalText: string): void {
    this.actorProgram.setDescription(
      `${this.actorBaseDefinition}\n\n${additionalText}`
    );
  }

  /**
   * Appends additional text to the Responder's existing RLM system prompt.
   * The base RLM prompt is preserved; the additional text is appended after it.
   */
  public setResponderDescription(additionalText: string): void {
    this.responderProgram.setDescription(
      `${this.responderBaseDefinition}\n\n${additionalText}`
    );
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
    actorFieldValues: Record<string, unknown>;
  }> {
    const rlm = this.rlmConfig;
    const runtime = rlm.runtime ?? new AxJSRuntime();

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

    for (const [k, v] of Object.entries(rawValues)) {
      if (rlm.contextFields.includes(k)) {
        contextValues[k] = v;
      } else {
        nonContextValues[k] = v;
      }
    }

    for (const field of rlm.contextFields) {
      if (!(field in contextValues)) {
        throw new Error(
          `RLM contextField "${field}" is missing from input values`
        );
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

    const llmQuery = async (
      queryOrQueries:
        | string
        | { query: string; context?: string }
        | readonly { query: string; context?: string }[],
      ctx?: string
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
        singleCtx?: string
      ): Promise<string> => {
        const normalizedCtx = singleCtx
          ? truncateText(singleCtx, maxRuntimeChars)
          : undefined;

        llmCallCount++;
        if (llmCallCount > maxLlmCalls) {
          return `[ERROR] Sub-query budget exhausted (${maxLlmCalls}/${maxLlmCalls}). Use the data you have already accumulated to produce your final answer.`;
        }

        const maxAttempts = 3;
        let lastError: unknown;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const res = await ai.chat(
              {
                chatPrompt: [
                  {
                    role: 'system' as const,
                    content: 'Answer the query based on the provided context.',
                  },
                  {
                    role: 'user' as const,
                    content: normalizedCtx
                      ? `Context:\n${normalizedCtx}\n\nQuery: ${singleQuery}`
                      : singleQuery,
                  },
                ],
                ...(rlm.subModel ? { model: rlm.subModel } : {}),
              },
              {
                stream: false,
                abortSignal: effectiveAbortSignal,
              }
            );
            const chatRes = res as AxChatResponse;
            return chatRes.results?.[0]?.content ?? '';
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
    const toolGlobals = this.buildRuntimeGlobals(effectiveAbortSignal);

    let doneSignaled = false;
    const doneFunction = () => {
      doneSignaled = true;
    };

    const createSession = () => {
      return runtime.createSession({
        ...contextValues,
        llmQuery,
        done: doneFunction,
        ...toolGlobals,
      });
    };

    const timeoutRestartNotice = `[The JavaScript runtime was restarted; all global state was lost and must be recreated if needed.]`;
    let session = createSession();
    let shouldRestartClosedSession = false;

    const reservedNames = [
      'llmQuery',
      'agents',
      'done',
      ...rlm.contextFields,
      ...Object.keys(toolGlobals),
    ];

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

    const executeInterpreterCode = async (code: string) => {
      try {
        const result = await session.execute(code, {
          signal: effectiveAbortSignal,
          reservedNames,
        });
        return formatInterpreterOutput(result);
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
            return truncateText(
              `Error: ${(err as Error).message}`,
              maxRuntimeChars
            );
          }
          try {
            shouldRestartClosedSession = false;
            session = createSession();
            doneSignaled = false;
            const retryResult = await session.execute(code, {
              signal: effectiveAbortSignal,
              reservedNames,
            });
            return truncateText(
              `${timeoutRestartNotice}\n${formatInterpreterOutput(retryResult)}`,
              maxRuntimeChars
            );
          } catch (retryErr) {
            if (isExecutionTimedOutError(retryErr)) {
              shouldRestartClosedSession = true;
            }
            return truncateText(
              `${timeoutRestartNotice}\nError: ${(retryErr as Error).message}`,
              maxRuntimeChars
            );
          }
        }
        if (isExecutionTimedOutError(err)) {
          return truncateText(
            `Error: ${(err as Error).message}`,
            maxRuntimeChars
          );
        }
        throw err;
      }
    };

    // 3. Actor loop (TypeScript-managed)
    const contextMetadata = buildRLMVariablesInfo(contextValues) || '(none)';
    let actionLog = '';

    const actorMergedOptions = {
      ...this.options,
      ...this.actorForwardOptions,
      ...options,
      debug,
      abortSignal: effectiveAbortSignal,
    };

    const actorFieldValues: Record<string, unknown> = {};

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        const actorResult = await this.actorProgram.forward(
          ai,
          {
            ...nonContextValues,
            contextMetadata,
            actionLog: actionLog || '(no actions yet)',
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

        // Exit condition: Actor outputs done()
        const trimmedCode = code?.trim();
        if (!code || !trimmedCode || isDoneSignal(trimmedCode)) {
          break;
        }

        // Defensive: strip trailing done()/DONE the model may have appended to code
        const doneStripped = code
          .replace(/\n\s*(?:done\(\)|"?DONE"?)\s*$/, '')
          .trim();
        const hadTrailingDone = doneStripped !== trimmedCode;
        if (hadTrailingDone) {
          code = doneStripped;
          if (!code) {
            break;
          }
        }

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

        // Reset flag before execution
        doneSignaled = false;

        const output = await executeInterpreterCode(code);
        actionLog += `${actionLog ? '\n\n' : ''}Action ${turn + 1}:\n\`\`\`javascript\n${code}\n\`\`\`\nResult:\n${output}${actorFieldsOutput}`;

        // Exit: trailing done was stripped, or done() was called during execution
        if (hadTrailingDone || doneSignaled) {
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

    return { nonContextValues, contextMetadata, actionLog, actorFieldValues };
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

      const { nonContextValues, contextMetadata, actionLog, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

      const responderMergedOptions = {
        ...this.options,
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
          contextMetadata,
          actionLog: actionLog || '(no actions were taken)',
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
      const { nonContextValues, contextMetadata, actionLog, actorFieldValues } =
        await this._runActorLoop(ai, values, options, effectiveAbortSignal);

      const responderMergedOptions = {
        ...this.options,
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
          actionLog: actionLog || '(no actions were taken)',
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
    abortSignal?: AbortSignal
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

      return await fn.func(callArgs, { abortSignal });
    };
  }

  /**
   * Wraps registered functions as flat globals and child agents under
   * an `agents.*` namespace for the JS runtime session.
   */
  private buildRuntimeGlobals(
    abortSignal?: AbortSignal
  ): Record<string, unknown> {
    const globals: Record<string, unknown> = {};

    // Tool functions as flat globals
    for (const fn of this.collectFunctions()) {
      globals[fn.name] = AxAgent.wrapFunction(fn, abortSignal);
    }

    // Child agents under agents.* namespace
    if (this.agents && this.agents.length > 0) {
      const agentsObj: Record<string, unknown> = {};
      for (const agent of this.agents) {
        const fn = agent.getFunction();
        agentsObj[fn.name] = AxAgent.wrapFunction(fn, abortSignal);
      }
      globals.agents = agentsObj;
    }

    return globals;
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
  agents?: AxAnyAgentic[];
  functions?: AxInputFunctionType;
}

/**
 * Creates a strongly-typed AI agent from a signature.
 * This is the recommended way to create agents, providing better type inference and cleaner syntax.
 *
 * @param signature - The input/output signature as a string or AxSignature object
 * @param config - Configuration options for the agent (rlm config is required)
 * @returns A typed agent instance
 *
 * @example
 * ```typescript
 * const myAgent = agent('context:string, query:string -> answer:string', {
 *   rlm: {
 *     contextFields: ['context'],
 *     runtime: new AxJSRuntime(),
 *   },
 * });
 * ```
 */
// --- String signature ---
export function agent<
  const T extends string,
  const CF extends readonly string[],
>(
  signature: T,
  config: AxAgentConfig<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs']
  > & {
    rlm: Omit<AxRLMConfig, 'contextFields'> & {
      contextFields: CF;
    };
  }
): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>;
// --- AxSignature object ---
export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  const CF extends readonly string[],
>(
  signature: AxSignature<TInput, TOutput>,
  config: AxAgentConfig<TInput, TOutput> & {
    rlm: Omit<AxRLMConfig, 'contextFields'> & {
      contextFields: CF;
    };
  }
): AxAgent<TInput, TOutput>;
// --- Implementation ---
export function agent(
  signature: string | AxSignature<any, any>,
  config: AxAgentConfig<any, any>
): AxAgent<any, any> {
  const typedSignature =
    typeof signature === 'string' ? AxSignature.create(signature) : signature;
  const { ai, agentIdentity, agents, functions, ...options } = config;

  return new AxAgent(
    {
      ai,
      agentIdentity,
      signature: typedSignature,
      agents,
      functions,
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

function buildRLMVariablesInfo(contextValues: Record<string, unknown>): string {
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
    lines.push(`- ${key}: type=${valueType}, size=${size}`);
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
