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
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
} from '../ai/types.js'
import { mergeFunctionCalls } from '../ai/util.js'
import { AxMemory } from '../mem/memory.js'
import type { AxAIMemory } from '../mem/types.js'
import { AxAIServiceStreamTerminatedError } from '../util/apicall.js'

import {
  assertAssertions,
  assertStreamingAssertions,
  type AxAssertion,
  AxAssertionError,
  type AxStreamingAssertion,
} from './asserts.js'
import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
  streamValues,
} from './extract.js'
import {
  type AxFieldProcessor,
  processFieldProcessors,
  processStreamingFieldProcessors,
} from './fieldProcessor.js'
import {
  type AxChatResponseFunctionCall,
  parseFunctionCalls,
  parseFunctions,
  processFunctions,
} from './functions.js'
import {
  type AxGenDeltaOut,
  type AxProgramExamples,
  type AxProgramForwardOptions,
  type AxProgramStreamingForwardOptions,
  AxProgramWithSignature,
  type AxSetExamplesOptions,
} from './program.js'
import { AxPromptTemplate } from './prompt.js'
import type { AxIField, AxSignature } from './sig.js'
import type {
  AxGenIn as AxGenInType,
  AxGenOut as AxGenOutType,
  AxMessage,
} from './types.js'
import { mergeDeltas } from './util.js'
import { handleValidationError, ValidationError } from './validate.js'

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
  functions?: Readonly<AxFunction[]>
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

export class AxGen<
  IN extends AxGenInType,
  OUT extends AxGenerateResult<AxGenOutType> = AxGenerateResult<AxGenOutType>,
