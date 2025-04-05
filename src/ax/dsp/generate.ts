import { ReadableStream } from 'node:stream/web'

import { type Span, SpanKind, type Tracer } from '@opentelemetry/api'

import type {
  AxAIService,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxFunction,
  AxRateLimiterFunction,
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
  type AxInputFunctionType,
  parseFunctionCalls,
  parseFunctions,
  processFunctions,
} from './functions.js'
import {
  type AxGenIn,
  type AxGenOut,
  type AxProgramForwardOptions,
  type AxProgramStreamingForwardOptions,
  AxProgramWithSignature,
} from './program.js'
import { AxPromptTemplate } from './prompt.js'
import type { AxIField, AxSignature } from './sig.js'
import { mergeDeltas } from './util.js'
import { handleValidationError, ValidationError } from './validate.js'

export interface AxGenOptions {
  maxRetries?: number
  maxSteps?: number
  mem?: AxAIMemory
  tracer?: Tracer
  rateLimiter?: AxRateLimiterFunction
  stream?: boolean
  description?: string

  functions?: AxInputFunctionType
  functionCall?: AxChatRequest['functionCall']
  stopFunction?: string
  promptTemplate?: typeof AxPromptTemplate
  asserts?: AxAssertion[]
  streamingAsserts?: AxStreamingAssertion[]
  fastFail?: boolean
}

export type AxGenerateResult<OUT extends AxGenOut> = OUT & {
  functions?: AxChatResponseFunctionCall[]
}

export interface AxResponseHandlerArgs<T> {
  ai: Readonly<AxAIService>
  model?: string
  res: T
  usageInfo: { ai: string; model: string }
  mem: AxAIMemory
  sessionId?: string
  traceId?: string
  functions?: Readonly<AxFunction[]>
  fastFail?: boolean
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
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenerateResult<AxGenOut> = AxGenerateResult<AxGenOut>,
> extends AxProgramWithSignature<IN, OUT> {
  private promptTemplate: AxPromptTemplate
  private asserts: AxAssertion[]
  private streamingAsserts: AxStreamingAssertion[]
  private options?: Omit<AxGenOptions, 'functions'>
  private functions?: AxFunction[]
  private functionsExecuted: Set<string> = new Set<string>()
  private fieldProcessors: AxFieldProcessor[] = []
  private streamingFieldProcessors: AxFieldProcessor[] = []

  constructor(
    signature: Readonly<AxSignature | string>,
    options?: Readonly<AxGenOptions>
  ) {
    super(signature, { description: options?.description })

    this.options = options
    this.promptTemplate = new (options?.promptTemplate ?? AxPromptTemplate)(
      this.signature,
      options?.functions
    )
    this.asserts = this.options?.asserts ?? []
    this.streamingAsserts = this.options?.streamingAsserts ?? []
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
  }: Readonly<{
    ai: Readonly<AxAIService>
    mem: AxAIMemory
    options?: Omit<AxProgramForwardOptions, 'ai' | 'mem'>
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
    } = options ?? {}

    const chatPrompt = mem?.history(sessionId) ?? []

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found')
    }

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const functions = _functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat()

