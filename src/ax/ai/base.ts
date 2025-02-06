import type { ReadableStream } from 'stream/web'

import { type Span, SpanKind } from '@opentelemetry/api'

import { getModelInfo } from '../dsp/modelinfo.js'
import { axSpanAttributes } from '../trace/trace.js'
import { apiCall } from '../util/apicall.js'
import { ColorLog } from '../util/log.js'
import { RespTransformStream } from '../util/transform.js'

import type {
  AxAIModelList,
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceImpl,
  AxAIServiceMetrics,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo,
  AxModelInfoWithProvider,
  AxTokenUsage,
} from './types.js'

const colorLog = new ColorLog()

export interface AxAIFeatures {
  functions: boolean
  streaming: boolean
  functionCot?: boolean
}

export interface AxBaseAIArgs {
  name: string
  apiURL: string
  headers: () => Promise<Record<string, string>>
  modelInfo: Readonly<AxModelInfo[]>
  defaults: Readonly<{ model: string; embedModel?: string }>
  options?: Readonly<AxAIServiceOptions>
  supportFor: AxAIFeatures | ((model: string) => AxAIFeatures)
  models?: AxAIModelList
}

export const axBaseAIDefaultConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 2000,
    temperature: 0,
    topK: 40,
    frequencyPenalty: 0.2,
  })

export const axBaseAIDefaultCreativeConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 500,
    temperature: 0.4,
    topP: 0.7,
    frequencyPenalty: 0.2,
    presencePenalty: 0.2,
  })

