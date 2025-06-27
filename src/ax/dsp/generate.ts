import { ReadableStream } from 'node:stream/web'

import {
  context,
  type Context,
  type Span,
  SpanKind,
  trace,
} from '@opentelemetry/api'

import { validateAxMessageArray } from '../ai/base.js'
import type {
  AxAIService,
  AxChatResponseResult,
  AxFunction,
} from '../ai/types.js'
import { AxMemory } from '../mem/memory.js'
import type { AxAIMemory } from '../mem/types.js'
import { AxAIServiceStreamTerminatedError } from '../util/apicall.js'

import {
  type AxAssertion,
  AxAssertionError,
  type AxStreamingAssertion,
} from './asserts.js'
import { ValidationError } from './errors.js'
import { type extractionState } from './extract.js'
import { type AxFieldProcessor } from './fieldProcessor.js'
import { type AxChatResponseFunctionCall, parseFunctions } from './functions.js'
import {
  processResponse,
  processStreamingResponse,
  shouldContinueSteps,
} from './processResponse.js'
import {
  type AsyncGenDeltaOut,
  type AxGenDeltaOut,
  type AxGenStreamingOut,
  type AxProgramExamples,
  type AxProgramForwardOptions,
  type AxProgramStreamingForwardOptions,
  AxProgramWithSignature,
  type AxSetExamplesOptions,
} from './program.js'
import { AxPromptTemplate } from './prompt.js'
import type { AxIField, AxSignature } from './sig.js'
import type {
  AxGenIn,
  AxGenIn as AxGenInType,
  AxGenOut,
  AxGenOut as AxGenOutType,
  AxMessage,
} from './types.js'
import { mergeDeltas } from './util.js'
import { handleValidationError } from './validate.js'

export type AxGenerateResult<OUT extends AxGenOutType> = OUT & {
  thought?: string
}

export interface AxResponseHandlerArgs<T> {
  ai: Readonly<AxAIService>
  model?: string
  res: T
  mem: AxAIMemory
  sessionId?: string
  traceId?: string
  functions: Readonly<AxFunction[]>
  strictMode?: boolean
  span?: Span
}

export interface AxStreamingEvent<T> {
  event: 'delta' | 'done' | 'error'
  data: {
    contentDelta?: string
    partialValues?: Partial<T>
    error?: string
    functions?: AxChatResponseFunctionCall[]
  }
}

export type InternalAxGenState = {
  index: number
  values: AxGenOutType
  content: string
  functionsExecuted: Set<string>
  functionCalls: NonNullable<AxChatResponseResult['functionCalls']>
  xstate: extractionState
}

