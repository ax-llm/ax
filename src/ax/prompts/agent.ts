import type {
  AxAIModelList,
  AxAIService,
  AxChatResponse,
  AxFunction,
  AxFunctionHandler,
  AxFunctionJSONSchema,
} from '../ai/types.js';
import { validateStructuredOutputValues } from '../dsp/extract.js';
import type { AxInputFunctionType } from '../dsp/functions.js';
import { AxGen } from '../dsp/generate.js';
import { toFieldType } from '../dsp/prompt.js';
import type { AxIField, AxSignatureConfig } from '../dsp/sig.js';
import { AxSignature } from '../dsp/sig.js';
import type { ParseSignature } from '../dsp/sigtypes.js';
import type {
  AxGenIn,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramDemos,
  AxProgramExamples,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxSetExamplesOptions,
  AxTunable,
  AxUsable,
} from '../dsp/types.js';
import { mergeAbortSignals } from '../util/abort.js';
import {
  AxAIServiceAbortedError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import type { AxRLMConfig } from './rlm.js';
import { axBuildRLMDefinition } from './rlm.js';

/** RLM-extended input: original inputs minus context fields, plus contextMetadata */
export type AxRLMInput<IN extends AxGenIn, ContextFields extends string> = Omit<
  IN,
  ContextFields
> & { contextMetadata: string };

/** RLM inline mode output: all original outputs optional, plus code field */
export type AxRLMInlineOutput<
  OUT extends AxGenOut,
  CodeFieldName extends string = 'javascriptCode',
> = Partial<OUT> & { [K in CodeFieldName]?: string };

/**
 * Interface for agents that can be used as child agents.
 * Provides methods to get the agent's function definition and features.
 */
export interface AxAgentic<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxProgrammable<IN, OUT> {
  getFunction(): AxFunction;
  getFeatures(): AxAgentFeatures;
}

export type AxAgentOptions = Omit<
  AxProgramForwardOptions<string>,
  'functions'
> & {
  disableSmartModelRouting?: boolean;
  /** List of field names that should not be automatically passed from parent to child agents */
  excludeFieldsFromPassthrough?: string[];
  debug?: boolean;
  /** RLM (Recursive Language Model) configuration for handling long contexts */
  rlm?: AxRLMConfig;
};

export interface AxAgentFeatures {
  /** Whether this agent can use smart model routing (requires an AI service) */
  canConfigureSmartModelRouting: boolean;
  /** List of fields that this agent excludes from parent->child value passing */
  excludeFieldsFromPassthrough: string[];
}

/**
 * Processes a child agent's function, applying model routing and input injection as needed.
 * Handles both the schema modifications and function wrapping.
 */
function processChildAgentFunction<IN extends AxGenIn>(
  childFunction: Readonly<AxFunction>,
  parentValues: IN | AxMessage<IN>[],
  parentInputKeys: string[],
  modelList: AxAIModelList<string> | undefined,
  options: Readonly<{
    debug: boolean;
    disableSmartModelRouting: boolean;
    excludeFieldsFromPassthrough: string[];
    canConfigureSmartModelRouting: boolean;
  }>
): AxFunction {
  const processedFunction = { ...childFunction };

  // Process input field injection
  if (processedFunction.parameters) {
    const childKeys = processedFunction.parameters.properties
      ? Object.keys(processedFunction.parameters.properties)
      : [];

    // Find common keys between parent and child, excluding 'model' and specified exclusions
    const commonKeys = parentInputKeys
      .filter((key) => childKeys.includes(key))
      .filter((key) => key !== 'model');
    const injectionKeys = commonKeys.filter(
      (key) => !options.excludeFieldsFromPassthrough.includes(key)
    );

    if (injectionKeys.length > 0) {
      // Remove injected fields from child schema
      processedFunction.parameters = removePropertiesFromSchema(
        processedFunction.parameters,
        injectionKeys
      );

      // Wrap function to inject parent values
      const originalFunc = processedFunction.func;
      // add debug logging if enabled
      processedFunction.func = async (childArgs, funcOptions) => {
        // Extract values from parentValues - handle both IN and AxMessage<IN>[] cases
        let valuesToInject: Partial<IN> = {};
        if (Array.isArray(parentValues)) {
          // If parentValues is an array of messages, find the most recent user message
          const lastUserMessage = parentValues
            .filter((msg) => msg.role === 'user')
            .pop();
          if (lastUserMessage) {
            valuesToInject = pick(
              lastUserMessage.values,
              injectionKeys as (keyof IN)[]
            );
          }
        } else {
          // If parentValues is a single IN object
          valuesToInject = pick(parentValues, injectionKeys as (keyof IN)[]);
        }

        const updatedChildArgs = {
          ...childArgs,
          ...valuesToInject,
        };

        return await originalFunc(updatedChildArgs, funcOptions);
      };
    }

    return processedFunction;
  }

  // Apply smart model routing if enabled
  if (
    modelList &&
    !options.disableSmartModelRouting &&
    options.canConfigureSmartModelRouting
  ) {
    processedFunction.parameters = addModelParameter(
      processedFunction.parameters,
      modelList
    );
  }

  return processedFunction;
}

const descriptionError = new Error(
  'Agent description must be at least 20 characters (explain in detail what the agent does)'
);

const definitionError = new Error(
  'Agent definition is the prompt you give to the LLM for the agent. It must be detailed and at least 100 characters'
);

const DEFAULT_RLM_MAX_LLM_CALLS = 50;
const DEFAULT_RLM_MAX_RUNTIME_CHARS = 5_000;
const DEFAULT_RLM_BATCH_CONCURRENCY = 8;
const DEFAULT_RLM_MAX_STEPS = 20;
const DEFAULT_RLM_MODE: NonNullable<AxRLMConfig['mode']> = 'inline';
const DEFAULT_RLM_INLINE_LANGUAGE = 'javascript';
type AxRLMExecutionEntry = {
  code: string;
  output: string;
};

/**
 * An AI agent that can process inputs using an AI service and coordinate with child agents.
 * Supports features like smart model routing and automatic input field passing to child agents.
 *
 * @deprecated Use the `agent()` factory function instead of instantiating this class directly.
 * The factory function provides better type inference and cleaner syntax.
 * This class will be removed in v15.0.0.
 *
 * Migration timeline:
 * - v13.0.24+: Deprecation warnings (current)
 * - v14.0.0: Runtime console warnings
 * - v15.0.0: Complete removal
 *
 * @example
 * // Old (deprecated):
 * const myAgent = new AxAgent({
 *   name: 'myAgent',
 *   description: 'An agent that does something',
 *   signature: 'userInput:string -> responseText:string'
 * });
 *
 * // New (recommended):
 * const myAgent = agent('userInput:string -> responseText:string', {
 *   name: 'myAgent',
 *   description: 'An agent that does something'
 * });
 */
export class AxAgent<
  IN extends AxGenIn,
  OUT extends AxGenOut,
  RLMIN extends AxGenIn = IN,
  RLMOUT extends AxGenOut = OUT,
> implements AxAgentic<IN, OUT>
{
  private ai?: AxAIService;
  private program: AxGen<IN, OUT>;
  private functions?: AxInputFunctionType;
  private agents?: AxAgentic<IN, OUT>[];
  private disableSmartModelRouting?: boolean;
  private excludeFieldsFromPassthrough: string[];
  private debug?: boolean;
  private options?: Readonly<AxAgentOptions>;
  private rlmConfig?: AxRLMConfig;
  private rlmContextFields?: readonly AxIField[];
  private rlmProgram?: AxGen<RLMIN, RLMOUT>;
  private rlmMode: NonNullable<AxRLMConfig['mode']> = DEFAULT_RLM_MODE;
  private rlmInlineLanguage = DEFAULT_RLM_INLINE_LANGUAGE;
  private rlmInlineCodeFieldName = toInlineCodeFieldName(
    DEFAULT_RLM_INLINE_LANGUAGE
  );

  private activeAbortControllers = new Set<AbortController>();
  private _stopRequested = false;

  private name: string;
  //   private subAgentList?: string
  private func: AxFunction;

  constructor(
    {
      ai,
      name,
      description,
      definition,
      signature,
      agents,
      functions,
    }: Readonly<{
      ai?: Readonly<AxAIService>;
      name: string;
      description: string;
      definition?: string;
      signature:
        | string
        | Readonly<AxSignatureConfig>
        | Readonly<AxSignature<IN, OUT>>;
      agents?: AxAgentic<IN, OUT>[];
      functions?: AxInputFunctionType;
    }>,
    options?: Readonly<AxAgentOptions>
  ) {
    const { disableSmartModelRouting, excludeFieldsFromPassthrough, debug } =
      options ?? {};

    this.ai = ai;
    this.agents = agents;
    this.functions = functions;
    this.disableSmartModelRouting = disableSmartModelRouting;
    this.excludeFieldsFromPassthrough = excludeFieldsFromPassthrough ?? [];
    this.debug = debug;
    this.options = options;

    if (!name || name.length < 5) {
      throw new Error(
        'Agent name must be at least 10 characters (more descriptive)'
      );
    }

    if (!description || description.length < 20) {
      throw descriptionError;
    }

    if (definition && definition.length < 100) {
      throw definitionError;
    }

    this.program = new AxGen<IN, OUT>(signature, {
      ...options,
      description: definition ?? description,
    });

    for (const agent of agents ?? []) {
      this.program.register(
        agent as unknown as Readonly<AxTunable<IN, OUT> & AxUsable>
      );
    }

    this.name = name;
    // this.subAgentList = agents?.map((a) => a.getFunction().name).join(', ')

    this.func = {
      name: toCamelCase(this.name),
      description,
      parameters: this.program.getSignature().toJSONSchema(),
      func: () => this.forward,
    };

    const mm = ai?.getModelList();
    // Only add model parameter if smart routing is enabled and model list exists
    if (mm && !this.disableSmartModelRouting) {
      this.func.parameters = addModelParameter(this.func.parameters, mm);
    }

    // RLM setup
    if (options?.rlm) {
      this.rlmConfig = options.rlm;
      const rlmRuntime = options.rlm.runtime ?? options.rlm.interpreter;
      this.rlmMode = options.rlm.mode ?? DEFAULT_RLM_MODE;
      this.rlmInlineLanguage =
        options.rlm.language?.trim() || DEFAULT_RLM_INLINE_LANGUAGE;
      this.rlmInlineCodeFieldName = toInlineCodeFieldName(
        this.rlmInlineLanguage
      );

      // Validate contextFields exist in signature
      const inputFields = this.program.getSignature().getInputFields();
      for (const cf of options.rlm.contextFields) {
        if (!inputFields.some((f) => f.name === cf)) {
          throw new Error(`RLM contextField "${cf}" not found in signature`);
        }
      }

      if (!rlmRuntime) {
        throw new Error(
          'RLM runtime is required. Set `rlm.runtime` (preferred) or `rlm.interpreter` (legacy alias).'
        );
      }

      if (this.rlmMode === 'inline') {
        validateNoReservedInlineOutputNames(
          this.program.getSignature().getOutputFields(),
          [this.rlmInlineCodeFieldName]
        );
      }

      // Build inner signature: same outputs, inputs minus context fields
      const baseOutputs = this.program.getSignature().getOutputFields();
      const rlmOutputs =
        this.rlmMode === 'inline'
          ? [
              ...makeOptionalOutputFields(baseOutputs),
              {
                name: this.rlmInlineCodeFieldName,
                title: toTitle(this.rlmInlineCodeFieldName),
                type: { name: 'code' as const },
                description: `${this.rlmInlineLanguage} code to execute in runtime session`,
                isOptional: true,
              },
            ]
          : baseOutputs;

      const rlmInputs = [
        ...inputFields.filter(
          (f) => !options.rlm!.contextFields.includes(f.name)
        ),
        {
          name: 'contextMetadata',
          title: 'Context Metadata',
          type: { name: 'string' as const },
          description:
            'Auto-generated metadata about pre-loaded context variables (type and size)',
        },
      ];

      const rlmSig = new AxSignature({
        description: this.program.getSignature().getDescription(),
        inputs: rlmInputs,
        outputs: rlmOutputs,
      });

      const contextFieldMeta = inputFields.filter((f) =>
        options.rlm!.contextFields.includes(f.name)
      );
      this.rlmContextFields = contextFieldMeta;

      const maxLlmCalls = options.rlm!.maxLlmCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;

      const rlmDef = axBuildRLMDefinition(
        definition ?? description,
        rlmRuntime.language,
        contextFieldMeta,
        {
          mode: this.rlmMode,
          inlineCodeFieldName: this.rlmInlineCodeFieldName,
          inlineLanguage: this.rlmInlineLanguage,
          runtimeUsageInstructions: rlmRuntime.getUsageInstructions?.(),
          maxLlmCalls,
        }
      );

      // Explicitly set maxSteps on the inner RLM AxGen so it does not
      // silently fall back to AxGen defaults.
      this.rlmProgram = new AxGen(rlmSig, {
        ...options,
        description: rlmDef,
        maxSteps: options?.maxSteps ?? DEFAULT_RLM_MAX_STEPS,
      }) as unknown as AxGen<RLMIN, RLMOUT>;
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
    // Also propagate to the underlying program in case it has its own controller
    this.program.stop();
  }

  /**
   * Creates a new AxAgent instance with type-safe signature parsing.
   * This is the recommended way to create agents with string-based signatures.
   *
   * @param signature - The signature string defining input/output fields
   * @param config - Agent configuration including name, description, etc.
   * @returns A new AxAgent instance with inferred types
   *
   * @example
   * ```typescript
   * const agent = AxAgent.create(
   *   'userInput:string "User question" -> responseText:string "Agent response"',
   *   {
   *     name: 'helpfulAgent',
   *     description: 'An agent that provides helpful responses to user questions',
   *     definition: 'You are a helpful assistant that provides clear, accurate responses to user questions.',
   *     ai: llm
   *   }
   * );
   * ```
   */
  public static create<
    const T extends string,
    const CF extends readonly string[],
    const Lang extends string = 'javascript',
  >(
    signature: T,
    config: AxAgentConfig<
      ParseSignature<T>['inputs'],
      ParseSignature<T>['outputs']
    > & {
      rlm: Omit<AxRLMConfig, 'contextFields' | 'mode' | 'language'> & {
        contextFields: CF;
        mode?: 'inline';
        language?: Lang;
      };
    }
  ): AxAgent<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs'],
    AxRLMInput<ParseSignature<T>['inputs'], CF[number]>,
    AxRLMInlineOutput<ParseSignature<T>['outputs'], `${Lowercase<Lang>}Code`>
  >;
  public static create<
    const T extends string,
    const CF extends readonly string[],
  >(
    signature: T,
    config: AxAgentConfig<
      ParseSignature<T>['inputs'],
      ParseSignature<T>['outputs']
    > & {
      rlm: Omit<AxRLMConfig, 'contextFields' | 'mode'> & {
        contextFields: CF;
        mode: 'function';
      };
    }
  ): AxAgent<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs'],
    AxRLMInput<ParseSignature<T>['inputs'], CF[number]>,
    ParseSignature<T>['outputs']
  >;
  public static create<const T extends string>(
    signature: T,
    config: AxAgentConfig<
      ParseSignature<T>['inputs'],
      ParseSignature<T>['outputs']
    >
  ): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>;
  public static create<const T extends string>(
    signature: T,
    config: AxAgentConfig<
      ParseSignature<T>['inputs'],
      ParseSignature<T>['outputs']
    >
  ): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']> {
    const typedSignature = AxSignature.create(signature);
    const { ai, name, description, definition, agents, functions, ...options } =
      config;

    return new AxAgent(
      {
        ai,
        name,
        description,
        definition,
        signature: typedSignature,
        agents,
        functions,
      },
      options
    );
  }

  public setExamples(
    examples:
      | Readonly<AxProgramExamples<IN, OUT>>
      | Readonly<AxProgramExamples<RLMIN, RLMOUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    this.program.setExamples(
      examples as Readonly<AxProgramExamples<IN, OUT>>,
      options
    );
    if (this.rlmProgram) {
      this.rlmProgram.setExamples(
        examples as Readonly<AxProgramExamples<RLMIN, RLMOUT>>,
        options
      );
    }
  }

  public setId(id: string) {
    this.program.setId(id);
  }

  public setParentId(parentId: string) {
    this.program.setParentId(parentId);
  }

  public getTraces() {
    return this.program.getTraces();
  }

  public setDemos(
    demos:
      | readonly AxProgramDemos<IN, OUT>[]
      | readonly AxProgramDemos<RLMIN, RLMOUT>[]
  ) {
    this.program.setDemos(demos as readonly AxProgramDemos<IN, OUT>[]);
    if (this.rlmProgram) {
      this.rlmProgram.setDemos(
        demos as readonly AxProgramDemos<RLMIN, RLMOUT>[]
      );
    }
  }

  public getUsage() {
    return this.program.getUsage();
  }

  public resetUsage() {
    this.program.resetUsage();
  }

  public getFunction(): AxFunction {
    const boundFunc = this.forward.bind(this);

    // Create a wrapper function that excludes the 'ai' parameter
    const wrappedFunc: AxFunctionHandler = async (
      valuesAndModel: IN & { model: string },
      options?
    ): Promise<string> => {
      const { model, ...values } = valuesAndModel;

      const ai = this.ai ?? options?.ai;
      if (!ai) {
        throw new Error('AI service is required to run the agent');
      }
      const ret = await boundFunc(ai, values as unknown as IN, {
        ...options,
        model,
      });

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
      ...this.func,
      func: wrappedFunc,
    };
  }

  public getFeatures(): AxAgentFeatures {
    return {
      canConfigureSmartModelRouting: this.ai === undefined,
      excludeFieldsFromPassthrough: this.excludeFieldsFromPassthrough,
    };
  }

  /**
   * Initializes the agent's execution context, processing child agents and their functions.
   */
  private init<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptionsWithModels<T>> | undefined
  ) {
    const ai = this.ai ?? parentAi;
    const mm = ai?.getModelList();

    // Get parent's input schema and keys
    const parentSchema = this.program.getSignature().getInputFields();
    const parentKeys = parentSchema.map((p) => p.name);
    const debug = this.getDebug<T>(ai, options);

    // Process each child agent's function
    const agentFuncs = this.agents?.map((agent) => {
      const f = agent.getFeatures();

      const processOptions = {
        debug,
        disableSmartModelRouting: !!this.disableSmartModelRouting,
        excludeFieldsFromPassthrough: f.excludeFieldsFromPassthrough,
        canConfigureSmartModelRouting: f.canConfigureSmartModelRouting,
      };

      return processChildAgentFunction(
        agent.getFunction(),
        values,
        parentKeys,
        mm,
        processOptions
      );
    });

    // Combine all functions
    const functions: AxInputFunctionType = [
      ...(options?.functions ?? this.functions ?? []),
      ...(agentFuncs ?? []),
    ];

    return { ai, functions, debug };
  }

  public async forward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    if (this.rlmConfig && this.rlmProgram) {
      return this._rlmForward(parentAi, values, options);
    }
    return this._defaultForward(parentAi, values, options);
  }

  public async *streamingForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    if (this.rlmConfig && this.rlmProgram) {
      // RLM mode: run non-streaming path and yield final result as a single delta
      const result = await this._rlmForward(parentAi, values, options);
      yield { version: 1, index: 0, delta: result as Partial<OUT> };
      return;
    }
    return yield* this._defaultStreamingForward(parentAi, values, options);
  }

  private async _defaultForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );
    try {
      const { ai, functions, debug } = this.init<T>(parentAi, values, options);
      const mergedOptions = {
        ...this.options,
        ...options,
        debug,
        functions,
        abortSignal: effectiveAbortSignal,
      };
      return await this.program.forward(ai, values, mergedOptions);
    } finally {
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  private async *_defaultStreamingForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );
    try {
      const { ai, functions, debug } = this.init<T>(parentAi, values, options);
      const mergedOptions = {
        ...this.options,
        ...options,
        debug,
        functions,
        abortSignal: effectiveAbortSignal,
      };
      return yield* this.program.streamingForward(ai, values, mergedOptions);
    } finally {
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  /**
   * RLM forward: extracts context fields, creates an interpreter session with
   * context + llmQuery globals, and runs the rlmProgram with codeInterpreter.
   */
  private async _rlmForward<T extends Readonly<AxAIService>>(
    parentAi: T,
    values: IN | AxMessage<IN>[],
    options?:
      | Readonly<AxProgramForwardOptionsWithModels<T>>
      | Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    if (this._stopRequested) {
      abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      abortController.signal,
      options?.abortSignal
    );

    try {
      const {
        ai,
        functions: baseFunctions,
        debug,
      } = this.init<T>(
        parentAi,
        values,
        options as Readonly<AxProgramForwardOptionsWithModels<T>>
      );
      const rlm = this.rlmConfig!;
      const interpreter = rlm.runtime ?? rlm.interpreter;
      if (!interpreter) {
        throw new Error(
          'RLM runtime is required. Set `rlm.runtime` (preferred) or `rlm.interpreter` (legacy alias).'
        );
      }

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

      // 2. Create interpreter session with context as globals
      const executionHistory: AxRLMExecutionEntry[] = [];
      let llmCallCount = 0;
      const maxLlmCalls = rlm.maxLlmCalls ?? DEFAULT_RLM_MAX_LLM_CALLS;
      const llmCallWarnThreshold = Math.floor(maxLlmCalls * 0.8);
      const maxRuntimeChars =
        rlm.maxRuntimeChars ??
        rlm.maxSubQueryContextChars ??
        rlm.maxInterpreterOutputChars ??
        DEFAULT_RLM_MAX_RUNTIME_CHARS;
      const maxBatchedLlmQueryConcurrency = Math.max(
        1,
        rlm.maxBatchedLlmQueryConcurrency ?? DEFAULT_RLM_BATCH_CONCURRENCY
      );

      const llmQuery = async (
        queryOrQueries:
          | string
          | { query: string; context?: string }
          | readonly { query: string; context?: string }[],
        ctx?: string
      ): Promise<string | string[]> => {
        // Normalize single-object form: llmQuery({ query, context }) → llmQuery(query, context)
        if (
          !Array.isArray(queryOrQueries) &&
          typeof queryOrQueries === 'object' &&
          queryOrQueries !== null &&
          'query' in queryOrQueries
        ) {
          return llmQuery(queryOrQueries.query, queryOrQueries.context ?? ctx);
        }

        // Pre-check: if already aborted, throw immediately
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
                      content:
                        'Answer the query based on the provided context.',
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

      const createRlmSession = () => {
        return interpreter.createSession({
          ...contextValues,
          llmQuery,
        });
      };

      const timeoutRestartNotice = `[The ${interpreter.language} runtime was restarted; all global state was lost and must be recreated if needed.]`;
      let session = createRlmSession();
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

      // 3. Create code execution helpers
      const contextDesc = (this.rlmContextFields ?? [])
        .map((f) => `${f.name}: ${toFieldType(f.type)}`)
        .join(', ');

      const reservedNames = ['llmQuery', ...rlm.contextFields];

      const executeInterpreterCode = async (code: string) => {
        try {
          const result = await session.execute(code, {
            signal: effectiveAbortSignal,
            reservedNames,
          });
          const output = formatInterpreterOutput(result);
          executionHistory.push({ code, output });
          return output;
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
              const output = truncateText(
                `Error: ${(err as Error).message}`,
                maxRuntimeChars
              );
              executionHistory.push({ code, output });
              return output;
            }
            try {
              shouldRestartClosedSession = false;
              session = createRlmSession();
              const retryResult = await session.execute(code, {
                signal: effectiveAbortSignal,
                reservedNames,
              });
              const output = truncateText(
                `${timeoutRestartNotice}\n${formatInterpreterOutput(retryResult)}`,
                maxRuntimeChars
              );
              executionHistory.push({ code, output });
              return output;
            } catch (retryErr) {
              if (isExecutionTimedOutError(retryErr)) {
                shouldRestartClosedSession = true;
              }
              const output = truncateText(
                `${timeoutRestartNotice}\nError: ${(retryErr as Error).message}`,
                maxRuntimeChars
              );
              executionHistory.push({ code, output });
              return output;
            }
          }
          if (isExecutionTimedOutError(err)) {
            const output = truncateText(
              `Error: ${(err as Error).message}`,
              maxRuntimeChars
            );
            executionHistory.push({ code, output });
            return output;
          }
          throw err;
        }
      };

      // 4. Run rlmProgram
      try {
        const mergedOptions = {
          ...this.options,
          ...options,
          debug,
          functions: baseFunctions,
          maxSteps: options?.maxSteps ?? this.options?.maxSteps ?? 20,
          abortSignal: effectiveAbortSignal,
        };

        const runFallbackExtraction = async () => {
          const fallbackExtractor = this.buildRLMFallbackExtractor();
          const trajectory = formatRLMExecutionHistory(executionHistory);
          const fallbackResult = await fallbackExtractor.forward(
            ai,
            {
              ...nonContextValues,
              rlmVariablesInfo: buildRLMVariablesInfo(contextValues),
              rlmTrajectory: trajectory,
            } as any,
            {
              ...mergedOptions,
              functions: baseFunctions,
              maxSteps: 1,
            } as any
          );
          this.validateFinalRLMOutput(fallbackResult);
          return fallbackResult;
        };

        const contextMetadata = buildRLMVariablesInfo(contextValues);
        const forwardValues = { ...nonContextValues, contextMetadata };

        if (this.rlmMode === 'inline') {
          const inlineProgram = this.rlmProgram!.clone();

          inlineProgram.addFieldProcessor(
            this.rlmInlineCodeFieldName as any,
            async (value) => {
              if (typeof value !== 'string' || value.trim().length === 0) {
                return;
              }
              const output = await executeInterpreterCode(value);
              return `Code Executed: ${output}`;
            }
          );

          try {
            const inlineResult = await inlineProgram.forward(
              ai,
              forwardValues as any,
              mergedOptions as any
            );
            const businessResult = this.stripInlineHelperFields(inlineResult);
            this.validateFinalRLMOutput(businessResult);
            return businessResult;
          } catch (error) {
            if (!isMaxStepsError(error)) {
              throw error;
            }
            return await runFallbackExtraction();
          }
        }

        const codeInterpreterFn: AxFunction = {
          name: 'codeInterpreter',
          description:
            `Execute ${interpreter.language} code in a persistent REPL. ` +
            `Context available as: ${contextDesc || rlm.contextFields.join(', ')}. ` +
            `Use \`await llmQuery(query, context?)\` for semantic analysis or \`await llmQuery([...])\` for batched queries.`,
          parameters: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: `${interpreter.language} code to execute`,
              },
            },
            required: ['code'],
          },
          func: async ({ code }: Readonly<{ code: string }>) => {
            return executeInterpreterCode(code);
          },
        };

        try {
          return (await this.rlmProgram!.forward(
            ai,
            forwardValues as any,
            {
              ...mergedOptions,
              functions: [...baseFunctions, codeInterpreterFn],
            } as any
          )) as unknown as OUT;
        } catch (error) {
          if (!isMaxStepsError(error)) {
            throw error;
          }
          return await runFallbackExtraction();
        }
      } finally {
        try {
          session.close();
        } catch {
          // Ignore close errors to avoid masking the original error
        }
      }
    } finally {
      this.activeAbortControllers.delete(abortController);
      this._stopRequested = false;
    }
  }

  /**
   * Updates the agent's description.
   * This updates both the stored description and the function's description.
   *
   * @param description - New description for the agent (must be at least 20 characters)
   * @throws Error if description is too short
   */
  public setDescription(description: string): void {
    if (!description || description.length < 20) {
      throw descriptionError;
    }

    this.program.getSignature().setDescription(description);
    this.func.description = description;
  }

  public setDefinition(definition: string): void {
    if (!definition || definition.length < 100) {
      throw definitionError;
    }

    this.program.setDescription(definition);
    this.func.description = definition;
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

  private validateFinalRLMOutput(values: OUT): void {
    validateStructuredOutputValues(
      this.program.getSignature(),
      values as Record<string, unknown>
    );
  }

  private stripInlineHelperFields(values: Record<string, unknown>): OUT {
    if (this.rlmMode !== 'inline') {
      return values as OUT;
    }

    const cloned = { ...(values as Record<string, unknown>) };
    delete cloned[this.rlmInlineCodeFieldName];
    return cloned as OUT;
  }

  private buildRLMFallbackExtractor(): AxGen<any, OUT> {
    const outputFields = this.program.getSignature().getOutputFields();
    const rlmInputs = this.rlmProgram!.getSignature().getInputFields();
    const fallbackInputs = [
      ...rlmInputs,
      {
        name: 'rlmVariablesInfo',
        title: 'Rlm Variables Info',
        type: { name: 'string' as const },
        description: 'Metadata about context variables available to REPL',
        isInternal: true,
      },
      {
        name: 'rlmTrajectory',
        title: 'Rlm Trajectory',
        type: { name: 'string' as const },
        description: 'Chronological code execution/output trace',
        isInternal: true,
      },
    ];

    const fallbackDefinition = `${this.program.getSignature().getDescription()}

You are completing a fallback extraction because the RLM loop reached its max steps.
Use the RLM trajectory and variable metadata below to extract the best final outputs.

Rules:
- Prefer evidence from the latest successful code outputs.
- If information is partial, provide the best possible answer grounded in trajectory.
- Do not mention fallback mode in final outputs.
- Use the input fields \`rlmVariablesInfo\` and \`rlmTrajectory\` as your primary evidence.`;

    const fallbackSignature = new AxSignature({
      description: fallbackDefinition,
      inputs: fallbackInputs,
      outputs: outputFields,
    });

    return new AxGen<any, OUT>(fallbackSignature, {
      ...(this.options ?? {}),
      maxSteps: 1,
    });
  }

  private getDebug<T extends Readonly<AxAIService>>(
    ai: AxAIService,
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): boolean {
    return options?.debug ?? this.debug ?? ai?.getOptions()?.debug ?? false;
  }
}

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

function isMaxStepsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof error.message === 'string' &&
    error.message.startsWith('Max steps reached:')
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

function formatRLMExecutionHistory(
  history: readonly AxRLMExecutionEntry[]
): string {
  if (history.length === 0) {
    return '(no interpreter steps captured)';
  }

  return history
    .map(
      (entry, index) =>
        `Step ${index + 1}\nCode:\n${entry.code}\nOutput:\n${entry.output}`
    )
    .join('\n\n');
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

function toInlineCodeFieldName(language: string): string {
  const normalized = language
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  const parts = normalized
    .split(/\s+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    return 'javascriptCode';
  }

  const camel = parts
    .map((part, index) =>
      index === 0 ? part : part[0]!.toUpperCase() + part.slice(1)
    )
    .join('');
  return `${camel}Code`;
}

function toTitle(name: string): string {
  const withSpaces = name
    .replace(/_/g, ' ')
    .replace(/([A-Z]|[0-9]+)/g, ' $1')
    .trim();
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function makeOptionalOutputFields(fields: readonly AxIField[]): AxIField[] {
  return fields.map((field) => ({
    ...field,
    isOptional: true,
  }));
}

function validateNoReservedInlineOutputNames(
  outputFields: readonly AxIField[],
  reservedNames: readonly string[]
): void {
  const reserved = new Set(reservedNames.map((n) => n.toLowerCase()));
  for (const field of outputFields) {
    if (reserved.has(field.name.toLowerCase())) {
      throw new Error(
        `RLM inline mode reserves output field "${field.name}". Rename the field or use rlm.mode="function".`
      );
    }
  }
}

function toCamelCase(inputString: string): string {
  // Split the string by any non-alphanumeric character (including underscores, spaces, hyphens)
  const words = inputString.split(/[^a-zA-Z0-9]/);

  // Map through each word, capitalize the first letter of each word except the first word
  const camelCaseString = words
    .map((word, index) => {
      // Lowercase the word to handle cases like uppercase letters in input
      const lowerWord = word.toLowerCase();

      // Capitalize the first letter of each word except the first one
      if (index > 0 && lowerWord && lowerWord[0]) {
        return lowerWord[0].toUpperCase() + lowerWord.slice(1);
      }

      return lowerWord;
    })
    .join('');

  return camelCaseString;
}

/**
 * Adds a required model parameter to a JSON Schema definition based on provided model mappings.
 * The model parameter will be an enum with values from the model map keys.
 *
 * @param parameters - The original JSON Schema parameters definition (optional)
 * @param models - Array of model mappings containing keys, model names and descriptions
 * @returns Updated JSON Schema with added model parameter
 */
export function addModelParameter(
  parameters: AxFunctionJSONSchema | undefined,
  models: AxAIModelList<string>
): AxFunctionJSONSchema {
  // If parameters is undefined, create a base schema
  const baseSchema: AxFunctionJSONSchema = parameters
    ? structuredClone(parameters)
    : {
        type: 'object',
        properties: {},
        required: [],
      };

  // Check if model parameter already exists
  if (baseSchema.properties?.model) {
    return baseSchema;
  }

  // Create the model property schema
  const modelProperty: AxFunctionJSONSchema & {
    enum: string[];
    description: string;
  } = {
    type: 'string',
    enum: models.map((m) => m.key),
    description: `The AI model to use for this function call. Available options: ${models
      .map((m) => `\`${m.key}\` ${m.description}`)
      .join(', ')}`,
  };

  // Create new properties object with model parameter
  const newProperties = {
    ...(baseSchema.properties ?? {}),
    model: modelProperty,
  };

  // Add model to required fields
  const newRequired = [...(baseSchema.required ?? []), 'model'];

  // Return updated schema
  return {
    ...baseSchema,
    properties: newProperties,
    required: newRequired,
  };
}

// New helper: removePropertiesFromSchema
//    Clones a JSON schema and removes properties and required fields matching the provided keys.
function removePropertiesFromSchema(
  schema: Readonly<AxFunctionJSONSchema>,
  keys: string[]
): AxFunctionJSONSchema {
  const newSchema = structuredClone(schema);
  if (newSchema.properties) {
    for (const key of keys) {
      delete newSchema.properties[key];
    }
  }
  if (Array.isArray(newSchema.required)) {
    const filteredRequired = newSchema.required.filter(
      (r: string) => !keys.includes(r)
    );
    Object.defineProperty(newSchema, 'required', {
      value: filteredRequired,
      writable: true,
      configurable: true,
    });
  }
  return newSchema;
}

// New helper: pick
//    Returns an object composed of the picked object properties.
function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Configuration options for creating an agent using the agent() factory function.
 */
export interface AxAgentConfig<IN extends AxGenIn, OUT extends AxGenOut>
  extends AxAgentOptions {
  ai?: AxAIService;
  name: string;
  description: string;
  definition?: string;
  agents?: AxAgentic<IN, OUT>[];
  functions?: AxInputFunctionType;
}

/**
 * Creates a strongly-typed AI agent from a signature.
 * This is the recommended way to create agents, providing better type inference and cleaner syntax.
 * Supports both string signatures and AxSignature objects.
 *
 * @param signature - The input/output signature as a string or AxSignature object
 * @param config - Configuration options for the agent
 * @returns A typed agent instance
 *
 * @example
 * ```typescript
 * // Using string signature
 * const myAgent = agent('userInput:string -> responseText:string', {
 *   name: 'myAgent',
 *   description: 'An agent that processes user input and returns a response',
 *   definition: 'You are a helpful assistant that responds to user queries...'
 * });
 *
 * // Using AxSignature object
 * const sig = s('userInput:string -> responseText:string');
 * const myAgent2 = agent(sig, {
 *   name: 'myAgent2',
 *   description: 'Same agent but using AxSignature object'
 * });
 *
 * // With child agents
 * const parentAgent = agent('taskDescription:string -> completedTask:string', {
 *   name: 'parentAgent',
 *   description: 'Coordinates child agents to complete tasks',
 *   agents: [childAgent1, childAgent2]
 * });
 *
 * // Type-safe usage
 * const result = await myAgent.forward(ai, { userInput: 'Hello!' });
 * console.log(result.responseText); // TypeScript knows this exists
 * ```
 */
// --- String signature + RLM inline mode ---
export function agent<
  const T extends string,
  const CF extends readonly string[],
  const Lang extends string = 'javascript',
>(
  signature: T,
  config: AxAgentConfig<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs']
  > & {
    rlm: Omit<AxRLMConfig, 'contextFields' | 'mode' | 'language'> & {
      contextFields: CF;
      mode?: 'inline';
      language?: Lang;
    };
  }
): AxAgent<
  ParseSignature<T>['inputs'],
  ParseSignature<T>['outputs'],
  AxRLMInput<ParseSignature<T>['inputs'], CF[number]>,
  AxRLMInlineOutput<ParseSignature<T>['outputs'], `${Lowercase<Lang>}Code`>
>;
// --- String signature + RLM function mode ---
export function agent<
  const T extends string,
  const CF extends readonly string[],
>(
  signature: T,
  config: AxAgentConfig<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs']
  > & {
    rlm: Omit<AxRLMConfig, 'contextFields' | 'mode'> & {
      contextFields: CF;
      mode: 'function';
    };
  }
): AxAgent<
  ParseSignature<T>['inputs'],
  ParseSignature<T>['outputs'],
  AxRLMInput<ParseSignature<T>['inputs'], CF[number]>,
  ParseSignature<T>['outputs']
>;
// --- AxSignature + RLM inline mode (for f() fluent builder) ---
export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  const CF extends readonly string[],
  const Lang extends string = 'javascript',
>(
  signature: AxSignature<TInput, TOutput>,
  config: AxAgentConfig<TInput, TOutput> & {
    rlm: Omit<AxRLMConfig, 'contextFields' | 'mode' | 'language'> & {
      contextFields: CF;
      mode?: 'inline';
      language?: Lang;
    };
  }
): AxAgent<
  TInput,
  TOutput,
  AxRLMInput<TInput, CF[number]>,
  AxRLMInlineOutput<TOutput, `${Lowercase<Lang>}Code`>
>;
// --- AxSignature + RLM function mode (for f() fluent builder) ---
export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  const CF extends readonly string[],
>(
  signature: AxSignature<TInput, TOutput>,
  config: AxAgentConfig<TInput, TOutput> & {
    rlm: Omit<AxRLMConfig, 'contextFields' | 'mode'> & {
      contextFields: CF;
      mode: 'function';
    };
  }
): AxAgent<TInput, TOutput, AxRLMInput<TInput, CF[number]>, TOutput>;
// --- String signature (no RLM) ---
export function agent<const T extends string>(
  signature: T,
  config: AxAgentConfig<
    ParseSignature<T>['inputs'],
    ParseSignature<T>['outputs']
  >
): AxAgent<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']>;
// --- AxSignature (no RLM) ---
export function agent<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
>(
  signature: AxSignature<TInput, TOutput>,
  config: AxAgentConfig<TInput, TOutput>
): AxAgent<TInput, TOutput>;
// --- Implementation ---
export function agent(
  signature: string | AxSignature<any, any>,
  config: AxAgentConfig<any, any>
): AxAgent<any, any, any, any> {
  const typedSignature =
    typeof signature === 'string' ? AxSignature.create(signature) : signature;
  const { ai, name, description, definition, agents, functions, ...options } =
    config;

  return new AxAgent(
    {
      ai,
      name,
      description,
      definition,
      signature: typedSignature,
      agents,
      functions,
    },
    options
  );
}
