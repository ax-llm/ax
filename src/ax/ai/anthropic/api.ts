import type { AxAPI } from '../../util/apicall.js'
import { AxAIRefusalError } from '../../util/apicall.js'
import { AxBaseAI, axBaseAIDefaultConfig } from '../base.js'
import { GoogleVertexAuth } from '../google-vertex/auth.js'
import type {
  AxAIInputModelList,
  AxAIPromptConfig,
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxInternalChatRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js'

import { axModelInfoAnthropic } from './info.js'
import {
  type AxAIAnthropicChatError,
  type AxAIAnthropicChatRequest,
  type AxAIAnthropicChatResponse,
  type AxAIAnthropicChatResponseDelta,
  type AxAIAnthropicConfig,
  type AxAIAnthropicContentBlockDeltaEvent,
  type AxAIAnthropicContentBlockStartEvent,
  type AxAIAnthropicErrorEvent,
  type AxAIAnthropicMessageDeltaEvent,
  type AxAIAnthropicMessageStartEvent,
  AxAIAnthropicModel,
  type AxAIAnthropicThinkingConfig,
  AxAIAnthropicVertexModel,
} from './types.js'

import { getModelInfo } from '@ax-llm/ax/dsp/modelinfo.js'

export const axAIAnthropicDefaultConfig = (): AxAIAnthropicConfig =>
  structuredClone({
    model: AxAIAnthropicModel.Claude37Sonnet,
    maxTokens: 40000, // Ensure maxTokens is higher than highest thinking budget
    thinkingTokenBudgetLevels: {
      minimal: 1024,
      low: 5000,
      medium: 10000,
      high: 20000,
      highest: 32000,
    },
    ...axBaseAIDefaultConfig(),
  })

export const axAIAnthropicVertexDefaultConfig = (): AxAIAnthropicConfig =>
  structuredClone({
    model: AxAIAnthropicVertexModel.Claude37Sonnet,
    maxTokens: 40000, // Ensure maxTokens is higher than highest thinking budget
    thinkingTokenBudgetLevels: {
      minimal: 1024,
      low: 5000,
      medium: 10000,
      high: 20000,
      highest: 32000,
    },
    ...axBaseAIDefaultConfig(),
  })

export interface AxAIAnthropicArgs {
  name: 'anthropic'
  apiKey?: string
  projectId?: string
  region?: string
  config?: Readonly<Partial<AxAIAnthropicConfig>>
  options?: Readonly<AxAIServiceOptions>
  models?: AxAIInputModelList<
    AxAIAnthropicModel | AxAIAnthropicVertexModel,
    undefined
  >
}

class AxAIAnthropicImpl
  implements
    AxAIServiceImpl<
      AxAIAnthropicModel | AxAIAnthropicVertexModel,
      unknown,
      AxAIAnthropicChatRequest,
      unknown,
      AxAIAnthropicChatResponse,
      AxAIAnthropicChatResponseDelta,
      unknown
    >
{
  private tokensUsed: AxTokenUsage | undefined
  private currentPromptConfig?: AxAIPromptConfig

  constructor(
    private config: AxAIAnthropicConfig,
    private isVertex: boolean
  ) {}

  getTokenUsage(): AxTokenUsage | undefined {
    return this.tokensUsed
  }

  getModelConfig(): AxModelConfig {
    const { config } = this
    return {
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      stream: config.stream,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      n: config.n,
    } as AxModelConfig
  }

  createChatReq = (
    req: Readonly<
      AxInternalChatRequest<AxAIAnthropicModel | AxAIAnthropicVertexModel>
    >,
    config: Readonly<AxAIPromptConfig>
  ): [AxAPI, AxAIAnthropicChatRequest] => {
    // Store config for use in response methods
    this.currentPromptConfig = config

    const model = req.model
    const stream = req.modelConfig?.stream ?? this.config.stream

    let apiConfig
    if (this.isVertex) {
      apiConfig = {
        name: stream
          ? `/models/${model}:streamRawPredict?alt=sse`
          : `/models/${model}:rawPredict`,
      }
    } else {
      apiConfig = {
        name: '/messages',
      }
    }

    let toolsChoice

    if (req.functionCall && req.functions && req.functions.length > 0) {
      if (typeof req.functionCall === 'string') {
        switch (req.functionCall) {
          case 'auto':
            toolsChoice = { tool_choice: { type: 'auto' as const } }
            break
          case 'required':
            toolsChoice = { tool_choice: { type: 'any' as const } }
            break
          case 'none':
            throw new Error('functionCall none not supported')
        }
      } else if ('function' in req.functionCall) {
        toolsChoice = {
          tool_choice: {
            type: 'tool' as const,
            name: req.functionCall.function.name,
          },
        }
      } else {
        throw new Error('Invalid function call type, must be string or object')
      }
    }

    const system = req.chatPrompt
      .filter((msg) => msg.role === 'system')
      .map((msg) => ({
        type: 'text' as const,
        text: msg.content,
        ...(msg.cache ? { cache: { type: 'ephemeral' } } : {}),
      }))

    const otherMessages = req.chatPrompt.filter((msg) => msg.role !== 'system')

    const messages = createMessages(otherMessages)

    const tools: AxAIAnthropicChatRequest['tools'] = req.functions?.map(
      (v) => ({
        name: v.name,
        description: v.description,
        input_schema: v.parameters,
      })
    )

    const maxTokens = req.modelConfig?.maxTokens ?? this.config.maxTokens
    const stopSequences =
      req.modelConfig?.stopSequences ?? this.config.stopSequences
    const temperature = req.modelConfig?.temperature ?? this.config.temperature
    const topP = req.modelConfig?.topP ?? this.config.topP
    const topK = req.modelConfig?.topK ?? this.config.topK
    const n = req.modelConfig?.n ?? this.config.n

    if (n && n > 1) {
      throw new Error('Anthropic does not support sampling (n > 1)')
    }

    // Handle thinking configuration
    let thinkingConfig: AxAIAnthropicThinkingConfig | undefined

    if (this.config.thinking?.budget_tokens) {
      thinkingConfig = this.config.thinking
    }

    // Override based on prompt-specific config
    if (config?.thinkingTokenBudget) {
      const levels = this.config.thinkingTokenBudgetLevels

      switch (config.thinkingTokenBudget) {
        case 'none':
          // When thinkingTokenBudget is 'none', disable thinking entirely
          thinkingConfig = undefined
          break
        case 'minimal':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.minimal ?? 1024,
          }
          break
        case 'low':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.low ?? 5000,
          }
          break
        case 'medium':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.medium ?? 10000,
          }
          break
        case 'high':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.high ?? 20000,
          }
          break
        case 'highest':
          thinkingConfig = {
            type: 'enabled',
            budget_tokens: levels?.highest ?? 32000,
          }
          break
      }
    }

    const reqValue: AxAIAnthropicChatRequest = {
      ...(this.isVertex
        ? { anthropic_version: 'vertex-2023-10-16' }
        : { model }),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(stopSequences && stopSequences.length > 0
        ? { stop_sequences: stopSequences }
        : {}),
      // Only include temperature when thinking is not enabled
      ...(temperature && !thinkingConfig ? { temperature } : {}),
      // Only include top_p when thinking is not enabled, or when it's >= 0.95
      ...(topP && (!thinkingConfig || topP >= 0.95) ? { top_p: topP } : {}),
      // Only include top_k when thinking is not enabled
      ...(topK && !thinkingConfig ? { top_k: topK } : {}),
      ...toolsChoice,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(stream ? { stream: true } : {}),
      ...(system ? { system } : {}),
      ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
      messages,
    }

    return [apiConfig, reqValue]
  }

  createChatResp = (
    resp: Readonly<AxAIAnthropicChatResponse | AxAIAnthropicChatError>
  ): AxChatResponse => {
    if (resp.type === 'error') {
      // Use AxAIRefusalError for authentication and API errors that could be refusal-related
      throw new AxAIRefusalError(
        resp.error.message,
        undefined, // model not specified in error response
        undefined // requestId not specified in error response
      )
    }

    const finishReason = mapFinishReason(resp.stop_reason)

    // Determine if thoughts should be shown
    const showThoughts =
      this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
      this.currentPromptConfig?.showThoughts !== false

    const results = resp.content
      .map((msg, index): AxChatResponseResult => {
        if (msg.type === 'tool_use') {
          return {
            index,
            id: msg.id,
            functionCalls: [
              {
                id: msg.id,
                type: 'function' as const,
                function: {
                  name: msg.name,
                  params: msg.input,
                },
              },
            ],
            finishReason,
          }
        }
        if (
          (msg.type === 'thinking' || msg.type === 'redacted_thinking') &&
          showThoughts
        ) {
          return {
            index,
            thought: msg.thinking,
            id: resp.id,
            finishReason,
          }
        }
        return {
          index,
          content: msg.type === 'text' ? msg.text : '',
          id: resp.id,
          finishReason,
        }
      })
      .filter(
        (result) =>
          result.content !== '' ||
          result.thought !== undefined ||
          result.functionCalls !== undefined
      )

    this.tokensUsed = {
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
    }

    return { results, remoteId: resp.id }
  }

  createChatStreamResp = (
    resp: Readonly<AxAIAnthropicChatResponseDelta>,
    state: object
  ): AxChatResponse => {
    if (!('type' in resp)) {
      throw new Error('Invalid Anthropic streaming event')
    }

    const sstate = state as {
      indexIdMap: Record<number, string>
    }

    if (!sstate.indexIdMap) {
      sstate.indexIdMap = {}
    }

    if (resp.type === 'error') {
      const { error } = resp as unknown as AxAIAnthropicErrorEvent
      throw new AxAIRefusalError(
        error.message,
        undefined, // model not specified in error event
        undefined // requestId not specified in error event
      )
    }

    const index = 0

    if (resp.type === 'message_start') {
      const { message } = resp as unknown as AxAIAnthropicMessageStartEvent
      const results = [{ index, content: '', id: message.id }]

      this.tokensUsed = {
        promptTokens: message.usage?.input_tokens ?? 0,
        completionTokens: message.usage?.output_tokens ?? 0,
        totalTokens:
          (message.usage?.input_tokens ?? 0) +
          (message.usage?.output_tokens ?? 0),
      }
      return { results }
    }

    if (resp.type === 'content_block_start') {
      const { content_block: contentBlock } =
        resp as unknown as AxAIAnthropicContentBlockStartEvent

      if (contentBlock.type === 'text') {
        return {
          results: [{ index, content: contentBlock.text }],
        }
      }
      if (contentBlock.type === 'thinking') {
        // Determine if thoughts should be shown
        const showThoughts =
          this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
          this.currentPromptConfig?.showThoughts !== false
        if (showThoughts) {
          return {
            results: [{ index, thought: contentBlock.thinking }],
          }
        }
        return {
          results: [{ index, content: '' }],
        }
      }
      if (contentBlock.type === 'tool_use') {
        if (
          typeof contentBlock.id === 'string' &&
          typeof resp.index === 'number' &&
          !sstate.indexIdMap[resp.index]
        ) {
          sstate.indexIdMap[resp.index] = contentBlock.id
          const functionCalls = [
            {
              id: contentBlock.id,
              type: 'function' as const,
              function: {
                name: contentBlock.name,
                params: '',
              },
            },
          ]
          return {
            results: [{ index, functionCalls }],
          }
        }
      }
    }

    if (resp.type === 'content_block_delta') {
      const { delta } = resp as unknown as AxAIAnthropicContentBlockDeltaEvent
      if (delta.type === 'text_delta') {
        return {
          results: [{ index, content: delta.text }],
        }
      }
      if (delta.type === 'thinking_delta') {
        // Determine if thoughts should be shown
        const showThoughts =
          this.currentPromptConfig?.thinkingTokenBudget !== 'none' &&
          this.currentPromptConfig?.showThoughts !== false
        if (showThoughts) {
          return {
            results: [{ index, thought: delta.thinking }],
          }
        }
        return {
          results: [{ index, content: '' }],
        }
      }
      if (delta.type === 'signature_delta') {
        // Signature deltas are handled internally by Anthropic,
        // we don't need to expose them in the response
        return {
          results: [{ index, content: '' }],
        }
      }
      if (delta.type === 'input_json_delta') {
        const id = sstate.indexIdMap[resp.index]
        if (!id) {
          throw new Error('invalid streaming index no id found: ' + resp.index)
        }
        const functionCalls = [
          {
            id,
            type: 'function' as const,
            function: {
              name: '',
              params: delta.partial_json,
            },
          },
        ]
        return {
          results: [{ index, functionCalls }],
        }
      }
    }

    if (resp.type === 'message_delta') {
      const { delta, usage } = resp as unknown as AxAIAnthropicMessageDeltaEvent

      this.tokensUsed = {
        promptTokens: 0,
        completionTokens: usage.output_tokens,
        totalTokens: usage.output_tokens,
      }

      const results = [
        {
          index,
          content: '',
          finishReason: mapFinishReason(delta.stop_reason),
        },
      ]
      return { results }
    }

    return {
      results: [{ index, content: '' }],
    }
  }
}

