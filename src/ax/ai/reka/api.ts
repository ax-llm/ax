import type { AxAPI } from '../../util/apicall.js'
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import type {
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxInternalChatRequest,
  AxModelConfig,
  AxModelInfo,
} from '../types.js'

import { axModelInfoReka } from './info.js'
import {
  type AxAIRekaChatRequest,
  type AxAIRekaChatResponse,
  type AxAIRekaChatResponseDelta,
  type AxAIRekaConfig,
  AxAIRekaModel,
} from './types.js'

export const axAIRekaDefaultConfig = (): AxAIRekaConfig =>
  structuredClone({
    model: AxAIRekaModel.RekaCore,
    ...axBaseAIDefaultConfig(),
  })

export const axAIRekaBestConfig = (): AxAIRekaConfig =>
  structuredClone({
    ...axAIRekaDefaultConfig(),
    model: AxAIRekaModel.RekaCore,
  })

export const axAIRekaCreativeConfig = (): AxAIRekaConfig =>
  structuredClone({
    model: AxAIRekaModel.RekaCore,
    ...axBaseAIDefaultCreativeConfig(),
  })

export const axAIRekaFastConfig = (): AxAIRekaConfig => ({
  ...axAIRekaDefaultConfig(),
  model: AxAIRekaModel.RekaFlash,
})

export interface AxAIRekaArgs {
  name: 'reka'
  apiKey: string
  apiURL?: string
  config?: Readonly<Partial<AxAIRekaConfig>>
  options?: Readonly<AxAIServiceOptions & { streamingUsage?: boolean }>
  modelInfo?: Readonly<AxModelInfo[]>
  modelMap?: Record<string, AxAIRekaModel | string>
}

class AxAIRekaImpl
  implements
    AxAIServiceImpl<
      AxAIRekaChatRequest,
      unknown,
      AxAIRekaChatResponse,
      AxAIRekaChatResponseDelta,
      unknown
    >
{
  constructor(private config: AxAIRekaConfig) {}

  getModelConfig(): AxModelConfig {
    const { config } = this
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      topP: config.topP,
      n: config.n,
      stream: config.stream,
    }
  }

  createChatReq = (
    req: Readonly<AxInternalChatRequest>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: Readonly<AxAIPromptConfig>
  ): [AxAPI, AxAIRekaChatRequest] => {
    const model = req.model

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty')
    }

    const apiConfig = {
      name: '/chat/completions',
    }

    const messages = createMessages(req)

    const frequencyPenalty =
      req.modelConfig?.frequencyPenalty ?? this.config.frequencyPenalty

    const stream = req.modelConfig?.stream ?? this.config.stream

    const reqValue: AxAIRekaChatRequest = {
      model,
      messages,
      max_tokens: req.modelConfig?.maxTokens ?? this.config.maxTokens ?? 500,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      top_k: req.modelConfig?.n ?? this.config.n,
      top_p: req.modelConfig?.topP ?? this.config.topP ?? 1,
      stop: req.modelConfig?.stopSequences ?? this.config.stop,
      presence_penalty:
        req.modelConfig?.presencePenalty ?? this.config.presencePenalty,
      ...(frequencyPenalty ? { frequency_penalty: frequencyPenalty } : {}),
      ...(stream ? { stream: true } : {}),
    }

    return [apiConfig, reqValue]
  }

  createChatResp = (resp: Readonly<AxAIRekaChatResponse>): AxChatResponse => {
    const { id, usage, responses } = resp

    const modelUsage = usage
      ? {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        }
      : undefined

    const results = responses.map((res) => {
      const finishReason = mapFinishReason(res.finish_reason)
      let content
      if (typeof res.message.content === 'string') {
        content = res.message.content
      } else {
        content = res.message.content.text
      }

      return {
        id: `${id}`,
        content,
        finishReason,
      }
    })

    return {
      modelUsage,
      results,
      remoteId: id,
    }
  }

  createChatStreamResp = (
    resp: Readonly<AxAIRekaChatResponseDelta>
  ): AxChatResponse => {
    const { id, usage, responses } = resp

    const modelUsage = usage
      ? {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
        }
      : undefined

    const results = responses.map((res) => {
      const finishReason = mapFinishReason(res.finish_reason)
      let content
      if (typeof res.chunk.content === 'string') {
        content = res.chunk.content
      } else {
        content = res.chunk.content.text
      }

      return {
        id: `${id}`,
        content,
        finishReason,
      }
    })

    return {
      results,
      modelUsage,
    }
  }
}

const mapFinishReason = (
  finishReason: AxAIRekaChatResponse['responses'][0]['finish_reason']
): AxChatResponseResult['finishReason'] => {
  switch (finishReason) {
    case 'stop':
      return 'stop' as const
    case 'context':
      return 'length' as const
    case 'length':
      return 'length' as const
  }
}

function createMessages(
  req: Readonly<AxChatRequest>
): AxAIRekaChatRequest['messages'] {
  return req.chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'system':
        return { role: 'user' as const, content: msg.content }

      case 'user':
        if (Array.isArray(msg.content)) {
          return {
            role: 'user' as const,
            content: msg.content.map((c) => {
              switch (c.type) {
                case 'text':
                  return { type: 'text' as const, text: c.text }
                case 'image': {
                  throw new Error('Image type not supported')
                }
                default:
                  throw new Error('Invalid content type')
              }
            }),
          }
        }
        return { role: 'user' as const, content: msg.content }

      case 'assistant':
        if (Array.isArray(msg.content)) {
          return {
            role: 'assistant' as const,
            content: msg.content.map((c) => {
              switch (c.type) {
                case 'text':
                  return { type: 'text' as const, text: c.text }
                case 'image': {
                  throw new Error('Image type not supported')
                }
                default:
                  throw new Error('Invalid content type')
              }
            }),
          }
        }
        if (!msg.content) {
          throw new Error('Assistant content is empty')
        }
        return { role: 'user' as const, content: msg.content }
      default:
        throw new Error('Invalid role')
    }
  })
}

export class AxAIReka extends AxBaseAI<
  AxAIRekaChatRequest,
  unknown,
  AxAIRekaChatResponse,
  AxAIRekaChatResponseDelta,
  unknown
> {
  constructor({
    apiKey,
    config,
    options,
    apiURL,
    modelInfo = axModelInfoReka,
    modelMap,
  }: Readonly<Omit<AxAIRekaArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Reka API key not set')
    }
    const _config = {
      ...axAIRekaDefaultConfig(),
      ...config,
    }

    const aiImpl = new AxAIRekaImpl(_config)

    super(aiImpl, {
      name: 'Reka',
      apiURL: apiURL ? apiURL : 'https://api.reka.ai/v1/chat',
      headers: async () => ({ 'X-Api-Key': apiKey }),
      modelInfo,
      models: {
        model: _config.model as string,
      },
      options,
      supportFor: { functions: true, streaming: true },
      modelMap,
    })
  }
}
