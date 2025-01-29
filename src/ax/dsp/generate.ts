import { ReadableStream } from 'stream/web'

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
import { AxSignature } from './sig.js'
import { mergeDeltas } from './util.js'
import { handleValidationError, ValidationError } from './validate.js'

export interface AxGenOptions {
  maxCompletions?: number
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

  public addAssert = (
    fn: AxAssertion['fn'],
    message?: string,
    optional?: boolean
  ) => {
    this.asserts.push({ fn, message, optional })
  }

  public addStreamingAssert = (
    fieldName: string,
    fn: AxStreamingAssertion['fn'],
    message?: string,
    optional?: boolean
  ) => {
    this.streamingAsserts.push({ fieldName, fn, message, optional })
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
      functions,
      functionCall: _functionCall,
    } = options ?? {}

    const chatPrompt = mem?.history(sessionId) ?? []

    if (chatPrompt.length === 0) {
      throw new Error('No chat prompt found')
    }

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
    const { sessionId, traceId, model, functions } = options ?? {}

    const usageInfo = {
      ai: ai.getName(),
      model: ai.getModelInfo().name,
    }

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
  }: Readonly<AxResponseHandlerArgs<ReadableStream<AxChatResponse>>>) {
    const functionCalls: NonNullable<AxChatResponseResult['functionCalls']> = []
    const values = {}
    const xstate: extractionState = {
      extractedFields: [],
      s: -1,
    }

    let content = ''

    for await (const v of res) {
      const result = v.results[0]
      if (!result) {
        continue
      }

      //for (const result of v.results ?? []) {
      if (v.modelUsage) {
        this.usage.push({ ...usageInfo, ...v.modelUsage })
      }

      if (result.content) {
        content += result.content
        mem.updateResult({ name: result.name, content }, sessionId)

        const skip = streamingExtractValues(
          this.signature,
          values,
          xstate,
          content
        )
        if (skip) {
          continue
        }

        assertStreamingAssertions(
          this.streamingAsserts,
          values,
          xstate,
          content,
          false
        )
        assertAssertions(this.asserts, values)
        yield* streamValues<OUT>(this.signature, values, xstate, content)
      }

      if (result.functionCalls) {
        mergeFunctionCalls(functionCalls, result.functionCalls)
        mem.updateResult(
          { name: result.name, content, functionCalls },
          sessionId
        )
      }

      if (result.finishReason === 'length') {
        throw new Error('Max tokens reached before completion')
      }
      //  }
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
    }

    streamingExtractFinalValue(this.signature, values, xstate, content)

    assertStreamingAssertions(
      this.streamingAsserts,
      values,
      xstate,
      content,
      true
    )
    assertAssertions(this.asserts, values)
    yield* streamValues<OUT>(this.signature, values, xstate, content, true)
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

    const result = res.results[0]
    if (!result) {
      throw new Error('No result found')
    }

    // for (const result of res.results ?? []) {
    if (res.modelUsage) {
      this.usage.push({ ...usageInfo, ...res.modelUsage })
    }

    mem.addResult(result, sessionId)

    if (result.content) {
      extractValues(this.signature, values, result.content)
      assertAssertions(this.asserts, values)
    }

    if (result.functionCalls) {
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
    }

    if (result.finishReason === 'length') {
      throw new Error('Max tokens reached before completion')
    }
    // }

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
    const mem = options.mem ?? this.options?.mem ?? new AxMemory()

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

          return
        } catch (e) {
          let errorFields
          span?.recordException(e as Error)

          if (e instanceof ValidationError) {
            errorFields = e.getFixingInstructions()
            err = e
          } else if (e instanceof AxAssertionError) {
            const e1 = e as AxAssertionError
            errorFields = e1.getFixingInstructions()
            err = e
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

      if (err instanceof AxAssertionError && err.getOptional()) {
        return err.getValue() as OUT
      }

      throw new Error(`Unable to fix validation error: ${err?.message}`)
    }

    throw new Error(`Max steps reached: ${maxSteps}`)
  }

  private shouldContinueSteps(
    lastMemItem: AxChatRequest['chatPrompt'][0] | undefined,
    stopFunction: string | undefined
  ) {
    const stopFunctionExecuted =
      stopFunction && this.functionsExecuted.has(stopFunction)

    if (
      lastMemItem?.role === 'function' &&
      stopFunction &&
      stopFunctionExecuted
    ) {
      return false
    }

    if (lastMemItem?.role === 'function') {
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
      ['generate.signature']: this.signature.toString(),
      ['generate.functions']: funcNames ?? '',
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
      // Clear buffer if version changes
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