> extends AxProgramWithSignature<IN, OUT> {
  private promptTemplate: AxPromptTemplate
  private asserts: AxAssertion[]
  private streamingAsserts: AxStreamingAssertion[]
  private options?: Omit<AxProgramForwardOptions, 'functions'>
  private functions?: AxFunction[]
  private functionsExecuted: Set<string> = new Set<string>()
  private fieldProcessors: AxFieldProcessor[] = []
  private streamingFieldProcessors: AxFieldProcessor[] = []
  private values: AxGenOutType = {}
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
      modelConfig,
      model,
      rateLimiter,
      stream,
      functions: _functions,
      functionCall: _functionCall,
      thinkingTokenBudget,
      showThoughts,
    } = options ?? {}

    const chatPrompt = mem?.history(sessionId) ?? []

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
  }>) {
    const { sessionId, traceId, functions: _functions } = options ?? {}
    const strictMode = options?.strictMode ?? false
    const model = options.model

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const functions = _functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat()

    const res = await this.forwardSendRequest({
      ai,
      mem,
      options,
      traceContext,
      firstStep,
    })

    if (res instanceof ReadableStream) {
      yield* this.processStreamingResponse({
        ai,
        model,
        res,
        mem,
        traceId,
        sessionId,
        functions,
        strictMode,
        span,
      })

      this.getLogger(ai, options)?.('', { tags: ['responseEnd'] })
    } else {
      yield await this.processResponse({
        ai,
        model,
        res,
        mem,
        traceId,
        sessionId,
        functions,
        span,
        strictMode,
      })
    }
  }

  private async *processStreamingResponse({
    ai,
    model,
    res,
    mem,
    sessionId,
    traceId,
    functions,
    strictMode,
    span,
  }: Readonly<AxResponseHandlerArgs<ReadableStream<AxChatResponse>>>) {
    const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> = []
    this.values = {}
    const xstate: extractionState = {
      extractedFields: [],
      streamedIndex: {},
      s: -1,
    }

    let content = ''

    mem.addResult(
      {
        content: '',
        functionCalls: [],
      },
      sessionId
    )

    for await (const v of res) {
      const result = v.results[0]
      if (!result) {
        continue
      }

      if (v.modelUsage) {
        this.usage.push(v.modelUsage)
      }

      if (result.functionCalls && result.functionCalls.length > 0) {
        mergeFunctionCalls(functionCalls, result.functionCalls)
        mem.updateResult(
          {
            name: result.name,
            content,
            functionCalls,
            delta: result.functionCalls?.[0]?.function?.params as string,
          },
          sessionId
        )
      } else if (result.content && result.content.length > 0) {
        if (result.thought && result.thought.length > 0) {
          yield {
            [this.thoughtFieldName]: result.thought,
          } as AxGenDeltaOut<OUT>['delta']
        }

        content += result.content
        mem.updateResult(
          { name: result.name, content, delta: result.content },
          sessionId
        )

        const skip = streamingExtractValues(
          this.signature,
          this.values,
          xstate,
          content,
          strictMode
        )

        if (skip) {
          continue
        }

        if (this.streamingAsserts.length !== 0) {
          await assertStreamingAssertions(
            this.streamingAsserts,
            xstate,
            content
          )
        }

        if (this.streamingFieldProcessors.length !== 0) {
          await processStreamingFieldProcessors(
            this.streamingFieldProcessors,
            content,
            xstate,
            mem,
            this.values,
            sessionId
          )
        }

        yield* streamValues<OUT>(
          this.signature,
          content,
          this.values as Record<string, OUT>,
          xstate
        )

        await assertAssertions(this.asserts, this.values)
      } else if (result.thought && result.thought.length > 0) {
        this.values[this.thoughtFieldName] =
          (this.values[this.thoughtFieldName] ?? '') + result.thought
        yield {
          [this.thoughtFieldName]: result.thought,
        } as AxGenDeltaOut<OUT>['delta']
      }

      if (result.finishReason === 'length') {
        throw new Error(
          `Max tokens reached before completion\nContent: ${content}`
        )
      }
    }

    const funcs = parseFunctionCalls(ai, functionCalls, this.values, model)
    if (funcs) {
      if (!functions) {
        throw new Error('Functions are not defined')
      }
      const fx = await processFunctions(
        ai,
        functions,
        funcs,
        mem,
        sessionId,
        traceId,
        span,
        this.excludeContentFromTrace
      )
      this.functionsExecuted = new Set([...this.functionsExecuted, ...fx])
    } else {
      streamingExtractFinalValue(this.signature, this.values, xstate, content)

      await assertStreamingAssertions(
        this.streamingAsserts,
        xstate,
        content,
        true
      )
      await assertAssertions(this.asserts, this.values)

      if (this.fieldProcessors.length) {
        await processFieldProcessors(
          this.fieldProcessors,
          this.values,
          mem,
          sessionId
        )
      }

      if (this.streamingFieldProcessors.length !== 0) {
        await processStreamingFieldProcessors(
          this.streamingFieldProcessors,
          content,
          xstate,
          mem,
          this.values,
          sessionId,
          true
        )
      }

      yield* streamValues<OUT>(
        this.signature,
        content,
        this.values as Record<string, OUT>,
        xstate
      )
    }
  }

  private async processResponse({
    ai,
    res,
    mem,
    sessionId,
    traceId,
    functions,
    span,
    strictMode,
  }: Readonly<AxResponseHandlerArgs<AxChatResponse>>): Promise<OUT> {
    this.values = {}

    let results = res.results ?? []

    if (results.length > 1) {
      results = results.filter((r) => r.functionCalls)
    }

    for (const result of results) {
      if (res.modelUsage) {
        this.usage.push(res.modelUsage)
      }

      mem.addResult(result, sessionId)

      if (result.functionCalls?.length) {
        const funcs = parseFunctionCalls(ai, result.functionCalls, this.values)
        if (funcs) {
          if (!functions) {
            throw new Error('Functions are not defined')
          }
          const fx = await processFunctions(
            ai,
            functions,
            funcs,
            mem,
            sessionId,
            traceId,
            span,
            this.excludeContentFromTrace
          )
          this.functionsExecuted = new Set([...this.functionsExecuted, ...fx])
        }
      } else if (result.content) {
        if (result.thought && result.thought.length > 0) {
          this.values[this.thoughtFieldName] = result.thought
        }

        extractValues(this.signature, this.values, result.content, strictMode)
        await assertAssertions(this.asserts, this.values)

        if (this.fieldProcessors.length) {
          await processFieldProcessors(
            this.fieldProcessors,
            this.values,
            mem,
            sessionId
          )
        }
      }

      if (result.finishReason === 'length') {
        throw new Error(
          `Max tokens reached before completion\nContent: ${result.content}`
        )
      }
    }

    // Strip out values whose signature fields have isInternal: true
    for (const field of this.signature.getOutputFields()) {
      if (field.isInternal) {
        delete this.values[field.name]
      }
    }

    return { ...this.values } as unknown as OUT
  }

  private async *_forward2(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions>,
    span?: Span,
    traceContext?: Context
  ) {
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

    const mem =
      options.mem ?? this.options?.mem ?? new AxMemory(10000, memOptions)

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

    mem.add(prompt, options?.sessionId)

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
          for await (const delta of generator) {
            if (delta !== undefined) {
              yield { version: errCount, delta }
            }
          }

          const lastMemItem = mem.getLast(options?.sessionId)
          const shouldContinue = this.shouldContinueSteps(
            lastMemItem,
            stopFunction
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

  private shouldContinueSteps(
    lastMemItem: ReturnType<AxAIMemory['getLast']>,
    stopFunction: string | undefined
  ) {
    const stopFunctionExecuted =
      stopFunction && this.functionsExecuted.has(stopFunction)

    const isFunction = lastMemItem?.chat?.role === 'function'
    const isProcessor = lastMemItem?.tags
      ? lastMemItem.tags.some((tag) => tag === 'processor')
      : false

    if (isFunction && stopFunction && stopFunctionExecuted) {
      return false
    }

    if (isFunction || isProcessor) {
      return true
    }

    return false
  }

  public async *_forward1(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options: Readonly<AxProgramForwardOptions>
  ) {
    const tracer =
      options?.tracer ?? this.options?.tracer ?? ai.getOptions().tracer

    let functions: AxFunction[] | undefined = this.functions

    if (options?.functions) {
      functions = parseFunctions(options.functions, this.functions)
    }

    if (!tracer) {
      yield* this._forward2(ai, values, {
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
        {
          ...options,
          functions,
        },
        span,
        traceContext
      )

      if (!this.excludeContentFromTrace) {
        span.addEvent('output', {
          content: JSON.stringify(this.values, null, 2),
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

    let buffer = {} as AxGenDeltaOut<OUT>['delta']
    let currentVersion = 0

    for await (const item of generator) {
      if (item.version !== currentVersion) {
        buffer = {}
      }
      currentVersion = item.version
      buffer = mergeDeltas(buffer, item.delta)
    }

    this.trace = { ...values, ...buffer } as unknown as OUT
    return buffer as OUT
  }

  override async *streamingForward(
    ai: Readonly<AxAIService>,
    values: IN | AxMessage<IN>[],
    options?: Readonly<AxProgramStreamingForwardOptions>
  ) {
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

export class AxGenerateError extends Error {
  public readonly details: AxGenerateErrorDetails

  constructor(
    message: string,
    details: Readonly<AxGenerateErrorDetails>,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AxGenerateError'
    this.details = details
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