    const functionCall = _functionCall ?? this.options?.functionCall

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
        debug: false,
      }
    )

    return res
  }

  private async *forwardCore({
    ai,
    mem,
    options,
  }: Readonly<{
    ai: Readonly<AxAIService>
    mem: AxAIMemory
    options: Omit<AxProgramForwardOptions, 'ai' | 'mem'>
  }>) {
    const { sessionId, traceId, model, functions: _functions } = options ?? {}
    const fastFail = options?.fastFail ?? this.options?.fastFail

    const modelName = model ?? ai.getDefaultModels().model
    const usageInfo = {
      ai: ai.getName(),
      model: modelName,
    }

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const functions = _functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat()

    const res = await this.forwardSendRequest({
      ai,
      mem,
      options,
    })

    if (res instanceof ReadableStream) {
      yield* this.processStreamingResponse({
        ai,
        model,
        res,
        usageInfo,
        mem,
        traceId,
        sessionId,
        functions,
        fastFail,
      })
    } else {
      yield await this.processResponse({
        ai,
        model,
        res,
        usageInfo,
        mem,
        traceId,
        sessionId,
        functions,
      })
    }
  }

  private async *processStreamingResponse({
    ai,
    model,
    res,
    usageInfo,
    mem,
    sessionId,
    traceId,
    functions,
    fastFail,
  }: Readonly<AxResponseHandlerArgs<ReadableStream<AxChatResponse>>>) {
    const streamingValidation =
      fastFail ?? ai.getFeatures().functionCot !== true
    const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> = []
    const values = {}
    const xstate: extractionState = {
      extractedFields: [],
      streamedIndex: {},
      s: -1,
    }

    let content = ''

    for await (const v of res) {
      const result = v.results[0]
      if (!result) {
        continue
      }

      if (v.modelUsage) {
        this.usage.push({ ...usageInfo, ...v.modelUsage })
      }

      if (result.functionCalls) {
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
      } else if (result.content) {
        content += result.content
        mem.updateResult(
          { name: result.name, content, delta: result.content },
          sessionId
        )

        const skip = streamingExtractValues(
          this.signature,
          values,
          xstate,
          content,
          streamingValidation
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
            values,
            sessionId
          )
        }

        yield* streamValues<OUT>(this.signature, content, values, xstate)

        await assertAssertions(this.asserts, values)
      }

      if (result.finishReason === 'length') {
        throw new Error('Max tokens reached before completion')
      }
    }

    const funcs = parseFunctionCalls(ai, functionCalls, values, model)
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
        traceId
      )
      this.functionsExecuted = new Set([...this.functionsExecuted, ...fx])
    } else {
      streamingExtractFinalValue(this.signature, values, xstate, content)

      await assertStreamingAssertions(
        this.streamingAsserts,
        xstate,
        content,
        true
      )
      await assertAssertions(this.asserts, values)

      if (this.fieldProcessors.length) {
        await processFieldProcessors(
          this.fieldProcessors,
          values,
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
          values,
          sessionId,
          true
        )
      }

      yield* streamValues<OUT>(this.signature, content, values, xstate)
    }
  }

  private async processResponse({
    ai,
    res,
    usageInfo,
    mem,
    sessionId,
    traceId,
    functions,
  }: Readonly<AxResponseHandlerArgs<AxChatResponse>>): Promise<OUT> {
    const values = {}

    let results = res.results ?? []

    if (results.length > 1) {
      results = results.filter((r) => r.functionCalls)
    }

    for (const result of results) {
      if (res.modelUsage) {
        this.usage.push({ ...usageInfo, ...res.modelUsage })
      }

      mem.addResult(result, sessionId)

      if (result.functionCalls?.length) {
        const funcs = parseFunctionCalls(ai, result.functionCalls, values)
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
            traceId
          )
          this.functionsExecuted = new Set([...this.functionsExecuted, ...fx])
        }
      } else if (result.content) {
        extractValues(this.signature, values, result.content)
        await assertAssertions(this.asserts, values)

        if (this.fieldProcessors.length) {
          await processFieldProcessors(
            this.fieldProcessors,
            values,
            mem,
            sessionId
          )
        }
      }

      if (result.finishReason === 'length') {
        throw new Error('Max tokens reached before completion')
      }
    }

    // Strip out values whose signature fields have isInternal: true
    const publicValues: AxGenOut = { ...values }
    for (const field of this.signature.getOutputFields()) {
      if (field.isInternal) {
        delete publicValues[field.name]
      }
    }

    return { ...values } as unknown as OUT
  }

  private async *_forward2(
    ai: Readonly<AxAIService>,
    values: IN,
    options: Readonly<AxProgramForwardOptions>,
    span?: Span
  ) {
    const stopFunction = (
      options?.stopFunction ?? this.options?.stopFunction
    )?.toLowerCase()

    const maxRetries = options.maxRetries ?? this.options?.maxRetries ?? 10
    const maxSteps = options.maxSteps ?? this.options?.maxSteps ?? 10
    const debug = options.debug ?? ai.getOptions().debug
    const memOptions = {
      debug: options.debug,
      debugHideSystemPrompt: options.debugHideSystemPrompt,
    }
    const mem =
      options.mem ?? this.options?.mem ?? new AxMemory(10000, memOptions)

    let err: ValidationError | AxAssertionError | undefined

    if (options?.functions && options.functions.length > 0) {
      const promptTemplate = this.options?.promptTemplate ?? AxPromptTemplate
      this.promptTemplate = new promptTemplate(
        this.signature,
        options.functions
      )
    }

    const prompt = this.promptTemplate.render<IN>(values, {
      examples: this.examples,
      demos: this.demos,
    })

    mem.add(prompt, options?.sessionId)

    multiStepLoop: for (let n = 0; n < maxSteps; n++) {
      for (let errCount = 0; errCount < maxRetries; errCount++) {
        try {
          const generator = this.forwardCore({ options, ai, mem })
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

          if (debug) {
            process.stdout.write('\n')
          }

          return
        } catch (e) {
          let errorFields: AxIField[] | undefined

          span?.recordException(e as Error)

          if (e instanceof ValidationError) {
            errorFields = e.getFixingInstructions()
            err = e
          } else if (e instanceof AxAssertionError) {
            const e1 = e as AxAssertionError
            errorFields = e1.getFixingInstructions()
            err = e
          } else if (e instanceof AxAIServiceStreamTerminatedError) {
            // Do nothing allow error correction to happen
          } else {
            throw e
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

      throw new Error(`Unable to fix validation error: ${err?.toString()}`)
    }

    throw new Error(`Max steps reached: ${maxSteps}`)
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
    values: IN,
    options: Readonly<AxProgramForwardOptions>
  ) {
    const tracer = this.options?.tracer ?? options?.tracer

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
      'generate.signature': this.signature.toString(),
      'generate.functions': funcNames ?? '',
    }

    const span = tracer.startSpan('Generate', {
      kind: SpanKind.SERVER,
      attributes,
    })

    try {
      yield* this._forward2(
        ai,
        values,
        {
          ...options,
          functions,
        },
        span
      )
    } finally {
      span.end()
    }
  }

  public override async forward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramForwardOptions>
  ): Promise<OUT> {
    const generator = this._forward1(ai, values, {
      ...options,
    })

    let buffer = {} as Partial<OUT>
    let currentVersion = 0

    for await (const item of generator) {
      if (item.version !== currentVersion) {
        buffer = {}
      }
      currentVersion = item.version
      buffer = mergeDeltas(buffer, item.delta)
    }

    this.trace = { ...values, ...buffer }
    return buffer as OUT
  }

  override async *streamingForward(
    ai: Readonly<AxAIService>,
    values: IN,
    options?: Readonly<AxProgramStreamingForwardOptions>
  ) {
    yield* this._forward1(ai, values, {
      ...options,
      stream: true,
    })
  }
}
