import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js'

import type { AxAPI } from '../../util/apicall.js'
import {
  type AxAIFeatures,
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import type {
  AxAIInputModelList,
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxModelInfo,
  AxTokenUsage,
} from '../types.js'

import {
  type AxAIOpenAIChatRequest,
  type AxAIOpenAIChatResponse,
  type AxAIOpenAIChatResponseDelta,
  type AxAIOpenAIConfig,
  AxAIOpenAIEmbedModel,
  type AxAIOpenAIEmbedRequest,
  type AxAIOpenAIEmbedResponse,
  AxAIOpenAIModel,
} from './chat_types.js'
import { axModelInfoOpenAI } from './info.js'

export const axAIOpenAIDefaultConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    model: AxAIOpenAIModel.GPT41,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    ...axBaseAIDefaultConfig(),
  })

export const axAIOpenAIBestConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    ...axAIOpenAIDefaultConfig(),
    model: AxAIOpenAIModel.GPT41,
  })

export const axAIOpenAICreativeConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> =>
  structuredClone({
    model: AxAIOpenAIModel.GPT41,
    embedModel: AxAIOpenAIEmbedModel.TextEmbedding3Small,
    ...axBaseAIDefaultCreativeConfig(),
  })

export const axAIOpenAIFastConfig = (): AxAIOpenAIConfig<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> => ({
  ...axAIOpenAIDefaultConfig(),
  model: AxAIOpenAIModel.GPT41Mini,
})

export interface AxAIOpenAIArgs<
  TName = 'openai',
  TModel = AxAIOpenAIModel,
  TEmbedModel = AxAIOpenAIEmbedModel,
  TChatReq extends
    AxAIOpenAIChatRequest<TModel> = AxAIOpenAIChatRequest<TModel>,
> extends Omit<
    AxAIOpenAIBaseArgs<TModel, TEmbedModel, TChatReq>,
    'config' | 'supportFor' | 'modelInfo'
  > {
  name: TName
  modelInfo?: AxModelInfo[]
  config?: Partial<AxAIOpenAIBaseArgs<TModel, TEmbedModel, TChatReq>['config']>
}

type ChatReqUpdater<TModel, TChatReq extends AxAIOpenAIChatRequest<TModel>> = (
  req: Readonly<TChatReq>
) => TChatReq

export interface AxAIOpenAIBaseArgs<
  TModel,
  TEmbedModel,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> {
  apiKey: string
  apiURL?: string
  config: Readonly<AxAIOpenAIConfig<TModel, TEmbedModel>>
  options?: Readonly<AxAIServiceOptions & { streamingUsage?: boolean }>
  modelInfo: Readonly<AxModelInfo[]>
  models?: AxAIInputModelList<TModel, TEmbedModel>
  chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>
  supportFor: AxAIFeatures | ((model: TModel) => AxAIFeatures)
}

class AxAIOpenAIImpl<
  TModel,
  TEmbedModel,
  TChatReq extends AxAIOpenAIChatRequest<TModel>,