export class AxBaseAI<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
> implements AxAIService
{
  private debug = false

  private rt?: AxAIServiceOptions['rateLimiter']
  private fetch?: AxAIServiceOptions['fetch']
  private tracer?: AxAIServiceOptions['tracer']
  private models?: AxAIModelList

  private modelInfo: readonly AxModelInfo[]
  private modelUsage?: AxTokenUsage
  private embedModelUsage?: AxTokenUsage
  private defaults: AxBaseAIArgs['defaults']

  protected apiURL: string
  protected name: string
  protected headers: () => Promise<Record<string, string>>
  protected supportFor: AxAIFeatures | ((model: string) => AxAIFeatures)

  // Add private metrics tracking properties
  private metrics: AxAIServiceMetrics = {
    latency: {
      chat: {
        mean: 0,
        p95: 0,
        p99: 0,
        samples: [],
      },
      embed: {
        mean: 0,
        p95: 0,
        p99: 0,
        samples: [],
      },
    },
    errors: {
      chat: {
        count: 0,
        rate: 0,
        total: 0,
      },
      embed: {
        count: 0,
        rate: 0,
        total: 0,
      },
    },
  }

  constructor(
    private readonly aiImpl: Readonly<
      AxAIServiceImpl<
        TChatRequest,
        TEmbedRequest,
        TChatResponse,
        TChatResponseDelta,
        TEmbedResponse
      >
    >,
    {
      name,
      apiURL,
      headers,
      modelInfo,
      defaults,
      options = {},
      supportFor,
      models,
    }: Readonly<AxBaseAIArgs>
  ) {
    this.name = name
    this.apiURL = apiURL
    this.headers = headers
    this.supportFor = supportFor
    this.tracer = options.tracer
    this.modelInfo = modelInfo
    this.models = models

    const model =
      this.models?.find((v) => v.key === defaults.model)?.model ??
      defaults.model

    const embedModel =
      this.models?.find((v) => v.key === defaults.embedModel)?.model ??
      defaults.embedModel

    this.defaults = { model, embedModel }

    if (
      !defaults.model ||
      typeof defaults.model !== 'string' ||
      defaults.model === ''
    ) {
      throw new Error('No model defined')
    }

    this.setOptions(options)
  }

  public setName(name: string): void {
    this.name = name
  }

  public setAPIURL(apiURL: string): void {
    this.apiURL = apiURL
  }

  public setHeaders(headers: () => Promise<Record<string, string>>): void {
    this.headers = headers
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    if (options.debug) {
      this.debug = options.debug
    }

    if (options.rateLimiter) {
      this.rt = options.rateLimiter
    }

    if (options.fetch) {
      this.fetch = options.fetch
    }

    if (options.tracer) {
      this.tracer = options.tracer
    }
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return {
      debug: this.debug,
      rateLimiter: this.rt,
      fetch: this.fetch,
      tracer: this.tracer,
    }
  }

  getModelInfo(): Readonly<AxModelInfoWithProvider> {
    const mi = getModelInfo({
      model: this.defaults.model,
      modelInfo: this.modelInfo,
      models: this.models,
    })
    return {
      ...mi,
      provider: this.name,
    }
  }

  getEmbedModelInfo(): AxModelInfoWithProvider | undefined {
    if (!this.defaults.embedModel) {
      return
    }

    const mi = getModelInfo({
      model: this.defaults.embedModel,
      modelInfo: this.modelInfo,
      models: this.models,
    })
    return {
      ...mi,
      provider: this.name,
    }
  }

  getModelList(): AxAIModelList | undefined {
    return this.models
  }

  getName(): string {
    return this.name
  }

  getFeatures(model?: string): AxAIFeatures {
    return typeof this.supportFor === 'function'
      ? this.supportFor(model ?? this.defaults.model)
      : this.supportFor
  }

  // Method to calculate percentiles
  private calculatePercentile(
    samples: readonly number[],
    percentile: number
  ): number {
    if (samples.length === 0) return 0
    const sorted = [...samples].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[index] ?? 0
  }

  // Method to update latency metrics
  private updateLatencyMetrics(type: 'chat' | 'embed', duration: number): void {
    const metrics = this.metrics.latency[type]
    metrics.samples.push(duration)

    // Keep only last 1000 samples to prevent memory issues
    if (metrics.samples.length > 1000) {
      metrics.samples.shift()
    }

    // Update statistics
    metrics.mean =
      metrics.samples.reduce((a, b) => a + b, 0) / metrics.samples.length
    metrics.p95 = this.calculatePercentile(metrics.samples, 95)
    metrics.p99 = this.calculatePercentile(metrics.samples, 99)
  }

  // Method to update error metrics
  private updateErrorMetrics(type: 'chat' | 'embed', isError: boolean): void {
    const metrics = this.metrics.errors[type]
    metrics.total++
    if (isError) {
      metrics.count++
    }
    metrics.rate = metrics.count / metrics.total
  }

  // Public method to get metrics
  public getMetrics(): AxAIServiceMetrics {
    return structuredClone(this.metrics)
  }

  async chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const startTime = performance.now()
    let isError = false

    try {
      return this._chat1(req, options)
    } catch (error) {
      isError = true
      throw error
    } finally {
      const duration = performance.now() - startTime
      this.updateLatencyMetrics('chat', duration)
      this.updateErrorMetrics('chat', isError)
    }
  }

  private async _chat1(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const model = req.model
      ? (this.models?.find((v) => v.key === req.model)?.model ?? req.model)
      : this.defaults.model

    const modelConfig = {
      ...this.aiImpl.getModelConfig(),
      ...req.modelConfig,
    }

    // stream is true by default unless explicitly set to false
    modelConfig.stream =
      (options?.stream !== undefined ? options.stream : modelConfig.stream) ??
      true

    const canStream = this.getFeatures(model).streaming
    if (!canStream) {
      modelConfig.stream = false
    }

    if (this.tracer) {
      return await this.tracer?.startActiveSpan(
        'Chat Request',
        {
          kind: SpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_REQUEST_MODEL]: model,
            [axSpanAttributes.LLM_REQUEST_MAX_TOKENS]: modelConfig.maxTokens,
            [axSpanAttributes.LLM_REQUEST_TEMPERATURE]: modelConfig.temperature,
            [axSpanAttributes.LLM_REQUEST_TOP_P]: modelConfig.topP,
            [axSpanAttributes.LLM_REQUEST_TOP_K]: modelConfig.topK,
            [axSpanAttributes.LLM_REQUEST_FREQUENCY_PENALTY]:
              modelConfig.frequencyPenalty,
            [axSpanAttributes.LLM_REQUEST_PRESENCE_PENALTY]:
              modelConfig.presencePenalty,
            [axSpanAttributes.LLM_REQUEST_STOP_SEQUENCES]:
              modelConfig.stopSequences?.join(', '),
            [axSpanAttributes.LLM_REQUEST_LLM_IS_STREAMING]: modelConfig.stream,
            // [AxSpanAttributes.LLM_PROMPTS]: _req.chatPrompt
            //   ?.map((v) => v.content)
            //   .join('\n')
          },
        },
        async (span) => {
          try {
            return await this._chat2(model, modelConfig, req, options, span)
          } finally {
            span.end()
          }
        }
      )
    }
    return await this._chat2(model, modelConfig, req, options)
  }

  private async _chat2(
    model: string,
    modelConfig: Readonly<AxModelConfig>,
    chatReq: Readonly<Omit<AxChatRequest, 'modelConfig'>>,
    options?: Readonly<AxAIServiceActionOptions>,
    span?: Span
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (!this.aiImpl.createChatReq) {
      throw new Error('generateChatReq not implemented')
    }

    let functions
    if (chatReq.functions && chatReq.functions.length > 0) {
      functions = chatReq.functions
    }

    const req = {
      ...chatReq,
      model,
      functions,
      modelConfig,
    }

    const fn = async () => {
      const [apiConfig, reqValue] = this.aiImpl.createChatReq(
        req,
        options as AxAIPromptConfig
      )

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: await this.buildHeaders(apiConfig.headers),
          stream: modelConfig.stream,
          debug: this.debug,
          fetch: this.fetch,
          span,
        },
        reqValue
      )
      return res
    }

    if (this.debug) {
      logChatRequest(req)
    }

    const rt = options?.rateLimiter ?? this.rt
    const rv = rt ? await rt(fn, { modelUsage: this.modelUsage }) : await fn()

    if (modelConfig.stream) {
      if (!this.aiImpl.createChatStreamResp) {
        throw new Error('generateChatResp not implemented')
      }

      const respFn = this.aiImpl.createChatStreamResp
      const wrappedRespFn =
        (state: object) => (resp: Readonly<TChatResponseDelta>) => {
          const res = respFn(resp, state)
          res.sessionId = options?.sessionId

          if (res.modelUsage) {
            this.modelUsage = res.modelUsage
          }

          if (span?.isRecording()) {
            setResponseAttr(res, span)
          }

          if (this.debug) {
            logResponse(res)
          }
          return res
        }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const doneCb = async (_values: readonly AxChatResponse[]) => {
        if (this.debug) {
          process.stdout.write('\n')
        }
      }

      const st = (rv as ReadableStream<TChatResponseDelta>).pipeThrough(
        new RespTransformStream<TChatResponseDelta, AxChatResponse>(
          wrappedRespFn({}),
          doneCb
        )
      )
      return st
    }

    if (!this.aiImpl.createChatResp) {
      throw new Error('generateChatResp not implemented')
    }
    const res = this.aiImpl.createChatResp(rv as TChatResponse)
    res.sessionId = options?.sessionId

    if (res.modelUsage) {
      this.modelUsage = res.modelUsage
    }

    if (span?.isRecording()) {
      setResponseAttr(res, span)
    }

    if (this.debug) {
      logResponse(res)
    }

    span?.end()
    return res
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    const startTime = performance.now()
    let isError = false

    try {
      return this._embed1(req, options)
    } catch (error) {
      isError = true
      throw error
    } finally {
      const duration = performance.now() - startTime
      this.updateLatencyMetrics('embed', duration)
      this.updateErrorMetrics('embed', isError)
    }
  }

  private async _embed1(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    const embedModel = req.embedModel
      ? (this.models?.find((v) => v.key === req.embedModel)?.model ??
        req.embedModel)
      : this.defaults.embedModel

    if (!embedModel) {
      throw new Error('No embed model defined')
    }

    if (this.tracer) {
      await this.tracer?.startActiveSpan(
        'Embed Request',
        {
          kind: SpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_REQUEST_MODEL]:
              req.embedModel ?? this.defaults.embedModel,
          },
        },
        async (span) => {
          try {
            return await this._embed2(embedModel, req, options, span)
          } finally {
            span.end()
          }
        }
      )
    }
    return this._embed2(embedModel, req, options)
  }

  private async _embed2(
    embedModel: string,
    embedReq: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions>,
    span?: Span
  ): Promise<AxEmbedResponse> {
    if (!this.aiImpl.createEmbedReq) {
      throw new Error('generateEmbedReq not implemented')
    }
    if (!this.aiImpl.createEmbedResp) {
      throw new Error('generateEmbedResp not implemented')
    }

    const req = {
      ...embedReq,
      embedModel,
    }

    const fn = async () => {
      const [apiConfig, reqValue] = this.aiImpl.createEmbedReq!(req)

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: await this.buildHeaders(apiConfig.headers),
          debug: this.debug,
          fetch: this.fetch,
          span,
        },
        reqValue
      )

      return res
    }

    const resValue = this.rt
      ? await this.rt(fn, { embedModelUsage: this.embedModelUsage })
      : await fn()
    const res = this.aiImpl.createEmbedResp!(resValue as TEmbedResponse)

    res.sessionId = options?.sessionId

    if (span?.isRecording()) {
      if (res.modelUsage) {
        this.embedModelUsage = res.modelUsage
        span.setAttributes({
          [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
            res.modelUsage.completionTokens ?? 0,
          [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]:
            res.modelUsage.promptTokens,
        })
      }
    }

    span?.end()
    return res
  }

  private async buildHeaders(
    headers: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    return { ...headers, ...(await this.headers()) }
  }
}

