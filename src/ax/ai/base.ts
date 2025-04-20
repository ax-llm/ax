import type { ReadableStream } from 'stream/web'

import { type Span, SpanKind } from '@opentelemetry/api'

import { axSpanAttributes } from '../trace/trace.js'
import { apiCall } from '../util/apicall.js'
import { RespTransformStream } from '../util/transform.js'

import { logChatRequest, logResponse } from './debug.js'
import type {
  AxAIInputModelList,
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
  AxModelUsage,
} from './types.js'

export interface AxAIFeatures {
  functions: boolean
  streaming: boolean
  functionCot?: boolean
}

export interface AxBaseAIArgs<TModel, TEmbedModel> {
  name: string
  apiURL: string
  headers: () => Promise<Record<string, string>>
  modelInfo: Readonly<AxModelInfo[]>
  defaults: Readonly<{ model: TModel; embedModel?: TEmbedModel }>
  options?: Readonly<AxAIServiceOptions>
  supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures)
  models?: AxAIInputModelList<TModel, TEmbedModel>
}

export const axBaseAIDefaultConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 2000,
    temperature: 0,
    topK: 40,
    topP: 0.9,
  })

export const axBaseAIDefaultCreativeConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 2000,
    temperature: 0.4,
    topP: 0.7,
    frequencyPenalty: 0.2,
  })

