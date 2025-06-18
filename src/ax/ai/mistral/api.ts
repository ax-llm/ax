import { axBaseAIDefaultConfig } from '../base.js'
import { type AxAIOpenAIArgs, AxAIOpenAIBase } from '../openai/api.js'
import type {
  AxAIOpenAIChatRequest,
  AxAIOpenAIConfig,
} from '../openai/chat_types.js'
import type { AxAIServiceOptions, AxModelInfo } from '../types.js'

import { axModelInfoMistral } from './info.js'
import { AxAIMistralEmbedModels, AxAIMistralModel } from './types.js'

type AxAIMistralConfig = AxAIOpenAIConfig<
  AxAIMistralModel,
  AxAIMistralEmbedModels
>

export const axAIMistralDefaultConfig = (): AxAIMistralConfig =>
  structuredClone({
    model: AxAIMistralModel.MistralSmall,
    ...axBaseAIDefaultConfig(),
    topP: 1,
  })

export const axAIMistralBestConfig = (): AxAIMistralConfig =>
  structuredClone({
    ...axAIMistralDefaultConfig(),
    model: AxAIMistralModel.MistralLarge,
  })

export type AxAIMistralChatRequest = Omit<
  AxAIOpenAIChatRequest<AxAIMistralModel>,
  'max_completion_tokens' | 'stream_options' | 'messages'
> & {
  max_tokens?: number
  messages: (
    | { role: 'system'; content: string }
    | {
        role: 'user'
        content:
          | string
          | (
              | {
                  type: 'text'
                  text: string
                }
              | {
                  type: 'image_url'
                  image_url: string
                }
            )[]
        name?: string
      }
    | {
        role: 'assistant'
        content: string
        name?: string
        tool_calls?: {
          type: 'function'
          function: {
            name: string
            // eslint-disable-next-line functional/functional-parameters
            arguments?: string
          }
        }[]
      }
    | { role: 'tool'; content: string; tool_call_id: string }
  )[]
}

export type AxAIMistralArgs = AxAIOpenAIArgs<
  'mistral',
  AxAIMistralModel,
  AxAIMistralEmbedModels
> & {
  options?: Readonly<AxAIServiceOptions> & { tokensPerMinute?: number }
  modelInfo?: AxModelInfo[]
}

export class AxAIMistral extends AxAIOpenAIBase<
  AxAIMistralModel,
  AxAIMistralEmbedModels
> {
  constructor({
    apiKey,
    config,
    options,
    models,
    modelInfo,
  }: Readonly<Omit<AxAIMistralArgs, 'name'>>) {
    if (!apiKey || apiKey === '') {
      throw new Error('Mistral API key not set')
    }
    const _config = {
      ...axAIMistralDefaultConfig(),
      ...config,
    }

    modelInfo = [...axModelInfoMistral, ...(modelInfo ?? [])]

    const supportFor = {
      functions: true,
      streaming: true,
      hasThinkingBudget: false,
      hasShowThoughts: false,
    }

    // Chat request updater to add Grok's search parameters
    const chatReqUpdater = (
      req: Readonly<AxAIOpenAIChatRequest<AxAIMistralModel>>
    ): AxAIMistralChatRequest => {
      // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
      const { max_completion_tokens, stream_options, messages, ...result } =
        req as AxAIOpenAIChatRequest<AxAIMistralModel> & {
          stream_options?: unknown
        }

      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(result as any),
        messages: this.updateMessages(messages),
        max_tokens: max_completion_tokens,
      }
    }

    super({
      apiKey,
      config: _config,
      options,
      apiURL: 'https://api.mistral.ai/v1',
      modelInfo,
      models,
      supportFor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chatReqUpdater: chatReqUpdater as any,
    })

    super.setName('Mistral')
  }

  private updateMessages(
    messages: AxAIOpenAIChatRequest<AxAIMistralModel>['messages']
  ) {
    const messagesUpdated = []

    if (!Array.isArray(messages)) {
      return messages
    }

    for (const message of messages) {
      if (message.role === 'user' && Array.isArray(message.content)) {
        const contentUpdated = message.content.map((item) => {
          if (
            typeof item === 'object' &&
            item !== null &&
            item.type === 'image_url'
          ) {
            return { type: 'image_url', image_url: item.image_url?.url }
          }
          return item
        })
        messagesUpdated.push({ ...message, content: contentUpdated })
      } else {
        messagesUpdated.push(message)
      }
    }

    return messagesUpdated
  }
}
