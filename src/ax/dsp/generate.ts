// ReadableStream is available globally in modern browsers and Node.js 16+

import {
  type Context,
  context,
  type Meter,
  type Span,
  SpanKind,
  trace,
} from '@opentelemetry/api';

import { validateAxMessageArray } from '../ai/base.js';
import { logResultPickerUsed } from '../ai/debug.js';
import type {
  AxAIService,
  AxChatRequest,
  AxChatResponseResult,
  AxFunction,
  AxLoggerFunction,
} from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';
import type { AxAIMemory } from '../mem/types.js';
import { mergeAbortSignals } from '../util/abort.js';
import {
  AxAIRefusalError,
  AxAIServiceAbortedError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import { createHash } from '../util/crypto.js';
import {
  type AxAssertion,
  AxAssertionError,
  type AxStreamingAssertion,
  assertAssertions,
} from './asserts.js';
import {
  type HandleErrorForGenerateArgs,
  handleAssertionErrorForGenerate,
  handleRefusalErrorForGenerate,
  handleValidationErrorForGenerate,
  ValidationError,
} from './errors.js';
import { validateStructuredOutputValues } from './extract.js';
import type { extractionState } from './extract.js';
import {
  type AxFieldProcessor,
  processFieldProcessors,
} from './fieldProcessor.js';
import {
  type AxChatResponseFunctionCall,
  AxStopFunctionCallException,
  createFunctionConfig,
  parseFunctions,
} from './functions.js';
import { axGlobals } from './globals.js';
import { toJsonSchema } from './jsonSchema.js';
import {
  type AxGenMetricsInstruments,
  getOrCreateGenMetricsInstruments,
  mergeCustomLabels,
  recordErrorCorrectionMetric,
  recordFieldProcessingMetric,
  recordFunctionCallingMetric,
  recordGenerationMetric,
  recordMultiStepMetric,
  recordPerformanceMetric,
  recordSamplesMetric,
  recordSignatureComplexityMetrics,
  recordStreamingMetric,
} from './metrics.js';
import {
  processResponse,
  processStreamingResponse,
  shouldContinueSteps,
} from './processResponse.js';
import { createSelfTuningFunction } from './selfTuning.js';
import type { AxSelfTuningConfig } from './types.js';
import { AxProgram } from './program.js';
import { AxPromptTemplate } from './prompt.js';
import { selectFromSamples, selectFromSamplesInMemory } from './samples.js';
import type { AxIField, AxSignature } from './sig.js';
import { AxStepContextImpl } from './stepContext.js';
import { SignatureToolCallingManager } from './signatureToolCalling.js';
import type {
  AsyncGenDeltaOut,
  AxGenDeltaOut,
  AxGenOut,
  AxGenStreamingOut,
  AxMessage,
  AxProgramExamples,
  AxProgramForwardOptions,
  AxProgramForwardOptionsWithModels,
  AxProgrammable,
  AxProgramStreamingForwardOptionsWithModels,
  AxResultPickerFunction,
  AxSetExamplesOptions,
} from './types.js';
import { mergeDeltas } from './util.js';
import {
  validateNumberConstraints,
  validateStringConstraints,
  validateURL,
} from './validators.js';

const STRUCTURED_OUTPUT_FUNCTION_NAME = '__finalResult';

export type AxGenerateResult<OUT> = OUT & {
  thought?: string;
};

export interface AxResponseHandlerArgs<T> {
  ai: Readonly<AxAIService>;
  model?: string;
  res: T;
  mem: AxAIMemory;
  sessionId?: string;
  traceId?: string;
  functions: Readonly<AxFunction[]>;
  strictMode?: boolean;
  span?: Span;
  logger: AxLoggerFunction;
}

export interface AxStreamingEvent<T> {
  event: 'delta' | 'done' | 'error';
  data: {
    contentDelta?: string;
    partialValues?: Partial<T>;
    error?: string;
    functions?: AxChatResponseFunctionCall[];
  };
}

export type InternalAxGenState = {
  index: number;
  values: Record<string, any>;
  content: string;
  functionsExecuted: Set<string>;
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>;
  xstate: extractionState;
};

export class AxGen<IN = any, OUT extends AxGenOut = any>
  extends AxProgram<IN, OUT>
  implements AxProgrammable<IN, OUT>
{
  public clone = (): AxGen<IN, OUT> => {
    return new AxGen(this.signature, this.options);
  };
  private promptTemplate: AxPromptTemplate;
  private asserts: AxAssertion<OUT>[];
  private streamingAsserts: AxStreamingAssertion[];
  private options?: Omit<AxProgramForwardOptions<any>, 'functions'>;
  private functions: AxFunction[];
  private fieldProcessors: AxFieldProcessor[] = [];
  private streamingFieldProcessors: AxFieldProcessor[] = [];
  private excludeContentFromTrace = false;
  private thoughtFieldName: string;
  private signatureToolCallingManager?: SignatureToolCallingManager;
  private structuredOutputFunctionFallback = false;
  private abortController?: AbortController;
  private _stopRequested = false;

  constructor(
    signature:
      | NonNullable<ConstructorParameters<typeof AxSignature>[0]>
      | AxSignature<any, any>,
    options?: Readonly<AxProgramForwardOptions<any>>
  ) {
    super(signature, {
      description: options?.description,
      traceLabel: options?.traceLabel,
    });

    this.options = options;
    this.thoughtFieldName = options?.thoughtFieldName ?? 'thought';
    const promptTemplateOptions = {
      functions: options?.functions,
      thoughtFieldName: this.thoughtFieldName,
    };
    this.promptTemplate = new (options?.promptTemplate ?? AxPromptTemplate)(
      this.signature,
      promptTemplateOptions
    );
    this.asserts = this.options?.asserts ?? [];
    this.streamingAsserts = this.options?.streamingAsserts ?? [];
    this.excludeContentFromTrace = options?.excludeContentFromTrace ?? false;
    this.functions = options?.functions
      ? parseFunctions(options.functions)
      : [];
    this.usage = [];
  }

  /**
   * Stops an in-flight generation. Causes `forward()` / `streamingForward()`
   * to throw `AxAIServiceAbortedError`.
   */
  public stop(): void {
    this._stopRequested = true;
    this.abortController?.abort('Stopped by user');
  }

  public setInstruction(instruction: string): void {
    this.promptTemplate.setInstruction(instruction);
  }

  public getInstruction(): string | undefined {
    return this.promptTemplate.getInstruction();
  }

  private getSignatureName(): string {
    return this.signature.getDescription() || 'unknown_signature';
  }

  private getMetricsInstruments(): AxGenMetricsInstruments | undefined {
    return getOrCreateGenMetricsInstruments();
  }

  // Helper to get merged custom labels from globals, AI service, and options
  private getMergedCustomLabels(
    ai?: Readonly<AxAIService>,
    options?: Readonly<{ customLabels?: Record<string, string> }>
  ): Record<string, string> {
    return mergeCustomLabels(
      axGlobals.customLabels,
      ai?.getOptions?.()?.customLabels,
      options?.customLabels
    );
  }

  public updateMeter(meter?: Meter): void {
    // This now just updates the global singleton, no need to store locally
    getOrCreateGenMetricsInstruments(meter);
  }

  private createStates(n: number) {
    return Array.from({ length: n }, (_, index) => ({
      index,
      functionCalls: [],
      values: {},
      content: '',
      functionsExecuted: new Set<string>(),
      xstate: {
        extractedFields: [],
        streamedIndex: {},
        s: -1,
      },
    }));
  }

  public addAssert = (fn: AxAssertion<OUT>['fn'], message?: string) => {
    this.asserts.push({ fn, message });
  };

  public addStreamingAssert = (
    fieldName: keyof OUT,
    fn: AxStreamingAssertion['fn'],
    message?: string
  ) => {
    // Validate that the field name exists in the output signature
    const outputField = this.signature
      .getOutputFields()
      .find((f) => f.name === fieldName);

    if (!outputField) {
      throw new Error(
        `addStreamingAssert: field ${String(fieldName)} not found in output signature`
      );
    }

    // Ensure the field is a string field for streaming assertions
    const ft = outputField.type?.name;
    const isStringField = !ft || ft === 'string' || ft === 'code';

    if (!isStringField) {
      throw new Error(
        `addStreamingAssert: field ${String(fieldName)} must be a string field for streaming assertions`
      );
    }

    this.streamingAsserts.push({ fieldName: String(fieldName), fn, message });
  };

  private addFieldProcessorInternal = (
    fieldName: string,
    fn: AxFieldProcessor['process'],
    streaming = false
  ) => {
    const field = this.signature
      .getOutputFields()
      .find((f) => f.name === fieldName);

    if (!field) {
      throw new Error(`addFieldProcessor: field ${fieldName} not found`);
    }

    if (streaming) {
      const ft = field.type?.name;
      const isText = !ft || ft === 'string' || ft === 'code';

      if (!isText) {
        throw new Error(
          `addFieldProcessor: field ${fieldName} must be a text field`
        );
      }
      this.streamingFieldProcessors.push({ field, process: fn });
    } else {
      this.fieldProcessors.push({ field, process: fn });
    }
  };

  public addStreamingFieldProcessor = (
    fieldName: keyof OUT,
    fn: (
      value: string,
      context?: { values?: OUT; sessionId?: string; done?: boolean }
    ) => unknown | Promise<unknown>
  ) => {
    this.addFieldProcessorInternal(
      String(fieldName),
      fn as AxFieldProcessor['process'],
      true
    );
  };

  public addFieldProcessor = (
    fieldName: keyof OUT,
    fn: (
      value: OUT[keyof OUT],
      context?: { values?: OUT; sessionId?: string; done?: boolean }
    ) => unknown | Promise<unknown>
  ) => {
    this.addFieldProcessorInternal(
      String(fieldName),
      fn as AxFieldProcessor['process'],
      false
    );
  };

  private async forwardSendRequest({
    ai,
    mem,
    options,
    traceContext,
    functions,
    functionCall,
    stepIndex,
  }: Readonly<{
    ai: Readonly<AxAIService>;
    mem: AxAIMemory;
    options?: Omit<AxProgramForwardOptions<any>, 'ai' | 'mem'>;
    traceContext?: Context;
    functions: AxFunction[];
    functionCall: AxChatRequest['functionCall'] | undefined;
    stepIndex?: number;
  }>) {
    const {
      sessionId,
      model,
      rateLimiter,
      stream,
      thinkingTokenBudget,
      showThoughts,
    } = options ?? {};

    // Use selectFromSamplesInMemory to choose the best sample before getting history
    const selectedIndex = await selectFromSamplesInMemory(mem, sessionId, {
      resultPicker: options?.resultPicker as
        | AxResultPickerFunction<OUT>
        | undefined,
    });

    const chatPrompt = mem?.history(selectedIndex, sessionId) ?? [];

    // History transformation for prompt-mode is handled centrally in base.ts

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found');
    }
    const modelConfig = {
      ...options?.modelConfig,
      ...(options?.sampleCount ? { n: options.sampleCount } : {}),
      ...(options?.sampleCount && options?.modelConfig?.temperature === 1
        ? { temperature: 0.8 }
        : {}),
    };

    const debug = this.isDebug(ai, options);
    const firstStep = stepIndex === 0;
    const logger = this.getLogger(ai, options);

    // Do not send native functions to the provider when emulating via prompt mode
    functions = this.signatureToolCallingManager ? [] : functions;

    let responseFormat: AxChatRequest['responseFormat'];

    const outputFields = this.signature.getOutputFields();
    const hasComplexFields = this.signature.hasComplexFields();

    // Auto-detect structured output requirement
    // If we have object types in output or array of objects, we use structured outputs
    // When structuredOutputFunctionFallback is true, responseFormat stays undefined
    // — the synthetic function handles structured output instead
    if (hasComplexFields && !this.structuredOutputFunctionFallback) {
      // Check if the provider/model supports structured outputs
      const features = ai.getFeatures(model);
      if (!features?.structuredOutputs) {
        throw new Error(
          `Complex structured outputs (object/array types) require a provider that supports structured outputs. ` +
            `Current provider/model (${model}) does not support this feature. ` +
            `Supported providers: OpenAI (GPT-4o, GPT-4.1+), Google Gemini, Anthropic (Sonnet/Opus).`
        );
      }

      // Use the signature-to-schema converter we implemented
      const schema = toJsonSchema(outputFields);

      responseFormat = {
        type: 'json_schema',
        schema: {
          name: 'output',
          strict: true,
          schema,
        },
      };
    }

    // Mark last function for caching (creates breakpoint after tools)
    // Cache if cacheBreakpoint is 'after-functions' or 'after-examples', or ignoreBreakpoints is true
    const cacheBreakpoint =
      options?.contextCache?.cacheBreakpoint ?? 'after-examples';
    const ignoreBreakpoints =
      ai.getFeatures?.(model)?.caching?.cacheBreakpoints === false;
    const shouldCacheFunctions =
      options?.contextCache &&
      (ignoreBreakpoints ||
        cacheBreakpoint === 'after-functions' ||
        cacheBreakpoint === 'after-examples');
    const functionsWithCache =
      functions?.length && shouldCacheFunctions
        ? functions.map((fn, i) => ({
            ...fn,
            cache: i === functions.length - 1,
          }))
        : functions;

    const res = await ai.chat(
      {
        chatPrompt,
        // Do not send native functions to the provider when emulating via prompt mode
        functions: functionsWithCache,
        functionCall,
        modelConfig,
        model,
        responseFormat,
      },
      {
        sessionId,
        rateLimiter,
        stream,
        debug,
        // Hide system prompt in debug logging for steps > 0 to reduce noise in multi-step workflows
        debugHideSystemPrompt: !firstStep,
        thinkingTokenBudget,
        showThoughts,
        traceContext,
        abortSignal: options?.abortSignal ?? axGlobals.abortSignal,
        stepIndex,
        logger,
        functionCallMode:
          options?.functionCallMode ?? this.options?.functionCallMode ?? 'auto',
        retry: options?.retry ?? this.options?.retry,
        customLabels: options?.customLabels,
      }
    );

    return res;
  }

  private async *forwardCore({
    ai,
    mem,
    options,
    stepIndex,
    span,
    traceContext,
    states,
    stopFunctionNames,
    stepContext,
  }: Readonly<{
    ai: Readonly<AxAIService>;
    mem: AxAIMemory;
    options: Omit<AxProgramForwardOptions<any>, 'ai' | 'mem'>;
    stepIndex?: number;
    span?: Span;
    traceContext?: Context;
    states: InternalAxGenState[];
    stopFunctionNames?: readonly string[];
    stepContext?: AxStepContextImpl;
  }>): AsyncGenDeltaOut<OUT> {
    const { sessionId, functions: functionList } = options ?? {};

    const functionResultFormatter =
      options?.functionResultFormatter ?? this.options?.functionResultFormatter;

    const definedFunctionCall =
      options?.functionCall ?? this.options?.functionCall;

    const signatureToolCallingManager = this.signatureToolCallingManager;

    const strictMode = options?.strictMode ?? false;
    const model = options.model;
    const usage = this.usage;
    const firstStep = stepIndex === 0;

    const debug = this.isDebug(ai, options);
    const logger = this.getLogger(ai, options);

    // Pass the function call mode directly to createFunctionConfig
    let { functions, functionCall } = createFunctionConfig(
      functionList,
      definedFunctionCall,
      firstStep,
      options
    );

    // When using function-call fallback for structured output,
    // force the AI to call the structured output function
    // only when there are no user-defined functions.
    if (this.structuredOutputFunctionFallback) {
      const userFunctionCount = functions.filter(
        (f) => f.name !== STRUCTURED_OUTPUT_FUNCTION_NAME
      ).length;
      if (userFunctionCount === 0) {
        functionCall = {
          type: 'function',
          function: { name: STRUCTURED_OUTPUT_FUNCTION_NAME },
        };
      }
    }

    const res = await this.forwardSendRequest({
      ai,
      mem,
      options,
      traceContext,
      functions,
      functionCall,
      stepIndex,
    });

    if (res instanceof ReadableStream) {
      yield* processStreamingResponse<OUT>({
        ai,
        model,
        res,
        mem,
        sessionId,
        traceId: span ? (span as any).spanContext?.().traceId : undefined,
        functions,
        strictMode,
        span,
        states,
        usage,
        asserts: this.asserts,
        streamingAsserts: this.streamingAsserts,
        fieldProcessors: this.fieldProcessors,
        streamingFieldProcessors: this.streamingFieldProcessors,
        thoughtFieldName: this.thoughtFieldName,
        excludeContentFromTrace: this.excludeContentFromTrace,
        signature: this.signature,
        logger,
        debug,
        functionResultFormatter,
        signatureToolCallingManager,
        stopFunctionNames,
        disableMemoryCleanup: options.disableMemoryCleanup,
        stepContext,
        abortSignal: options.abortSignal,
      });
    } else {
      yield* processResponse<OUT>({
        ai,
        model,
        res,
        mem,
        sessionId,
        traceId: span ? (span as any).spanContext?.().traceId : undefined,
        functions,
        span,
        strictMode,
        states,
        usage,
        asserts: this.asserts,
        fieldProcessors: this.fieldProcessors,
        thoughtFieldName: this.thoughtFieldName,
        excludeContentFromTrace: this.excludeContentFromTrace,
        signature: this.signature,
        logger,
        debug,
        functionResultFormatter,
        signatureToolCallingManager,
        stopFunctionNames,
        disableMemoryCleanup: options.disableMemoryCleanup,
        stepContext,
        abortSignal: options.abortSignal,
      });
    }
  }

  private async *_forward2(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    states: InternalAxGenState[],
    options: Readonly<AxProgramForwardOptions<any>>,
    span?: Span,
    traceContext?: Context
  ): AxGenStreamingOut<OUT> {
    const rawStop = options?.stopFunction ?? this.options?.stopFunction;
    let stopFunctionNames = Array.isArray(rawStop)
      ? rawStop.map((s) => s.toLowerCase())
      : rawStop
        ? [rawStop.toLowerCase()]
        : undefined;

    const maxRetries = options.maxRetries ?? this.options?.maxRetries ?? 3;
    const maxSteps = options.maxSteps ?? this.options?.maxSteps ?? 25;

    const mem = options.mem ?? this.options?.mem ?? new AxMemory();

    const mutableFunctions = options.functions
      ? parseFunctions(options.functions)
      : [...this.functions];

    // Create step context for programmatic loop control
    const stepContext = new AxStepContextImpl(maxSteps);

    // Inject self-tuning function if enabled
    let selfTuningConfig: AxSelfTuningConfig | undefined;

    if (options.selfTuning) {
      selfTuningConfig =
        options.selfTuning === true
          ? { model: true, thinkingBudget: true }
          : options.selfTuning;

      // Validate: model selection requires a models list with 2+ chat models
      if (selfTuningConfig.model !== false) {
        const modelList = ai.getModelList();
        const chatModels = modelList?.filter((entry) => 'model' in entry);
        if (!chatModels || chatModels.length < 2) {
          throw new Error(
            'Self-tuning with model selection requires the AI service to have a `models` list with at least 2 chat models. ' +
              'Either configure models on your AI service or disable model selection with `selfTuning: { model: false }`.'
          );
        }
      }

      const tuningFn = createSelfTuningFunction(
        ai,
        selfTuningConfig,
        options.model ? String(options.model) : undefined
      );
      mutableFunctions.push(tuningFn);
    }

    // Mutable options that can be changed by step context mutations
    let mutableOptions = { ...options };

    const stepHooks = options.stepHooks;

    const hasFunctions = mutableFunctions && mutableFunctions.length > 0;

    const functionCallMode =
      options.functionCallMode ?? this.options?.functionCallMode ?? 'auto';

    // Handle prompt mode
    if (hasFunctions && functionCallMode === 'prompt') {
      this.signatureToolCallingManager = new SignatureToolCallingManager(
        mutableFunctions
      );
    }

    // Handle auto mode
    if (
      hasFunctions &&
      functionCallMode === 'auto' &&
      !ai.getFeatures(options.model).functions
    )
      this.signatureToolCallingManager = new SignatureToolCallingManager(
        mutableFunctions
      );

    let err: ValidationError | AxAssertionError | undefined;
    let lastError: Error | undefined;

    const promptTemplateClass =
      this.options?.promptTemplate ?? AxPromptTemplate;

    // Use SignatureToolCallingManager to process signature if in prompt mode
    if (this.signatureToolCallingManager) {
      this.signature = this.signatureToolCallingManager.processSignature(
        this.signature
      );
      this.setSignature(this.signature);
    }

    // Detect structured output function-call fallback condition
    const hasComplexFields = this.signature.hasComplexFields();
    const features = ai.getFeatures?.(options.model);
    const structuredOutputMode =
      options.structuredOutputMode ??
      this.options?.structuredOutputMode ??
      'auto';

    this.structuredOutputFunctionFallback =
      hasComplexFields &&
      (structuredOutputMode === 'function' ||
        (structuredOutputMode === 'auto' && !features?.structuredOutputs));

    // When fallback is active, create synthetic function and add to stop functions
    if (this.structuredOutputFunctionFallback) {
      const syntheticFunction: AxFunction = {
        name: STRUCTURED_OUTPUT_FUNCTION_NAME,
        description:
          'Return the final result. Call this function with the complete output data.',
        parameters: toJsonSchema(this.signature.getOutputFields()),
        func: async () => 'done',
      };
      mutableFunctions.push(syntheticFunction);

      stopFunctionNames = [
        ...(stopFunctionNames ?? []),
        STRUCTURED_OUTPUT_FUNCTION_NAME.toLowerCase(),
      ];
    }

    // Check if provider has automatic cache lookback (e.g., Anthropic)
    const providerIgnoreBreakpoints =
      ai.getFeatures?.(options.model)?.caching?.cacheBreakpoints === false;

    const currentPromptTemplateOptions = {
      // Prefer per-call functions; fall back to parsed functions from constructor
      functions: this.signatureToolCallingManager ? [] : mutableFunctions,
      thoughtFieldName: this.thoughtFieldName,
      contextCache: options.contextCache, // Pass through for system prompt caching
      examplesInSystem: options.examplesInSystem,
      ignoreBreakpoints: providerIgnoreBreakpoints,
      structuredOutputFunctionName: this.structuredOutputFunctionFallback
        ? STRUCTURED_OUTPUT_FUNCTION_NAME
        : undefined,
    };

    this.promptTemplate = new promptTemplateClass(
      this.signature,
      currentPromptTemplateOptions
    );

    // New logic:
    let prompt: AxChatRequest['chatPrompt'];

    // Track prompt rendering performance
    const promptRenderStart = performance.now();

    if (Array.isArray(values)) {
      // Validate AxMessage array items
      validateAxMessageArray<IN>(values as AxMessage<IN>[]);

      // We'll need to decide how to get the 'individual' IN for demos/examples if needed by render.
      // For now, assume render will handle the array directly.
      // The generic type for render might need to be T (from render<T extends ...>)
      // and T will be inferred as ReadonlyArray<AxMessage>
      prompt = this.promptTemplate.render(values as any, {
        examples: this.examples as any,
        demos: this.demos as any,
      });
    } else {
      // Ensure `values` here is correctly inferred as IN
      prompt = this.promptTemplate.render(values as any, {
        // Cast if necessary
        examples: this.examples as any,
        demos: this.demos as any,
      });
    }

    const promptRenderDuration = performance.now() - promptRenderStart;

    // Record prompt render performance metric
    const metricsInstruments = this.getMetricsInstruments();
    const customLabels = this.getMergedCustomLabels(ai, options);
    if (metricsInstruments) {
      recordPerformanceMetric(
        metricsInstruments,
        'prompt_render',
        promptRenderDuration,
        this.getSignatureName(),
        customLabels
      );
    }

    // Track memory update performance
    const memoryUpdateStart = performance.now();
    mem.addRequest(prompt, options.sessionId);
    const memoryUpdateDuration = performance.now() - memoryUpdateStart;

    // Record memory update performance metric
    if (metricsInstruments) {
      recordPerformanceMetric(
        metricsInstruments,
        'memory_update',
        memoryUpdateDuration,
        this.getSignatureName(),
        customLabels
      );
    }

    // Track committed values across retries to prevent duplication
    const committedValues = new Map<number, Record<string, any>>();
    states.forEach((s) => {
      committedValues.set(s.index, {});
    });

    // Helper to apply pending step context mutations to mutableOptions/mutableFunctions
    const applyStepContextMutations = () => {
      const pendingOpts = stepContext._consumePendingOptions();
      if (pendingOpts) {
        const { modelConfig: pendingModelConfig, ...restOpts } = pendingOpts;
        mutableOptions = { ...mutableOptions, ...restOpts };
        if (pendingModelConfig) {
          mutableOptions.modelConfig = {
            ...mutableOptions.modelConfig,
            ...pendingModelConfig,
          };
        }
      }

      const toAdd = stepContext._consumeFunctionsToAdd();
      if (toAdd) {
        const parsed = parseFunctions(toAdd);
        for (const fn of parsed) {
          if (!mutableFunctions.some((f) => f.name === fn.name)) {
            mutableFunctions.push(fn);
          }
        }
      }

      const toRemove = stepContext._consumeFunctionsToRemove();
      if (toRemove) {
        const removeSet = new Set(toRemove.map((n) => n.toLowerCase()));
        for (let i = mutableFunctions.length - 1; i >= 0; i--) {
          if (removeSet.has(mutableFunctions[i]!.name.toLowerCase())) {
            mutableFunctions.splice(i, 1);
          }
        }
      }
    };

    // Resolve the effective abort signal once at method start
    const effectiveAbortSignal = options?.abortSignal ?? axGlobals.abortSignal;

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
      // Begin new step on the context
      stepContext._beginStep(n);

      // Apply pending mutations from previous step (or from selfTuning/hooks)
      applyStepContextMutations();

      // Update self-tuning function schema if model changed
      if (selfTuningConfig && selfTuningConfig.model !== false) {
        const idx = mutableFunctions.findIndex(
          (f) => f.name === 'adjustGeneration'
        );
        if (idx !== -1) {
          const currentModel = mutableOptions.model
            ? String(mutableOptions.model)
            : undefined;
          mutableFunctions[idx] = createSelfTuningFunction(
            ai,
            selfTuningConfig,
            currentModel
          );
        }
      }

      // Check if stop was requested by a previous step's function/hook
      if (stepContext._isStopRequested) {
        break;
      }

      // Check if abort was signalled between steps
      if (effectiveAbortSignal?.aborted) {
        throw new AxAIServiceAbortedError(
          'between-steps',
          effectiveAbortSignal.reason ?? 'Aborted between steps'
        );
      }

      // Call beforeStep hook
      if (stepHooks?.beforeStep) {
        await stepHooks.beforeStep(stepContext);
        applyStepContextMutations();
        if (stepContext._isStopRequested) {
          break;
        }
      }

      // Infrastructure error retry configuration
      // Use the same maxRetries for infrastructure errors (default 3)
      const infraMaxRetries = maxRetries;

      // Infrastructure retry loop (outer loop for 5xx, network, timeout errors)
      for (
        let infraRetryCount = 0;
        infraRetryCount <= infraMaxRetries;
        infraRetryCount++
      ) {
        try {
          // Validation/assertion error retry loop (inner loop)
          for (let errCount = 0; errCount < maxRetries; errCount++) {
            // Reset states for new attempt
            states.forEach((s) => {
              s.content = '';
              s.values = {};
              s.functionCalls = [];
              s.functionsExecuted = new Set<string>();
              s.xstate = { extractedFields: [], streamedIndex: {}, s: -1 };
            });

            // Reset committed values on retry so all values are re-emitted in new version
            if (errCount > 0) {
              committedValues.forEach((_, index) => {
                committedValues.set(index, {});
              });
            }

            // Track values for the current attempt to calculate deltas relative to committed values
            const currentAttemptValues = new Map<number, Record<string, any>>();
            states.forEach((s) => {
              currentAttemptValues.set(s.index, {});
            });

            try {
              const generator = this.forwardCore({
                options: { ...mutableOptions, functions: mutableFunctions },
                ai,
                mem,
                stepIndex: n,
                span,
                traceContext,
                states,
                stopFunctionNames,
                stepContext,
              });

              let stopFunctionTriggered = false;
              try {
                for await (const result of generator) {
                  if (result !== undefined) {
                    const index = result.index;
                    const delta = result.delta;

                    // Update current attempt values and calculate effective delta against committed values
                    const currentValues = currentAttemptValues.get(index) ?? {};
                    const committed = committedValues.get(index) ?? {};
                    const effectiveDelta: Partial<OUT> = {};
                    let hasEffectiveDelta = false;

                    for (const key of Object.keys(delta)) {
                      const dVal = (delta as any)[key];
                      const curVal = currentValues[key];

                      // Merge into currentValues
                      let newVal: any;
                      if (
                        typeof dVal === 'string' &&
                        (typeof curVal === 'string' || curVal === undefined)
                      ) {
                        newVal = (curVal ?? '') + dVal;
                      } else if (
                        Array.isArray(dVal) &&
                        (Array.isArray(curVal) || curVal === undefined)
                      ) {
                        newVal = [...(curVal ?? []), ...dVal];
                      } else {
                        newVal = dVal;
                      }
                      currentValues[key] = newVal;

                      // Now compare with committed
                      const val = newVal;
                      const committedVal = committed[key];

                      if (
                        typeof val === 'string' &&
                        typeof committedVal === 'string'
                      ) {
                        if (val.startsWith(committedVal)) {
                          const diff = val.slice(committedVal.length);
                          if (diff) {
                            (effectiveDelta as any)[key] = diff;
                            hasEffectiveDelta = true;
                            committed[key] = val; // Update committed value
                          }
                        } else if (committedVal.startsWith(val)) {
                          // Replay of previously yielded value - suppress
                        } else {
                          // Divergence or new value, assume overwrite/append
                          if (val !== committedVal) {
                            (effectiveDelta as any)[key] = val;
                            hasEffectiveDelta = true;
                            committed[key] = val;
                          }
                        }
                      } else if (
                        Array.isArray(val) &&
                        Array.isArray(committedVal)
                      ) {
                        // For arrays, if val is superset of committed
                        if (val.length > committedVal.length) {
                          // Check if it's a pure extension
                          // Simple check: compare JSON of prefix
                          // Or just slice and trust?
                          // For streaming arrays, we usually just append items.
                          const diff = val.slice(committedVal.length);
                          (effectiveDelta as any)[key] = diff;
                          hasEffectiveDelta = true;
                          committed[key] = val;
                        }
                        // If val is subset of committed (replay), do nothing.
                      } else {
                        // Other types (boolean, number, object), yield if changed
                        if (
                          JSON.stringify(val) !== JSON.stringify(committedVal)
                        ) {
                          (effectiveDelta as any)[key] = val;
                          hasEffectiveDelta = true;
                          committed[key] = val;
                        }
                      }
                    }

                    if (hasEffectiveDelta) {
                      yield {
                        version: errCount,
                        index: result.index,
                        delta: effectiveDelta,
                      };
                    }
                  }
                }
              } catch (e) {
                if (e instanceof AxStopFunctionCallException) {
                  stopFunctionTriggered = true;

                  // Extract structured output values from the synthetic function call
                  if (this.structuredOutputFunctionFallback) {
                    const structuredCall = e.calls.find(
                      (c) => c.func.name === STRUCTURED_OUTPUT_FUNCTION_NAME
                    );
                    if (structuredCall?.args) {
                      const args = structuredCall.args as Record<
                        string,
                        unknown
                      >;

                      // Validate against field constraints (same as native structured output path)
                      validateStructuredOutputValues(this.signature, args);

                      const outputFields = this.signature.getOutputFields();
                      for (const state of states) {
                        const delta: Record<string, unknown> = {};
                        for (const field of outputFields) {
                          if (field.name in args && !field.isInternal) {
                            delta[field.name] = args[field.name];
                            state.values[field.name] = args[field.name];
                          }
                        }
                        yield {
                          version: errCount,
                          index: state.index,
                          delta: delta as Partial<OUT>,
                        };
                      }

                      // Run assertions (same as native structured output path)
                      for (const state of states) {
                        await assertAssertions(
                          this.asserts,
                          state.values as OUT
                        );
                      }

                      // Run field processors (same as native structured output path)
                      if (this.fieldProcessors.length > 0) {
                        for (const state of states) {
                          await processFieldProcessors(
                            this.fieldProcessors,
                            state.values as OUT,
                            mem,
                            options.sessionId
                          );
                        }
                      }
                    }
                  }
                } else {
                  throw e;
                }
              }

              // Accumulate usage on step context from this step's usage data
              if (this.usage.length > 0) {
                const lastUsage = this.usage[this.usage.length - 1];
                if (lastUsage?.tokens) {
                  stepContext._addUsage(
                    lastUsage.tokens.promptTokens ?? 0,
                    lastUsage.tokens.completionTokens ?? 0,
                    lastUsage.tokens.totalTokens ?? 0
                  );
                }
              }

              // Check if any functions were executed (for afterFunctionExecution hook)
              const functionsRan = states.some(
                (s) => s.functionsExecuted.size > 0
              );

              // Call afterFunctionExecution hook if functions ran
              if (functionsRan && stepHooks?.afterFunctionExecution) {
                await stepHooks.afterFunctionExecution(stepContext);
                applyStepContextMutations();
              }

              const shouldContinue =
                stopFunctionTriggered || stepContext._isStopRequested
                  ? false
                  : shouldContinueSteps(
                      mem,
                      stopFunctionNames,
                      states,
                      mutableOptions?.sessionId
                    );

              // Call afterStep hook
              if (stepHooks?.afterStep) {
                await stepHooks.afterStep(stepContext);
                applyStepContextMutations();
              }

              if (
                shouldContinue &&
                !stepContext._isStopRequested &&
                !effectiveAbortSignal?.aborted
              ) {
                // Record multi-step generation metric
                const metricsInstruments = this.getMetricsInstruments();
                if (metricsInstruments) {
                  recordMultiStepMetric(
                    metricsInstruments,
                    n + 1,
                    maxSteps,
                    this.getSignatureName(),
                    customLabels
                  );
                }
                continue multiStepLoop;
              }

              // If we stopped because of an abort signal, throw
              if (effectiveAbortSignal?.aborted) {
                throw new AxAIServiceAbortedError(
                  'mid-step',
                  effectiveAbortSignal.reason ?? 'Aborted'
                );
              }

              // On success, clean up any error-related tags from memory to keep context clean
              if (!options?.disableMemoryCleanup) {
                mem.removeByTag('invalid-assistant', options.sessionId);
                mem.removeByTag('correction', options.sessionId);
                mem.removeByTag('error', options.sessionId);
              }

              // Record successful completion metrics
              const metricsInstruments = this.getMetricsInstruments();
              if (metricsInstruments) {
                recordMultiStepMetric(
                  metricsInstruments,
                  n + 1,
                  maxSteps,
                  this.getSignatureName(),
                  customLabels
                );

                // Count unique functions executed across all states
                const allFunctionsExecuted = new Set<string>();
                states.forEach((state) => {
                  state.functionsExecuted.forEach((func) =>
                    allFunctionsExecuted.add(func)
                  );
                });

                // Record function metrics if functions were used
                if (allFunctionsExecuted.size > 0) {
                  recordFunctionCallingMetric(
                    metricsInstruments,
                    true,
                    allFunctionsExecuted.size,
                    true,
                    false,
                    this.getSignatureName(),
                    customLabels
                  );
                }

                // Record field processing metrics
                recordFieldProcessingMetric(
                  metricsInstruments,
                  this.fieldProcessors.length,
                  this.streamingFieldProcessors.length,
                  this.getSignatureName(),
                  customLabels
                );
              }

              return;
            } catch (e) {
              // Re-throw abort errors immediately — never retry or wrap them
              if (e instanceof AxAIServiceAbortedError) {
                throw e;
              }

              lastError = e as Error;
              let errorFields: AxIField[] | undefined;
              const debug = this.isDebug(ai, options);
              const logger = this.getLogger(ai, options);
              const metricsInstruments = this.getMetricsInstruments();
              const signatureName = this.getSignatureName();

              const args: HandleErrorForGenerateArgs<Error> = {
                error: e as Error,
                errCount,
                logger,
                metricsInstruments,
                signatureName,
                span,
                debug,
                customLabels,
              };

              span?.recordException(e as Error);

              if (e instanceof ValidationError) {
                errorFields = handleValidationErrorForGenerate(
                  args as HandleErrorForGenerateArgs<ValidationError>
                );
                err = e;
              } else if (e instanceof AxAssertionError) {
                errorFields = handleAssertionErrorForGenerate(
                  args as HandleErrorForGenerateArgs<AxAssertionError>
                );
                err = e;
              } else if (e instanceof AxAIRefusalError) {
                handleRefusalErrorForGenerate(
                  args as HandleErrorForGenerateArgs<AxAIRefusalError>
                );
              } else if (e instanceof AxAIServiceStreamTerminatedError) {
                // Do nothing allow error correction to happen
              } else {
                // Check if this is a retryable infrastructure error
                // If so, let it bubble up to the infrastructure retry loop
                const error = e as Error;
                const isInfraError =
                  error instanceof AxAIServiceStatusError &&
                  (error as AxAIServiceStatusError).status >= 500 &&
                  (error as AxAIServiceStatusError).status < 600;

                const isNetworkError = error instanceof AxAIServiceNetworkError;
                const isTimeoutError = error instanceof AxAIServiceTimeoutError;

                if (isInfraError || isNetworkError || isTimeoutError) {
                  // Let infrastructure errors bubble up to outer catch
                  throw e;
                }

                // Not an infrastructure error, enhance and throw
                throw enhanceError(e, ai, this.signature);
              }

              if (errorFields) {
                mem.addTag('error', options.sessionId);
                mem.addRequest(
                  [
                    {
                      role: 'user' as const,
                      content:
                        this.promptTemplate.renderExtraFields(errorFields),
                    },
                  ],
                  options.sessionId
                );
                mem.addTag('correction', options.sessionId);

                // When using structured outputs (JSON mode), we need to reset the state content
                // to avoid concatenating JSON objects from previous retry attempts
                const hasComplexFields = this.signature.hasComplexFields();
                if (hasComplexFields) {
                  for (const state of states) {
                    state.content = '';
                    state.values = {};
                    state.xstate = {
                      extractedFields: [],
                      streamedIndex: {},
                      s: -1,
                    };
                  }
                }
              }
            }
          }

          // Record max retries reached for validation errors
          const metricsInstruments = this.getMetricsInstruments();
          if (metricsInstruments) {
            recordErrorCorrectionMetric(
              metricsInstruments,
              maxRetries,
              false, // failed
              maxRetries,
              this.getSignatureName(),
              customLabels
            );
          }

          throw enhanceError(
            new Error(
              `Unable to fix validation error: ${
                (err ?? lastError)?.message ??
                (err ?? lastError)?.toString() ??
                'unknown error'
              }\n\nLLM Output:\n${states.map((s) => s.content).join('\n---\n')}`
            ),
            ai,
            this.signature
          );
        } catch (e) {
          // Infrastructure error handling
          const error = e as Error;
          const isInfraError =
            error instanceof AxAIServiceStatusError &&
            (error as AxAIServiceStatusError).status >= 500 &&
            (error as AxAIServiceStatusError).status < 600;

          const isNetworkError = error instanceof AxAIServiceNetworkError;
          const isTimeoutError = error instanceof AxAIServiceTimeoutError;
          const isStreamTerminated =
            error instanceof AxAIServiceStreamTerminatedError;

          const shouldRetryInfra =
            (isInfraError ||
              isNetworkError ||
              isTimeoutError ||
              isStreamTerminated) &&
            infraRetryCount < infraMaxRetries;

          if (shouldRetryInfra) {
            const debug = this.isDebug(ai, options);
            const logger = this.getLogger(ai, options);

            // Calculate exponential backoff delay
            const baseDelay = 1000; // 1 second
            const maxDelay = 60000; // 60 seconds
            const delay = Math.min(
              maxDelay,
              baseDelay * Math.pow(2, infraRetryCount)
            );

            if (debug && logger) {
              logger({
                name: 'Notification',
                id: 'infrastructure-retry',
                value: `Infrastructure error (attempt ${infraRetryCount + 1}/${infraMaxRetries + 1}): ${error.message}. Retrying in ${delay}ms...`,
              });
            }

            span?.addEvent('infrastructure.retry', {
              attempt: infraRetryCount + 1,
              maxRetries: infraMaxRetries,
              delay,
              errorType:
                error instanceof AxAIServiceStatusError
                  ? 'status_error'
                  : error instanceof AxAIServiceNetworkError
                    ? 'network_error'
                    : error instanceof AxAIServiceTimeoutError
                      ? 'timeout_error'
                      : 'stream_terminated',
              errorMessage: error.message,
            });

            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue; // Retry infrastructure call
          }

          // Not a retryable infrastructure error, or max retries exhausted
          throw e;
        }
      }
    }

    // Record max steps reached
    if (metricsInstruments) {
      recordMultiStepMetric(
        metricsInstruments,
        maxSteps,
        maxSteps,
        this.getSignatureName(),
        customLabels
      );
    }

    throw enhanceError(
      new Error(`Max steps reached: ${maxSteps}`),
      ai,
      this.signature
    );
  }

  /**
   * Validate input values against field constraints
   * @throws ValidationError if any input value fails validation
   */
  private validateInputs(values: IN): void {
    const inputFields = this.signature.getInputFields();

    for (const field of inputFields) {
      if (field.isInternal) continue;

      const value = values[field.name as keyof IN];

      // Skip validation for optional fields with undefined values
      if (field.isOptional && value === undefined) {
        continue;
      }

      const type = field.type;
      if (!type) continue;

      // Validate based on field type
      if (type.name === 'url') {
        validateURL(value, field);
      }

      if (type.name === 'date') {
        // Date validation is already handled by existing parseLLMFriendlyDate
        // which is called during extraction - we'll rely on that
      }

      if (type.name === 'datetime') {
        // DateTime validation is already handled by existing parseLLMFriendlyDateTime
        // which is called during extraction - we'll rely on that
      }

      if (type.name === 'string' || type.name === 'code') {
        validateStringConstraints(value, field);
      }

      if (type.name === 'number') {
        validateNumberConstraints(value, field);
      }

      // Recursively validate object fields
      if (
        type.name === 'object' &&
        type.fields &&
        typeof value === 'object' &&
        value !== null
      ) {
        this.validateObjectFields(
          value as Record<string, unknown>,
          type.fields,
          field.name
        );
      }

      // Validate array elements
      if (type.isArray && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];

          if (type.name === 'string' || type.name === 'code') {
            validateStringConstraints(item, field);
          } else if (type.name === 'number') {
            validateNumberConstraints(item, field);
          } else if (type.fields && typeof item === 'object' && item !== null) {
            this.validateObjectFields(
              item as Record<string, unknown>,
              type.fields,
              `${field.name}[${i}]`
            );
          }
        }
      }
    }
  }

  /**
   * Recursively validate object field values
   */
  private validateObjectFields(
    obj: Record<string, unknown>,
    fields: Record<string, import('./sig.js').AxFieldType>,
    parentFieldName: string
  ): void {
    for (const [fieldName, fieldType] of Object.entries(fields)) {
      const value = obj[fieldName];

      // Skip optional fields with undefined values
      if (fieldType.isOptional && value === undefined) {
        continue;
      }

      const syntheticField: import('./sig.js').AxField = {
        name: `${parentFieldName}.${fieldName}`,
        type: {
          name: fieldType.type,
          isArray: fieldType.isArray,
          options: fieldType.options ? [...fieldType.options] : undefined,
          fields: fieldType.fields,
          minLength: fieldType.minLength,
          maxLength: fieldType.maxLength,
          minimum: fieldType.minimum,
          maximum: fieldType.maximum,
          pattern: fieldType.pattern,
          format: fieldType.format,
        },
        description: fieldType.description,
        isOptional: fieldType.isOptional,
      };

      if (fieldType.type === 'string' || fieldType.type === 'code') {
        validateStringConstraints(value, syntheticField);
      } else if (fieldType.type === 'number') {
        validateNumberConstraints(value, syntheticField);
      } else if (
        fieldType.type === 'object' &&
        fieldType.fields &&
        typeof value === 'object' &&
        value !== null
      ) {
        this.validateObjectFields(
          value as Record<string, unknown>,
          fieldType.fields,
          syntheticField.name
        );
      }

      // Validate arrays
      if (fieldType.isArray && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];

          if (fieldType.type === 'string' || fieldType.type === 'code') {
            validateStringConstraints(item, syntheticField);
          } else if (fieldType.type === 'number') {
            validateNumberConstraints(item, syntheticField);
          } else if (
            fieldType.fields &&
            typeof item === 'object' &&
            item !== null
          ) {
            this.validateObjectFields(
              item as Record<string, unknown>,
              fieldType.fields,
              `${syntheticField.name}[${i}]`
            );
          }
        }
      }
    }
  }

  public async *_forward1(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions<any>>
  ): AxGenStreamingOut<OUT> {
    // Validate input values before processing
    if (!Array.isArray(values) || !values.every((v) => 'role' in v)) {
      this.validateInputs(values as IN);
    }

    // Create internal abort controller and merge with any user-provided signal
    this.abortController = new AbortController();
    if (this._stopRequested) {
      this.abortController.abort('Stopped by user (pre-forward)');
    }
    const effectiveAbortSignal = mergeAbortSignals(
      this.abortController.signal,
      options?.abortSignal ?? axGlobals.abortSignal
    );
    const effectiveOptions = effectiveAbortSignal
      ? { ...options, abortSignal: effectiveAbortSignal }
      : options;

    try {
      // Track state creation performance
      const stateCreationStart = performance.now();
      const states = this.createStates(options.sampleCount ?? 1);
      const stateCreationDuration = performance.now() - stateCreationStart;

      // Record state creation performance metric
      const metricsInstruments = this.getMetricsInstruments();
      const customLabels = this.getMergedCustomLabels(ai, options);
      if (metricsInstruments) {
        recordPerformanceMetric(
          metricsInstruments,
          'state_creation',
          stateCreationDuration,
          this.getSignatureName(),
          customLabels
        );
      }

      const tracer =
        options?.tracer ?? this.options?.tracer ?? ai.getOptions().tracer;

      let functions: AxFunction[] | undefined = this.functions;

      if (options?.functions) {
        functions = parseFunctions(options.functions, this.functions);
      }

      if (!tracer) {
        yield* this._forward2(ai, values, states, {
          ...effectiveOptions,
          functions,
        });
        return;
      }

      const funcNames = functions?.map((f) => f.name).join(',');

      const attributes = {
        signature: JSON.stringify(this.signature.toJSON(), null, 2),
        ...(this.examples
          ? { examples: JSON.stringify(this.examples, null, 2) }
          : {}),
        ...(funcNames ? { provided_functions: funcNames } : {}),
        ...(options?.model ? { model: options.model } : {}),
        ...(options?.thinkingTokenBudget
          ? { thinking_token_budget: options.thinkingTokenBudget }
          : {}),
        ...(options?.showThoughts
          ? { show_thoughts: options.showThoughts }
          : {}),
        ...(options?.maxSteps ? { max_steps: options.maxSteps } : {}),
        ...(options?.maxRetries ? { max_retries: options.maxRetries } : {}),
      };

      const traceLabel =
        this.traceLabel && options.traceLabel
          ? `${this.traceLabel} > ${options.traceLabel}`
          : (options.traceLabel ?? this.traceLabel);
      const spanName = traceLabel ? `AxGen > ${traceLabel}` : 'AxGen';

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.SERVER,
        attributes,
      });

      const currentContext = context.active();
      const traceContext = trace.setSpan(currentContext, span);

      try {
        if (!this.excludeContentFromTrace) {
          span.addEvent('input', { content: JSON.stringify(values, null, 2) });
        }

        yield* this._forward2(
          ai,
          values,
          states,
          {
            ...effectiveOptions,
            functions,
          },
          span,
          traceContext
        );

        if (!this.excludeContentFromTrace) {
          const valuesList = states.map((s) => s.values);
          const values = valuesList.length === 1 ? valuesList[0] : valuesList;
          span.addEvent('output', {
            content: JSON.stringify(values, null, 2),
          });
        }
      } finally {
        span.end();
      }
    } finally {
      this.abortController = undefined;
      this._stopRequested = false;
    }
  }

  /**
   * Executes the generator with the given AI service and input values.
   *
   * This is the main entry point for running an AI generation. The execution pipeline:
   * 1. **Validate** - Check input values match the signature
   * 2. **Render** - Build the prompt from signature, examples, and inputs
   * 3. **Call** - Send the request to the AI service
   * 4. **Parse** - Extract structured outputs from the response
   * 5. **Assert** - Validate outputs and retry with error correction if needed
   *
   * @param ai - The AI service instance to use (created via `ai()` factory)
   * @param values - Input values matching the signature's input fields, or an array of
   *   `AxMessage` objects for multi-turn conversations
   * @param options - Optional execution configuration
   *
   * @param options.model - Override the default model for this request
   * @param options.maxTokens - Maximum tokens in the response. Rule of thumb: ~750 tokens ≈ 1 page
   *   of English text. Set higher for long-form content, lower for concise responses.
   * @param options.temperature - Controls randomness in generation (0-2):
   *   - `0` - Deterministic, always picks most likely token (best for factual tasks)
   *   - `0.3-0.7` - Balanced creativity (good for most tasks)
   *   - `1.0+` - High creativity (good for brainstorming, creative writing)
   *   - `2.0` - Maximum randomness (often incoherent)
   * @param options.thinkingTokenBudget - Enable extended thinking for complex reasoning:
   *   - `'none'` - Disabled (default)
   *   - `'minimal'` - ~1K tokens of thinking
   *   - `'low'` - ~4K tokens
   *   - `'medium'` - ~10K tokens
   *   - `'high'` - ~20K tokens
   *   - `'highest'` - ~32K+ tokens (provider maximum)
   * @param options.stream - Enable streaming responses for real-time output
   * @param options.functions - Array of function tools the AI can call
   * @param options.functionCallMode - How to handle function calling:
   *   - `'auto'` - Let the provider decide (default)
   *   - `'native'` - Force native function calling (if supported)
   *   - `'prompt'` - Simulate via prompt engineering (for models without native support)
   * @param options.mem - Memory instance for conversation history
   * @param options.sessionId - Session identifier for memory isolation
   * @param options.maxRetries - Maximum error correction attempts (default: 3)
   * @param options.maxSteps - Maximum function call iterations (default: 10)
   * @param options.debug - Enable debug logging
   *
   * @returns Promise resolving to the output values matching the signature's output fields
   *
   * @throws {AxValidationError} When input values don't match the signature
   * @throws {AxAssertionError} When output parsing/validation fails after all retries
   * @throws {AxAIServiceError} When the AI service request fails
   *
   * @example Basic usage
   * ```typescript
   * const gen = ax('question: string -> answer: string');
   * const result = await gen.forward(ai, { question: 'What is 2+2?' });
   * console.log(result.answer); // "4"
   * ```
   *
   * @example With configuration
   * ```typescript
   * const result = await gen.forward(ai, { question: 'Explain quantum computing' }, {
   *   maxTokens: 2000,
   *   temperature: 0.3,
   *   stream: true
   * });
   * ```
   *
   * @example Multi-turn conversation
   * ```typescript
   * const mem = new AxMemory();
   * const chat = ax('message: string -> reply: string');
   *
   * await chat.forward(ai, { message: 'Hi, my name is Alice' }, { mem });
   * const result = await chat.forward(ai, { message: 'What is my name?' }, { mem });
   * // result.reply will reference "Alice" from conversation history
   * ```
   *
   * @example With function calling
   * ```typescript
   * const result = await gen.forward(ai, values, {
   *   functions: [{
   *     name: 'getWeather',
   *     description: 'Get current weather for a city',
   *     parameters: {
   *       type: 'object',
   *       properties: { city: { type: 'string', description: 'City name' } },
   *       required: ['city']
   *     },
   *     func: async ({ city }) => fetchWeather(city)
   *   }],
   *   maxSteps: 5
   * });
   * ```
   */
  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    // Caching pre-check: if cachingFunction provided and returns a value, short-circuit
    const cachingFunction =
      options?.cachingFunction ??
      this.options?.cachingFunction ??
      axGlobals.cachingFunction;
    const cacheKey = (() => {
      if (!cachingFunction) return undefined;
      const inputNames = this.signature.getInputFields().map((f) => f.name);
      return this.computeCacheKey(values, inputNames);
    })();
    if (cachingFunction && cacheKey) {
      const cached = await cachingFunction(cacheKey);
      if (cached !== undefined) {
        return cached as unknown as OUT;
      }
    }

    const startTime = performance.now();
    const signatureName = this.getSignatureName();
    const isStreaming = options?.stream ?? false;
    let success = false;
    let errorCorrectionAttempts = 0;
    let resultPickerUsed = false;

    try {
      // Record signature complexity metrics
      const metricsInstruments = this.getMetricsInstruments();
      const customLabels = this.getMergedCustomLabels(ai, options);
      if (metricsInstruments) {
        recordSignatureComplexityMetrics(
          metricsInstruments,
          this.signature.getInputFields().length,
          this.signature.getOutputFields().length,
          this.examples?.length ?? 0,
          this.demos?.length ?? 0,
          signatureName,
          customLabels
        );
      }

      const generator = this._forward1(ai, values, options ?? {});

      let buffer: AxGenDeltaOut<OUT>[] = [];
      let currentVersion = 0;
      let deltasEmitted = 0;

      for await (const delta of generator) {
        if (delta.version !== currentVersion) {
          buffer = [];
        }
        currentVersion = delta.version;
        buffer = mergeDeltas<OUT>(buffer, delta);
        deltasEmitted++;
      }

      // Track error correction attempts from the version count
      errorCorrectionAttempts = currentVersion;

      // Use result picker to select from multiple samples
      const resultPickerStart = performance.now();
      resultPickerUsed = !!options?.resultPicker;

      const selectedIndex = await selectFromSamples(
        buffer,
        {
          resultPicker: options?.resultPicker as
            | AxResultPickerFunction<OUT>
            | undefined,
        },
        // Pass memory to enable function result selection
        options?.mem,
        options?.sessionId
      );

      const resultPickerLatency = performance.now() - resultPickerStart;

      const selectedResult = buffer[selectedIndex];
      const result = selectedResult?.delta ?? {};

      // When values is an AxMessage array, do not spread it into trace; only include result
      const baseTrace = Array.isArray(values)
        ? ({} as Record<string, unknown>)
        : ((values as unknown as Record<string, unknown>) ?? {});
      this.trace = { ...baseTrace, ...result } as unknown as OUT;
      // Log result picker usage if it was used and debug is enabled
      if (resultPickerUsed && this.isDebug(ai, options)) {
        const logger = this.getLogger(ai, options);
        logResultPickerUsed(
          buffer.length,
          selectedIndex,
          resultPickerLatency,
          logger
        );
      }

      success = true;

      // Record samples metrics
      if (metricsInstruments) {
        recordSamplesMetric(
          metricsInstruments,
          buffer.length,
          resultPickerUsed,
          resultPickerUsed ? resultPickerLatency : undefined,
          signatureName,
          customLabels
        );

        // Record streaming metrics
        recordStreamingMetric(
          metricsInstruments,
          isStreaming,
          deltasEmitted,
          undefined, // finalization latency not applicable here
          signatureName,
          customLabels
        );
      }

      // Caching post-store: call cachingFunction again with value if provided
      if (cachingFunction && cacheKey) {
        try {
          await cachingFunction(cacheKey, result as unknown as AxGenOut);
        } catch {}
      }

      return result as unknown as OUT;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = performance.now() - startTime;

      // Record generation metrics
      const finalMetricsInstruments = this.getMetricsInstruments();
      const finalCustomLabels = this.getMergedCustomLabels(ai, options);
      if (finalMetricsInstruments) {
        recordGenerationMetric(
          finalMetricsInstruments,
          duration,
          success,
          signatureName,
          ai.getName(),
          options?.model ? String(options.model) : undefined,
          finalCustomLabels
        );

        // Skip per-call function execution metric here; detailed metrics are recorded during processing

        // Record error correction metrics
        if (errorCorrectionAttempts > 0) {
          recordErrorCorrectionMetric(
            finalMetricsInstruments,
            errorCorrectionAttempts,
            success,
            options?.maxRetries ?? 10,
            signatureName,
            finalCustomLabels
          );
        }
      }
    }
  }

  async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
    // Caching pre-check for streaming
    const cachingFunction =
      options?.cachingFunction ??
      this.options?.cachingFunction ??
      axGlobals.cachingFunction;
    const cacheKey = (() => {
      if (!cachingFunction) return undefined;
      const inputNames = this.signature.getInputFields().map((f) => f.name);
      return this.computeCacheKey(values, inputNames);
    })();
    if (cachingFunction && cacheKey) {
      let cached: unknown;
      try {
        cached = await cachingFunction(cacheKey);
      } catch {}
      if (cached !== undefined) {
        yield {
          version: 0,
          index: 0,
          delta: cached as OUT,
        };
        return;
      }
    }

    // If no result picker, use normal streaming
    if (!options?.resultPicker) {
      yield* this._forward1(ai, values, {
        ...options,
        stream: true,
      });
      return;
    }

    // For result picker, we need to buffer all results first
    const generator = this._forward1(ai, values, {
      ...options,
      stream: true,
    });

    let buffer: AxGenDeltaOut<OUT>[] = [];
    let currentVersion = 0;

    for await (const delta of generator) {
      if (delta.version !== currentVersion) {
        buffer = [];
      }
      currentVersion = delta.version;
      buffer = mergeDeltas<OUT>(buffer, delta);
    }

    // Use result picker to select from samples
    const selectedIndex = await selectFromSamples(
      buffer,
      {
        resultPicker: options?.resultPicker as
          | AxResultPickerFunction<OUT>
          | undefined,
      },
      // Pass memory to enable function result selection
      options?.mem,
      options?.sessionId
    );

    // Yield the selected result
    const selectedResult = buffer[selectedIndex];
    if (selectedResult) {
      // Post-store cache
      if (cachingFunction && cacheKey) {
        try {
          await cachingFunction(
            cacheKey,
            selectedResult.delta as unknown as AxGenOut
          );
        } catch {}
      }
      yield {
        version: currentVersion,
        index: selectedIndex,
        delta: selectedResult.delta,
      };
    }
  }

  public override setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    super.setExamples(examples, options);
    // No need to update prompt template - all fields can be missing in examples
  }

  private isDebug(
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions<any>>
  ) {
    return (
      options?.debug ??
      this.options?.debug ??
      axGlobals.debug ??
      ai.getOptions().debug ??
      false
    );
  }

  private getLogger(
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions<any>>
  ) {
    return (
      options?.logger ??
      this.options?.logger ??
      axGlobals.logger ??
      ai.getLogger()
    );
  }

  private computeCacheKey(
    values: IN | AxMessage<IN>[],
    inputNames: readonly string[]
  ): string {
    const hasher = createHash('sha256');
    hasher.update(this.signature.hash() ?? '');

    const updateWithValue = (v: unknown): void => {
      const t = typeof v;
      hasher.update(`|${t}|`);
      if (v === null || v === undefined) {
        hasher.update('null');
        return;
      }
      if (t === 'string' || t === 'number' || t === 'boolean') {
        hasher.update(String(v));
        return;
      }
      if (Array.isArray(v)) {
        hasher.update('[');
        for (const item of v) updateWithValue(item);
        hasher.update(']');
        return;
      }
      if (
        typeof v === 'object' &&
        v !== null &&
        'mimeType' in (v as Record<string, unknown>) &&
        'data' in (v as Record<string, unknown>)
      ) {
        const mv = v as { mimeType?: string; data?: string };
        hasher.update(mv.mimeType ?? '');
        const dataDigest = createHash('sha256')
          .update(mv.data ?? '')
          .digest('hex');
        hasher.update(dataDigest);
        return;
      }
      if (typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        for (const k of keys) {
          hasher.update(`{${k}}`);
          updateWithValue(obj[k]);
        }
        return;
      }
      hasher.update(String(v));
    };

    if (Array.isArray(values)) {
      for (const m of values as AxMessage<IN>[]) {
        hasher.update(`role:${m.role}`);
        const row = inputNames.map((n) => (m as any).values?.[n]);
        for (const val of row) updateWithValue(val);
      }
    } else {
      const row = inputNames.map((n) => (values as any)?.[n]);
      for (const val of row) updateWithValue(val);
    }

    return hasher.digest('hex');
  }
}