export class AxBaseAI<
  TModel,
  TEmbedModel,
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
> implements AxAIService<TModel, TEmbedModel>
{
  private debug = false

  private rt?: AxAIServiceOptions['rateLimiter']
  private fetch?: AxAIServiceOptions['fetch']
  private tracer?: AxAIServiceOptions['tracer']
  private models?: AxAIInputModelList<TModel, TEmbedModel>

  private modelInfo: readonly AxModelInfo[]
  private modelUsage?: AxModelUsage
  private embedModelUsage?: AxModelUsage
  private defaults: AxBaseAIArgs<TModel, TEmbedModel>['defaults']

  protected apiURL: string
  protected name: string
  protected id: string
  protected headers: () => Promise<Record<string, string>>
  protected supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures)

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
        TModel,
        TEmbedModel,
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
    }: Readonly<AxBaseAIArgs<TModel, TEmbedModel>>
  ) {
    this.name = name
    this.apiURL = apiURL
    this.headers = headers
    this.supportFor = supportFor
    this.tracer = options.tracer
    this.modelInfo = modelInfo
    this.models = models
    this.id = crypto.randomUUID()

    const model = this.getModel(defaults.model) ?? defaults.model
    const embedModel =
      this.getEmbedModel(defaults.embedModel) ?? defaults.embedModel

    this.defaults = { model, embedModel }

    if (
      !defaults.model ||
      typeof defaults.model !== 'string' ||
      defaults.model === ''
    ) {
      throw new Error('No model defined')
    }

    this.setOptions(options)

    if (models) {
      validateModels(models)
    }
  }

  public setName(name: string): void {
    this.name = name
  }

  public getId(): string {
    return this.id
  }

  public setAPIURL(apiURL: string): void {
    this.apiURL = apiURL
  }

  public setHeaders(headers: () => Promise<Record<string, string>>): void {
    this.headers = headers
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    this.debug = options.debug ?? false
    this.rt = options.rateLimiter
    this.fetch = options.fetch
    this.tracer = options.tracer
  }

  getOptions(): Readonly<AxAIServiceOptions> {
    return {
      debug: this.debug,
      rateLimiter: this.rt,
      fetch: this.fetch,
      tracer: this.tracer,
    }
  }

  getModelList(): AxAIModelList | undefined {
    const models: AxAIModelList = []
    for (const model of this.models ?? []) {
      if (model.isInternal) {
        continue
      }

      if ('model' in model && model.model) {
        models.push({
          key: model.key,
          description: model.description,
          model: model.model as string,
        })
      }

      if ('embedModel' in model && model.embedModel) {
        models.push({
          key: model.key,
          description: model.description,
          embedModel: model.embedModel as string,
        })
      }
    }

    return models
  }

  getName(): string {
    return this.name
  }

  getFeatures(model?: TModel): AxAIFeatures {
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
    req: Readonly<AxChatRequest<TModel>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<TModel, TEmbedModel>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const startTime = performance.now()
    let isError = false

    try {
      const result = await this._chat1(req, options)
      return result
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
    req: Readonly<AxChatRequest<TModel>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<TModel, TEmbedModel>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    const model = this.getModel(req.model) ?? req.model ?? this.defaults.model

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
            [axSpanAttributes.LLM_REQUEST_MODEL]: model as string,
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

  private cleanupFunctionSchema(
    fn: Readonly<NonNullable<AxChatRequest['functions']>[number]>
  ): NonNullable<AxChatRequest['functions']>[number] {
    const cleanFn = { ...fn }
    if (cleanFn.parameters) {
      const cleanParams = { ...cleanFn.parameters }

      // Remove empty required array
      if (
        Array.isArray(cleanParams.required) &&
        cleanParams.required.length === 0
      ) {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete cleanParams.required
      }

      // Remove empty properties object
      if (
        cleanParams.properties &&
        Object.keys(cleanParams.properties).length === 0
      ) {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete cleanParams.properties
      }

      // After cleaning, remove the entire parameters object if it's effectively empty
      // i.e., either no keys left or just { type: 'object' } remaining.
      if (
        Object.keys(cleanParams).length === 0 ||
        (Object.keys(cleanParams).length === 1 && cleanParams.type === 'object')
      ) {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete cleanFn.parameters
      } else {
        cleanFn.parameters = cleanParams
      }
    }
    return cleanFn
  }

  private async _chat2(
    model: TModel,
    modelConfig: Readonly<AxModelConfig>,
    chatReq: Readonly<Omit<AxChatRequest<TModel>, 'modelConfig'>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>,
    span?: Span
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (!this.aiImpl.createChatReq) {
      throw new Error('generateChatReq not implemented')
    }

    const debug = options?.debug ?? this.debug

    let functions: NonNullable<AxChatRequest['functions']> | undefined

    if (chatReq.functions && chatReq.functions.length > 0) {
      functions = chatReq.functions.map((fn) => this.cleanupFunctionSchema(fn))
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
          debug,
          fetch: this.fetch,
          span,
        },
        reqValue
      )
      return res
    }

    if (debug) {
      logChatRequest(req.chatPrompt, options?.debugHideSystemPrompt)
    }

    const rt = options?.rateLimiter ?? this.rt
    const rv = rt ? await rt(fn, { modelUsage: this.modelUsage }) : await fn()

    if (modelConfig.stream) {
      if (!this.aiImpl.createChatStreamResp) {
        throw new Error('generateChatResp not implemented')
      }

      const respFn = this.aiImpl.createChatStreamResp.bind(this)
      const wrappedRespFn =
        (state: object) => (resp: Readonly<TChatResponseDelta>) => {
          const res = respFn(resp, state)
          res.sessionId = options?.sessionId

          if (!res.modelUsage) {
            res.modelUsage = {
              ai: this.name,
              model: model as string,
              tokens: this.aiImpl.getTokenUsage(),
            }
          }
          this.modelUsage = res.modelUsage

          if (span?.isRecording()) {
            setResponseAttr(res, span)
          }

          if (debug) {
            logResponse(res)
          }
          return res
        }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const doneCb = async (_values: readonly AxChatResponse[]) => {
        if (debug) {
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

    if (debug) {
      logResponse(res)
    }

    span?.end()
    return res
  }

  async embed(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>
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
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>
  ): Promise<AxEmbedResponse> {
    const embedModel =
      this.getEmbedModel(req.embedModel) ??
      req.embedModel ??
      this.defaults.embedModel

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
            [axSpanAttributes.LLM_REQUEST_MODEL]: embedModel as string,
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
    embedModel: TEmbedModel,
    embedReq: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>,
    span?: Span
  ): Promise<AxEmbedResponse> {
    if (!this.aiImpl.createEmbedReq) {
      throw new Error('generateEmbedReq not implemented')
    }
    if (!this.aiImpl.createEmbedResp) {
      throw new Error('generateEmbedResp not implemented')
    }

    const debug = options?.debug ?? this.debug

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
          debug,
          fetch: this.fetch,
          span,
        },
        reqValue
      )

      return res
    }

    const resValue = this.rt
      ? await this.rt(fn, { modelUsage: this.embedModelUsage })
      : await fn()
    const res = this.aiImpl.createEmbedResp!(resValue as TEmbedResponse)

    res.sessionId = options?.sessionId

    if (!res.modelUsage) {
      res.modelUsage = {
        ai: this.name,
        model: embedModel as string,
        tokens: this.aiImpl.getTokenUsage(),
      }
    }
    this.embedModelUsage = res.modelUsage

    if (span?.isRecording()) {
      setResponseAttr(res, span)
    }

    span?.end()
    return res
  }

  private async buildHeaders(
    headers: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    return { ...headers, ...(await this.headers()) }
  }

  private getModelByKey(
    modelName?: TModel | TEmbedModel
  ): AxAIInputModelList<TModel, TEmbedModel>[number] | undefined {
    if (!modelName) {
      return undefined
    }
    const item = this.models?.find((v) => v.key === modelName)
    return item
  }

  private getModel(modelName?: TModel): TModel | undefined {
    const item = this.getModelByKey(modelName)
    return item && 'model' in item ? item.model : undefined
  }

  private getEmbedModel(modelName?: TEmbedModel): TEmbedModel | undefined {
    const item = this.getModelByKey(modelName)
    return item && 'embedModel' in item ? item.embedModel : undefined
  }
}

function setResponseAttr(
  res: Readonly<AxChatResponse | AxEmbedResponse>,
  span: Span
) {
  if (res.modelUsage) {
    span.setAttributes({
      [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
        res.modelUsage.tokens?.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]:
        res.modelUsage.tokens?.promptTokens,
    })
  }
}

function validateModels<TModel, TEmbedModel>(
  models: Readonly<AxAIInputModelList<TModel, TEmbedModel>>
): void {
  // Validate duplicate keys in models.
  const keys = new Set<string>()
  for (const model of models) {
    if (keys.has(model.key)) {
      throw new Error(
        `Duplicate model key detected: "${model.key}". Each model key must be unique.`
      )
    }
    keys.add(model.key)
  }
}