export class AxAIAnthropic extends AxBaseAI<
  AxAIAnthropicModel | AxAIAnthropicVertexModel,
  unknown,
  AxAIAnthropicChatRequest,
  unknown,
  AxAIAnthropicChatResponse,
  AxAIAnthropicChatResponseDelta,
  unknown
> {
  constructor({
    apiKey,
    projectId,
    region,
    config,
    options,
    models,
  }: Readonly<Omit<AxAIAnthropicArgs, 'name'>>) {
    const isVertex = projectId !== undefined && region !== undefined

    let apiURL
    let headers

    if (isVertex) {
      apiURL = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/anthropic/`
      if (apiKey) {
        headers = async () => ({ Authorization: `Bearer ${apiKey}` })
      } else {
        const vertexAuth = new GoogleVertexAuth()
        headers = async () => ({
          Authorization: `Bearer ${await vertexAuth.getAccessToken()}`,
        })
      }
    } else {
      if (!apiKey) {
        throw new Error('Anthropic API key not set')
      }
      apiURL = 'https://api.anthropic.com/v1'
      headers = async () => ({
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'x-api-key': apiKey,
      })
    }

    const _config = {
      ...axAIAnthropicDefaultConfig(),
      ...config,
    }

    const aiImpl = new AxAIAnthropicImpl(_config, isVertex)

    const supportFor = (
      model: AxAIAnthropicModel | AxAIAnthropicVertexModel
    ) => {
      const mi = getModelInfo<
        AxAIAnthropicModel | AxAIAnthropicVertexModel,
        undefined
      >({
        model,
        modelInfo: axModelInfoAnthropic,
        models,
      })
      return {
        functions: true,
        streaming: true,
        hasThinkingBudget: mi?.hasThinkingBudget ?? false,
        hasShowThoughts: mi?.hasShowThoughts ?? false,
        functionCot: true,
      }
    }

    super(aiImpl, {
      name: 'Anthropic',
      apiURL,
      headers,
      modelInfo: axModelInfoAnthropic,
      defaults: { model: _config.model },
      options,
      supportFor,
      models,
    })
  }
}

type AnthropicMsg = AxAIAnthropicChatRequest['messages'][0]
type AnthropicMsgRoleUser = Extract<AnthropicMsg, { role: 'user' }>
type AnthropicMsgRoleUserToolResult = Extract<
  AnthropicMsgRoleUser['content'][0],
  { type: 'tool_result' }
>

function createMessages(
  chatPrompt: Readonly<AxChatRequest['chatPrompt']>
): AxAIAnthropicChatRequest['messages'] {
  const items: AxAIAnthropicChatRequest['messages'] = chatPrompt.map((msg) => {
    switch (msg.role) {
      case 'function':
        const content: AnthropicMsgRoleUserToolResult[] = [
          {
            type: 'tool_result' as const,
            content: msg.result,
            tool_use_id: msg.functionId,
            ...(msg.isError ? { is_error: true } : {}),
            ...(msg.cache ? { cache: { type: 'ephemeral' } } : {}),
          },
        ]

        return {
          role: 'user' as const,
          content,
        }
      case 'user': {
        if (typeof msg.content === 'string') {
          return {
            role: 'user' as const,
            content: msg.content,
          }
        }
        const content = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return {
                type: 'text' as const,
                text: v.text,
                ...(v.cache ? { cache: { type: 'ephemeral' } } : {}),
              }
            case 'image':
              return {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: v.mimeType,
                  data: v.image,
                },
                ...(v.cache ? { cache: { type: 'ephemeral' } } : {}),
              }
            default:
              throw new Error('Invalid content type')
          }
        })
        return {
          role: 'user' as const,
          content,
        }
      }
      case 'assistant': {
        let content: Extract<
          AxAIAnthropicChatRequest['messages'][0],
          { role: 'assistant' }
        >['content'] = ''

        if (typeof msg.content === 'string') {
          content = msg.content
        }
        if (typeof msg.functionCalls !== 'undefined') {
          content = msg.functionCalls.map((v) => {
            let input
            if (typeof v.function.params === 'string') {
              input = JSON.parse(v.function.params)
            } else if (typeof v.function.params === 'object') {
              input = v.function.params
            }
            return {
              type: 'tool_use' as const,
              id: v.id,
              name: v.function.name,
              input,
              ...(msg.cache ? { cache: { type: 'ephemeral' } } : {}),
            }
          })
        }
        return {
          role: 'assistant' as const,
          content,
        }
      }
      default:
        throw new Error('Invalid role')
    }
  })

  return mergeAssistantMessages(items)
}

// Anthropic and some others need this in non-streaming mode
function mergeAssistantMessages(
  messages: Readonly<AxAIAnthropicChatRequest['messages']>
): AxAIAnthropicChatRequest['messages'] {
  const mergedMessages: AxAIAnthropicChatRequest['messages'] = []

  for (const [i, cur] of messages.entries()) {
    // Continue if not an assistant message or first message
    if (cur.role !== 'assistant') {
      mergedMessages.push(cur)
      continue
    }

    // Merge current message with the previous one if both are from the assistant
    if (i > 0 && messages.at(i - 1)?.role === 'assistant') {
      const lastMessage = mergedMessages.pop()

      mergedMessages.push({
        ...(lastMessage ? lastMessage : {}),
        ...cur,
      })
    } else {
      mergedMessages.push(cur)
    }
  }

  return mergedMessages
}

function mapFinishReason(
  stopReason?: AxAIAnthropicChatResponse['stop_reason'] | null
): AxChatResponse['results'][0]['finishReason'] | undefined {
  if (!stopReason) {
    return undefined
  }
  switch (stopReason) {
    case 'stop_sequence':
      return 'stop'
      break
    case 'max_tokens':
      return 'length'
      break
    case 'tool_use':
      return 'function_call'
      break
    case 'end_turn':
      return 'stop'
      break
    default:
      return 'stop'
  }
}