> implements
    AxAIServiceImpl<
      TModel,
      TEmbedModel,
      AxAIOpenAIChatRequest<TModel>,
      AxAIOpenAIEmbedRequest<TEmbedModel>,
      AxAIOpenAIChatResponse,
      AxAIOpenAIChatResponseDelta,
      AxAIOpenAIEmbedResponse
    >
{
  private tokensUsed: AxTokenUsage | undefined

  constructor(
    private readonly config: Readonly<AxAIOpenAIConfig<TModel, TEmbedModel>>,
    private streamingUsage: boolean,
    private readonly chatReqUpdater?: ChatReqUpdater<TModel, TChatReq>
  ) {}

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed
  }

  getModelConfig(): AxModelConfig {
    const { config } = this

    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      topP: config.topP,
      n: config.n,
      stream: config.stream,
    }
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<TModel>>,

    config: Readonly<AxAIPromptConfig>
  ): [AxAPI, AxAIOpenAIChatRequest<TModel>] {
    const model = req.model

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty')
    }

    const apiConfig = {
      name: '/chat/completions',
    }

    const tools = req.functions?.map((v) => ({
      type: 'function' as const,
      function: {
        name: v.name,
        description: v.description,
        parameters: v.parameters,
      },
    }))

    const toolsChoice =
      !req.functionCall && req.functions && req.functions.length > 0
        ? 'auto'
        : req.functionCall

    const messages = createMessages(req)

    const frequencyPenalty =
      req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty

    const stream = req.modelConfig?.stream ?? this.config.stream

    const store = this.config.store

    let reqValue: AxAIOpenAIChatRequest<TModel> = {
      model,
      messages,
      response_format: this.config?.responseFormat
        ? { type: this.config.responseFormat }
        : undefined,
      tools,
      tool_choice: toolsChoice,
      max_completion_tokens:
        req.modelConfig?.maxTokens ?? this.config.maxTokens ?? 500,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      n: req.modelConfig?.n ?? this.config.n,
      stop: req.modelConfig?.stopSequences ?? this.config.stop,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      logit_bias: this.config.logitBias,
      ...(frequencyPenalty ? { frequency_penalty: frequencyPenalty } : {}),
      ...(stream && this.streamingUsage
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
      ...(store ? { store: store } : {}),
      ...(this.config.serviceTier
        ? { service_tier: this.config.serviceTier }
        : {}),
      ...(this.config.user ? { user: this.config.user } : {}),
    }

    if (this.config.reasoningEffort) {
      reqValue.reasoning_effort = this.config.reasoningEffort
    }

    if (this.config.webSearchOptions) {
      reqValue.web_search_options = {
        ...(this.config.webSearchOptions.searchContextSize && {
          search_context_size: this.config.webSearchOptions.searchContextSize,
        }),
        ...(this.config.webSearchOptions.userLocation && {
          user_location: {
            approximate: {
              type: 'approximate',
              ...(this.config.webSearchOptions.userLocation.approximate
                .city && {
                city: this.config.webSearchOptions.userLocation.approximate
                  .city,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .country && {
                country:
                  this.config.webSearchOptions.userLocation.approximate.country,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .region && {
                region:
                  this.config.webSearchOptions.userLocation.approximate.region,
              }),
              ...(this.config.webSearchOptions.userLocation.approximate
                .timezone && {
                timezone:
                  this.config.webSearchOptions.userLocation.approximate
                    .timezone,
              }),
            },
          },
        }),
      }
    }

    // Then, override based on prompt-specific config
    if (config.thinkingTokenBudget) {
      switch (config.thinkingTokenBudget) {
        case 'disable':
          reqValue.reasoning_effort = undefined; // Explicitly set to undefined
          break;
        case 'minimal':
          reqValue.reasoning_effort = 'low'
          break
        case 'low':
          reqValue.reasoning_effort = 'medium'
          break
        case 'medium':
          reqValue.reasoning_effort = 'high'
          break
        case 'high':
          reqValue.reasoning_effort = 'high'
          break
        case 'highest':
          reqValue.reasoning_effort = 'high'
          break
      }
    }

    if (this.chatReqUpdater) {
      reqValue = this.chatReqUpdater(reqValue as TChatReq)
    }

    return [apiConfig, reqValue]
  }

  createEmbedReq(
    req: Readonly<AxInternalEmbedRequest<TEmbedModel>>
  ): [AxAPI, AxAIOpenAIEmbedRequest<TEmbedModel>] {
    const model = req.embedModel

    if (!model) {
      throw new Error('Embed model not set')
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty')
    }

    const apiConfig = {
      name: '/embeddings',
    }

    const reqValue = {
      model: model,
      input: req.texts,
      dimensions: this.config.dimensions,
    }

    return [apiConfig, reqValue]
  }

  createChatResp(resp: Readonly<AxAIOpenAIChatResponse>): AxChatResponse {
    const { id, usage, choices, error } = resp

    if (error) {
      throw error
    }

    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined

    const results = choices.map((choice) => {
      const finishReason = mapFinishReason(choice.finish_reason)

      const functionCalls = choice.message.tool_calls?.map(
        ({ id, function: { arguments: params, name } }) => ({
          id: id,
          type: 'function' as const,
          function: { name, params },
        })
      )

      return {
        id: `${choice.index}`,
        content: choice.message.content,
        thought: choice.message.reasoning_content,
        functionCalls,
        finishReason,
      }
    })

    return {
      results,
      remoteId: id,
    }
  }

  createChatStreamResp(
    resp: Readonly<AxAIOpenAIChatResponseDelta>,
    state: object
  ): AxChatResponse {
    const { id, usage, choices } = resp

    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined

    const sstate = state as {
      indexIdMap: Record<number, string>
    }

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {}
    }

    const results = choices.map(
      ({
        delta: {
          content,
          role,
          tool_calls: toolCalls,
          reasoning_content: thought,
        },
        finish_reason: oaiFinishReason,
      }) => {
        const finishReason = mapFinishReason(oaiFinishReason)

        const functionCalls = toolCalls
          ?.map(({ id: _id, index, function: { name, arguments: params } }) => {
            if (
              typeof _id === 'string' &&
              typeof index === 'number' &&
              !sstate.indexIdMap[index]
            ) {
              sstate.indexIdMap[index] = _id
            }

            const id = sstate.indexIdMap[index]
            if (!id) {
              return null
            }

            return {
              id,
              type: 'function' as const,
              function: { name, params },
            }
          })
          .filter((v) => v !== null)

        return {
          content,
          role,
          thought,
          functionCalls,
          finishReason,
          id,
        }
      }
    )

    return { results }
  }

  createEmbedResp(resp: Readonly<AxAIOpenAIEmbedResponse>): AxEmbedResponse {
    const { data, usage } = resp

    this.tokensUsed = usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        }
      : undefined

    return { embeddings: data.map((v) => v.embedding) }
  }
}

