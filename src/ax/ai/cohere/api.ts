import type { AxAPI } from '../../util/apicall.js'
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import type {
  AxAIModelList,
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
} from '../types.js'

import { axModelInfoCohere } from './info.js'
import {
  type AxAICohereChatRequest,
  type AxAICohereChatResponse,
  type AxAICohereChatResponseDelta,
  type AxAICohereConfig,
  AxAICohereEmbedModel,
  type AxAICohereEmbedRequest,
  type AxAICohereEmbedResponse,
  AxAICohereModel,
} from './types.js'

export const axAICohereDefaultConfig = (): AxAICohereConfig =>
  structuredClone({
    model: AxAICohereModel.CommandRPlus,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultConfig(),
  })

export const axAICohereCreativeConfig = (): AxAICohereConfig =>
  structuredClone({
    model: AxAICohereModel.CommandR,
    embedModel: AxAICohereEmbedModel.EmbedEnglishV30,
    ...axBaseAIDefaultCreativeConfig(),
  })

export interface AxAICohereArgs {
  name: 'cohere'
  apiKey: string
  config?: Readonly<Partial<AxAICohereConfig>>
  options?: Readonly<AxAIServiceOptions>
  models?: AxAIModelList<AxAICohereModel>
}

class AxAICohereImpl
  implements
    AxAIServiceImpl<
      AxAICohereModel,
      AxAICohereEmbedModel,
      AxAICohereChatRequest,
      AxAICohereEmbedRequest,
      AxAICohereChatResponse,
      AxAICohereChatResponseDelta,
      AxAICohereEmbedResponse
    >
{
  constructor(private config: AxAICohereConfig) {}

  getModelConfig(): AxModelConfig {
    const { config } = this
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      endSequences: config.endSequences,
      stopSequences: config.stopSequences,
      stream: config.stream,
      n: config.n,
    } as AxModelConfig
  }

  createChatReq(
    req: Readonly<AxInternalChatRequest<AxAICohereModel>>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [AxAPI, AxAICohereChatRequest] {
    const model = req.model

    const lastChatMsg = req.chatPrompt.at(-1)
    const restOfChat = req.chatPrompt.slice(0, -1)

    let message: AxAICohereChatRequest['message'] | undefined

    if (
      lastChatMsg &&
      lastChatMsg.role === 'user' &&
      typeof lastChatMsg.content === 'string'
    ) {
      message = lastChatMsg?.content
    }

    const chatHistory = createHistory(restOfChat)

    type PropValue = NonNullable<
      AxAICohereChatRequest['tools']
    >[0]['parameter_definitions'][0]

    const tools: AxAICohereChatRequest['tools'] = req.functions?.map((v) => {
      const props: Record<string, PropValue> = {}
      if (v.parameters?.properties) {
        for (const [key, value] of Object.entries(v.parameters.properties)) {
          props[key] = {
            description: value.description,
            type: value.type,
            required: v.parameters.required?.includes(key) ?? false,
          }
        }
      }

      return {
        name: v.name,
        description: v.description,
        parameter_definitions: props,
      }
    })

    type FnType = Extract<AxChatRequest['chatPrompt'][0], { role: 'function' }>

    const toolResults: AxAICohereChatRequest['tool_results'] = (
      req.chatPrompt as FnType[]
    )
      .filter((chat) => chat.role === 'function')
      .map((chat) => {
        const fn = tools?.find((t) => t.name === chat.functionId)
        if (!fn) {
          throw new Error('Function not found')
        }
        return {
          call: { name: fn.name, parameters: fn.parameter_definitions },
          outputs: [{ result: chat.result ?? '' }],
        }
      })

    const apiConfig = {
      name: '/chat',
    }

    const reqValue: AxAICohereChatRequest = {
      message,
      model,
      tools,
      ...(toolResults && !message ? { tool_results: toolResults } : {}),
      chat_history: chatHistory,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      k: req.modelConfig?.topK ?? this.config.topK,
      p: req.modelConfig?.topP ?? this.config.topP,
      frequency_penalty:
        req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      end_sequences: this.config.endSequences,
      stop_sequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
    }

    return [apiConfig, reqValue]
  }

  createEmbedReq = (
    req: Readonly<AxInternalEmbedRequest<AxAICohereEmbedModel>>
  ): [AxAPI, AxAICohereEmbedRequest] => {
    const model = req.embedModel

    if (!model) {
      throw new Error('Embed model not set')
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty')
    }

    const apiConfig = {
      name: '/embed',
    }

    const reqValue = {
      model,
      texts: req.texts ?? [],
      input_type: 'classification',
      truncate: '',
    }

    return [apiConfig, reqValue]
  }

  createChatResp = (resp: Readonly<AxAICohereChatResponse>): AxChatResponse => {
    const modelUsage = resp.meta.billed_units
      ? {
          promptTokens: resp.meta.billed_units.input_tokens,
          completionTokens: resp.meta.billed_units.output_tokens,
          totalTokens:
            resp.meta.billed_units.input_tokens +
            resp.meta.billed_units.output_tokens,
        }
      : undefined

    let finishReason: AxChatResponse['results'][0]['finishReason']
    if ('finish_reason' in resp) {
      switch (resp.finish_reason) {
        case 'COMPLETE':
          finishReason = 'stop'
          break
        case 'MAX_TOKENS':
          finishReason = 'length'
          break
        case 'ERROR':
          throw new Error('Finish reason: ERROR')
        case 'ERROR_TOXIC':
          throw new Error('Finish reason: CONTENT_FILTER')
        default:
          finishReason = 'stop'
          break
      }
    }

    let functionCalls: AxChatResponse['results'][0]['functionCalls']

    if ('tool_calls' in resp) {
      functionCalls = resp.tool_calls?.map(
        (v): NonNullable<AxChatResponse['results'][0]['functionCalls']>[0] => {
          return {
            id: v.name,
            type: 'function' as const,
            function: { name: v.name, params: v.parameters },
          }
        }
      )
    }

    const results: AxChatResponse['results'] = [
      {
        id: resp.generation_id,
        content: resp.text,
        functionCalls,
        finishReason,
      },
    ]

    return {
      results,
      modelUsage,
      remoteId: resp.response_id,
    }
  }

  createChatStreamResp = (
    resp: Readonly<AxAICohereChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    const ss = state as {
      generation_id?: string
    }

    if (resp.event_type === 'stream-start') {
      ss.generation_id = resp.generation_id
    }

    const { results } = this.createChatResp(resp)
    const result = results[0]
    if (!result) {
      throw new Error('No result')
    }

    result.id = ss.generation_id ?? ''
    return { results }
  }

  createEmbedResp(resp: Readonly<AxAICohereEmbedResponse>): AxEmbedResponse {
    return {
      remoteId: resp.id,
      embeddings: resp.embeddings,
    }
  }
}

