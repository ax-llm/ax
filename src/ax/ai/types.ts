import type { ReadableStream } from 'node:stream/web'

import type { Tracer } from '@opentelemetry/api'

import type { AxAPI } from '../util/apicall.js'

import type { AxAIFeatures } from './base.js'

export type AxAIInputModelList<TModel, TEmbedModel> = (AxAIModelListBase & {
  isInternal?: boolean
} & ({ model: TModel } | { embedModel: TEmbedModel }))[]

export type AxAIModelListBase = {
  key: string
  description: string
}

export type AxAIModelList = (AxAIModelListBase &
  ({ model: string } | { embedModel: string }))[]

export type AxModelInfo = {
  name: string
  currency?: string
  characterIsToken?: boolean
  promptTokenCostPer1M?: number
  completionTokenCostPer1M?: number
  aliases?: string[]
}

export type AxTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type AxModelConfig = {
  maxTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  endSequences?: string[]
  stream?: boolean
  n?: number
}

export type AxFunctionHandler = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any,
  extra?: Readonly<{
    sessionId?: string
    traceId?: string
    debug?: boolean
    ai?: AxAIService
  }>
) => unknown

export type AxFunctionJSONSchema = {
  type: string
  properties?: Record<
    string,
    AxFunctionJSONSchema & {
      enum?: string[]
      description: string
    }
  >
  required?: string[]
  items?: AxFunctionJSONSchema
}

export type AxFunction = {
  name: string
  description: string
  parameters?: AxFunctionJSONSchema
  func: AxFunctionHandler
}

export type AxChatResponseResult = {
  content?: string
  name?: string
  id?: string
  functionCalls?: {
    id: string
    type: 'function'
    function: { name: string; params?: string | object }
  }[]
  finishReason?:
    | 'stop'
    | 'length'
    | 'function_call'
    | 'content_filter'
    | 'error'
}

export type AxChatResponse = {
  sessionId?: string
  remoteId?: string
  results: readonly AxChatResponseResult[]
  modelUsage?: AxTokenUsage
  embedModelUsage?: AxTokenUsage
}

export type AxEmbedResponse = {
  remoteId?: string
  sessionId?: string
  embeddings: readonly (readonly number[])[]
  modelUsage?: AxTokenUsage
}

export type AxModelInfoWithProvider = AxModelInfo & { provider: string }

export type AxChatRequest<TModel = string> = {
  chatPrompt: (
    | { role: 'system'; content: string; cache?: boolean }
    | {
        role: 'user'
        name?: string
        content:
          | string
          | (
              | {
                  type: 'text'
                  text: string
                  cache?: boolean
                }
              | {
                  type: 'image'
                  mimeType: string
                  image: string
                  details?: 'high' | 'low' | 'auto'
                  cache?: boolean
                }
              | {
                  type: 'audio'
                  data: string
                  format?: 'wav'
                  cache?: boolean
                }
            )[]
      }
    | {
        role: 'assistant'
        content?: string
        name?: string
        functionCalls?: {
          id: string
          type: 'function'
          function: { name: string; params?: string | object }
        }[]
        cache?: boolean
      }
    | {
        role: 'function'
        result: string
        isError?: boolean
        functionId: string
        cache?: boolean
      }
  )[]
  functions?: Readonly<{
    name: string
    description: string
    parameters?: AxFunctionJSONSchema
  }>[]
  functionCall?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } }
  modelConfig?: AxModelConfig
  model?: TModel
}

export interface AxAIServiceMetrics {
  latency: {
    chat: {
      mean: number
      p95: number
      p99: number
      samples: number[]
    }
    embed: {
      mean: number
      p95: number
      p99: number
      samples: number[]
    }
  }
  errors: {
    chat: {
      count: number
      rate: number
      total: number
    }
    embed: {
      count: number
      rate: number
      total: number
    }
  }
}

export type AxInternalChatRequest<TModel> = Omit<AxChatRequest, 'model'> &
  Required<Pick<AxChatRequest<TModel>, 'model'>>

export type AxEmbedRequest<TEmbedModel = string> = {
  texts?: readonly string[]
  embedModel?: TEmbedModel
}

export type AxInternalEmbedRequest<TEmbedModel> = Omit<
  AxEmbedRequest,
  'embedModel'
> &
  Required<Pick<AxEmbedRequest<TEmbedModel>, 'embedModel'>>

export type AxRateLimiterFunction = <T = unknown>(
  reqFunc: () => Promise<T | ReadableStream<T>>,
  info: Readonly<{ modelUsage?: AxTokenUsage; embedModelUsage?: AxTokenUsage }>
) => Promise<T | ReadableStream<T>>

export type AxAIPromptConfig = {
  stream?: boolean
}

export type AxAIServiceOptions = {
  debug?: boolean
  rateLimiter?: AxRateLimiterFunction
  fetch?: typeof fetch
  tracer?: Tracer
}

export type AxAIServiceActionOptions<
  TModel = unknown,
  TEmbedModel = unknown,
> = {
  ai?: Readonly<AxAIService<TModel, TEmbedModel>>
  sessionId?: string
  traceId?: string
  rateLimiter?: AxRateLimiterFunction
  debug?: boolean
  debugHideSystemPrompt?: boolean
}

export interface AxAIService<TModel = unknown, TEmbedModel = unknown> {
  getId(): string
  getName(): string
  getFeatures(model?: TModel): AxAIFeatures
  getModelList(): AxAIModelList | undefined
  getDefaultModels(): Readonly<{ model: string; embedModel?: string }>
  getMetrics(): AxAIServiceMetrics

  chat(
    req: Readonly<AxChatRequest<TModel>>,
    options?: Readonly<
      AxAIPromptConfig & AxAIServiceActionOptions<TModel, TEmbedModel>
    >
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>>
  embed(
    req: Readonly<AxEmbedRequest<TEmbedModel>>,
    options?: Readonly<AxAIServiceActionOptions<TModel, TEmbedModel>>
  ): Promise<AxEmbedResponse>

  setOptions(options: Readonly<AxAIServiceOptions>): void
  getOptions(): Readonly<AxAIServiceOptions>
}

export interface AxAIServiceImpl<
  TModel,
  TEmbedModel,
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
> {
  createChatReq(
    req: Readonly<AxInternalChatRequest<TModel>>,
    config: Readonly<AxAIPromptConfig>
  ): [AxAPI, TChatRequest]

  createChatResp(resp: Readonly<TChatResponse>): AxChatResponse

  createChatStreamResp?(
    resp: Readonly<TChatResponseDelta>,
    state: object
  ): AxChatResponse

  createEmbedReq?(
    req: Readonly<AxInternalEmbedRequest<TEmbedModel>>
  ): [AxAPI, TEmbedRequest]

  createEmbedResp?(resp: Readonly<TEmbedResponse>): AxEmbedResponse

  getModelConfig(): AxModelConfig
}