const mapFinishReason = (
  finishReason: AxAIOpenAIChatResponse['choices'][0]['finish_reason']
): AxChatResponseResult['finishReason'] => {
  switch (finishReason) {
    case 'stop':
      return 'stop' as const
    case 'length':
      return 'length' as const
    case 'content_filter':
      return 'error' as const
    case 'tool_calls':
      return 'function_call' as const
  }
}

function createMessages<TModel>(
  req: Readonly<AxInternalChatRequest<TModel>>
): AxAIOpenAIChatRequest<TModel>['messages'] {
  return req.chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'system':
        return { role: 'system' as const, content: msg.content }
      case 'user':
        if (Array.isArray(msg.content)) {
          return {
            role: 'user' as const,
            name: msg.name,
            content: msg.content.map((c) => {
              switch (c.type) {
                case 'text':
                  return { type: 'text' as const, text: c.text }
                case 'image': {
                  const url = `data:${c.mimeType};base64,` + c.image
                  return {
                    type: 'image_url' as const,
                    image_url: { url, details: c.details ?? 'auto' },
                  }
                }
                case 'audio': {
                  const data = c.data
                  return {
                    type: 'input_audio' as const,
                    input_audio: { data, format: c.format ?? 'wav' },
                  }
                }
                default:
                  throw new Error('Invalid content type')
              }
            }),
          }
        }
        return { role: 'user' as const, content: msg.content, name: msg.name }
      case 'assistant':
        return {
          role: 'assistant' as const,
          content: msg.content as string,
          name: msg.name,
          tool_calls: msg.functionCalls?.map((v) => ({
            id: v.id,
            type: 'function' as const,
            function: {
              name: v.function.name,
              arguments:
                typeof v.function.params === 'object'
                  ? JSON.stringify(v.function.params)
                  : v.function.params,
            },
          })),
        }
      case 'function':
        return {
          role: 'tool' as const,
          content: msg.result,
          tool_call_id: msg.functionId,
        }
      default:
        throw new Error('Invalid role')
    }
  })
}

export class AxAIOpenAIBase<
  TModel,
  TEmbedModel,
  TChatReq extends
    AxAIOpenAIChatRequest<TModel> = AxAIOpenAIChatRequest<TModel>,
> extends AxBaseAI<
  TModel,
  TEmbedModel,
  AxAIOpenAIChatRequest<TModel>,
  AxAIOpenAIEmbedRequest<TEmbedModel>,
  AxAIOpenAIChatResponse,
  AxAIOpenAIChatResponseDelta,
  AxAIOpenAIEmbedResponse
> {
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo,
    models,
    chatReqUpdater,
    supportFor,
  }: Readonly<
    Omit<AxAIOpenAIBaseArgs<TModel, TEmbedModel, TChatReq>, 'name'>
  >) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set')
    }

    const aiImpl = new AxAIOpenAIImpl<TModel, TEmbedModel, TChatReq>(
      config,
      options?.streamingUsage ?? true,
      chatReqUpdater
    )

    super(aiImpl, {
      name: 'OpenAI',
      apiURL: apiURL ? apiURL : 'https://api.openai.com/v1',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo,
      defaults: {
        model: config.model,
        embedModel: config.embedModel,
      },
      options,
      supportFor,
      models,
    })
  }
}

export class AxAIOpenAI extends AxAIOpenAIBase<
  AxAIOpenAIModel,
  AxAIOpenAIEmbedModel
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIOpenAIArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('OpenAI API key not set')
    }

    modelInfo = [...axModelInfoOpenAI, ...(modelInfo ?? [])]

    const supportFor = (model: AxAIOpenAIModel) => {
      const mi = getModelInfo<AxAIOpenAIModel, AxAIOpenAIEmbedModel>({
        model,
        modelInfo,
        models,
      })
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
      }
    }

    super({
      apiKey,
      config: {
        ...axAIOpenAIDefaultConfig(),
        ...config,
      },
      options,
      modelInfo,
      models,
      supportFor,
    })

    super.setName('OpenAI')
  }
}