export class AxAICohere extends AxBaseAI<
  AxAICohereModel,
  AxAICohereEmbedModel,
  AxAICohereChatRequest,
  AxAICohereEmbedRequest,
  AxAICohereChatResponse,
  AxAICohereChatResponseDelta,
  AxAICohereEmbedResponse
> {
  constructor({
    apiKey,
    config,
    options,
    models,
  }: Readonly<Omit<AxAICohereArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Cohere API key not set')
    }
    const _config = {
      ...axAICohereDefaultConfig(),
      ...config,
    }

    const aiImpl = new AxAICohereImpl(_config)

    super(aiImpl, {
      name: 'Cohere',
      apiURL: 'https://api.cohere.ai/v1',
      headers: async () => ({ Authorization: `Bearer ${apiKey}` }),
      modelInfo: axModelInfoCohere,
      defaults: { model: _config.model },
      supportFor: { functions: true, streaming: true },
      options,
      models,
    })
  }
}
function createHistory(
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): AxAICohereChatRequest['chat_history'] {
  return chatPrompt.map((chat) => {
    let message: string = ''

    if (
      chat.role === 'system' ||
      chat.role === 'assistant' ||
      chat.role === 'user'
    ) {
      if (typeof chat.content === 'string') {
        message = chat.content
      } else {
        throw new Error('Multi-modal content not supported')
      }
    }

    switch (chat.role) {
      case 'user':
        return { role: 'USER' as const, message }
      case 'system':
        return { role: 'SYSTEM' as const, message }
      case 'assistant': {
        const toolCalls = createToolCall(chat.functionCalls)
        return {
          role: 'CHATBOT' as const,
          message,
          tool_calls: toolCalls,
        }
      }
      case 'function': {
        const functionCalls = chatPrompt
          .map((v) => {
            if (v.role === 'assistant') {
              return v.functionCalls?.find((f) => f.id === chat.functionId)
            }
            return undefined
          })
          .filter((v) => v !== undefined)

        const call = createToolCall(functionCalls)?.at(0)

        if (!call) {
          throw new Error('Function call not found')
        }

        const outputs = [{ result: chat.result }]
        return {
          role: 'TOOL' as const,
          tool_results: [
            {
              call,
              outputs,
            },
          ],
        }
      }
      default:
        throw new Error('Unknown role')
    }
  })
}
function createToolCall(
  functionCalls: Readonly<
    Extract<
      AxChatRequest['chatPrompt'][0],
      { role: 'assistant' }
    >['functionCalls']
  >
) {
  return functionCalls?.map((v) => {
    const parameters =
      typeof v.function.params === 'string'
        ? JSON.parse(v.function.params)
        : v.function.params
    return { name: v.function.name, parameters }
  })
}
