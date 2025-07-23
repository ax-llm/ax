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
  AxAIServiceStreamTerminatedError,
} from '../util/apicall.js';

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
  createFunctionConfig,
  parseFunctions,
} from './functions.js';
import { axGlobals } from './globals.js';
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
import type {
  AsyncGenDeltaOut,
  AxGenDeltaOut,
  AxGenIn,
  AxGenIn as AxGenInType,
  AxGenOut,
  AxGenOut as AxGenOutType,
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

export type AxGenerateResult<OUT extends AxGenOutType> = OUT & {
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
  values: AxGenOutType;
  content: string;
  functionsExecuted: Set<string>;
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>;
  xstate: extractionState;
};

export class AxGen<
    IN extends AxGenIn = AxGenIn,
    OUT extends AxGenOut = AxGenOut,
  >
  extends AxProgram<IN, OUT>
  implements AxProgrammable<IN, OUT>
{
  private promptTemplate: AxPromptTemplate;
  private asserts: AxAssertion[];
  private streamingAsserts: AxStreamingAssertion[];
  private options?: Omit<AxProgramForwardOptions<any>, 'functions'>;
  private functions?: AxFunction[];
  private fieldProcessors: AxFieldProcessor[] = [];
  private streamingFieldProcessors: AxFieldProcessor[] = [];
  private excludeContentFromTrace = false;
  private thoughtFieldName: string;

  /**
   * Creates an instance of the `AxGen` class.
   *
   * @param {NonNullable<ConstructorParameters<typeof AxSignature>[0]>} signature - The signature for the generation program.
   * @param {Readonly<AxProgramForwardOptions<any>>} [options] - The options for the generation program.
   */
  constructor(
    signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>,
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
    this.usage = [];

    if (options?.functions) {
      this.functions = parseFunctions(options.functions);
    }
  }

  private getSignatureName(): string {
    return this.signature.getDescription() || 'unknown_signature';
  }

  private getMetricsInstruments(): AxGenMetricsInstruments | undefined {
    return getOrCreateGenMetricsInstruments();
  }

  /**
   * Updates the meter for the generation program.
   * @param {Meter} [meter] - The meter to use for metrics.
   */
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

  /**
   * Adds an assertion to the generation program.
   * @param {AxAssertion['fn']} fn - The assertion function.
   * @param {string} [message] - The message to display if the assertion fails.
   */
  public addAssert = (fn: AxAssertion['fn'], message?: string) => {
    this.asserts.push({ fn, message });
  };

  /**
   * Adds a streaming assertion to the generation program.
   * @param {string} fieldName - The name of the field to assert on.
   * @param {AxStreamingAssertion['fn']} fn - The assertion function.
   * @param {string} [message] - The message to display if the assertion fails.
   */
  public addStreamingAssert = (
    fieldName: string,
    fn: AxStreamingAssertion['fn'],
    message?: string
  ) => {
    this.streamingAsserts.push({ fieldName, fn, message });
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
          `addFieldProcessor: field ${fieldName} is must be a text field`
        );
      }
      this.streamingFieldProcessors.push({ field, process: fn });
    } else {
      this.fieldProcessors.push({ field, process: fn });
    }
  };

  /**
   * Adds a streaming field processor to the generation program.
   * @param {string} fieldName - The name of the field to process.
   * @param {AxFieldProcessor['process']} fn - The processor function.
   */
  public addStreamingFieldProcessor = (
    fieldName: string,
    fn: AxFieldProcessor['process']
  ) => {
    this.addFieldProcessorInternal(fieldName, fn, true);
  };

  /**
   * Adds a field processor to the generation program.
   * @param {string} fieldName - The name of the field to process.
   * @param {AxFieldProcessor['process']} fn - The processor function.
   */
  public addFieldProcessor = (
    fieldName: string,
    fn: AxFieldProcessor['process']
  ) => {
    this.addFieldProcessorInternal(fieldName, fn, false);
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
    const selectedIndex = await selectFromSamplesInMemory<OUT>(mem, sessionId, {
      resultPicker: options?.resultPicker as
        | AxResultPickerFunction<OUT>
        | undefined,
    });

    const chatPrompt = mem?.history(selectedIndex, sessionId) ?? [];

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

    const res = await ai.chat(
      {
        chatPrompt,
        functions,
        functionCall,
        modelConfig,
        model,
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
        abortSignal: options?.abortSignal,
        stepIndex,
        logger,
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
  }: Readonly<{
    ai: Readonly<AxAIService>;
    mem: AxAIMemory;
    options: Omit<AxProgramForwardOptions<any>, 'ai' | 'mem'>;
    stepIndex?: number;
    span?: Span;
    traceContext?: Context;
  }>): AsyncGenDeltaOut<OUT> {
    const { sessionId, functions: functionList } = options ?? {};
    const definedFunctionCall =
      options?.functionCall ?? this.options?.functionCall;
    const strictMode = options?.strictMode ?? false;
    const model = options.model;
    const states = this.createStates(options.sampleCount ?? 1);
    const usage = this.usage;
    const firstStep = stepIndex === 0;
    const logger = this.getLogger(ai, options);

    const { functions, functionCall } = createFunctionConfig(
      functionList,
      definedFunctionCall,
      firstStep
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
      yield* processStreamingResponse({
        ai,
        model,
        res,
        mem,
        sessionId,
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
        functionResultFormatter:
          options?.functionResultFormatter ??
          this.options?.functionResultFormatter,
      });
    } else {
      yield* processResponse({
        ai,
        model,
        res,
        mem,
        sessionId,
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
        functionResultFormatter:
          options?.functionResultFormatter ??
          this.options?.functionResultFormatter,
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
    const stopFunction = (
      options?.stopFunction ?? this.options?.stopFunction
    )?.toLowerCase();

    const maxRetries = options.maxRetries ?? this.options?.maxRetries ?? 10;
    const maxSteps = options.maxSteps ?? this.options?.maxSteps ?? 10;

    const mem = options.mem ?? this.options?.mem ?? new AxMemory();

    let err: ValidationError | AxAssertionError | undefined;

    if (options?.functions && options.functions.length > 0) {
      const promptTemplateClass =
        this.options?.promptTemplate ?? AxPromptTemplate;
      const currentPromptTemplateOptions = {
        functions: options.functions,
        thoughtFieldName: this.thoughtFieldName,
      };
      this.promptTemplate = new promptTemplateClass(
        this.signature,
        currentPromptTemplateOptions
      );
    }

    // New logic:
    let prompt: AxChatRequest['chatPrompt'];

    // Track prompt rendering performance
    const promptRenderStart = performance.now();

    if (Array.isArray(values)) {
      // Validate AxMessage array items
      validateAxMessageArray(values);

      // We'll need to decide how to get the 'individual' IN for demos/examples if needed by render.
      // For now, assume render will handle the array directly.
      // The generic type for render might need to be T (from render<T extends ...>)
      // and T will be inferred as ReadonlyArray<AxMessage>
      prompt = this.promptTemplate.render(values, {
        examples: this.examples,
        demos: this.demos,
      });
    } else {
      // Ensure `values` here is correctly inferred as AxGenInType
      prompt = this.promptTemplate.render(values as AxGenInType, {
        // Cast if necessary
        examples: this.examples,
        demos: this.demos,
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

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
      for (let errCount = 0; errCount < maxRetries; errCount++) {
        try {
          const generator = this.forwardCore({
            options,
            ai,
            mem,
            stepIndex: n,
            span,
            traceContext,
          });

          for await (const result of generator) {
            if (result !== undefined) {
              yield {
                version: errCount,
                index: result.index,
                delta: result.delta,
              };
            }
          }

          const shouldContinue = shouldContinueSteps(
            mem,
            stopFunction,
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
            throw enhanceError(e, ai, this.signature);
          }

          if (errorFields) {
            mem.addRequest(
              [
                {
                  role: 'user' as const,
                  content: this.promptTemplate.renderExtraFields(errorFields),
                },
              ],
              options.sessionId
            );
            mem.addTag('error', options.sessionId);
          }
        }
      }

      // Record max retries reached
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
        new Error(`Unable to fix validation error: ${err?.toString()}`),
        ai,
        this.signature
      );
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

  public async *_forward1(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions<any>>
  ): AxGenStreamingOut<OUT> {
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

  /**
   * Executes the generation program with the given AI service and input values.
   *
   * @param {T} ai - The AI service to use.
   * @param {IN | AxMessage<IN>[]} values - The input values for the program.
   * @param {Readonly<AxProgramForwardOptionsWithModels<T>>} [options] - The options for the forward pass.
   * @returns {Promise<OUT>} A promise that resolves to the output of the program.
   */
  public async forward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptionsWithModels<T>>
  ): Promise<OUT> {
    const startTime = performance.now();
    const signatureName = this.getSignatureName();
    const isStreaming = options?.stream ?? false;
    let success = false;
    let errorCorrectionAttempts = 0;
    let functionsEnabled = false;
    const functionsExecuted = 0;
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

      // Check if functions are enabled
      functionsEnabled = !!(options?.functions || this.functions);

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
      this.trace = { ...values, ...result } as unknown as OUT;

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

        // Record function calling metrics if functions were used
        if (functionsEnabled) {
          recordFunctionCallingMetric(
            finalMetricsInstruments,
            functionsEnabled,
            functionsExecuted,
            functionsExecuted > 0,
            false, // function error correction tracking would need more complex logic
            signatureName
          );
        }

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

  /**
   * Executes the generation program and returns a streaming output.
   *
   * @param {T} ai - The AI service to use.
   * @param {IN | AxMessage<IN>[]} values - The input values for the program.
   * @param {Readonly<AxProgramStreamingForwardOptionsWithModels<T>>} [options] - The options for the streaming forward pass.
   * @returns {AxGenStreamingOut<OUT>} A streaming output of the program's result.
   */
  async *streamingForward<T extends Readonly<AxAIService>>(
    ai: T,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptionsWithModels<T>>
  ): AxGenStreamingOut<OUT> {
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
      options?.debug ?? this.options?.debug ?? ai.getOptions().debug ?? false
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
}

function enhanceError(
  e: unknown,
  ai: Readonly<AxAIService>,
  signature: Readonly<AxSignature>
): Error {
  const originalError = e instanceof Error ? e : new Error(String(e));
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
  return new AxGenerateError('Generate failed', details, {
    cause: originalError,
  });
}
