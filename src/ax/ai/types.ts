import type { ReadableStream } from 'stream/web'

import type { Tracer } from '@opentelemetry/api'

import type { AxAPI } from '../util/apicall.js'

export type AxAIModelMap = Record<string, string>

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

export type AxChatRequest = {
  chatPrompt: Readonly<
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
        functionId: string
        cache?: boolean
      }
  >[]
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
  modelConfig?: Readonly<AxModelConfig>
  model?: string
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

export type AxInternalChatRequest = Omit<AxChatRequest, 'model'> &
  Required<Pick<AxChatRequest, 'model'>>

export type AxEmbedRequest = {
  texts?: readonly string[]
  embedModel?: string
}

export type AxInternalEmbedRequest = Omit<AxEmbedRequest, 'embedModel'> &
  Required<Pick<AxEmbedRequest, 'embedModel'>>

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

export type AxAIServiceActionOptions = {
  ai?: Readonly<AxAIService>
  sessionId?: string
  traceId?: string
  rateLimiter?: AxRateLimiterFunction
}

export interface AxAIService {
  getName(): string
  getModelInfo(): Readonly<AxModelInfoWithProvider>
  getEmbedModelInfo(): Readonly<AxModelInfoWithProvider> | undefined
  getFeatures(model?: string): { functions: boolean; streaming: boolean }
  getModelMap(): AxAIModelMap | undefined
  getMetrics(): AxAIServiceMetrics

  chat(
    req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>>
  embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions & AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse>

  setOptions(options: Readonly<AxAIServiceOptions>): void
  getOptions(): Readonly<AxAIServiceOptions>
}

export interface AxAIServiceImpl<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse,
> {
  createChatReq(
    req: Readonly<AxInternalChatRequest>,
    config: Readonly<AxAIPromptConfig>
  ): [AxAPI, TChatRequest]

  createChatResp(resp: Readonly<TChatResponse>): AxChatResponse

  createChatStreamResp?(
    resp: Readonly<TChatResponseDelta>,
    state: object
  ): AxChatResponse

  createEmbedReq?(req: Readonly<AxInternalEmbedRequest>): [AxAPI, TEmbedRequest]

  createEmbedResp?(resp: Readonly<TEmbedResponse>): AxEmbedResponse

  getModelConfig(): AxModelConfig
}