export class AxGen<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenOut = AxGenOut,
> extends AxProgramWithSignature<IN, OUT> {
  private promptTemplate: AxPromptTemplate
  private asserts: AxAssertion[]
  private streamingAsserts: AxStreamingAssertion[]
  private options?: Omit<AxProgramForwardOptions, 'functions'>
  private functions?: AxFunction[]
  private fieldProcessors: AxFieldProcessor[] = []
  private streamingFieldProcessors: AxFieldProcessor[] = []
  private excludeContentFromTrace: boolean = false
  private thoughtFieldName: string

  constructor(
    signature: NonNullable<ConstructorParameters<typeof AxSignature>[0]>,
    options?: Readonly<AxProgramForwardOptions>
  ) {
    super(signature, { description: options?.description })

    this.options = options
    this.thoughtFieldName = options?.thoughtFieldName ?? 'thought'
    const promptTemplateOptions = {
      functions: options?.functions,
      thoughtFieldName: this.thoughtFieldName,
    }
    this.promptTemplate = new (options?.promptTemplate ?? AxPromptTemplate)(
      this.signature,
      promptTemplateOptions
    )
    this.asserts = this.options?.asserts ?? []
    this.streamingAsserts = this.options?.streamingAsserts ?? []
    this.excludeContentFromTrace = options?.excludeContentFromTrace ?? false
    this.usage = []

    if (options?.functions) {
      this.functions = parseFunctions(options.functions)
    }
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
    }))
  }

  public addAssert = (fn: AxAssertion['fn'], message?: string) => {
    this.asserts.push({ fn, message })
  }

  public addStreamingAssert = (
    fieldName: string,
    fn: AxStreamingAssertion['fn'],
    message?: string
  ) => {
    this.streamingAsserts.push({ fieldName, fn, message })
  }

  private addFieldProcessorInternal = (
    fieldName: string,
    fn: AxFieldProcessor['process'],
    streaming = false
  ) => {
    const field = this.signature
      .getOutputFields()
      .find((f) => f.name === fieldName)

    if (!field) {
      throw new Error(`addFieldProcessor: field ${fieldName} not found`)
    }

    if (streaming) {
      const ft = field.type?.name
      const isText = !ft || ft === 'string' || ft === 'code'

      if (!isText) {
        throw new Error(
          `addFieldProcessor: field ${fieldName} is must be a text field`
        )
      }
      this.streamingFieldProcessors.push({ field, process: fn })
    } else {
      this.fieldProcessors.push({ field, process: fn })
    }
  }

  public addStreamingFieldProcessor = (
    fieldName: string,
    fn: AxFieldProcessor['process']
  ) => {
    this.addFieldProcessorInternal(fieldName, fn, true)
  }

  public addFieldProcessor = (
    fieldName: string,
    fn: AxFieldProcessor['process']
  ) => {
    this.addFieldProcessorInternal(fieldName, fn, false)
  }

  private async forwardSendRequest({
    ai,
    mem,
    options,
    traceContext,
    firstStep,
  }: Readonly<{
    ai: Readonly<AxAIService>
    mem: AxAIMemory
    options?: Omit<AxProgramForwardOptions, 'ai' | 'mem'>
    traceContext?: Context
    firstStep: boolean
  }>) {
    const {
      sessionId,
      traceId,
      model,
      rateLimiter,
      stream,
      functions: _functions,
      functionCall: _functionCall,
      thinkingTokenBudget,
      showThoughts,
    } = options ?? {}

    const chatPrompt = mem?.history(0, sessionId) ?? []

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found')
    }

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const functions = _functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat()

    let functionCall = _functionCall ?? this.options?.functionCall

    if (
      !firstStep &&
      (functionCall === 'required' || typeof functionCall === 'function')
    ) {
      functionCall = undefined
    }

    const modelConfig = {
      ...options?.modelConfig,
      ...(options?.sampleCount ? { n: options.sampleCount } : {}),
    }

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
        traceId,
        rateLimiter,
        stream,
        debug: false, // we do our own debug logging
        thinkingTokenBudget,
        showThoughts,
        traceContext,
        abortSignal: options?.abortSignal,
      }
    )

    return res
  }

  private async *forwardCore({
    ai,
    mem,
    options,
    firstStep,
    span,
    traceContext,
  }: Readonly<{
    ai: Readonly<AxAIService>
    mem: AxAIMemory
    options: Omit<AxProgramForwardOptions, 'ai' | 'mem'>
    firstStep: boolean
    span?: Span
    traceContext?: Context
  }>): AsyncGenDeltaOut<OUT> {
    const { sessionId, traceId, functions: _functions } = options ?? {}
    const strictMode = options?.strictMode ?? false
    const model = options.model
    const states = this.createStates(options.sampleCount ?? 1)
    const usage = this.usage

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const functions =
      _functions
        ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
        ?.flat() ?? []

    const res = await this.forwardSendRequest({
      ai,
      mem,
      options,
      traceContext,
      firstStep,
    })

    if (res instanceof ReadableStream) {
      yield* processStreamingResponse({
        ai,
        model,
        res,
        mem,
        traceId,
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
      })

      this.getLogger(ai, options)?.('', { tags: ['responseEnd'] })
    } else {
      yield* processResponse({
        ai,
        model,
        res,
        mem,
        traceId,
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
      })
    }
  }

  private async *_forward2(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    states: InternalAxGenState[],
    options: Readonly<AxProgramForwardOptions>,
    span?: Span,
    traceContext?: Context
  ): AxGenStreamingOut<OUT> {
    const stopFunction = (
      options?.stopFunction ?? this.options?.stopFunction
    )?.toLowerCase()

    const maxRetries = options.maxRetries ?? this.options?.maxRetries ?? 10
    const maxSteps = options.maxSteps ?? this.options?.maxSteps ?? 10
    const debugHideSystemPrompt = options.debugHideSystemPrompt
    const memOptions = {
      debug: this.isDebug(ai, options),
      debugHideSystemPrompt,
    }

    const mem = options.mem ?? this.options?.mem ?? new AxMemory(memOptions)

    let err: ValidationError | AxAssertionError | undefined

    if (options?.functions && options.functions.length > 0) {
      const promptTemplateClass =
        this.options?.promptTemplate ?? AxPromptTemplate
      const currentPromptTemplateOptions = {
        functions: options.functions,
        thoughtFieldName: this.thoughtFieldName,
      }
      this.promptTemplate = new promptTemplateClass(
        this.signature,
        currentPromptTemplateOptions
      )
    }

    // New logic:
    let prompt

    if (Array.isArray(values)) {
      // Validate AxMessage array items
      validateAxMessageArray(values)

      // We'll need to decide how to get the 'individual' IN for demos/examples if needed by render.
      // For now, assume render will handle the array directly.
      // The generic type for render might need to be T (from render<T extends ...>)
      // and T will be inferred as ReadonlyArray<AxMessage>
      prompt = this.promptTemplate.render(values, {
        examples: this.examples,
        demos: this.demos,
      })
    } else {
      // Ensure `values` here is correctly inferred as AxGenInType
      prompt = this.promptTemplate.render(values as AxGenInType, {
        // Cast if necessary
        examples: this.examples,
        demos: this.demos,
      })
    }

    mem.addRequest(prompt, options.sessionId)

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
      const firstStep = n === 0
      for (let errCount = 0; errCount < maxRetries; errCount++) {
        try {
          const generator = this.forwardCore({
            options,
            ai,
            mem,
            firstStep,
            span,
            traceContext,
          })

          for await (const result of generator) {
            if (result !== undefined) {
              yield {
                version: errCount,
                index: result.index,
                delta: result.delta,
              }
            }
          }

          const shouldContinue = shouldContinueSteps(
            mem,
            stopFunction,
            states,
            options?.sessionId
          )

          if (shouldContinue) {
            continue multiStepLoop
          }

          this.getLogger(ai, options)?.('', { tags: ['responseEnd'] })
          return
        } catch (e) {
          let errorFields: AxIField[] | undefined

          span?.recordException(e as Error)

          if (e instanceof ValidationError) {
            errorFields = e.getFixingInstructions()
            err = e

            // Add telemetry event for validation error
            if (span) {
              span.addEvent('validation.error', {
                message: e.toString(),
                fixing_instructions:
                  errorFields?.map((f) => f.title).join(', ') ?? '',
              })
            }
          } else if (e instanceof AxAssertionError) {
            const e1 = e as AxAssertionError
            errorFields = e1.getFixingInstructions()
            err = e

            // Add telemetry event for assertion error
            if (span) {
              span.addEvent('assertion.error', {
                message: e1.toString(),
                fixing_instructions:
                  errorFields?.map((f) => f.title).join(', ') ?? '',
              })
            }
          } else if (e instanceof AxAIServiceStreamTerminatedError) {
            // Do nothing allow error correction to happen
          } else {
            throw enhanceError(e, ai, this.signature)
          }

          if (errorFields) {
            handleValidationError(
              mem,
              errorFields,
              ai,
              this.promptTemplate,
              options.sessionId
            )
          }
        }
      }

      throw enhanceError(
        new Error(`Unable to fix validation error: ${err?.toString()}`),
        ai,
        this.signature
      )
    }

    throw enhanceError(
      new Error(`Max steps reached: ${maxSteps}`),
      ai,
      this.signature
    )
  }

  public async *_forward1(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions>
  ): AxGenStreamingOut<OUT> {
    const states = this.createStates(options.sampleCount ?? 1)

    const tracer =
      options?.tracer ?? this.options?.tracer ?? ai.getOptions().tracer

    let functions: AxFunction[] | undefined = this.functions

    if (options?.functions) {
      functions = parseFunctions(options.functions, this.functions)
    }

    if (!tracer) {
      yield* this._forward2(ai, values, states, {
        ...options,
        functions,
      })
      return
    }

    const funcNames = functions?.map((f) => f.name).join(',')

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
    }

    const traceLabel = options.traceLabel ?? this.options?.traceLabel
    const spanName = traceLabel ? `${traceLabel} (AxGen)` : 'AxGen'

    const span = tracer.startSpan(spanName, {
      kind: SpanKind.SERVER,
      attributes,
    })

    const currentContext = context.active()
    const traceContext = trace.setSpan(currentContext, span)

    try {
      if (!this.excludeContentFromTrace) {
        span.addEvent('input', { content: JSON.stringify(values, null, 2) })
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
      )

      if (!this.excludeContentFromTrace) {
        const valuesList = states.map((s) => s.values)
        const values = valuesList.length === 1 ? valuesList[0] : valuesList
        span.addEvent('output', {
          content: JSON.stringify(values, null, 2),
        })
      }
    } finally {
      span.end()
    }
  }

  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    const generator = this._forward1(ai, values, options ?? {})

    let buffer: AxGenDeltaOut<OUT>[] = []
    let currentVersion = 0

    for await (const delta of generator) {
      if (delta.version !== currentVersion) {
        buffer = []
      }
      currentVersion = delta.version
      buffer = mergeDeltas<OUT>(buffer, delta)
    }

    const result = buffer[0]?.delta ?? {}
    this.trace = { ...values, ...result } as unknown as OUT

    return result as unknown as OUT
  }

  override async *streamingForward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptions>
  ): AxGenStreamingOut<OUT> {
    yield* this._forward1(ai, values, {
      ...options,
      stream: true,
    })
  }

  public override setExamples(
    examples: Readonly<AxProgramExamples<IN, OUT>>,
    options?: Readonly<AxSetExamplesOptions>
  ) {
    super.setExamples(examples, options)
    // No need to update prompt template - all fields can be missing in examples
  }

  private isDebug(
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions>
  ) {
    return (
      options?.debug ?? this.options?.debug ?? ai.getOptions().debug ?? false
    )
  }

  private getLogger(
    ai: Readonly<AxAIService>,
    options?: Readonly<AxProgramForwardOptions>
  ) {
    return options?.logger ?? this.options?.logger ?? ai.getLogger()
  }
}

