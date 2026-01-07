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
import {
  AxAIRefusalError,
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
} from './asserts.js';
import {
  type HandleErrorForGenerateArgs,
  handleAssertionErrorForGenerate,
  handleRefusalErrorForGenerate,
  handleValidationErrorForGenerate,
  ValidationError,
} from './errors.js';
import type { extractionState } from './extract.js';
import type { AxFieldProcessor } from './fieldProcessor.js';
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
import { AxProgram } from './program.js';
import { AxPromptTemplate } from './prompt.js';
import { selectFromSamples, selectFromSamplesInMemory } from './samples.js';
import type { AxIField, AxSignature } from './sig.js';
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
    if (hasComplexFields) {
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
    // Only if cacheBreakpoint is 'after-functions' or 'after-examples'
    const cacheBreakpoint =
      options?.contextCache?.cacheBreakpoint ?? 'after-examples';
    const shouldCacheFunctions =
      cacheBreakpoint === 'after-functions' ||
      cacheBreakpoint === 'after-examples';
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
  }: Readonly<{
    ai: Readonly<AxAIService>;
    mem: AxAIMemory;
    options: Omit<AxProgramForwardOptions<any>, 'ai' | 'mem'>;
    stepIndex?: number;
    span?: Span;
    traceContext?: Context;
    states: InternalAxGenState[];
    stopFunctionNames?: readonly string[];
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
    const { functions, functionCall } = createFunctionConfig(
      functionList,
      definedFunctionCall,
      firstStep,
      options
    );

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
    const stopFunctionNames = Array.isArray(rawStop)
      ? rawStop.map((s) => s.toLowerCase())
      : rawStop
        ? [rawStop.toLowerCase()]
        : undefined;

    const maxRetries = options.maxRetries ?? this.options?.maxRetries ?? 3;
    const maxSteps = options.maxSteps ?? this.options?.maxSteps ?? 25;

    const mem = options.mem ?? this.options?.mem ?? new AxMemory();

    const functions = [
      ...this.functions,
      ...(options.functions ? parseFunctions(options.functions) : []),
    ];

    const hasFunctions = functions && functions.length > 0;

    const functionCallMode =
      options.functionCallMode ?? this.options?.functionCallMode ?? 'auto';

    // Handle prompt mode
    if (hasFunctions && functionCallMode === 'prompt') {
      this.signatureToolCallingManager = new SignatureToolCallingManager(
        functions
      );
    }

    // Handle auto mode
    if (
      hasFunctions &&
      functionCallMode === 'auto' &&
      !ai.getFeatures(options.model).functions
    )
      this.signatureToolCallingManager = new SignatureToolCallingManager(
        functions
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

    const currentPromptTemplateOptions = {
      // Prefer per-call functions; fall back to parsed functions from constructor
      functions: this.signatureToolCallingManager ? [] : functions,
      thoughtFieldName: this.thoughtFieldName,
      contextCache: options.contextCache, // Pass through for system prompt caching
      examplesInSystem: options.examplesInSystem,
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
    if (metricsInstruments) {
      recordPerformanceMetric(
        metricsInstruments,
        'prompt_render',
        promptRenderDuration,
        this.getSignatureName()
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
        this.getSignatureName()
      );
    }

    // Track committed values across retries to prevent duplication
    const committedValues = new Map<number, Record<string, any>>();
    states.forEach((s) => {
      committedValues.set(s.index, {});
    });

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
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
                options,
                ai,
                mem,
                stepIndex: n,
                span,
                traceContext,
                states,
                stopFunctionNames,
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
                } else {
                  throw e;
                }
              }

              const shouldContinue = stopFunctionTriggered
                ? false
                : shouldContinueSteps(
                    mem,
                    stopFunctionNames,
                    states,
                    options?.sessionId
                  );

              if (shouldContinue) {
                // Record multi-step generation metric
                const metricsInstruments = this.getMetricsInstruments();
                if (metricsInstruments) {
                  recordMultiStepMetric(
                    metricsInstruments,
                    n + 1,
                    maxSteps,
                    this.getSignatureName()
                  );
                }
                continue multiStepLoop;
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
                  this.getSignatureName()
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
                    this.getSignatureName()
                  );
                }

                // Record field processing metrics
                recordFieldProcessingMetric(
                  metricsInstruments,
                  this.fieldProcessors.length,
                  this.streamingFieldProcessors.length,
                  this.getSignatureName()
                );
              }

              return;
            } catch (e) {
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
              this.getSignatureName()
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
        this.getSignatureName()
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

    // Track state creation performance
    const stateCreationStart = performance.now();
    const states = this.createStates(options.sampleCount ?? 1);
    const stateCreationDuration = performance.now() - stateCreationStart;

    // Record state creation performance metric
    const metricsInstruments = this.getMetricsInstruments();
    if (metricsInstruments) {
      recordPerformanceMetric(
        metricsInstruments,
        'state_creation',
        stateCreationDuration,
        this.getSignatureName()
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
        ...options,
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
      ...(options?.showThoughts ? { show_thoughts: options.showThoughts } : {}),
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
          ...options,
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
  }

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
      if (metricsInstruments) {
        recordSignatureComplexityMetrics(
          metricsInstruments,
          this.signature.getInputFields().length,
          this.signature.getOutputFields().length,
          this.examples?.length ?? 0,
          this.demos?.length ?? 0,
          signatureName
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
          signatureName
        );

        // Record streaming metrics
        recordStreamingMetric(
          metricsInstruments,
          isStreaming,
          deltasEmitted,
          undefined, // finalization latency not applicable here
          signatureName
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
      if (finalMetricsInstruments) {
        recordGenerationMetric(
          finalMetricsInstruments,
          duration,
          success,
          signatureName,
          ai.getName(),
          options?.model ? String(options.model) : undefined
        );

        // Skip per-call function execution metric here; detailed metrics are recorded during processing

        // Record error correction metrics
        if (errorCorrectionAttempts > 0) {
          recordErrorCorrectionMetric(
            finalMetricsInstruments,
            errorCorrectionAttempts,
            success,
            options?.maxRetries ?? 10,
            signatureName
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