export type AxGenerateErrorDetails = {
  model?: string;
  maxTokens?: number;
  streaming: boolean;
  signature: {
    input: Readonly<AxIField[]>;
    output: Readonly<AxIField[]>;
    description?: string;
  };
};

type ErrorOptions = { cause?: Error };

export class AxGenerateError extends Error {
  public readonly details: AxGenerateErrorDetails;

  constructor(
    message: string,
    details: Readonly<AxGenerateErrorDetails>,
    options?: ErrorOptions
  ) {
    super(message);
    this.name = 'AxGenerateError';
    this.details = details;
    // Set cause property dynamically to avoid TypeScript issues
    if (options?.cause) {
      (this as ErrorOptions).cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    const cause = (this as ErrorOptions).cause;
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      cause: cause
        ? {
            name: cause.name,
            message: cause.message,
            stack: cause.stack,
          }
        : undefined,
      stack: this.stack,
    };
  }
}

function enhanceError(
  e: unknown,
  ai: Readonly<AxAIService>,
  signature: Readonly<AxSignature>
): Error {
  const originalError = e instanceof Error ? e : new Error(String(e));

  // Never wrap abort errors — preserve the specific error type
  if (originalError instanceof AxAIServiceAbortedError) {
    return originalError;
  }

  // Don't wrap validation errors or assertion errors - let them propagate directly
  const errorMsg = (originalError.message || '').toLowerCase();
  const isValidationOrAssertionError =
    errorMsg.includes('at least') ||
    errorMsg.includes('at most') ||
    errorMsg.includes('must match pattern') ||
    errorMsg.includes('invalid url') ||
    errorMsg.includes('required') ||
    errorMsg.includes('missing') ||
    errorMsg.includes('valid email') ||
    errorMsg.includes('number must be') ||
    originalError.name === 'ValidationError' ||
    originalError.name === 'AssertionError' ||
    originalError.name === 'AxAssertionError' ||
    // Check if error was thrown from an assertion (stack trace includes 'asserts.ts')
    originalError.stack?.includes('asserts.ts');

  if (isValidationOrAssertionError) {
    return originalError;
  }

  const model = ai.getLastUsedChatModel() as string | undefined;
  const modelConfig = ai.getLastUsedModelConfig();

  const details = {
    model: model,
    maxTokens: modelConfig?.maxTokens,
    streaming: modelConfig?.stream ?? false,
    signature: {
      input: signature.getInputFields(),
      output: signature.getOutputFields(),
      description: signature.getDescription(),
    },
  };

  // Return custom error with short message and details as object property
  return new AxGenerateError(
    `Generate failed: ${originalError.message}`,
    details,
    {
      cause: originalError,
    }
  );
}