export type AxGenerateErrorDetails = {
  model?: string
  maxTokens?: number
  streaming: boolean
  signature: {
    input: Readonly<AxIField[]>
    output: Readonly<AxIField[]>
    description?: string
  }
}

type ErrorOptions = { cause?: Error }

export class AxGenerateError extends Error {
  public readonly details: AxGenerateErrorDetails

  constructor(
    message: string,
    details: Readonly<AxGenerateErrorDetails>,
    options?: ErrorOptions
  ) {
    super(message)
    this.name = 'AxGenerateError'
    this.details = details
    // Set cause property dynamically to avoid TypeScript issues
    if (options?.cause) {
      ;(this as ErrorOptions).cause = options.cause
    }
  }
}

function enhanceError(
  e: unknown,
  ai: Readonly<AxAIService>,
  signature: Readonly<AxSignature>
): Error {
  const originalError = e instanceof Error ? e : new Error(String(e))
  const model = ai.getLastUsedChatModel() as string | undefined
  const modelConfig = ai.getLastUsedModelConfig()

  const details = {
    model: model,
    maxTokens: modelConfig?.maxTokens,
    streaming: modelConfig?.stream ?? false,
    signature: {
      input: signature.getInputFields(),
      output: signature.getOutputFields(),
      description: signature.getDescription(),
    },
  }

  // Return custom error with short message and details as object property
  return new AxGenerateError('Generate failed', details, {
    cause: originalError,
  })
}