const logChatRequest = (req: Readonly<AxChatRequest>) => {
  const items = req.chatPrompt?.map((msg) => {
    switch (msg.role) {
      case 'system':
        return `${colorLog.blueBright('System:')}\n${colorLog.whiteBright(msg.content)}`
      case 'function':
        return `${colorLog.blueBright('Function Result:')}\n${colorLog.whiteBright(msg.result)}`
      case 'user': {
        if (typeof msg.content === 'string') {
          return `${colorLog.blueBright('User:')}\n${colorLog.whiteBright(msg.content)}`
        }
        const items = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return `${colorLog.whiteBright(v.text)}`
            case 'image':
              return `(Image, ${v.mimeType}) ${colorLog.whiteBright(v.image.substring(0, 10))}`
            default:
              throw new Error('Invalid content type')
          }
        })
        return `${colorLog.blueBright('User:')}\n${items.join('\n')}`
      }
      case 'assistant': {
        if (msg.functionCalls) {
          const fns = msg.functionCalls?.map(({ function: fn }) => {
            const args =
              typeof fn.params !== 'string'
                ? JSON.stringify(fn.params, null, 2)
                : fn.params
            return `${fn.name}(${args})`
          })
          return `${colorLog.blueBright('\nFunctions:')}\n${colorLog.whiteBright(fns.join('\n'))}`
        }
        return `${colorLog.blueBright('\nAssistant:')}\n${colorLog.whiteBright(msg.content ?? '<empty>')}`
      }
      default:
        throw new Error('Invalid role')
    }
  })

  if (items) {
    process.stdout.write('\n===\n' + items.join('\n') + '\n\n---\n')
  }
}

const logResponse = (resp: Readonly<AxChatResponse>) => {
  if (!resp.results) {
    return
  }
  for (const r of resp.results) {
    if (r.content) {
      process.stdout.write(colorLog.greenBright(r.content))
    }
    if (r.functionCalls) {
      for (const [i, f] of r.functionCalls.entries()) {
        if (f.function.name) {
          if (i > 0) {
            process.stdout.write('\n\n')
          }
          process.stdout.write(
            `Function ${i + 1} -> ${colorLog.greenBright(f.function.name)} `
          )
        }
        if (f.function.params) {
          const params =
            typeof f.function.params === 'string'
              ? f.function.params
              : JSON.stringify(f.function.params, null, 2)
          process.stdout.write(`${colorLog.greenBright(params)}`)
        }
      }
    }
  }
}

const setResponseAttr = (res: Readonly<AxChatResponse>, span: Span) => {
  if (res.modelUsage) {
    span.setAttributes({
      [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
        res.modelUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: res.modelUsage.promptTokens,
    })
  }
}
