import type { API } from '../../util/apicall.js'
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import type {
  AxAIServiceOptions,
  AxChatResponse,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
} from '../types.js'

import { axModelInfoOllama } from './info.js'
import {
  type AxAIOllamaChatRequest,
  type AxAIOllamaChatResponse,
  type AxAIOllamaChatResponseDelta,
  type AxAIOllamaConfig,
  AxAIOllamaEmbedModel,
  type AxAIOllamaEmbedRequest,
  type AxAIOllamaEmbedResponse,
  AxAIOllamaModel,
} from './types.js'

export const axAIOllamaDefaultConfig = (): AxAIOllamaConfig => ({
  model: AxAIOllamaModel.Codellama,
  embedModel: AxAIOllamaEmbedModel.Codellama,
  ...axBaseAIDefaultConfig(),
})

export const axAIOllamaDefaultCreativeConfig = (): AxAIOllamaConfig => ({
  model: AxAIOllamaModel.Codellama,
  embedModel: AxAIOllamaEmbedModel.Codellama,
  ...axBaseAIDefaultCreativeConfig(),
})

export interface AxAIOllamaArgs {
  name: 'ollama'
  url?: string
  config?: Readonly<Partial<AxAIOllamaConfig>>
  options?: Readonly<AxAIServiceOptions>
  modelMap?: Record<string, AxAIOllamaModel | AxAIOllamaEmbedModel | string>
}

export class AxAIOllama extends AxBaseAI<
  AxAIOllamaChatRequest,
  AxAIOllamaEmbedRequest,
  AxAIOllamaChatResponse,
  AxAIOllamaChatResponseDelta,
  AxAIOllamaEmbedResponse
> {
  private config: AxAIOllamaConfig

  constructor({
    url,
    config,
    options,
    modelMap,
  }: Readonly<Omit<AxAIOllamaArgs, 'name'>>) {
    const _config = {
      ...axAIOllamaDefaultConfig(),
      ...config,
    }

    super({
      name: 'Ollama',
      apiURL: new URL('/api', url || 'http://localhost:11434').href,
      headers: {},
      modelInfo: axModelInfoOllama,
      models: {
        model: _config.model,
        embedModel: _config.embedModel,
      },
      options,
      supportFor: { functions: false, streaming: true },
      modelMap,
    })

    this.config = _config
  }

  override getModelConfig(): AxModelConfig {
    return {
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      topP: this.config.topP,
      topK: this.config.topK,
    }
  }

  override generateChatReq = (
    req: Readonly<AxInternalChatRequest>
  ): [API, AxAIOllamaChatRequest] => {
    const model = req.model

    const messages = req.chatPrompt.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))

    const apiConfig: API = {
      name: '/chat',
    }

    const reqBody: AxAIOllamaChatRequest = {
      model,
      messages,
      stream: true,
      options: {
        temperature: req.modelConfig?.temperature ?? this.config.temperature,
        top_p: req.modelConfig?.topP ?? this.config.topP,
        top_k: req.modelConfig?.topK ?? this.config.topK,
        num_predict: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      },
    }

    return [apiConfig, reqBody]
  }

  override generateChatResp = (
    resp: Readonly<AxAIOllamaChatResponse>
  ): AxChatResponse => {
    return {
      results: [
        {
          content: resp.message?.content || '',
          finishReason: resp.done_reason || 'stop',
        },
      ],
      modelUsage: resp.total_duration
        ? {
            totalTokens: resp.prompt_eval_count + resp.eval_count,
            promptTokens: resp.prompt_eval_count,
            completionTokens: resp.eval_count,
          }
        : undefined,
    }
  }

  override generateChatStreamResp = (
    resp: Readonly<AxAIOllamaChatResponseDelta>,
    state: Readonly<{ fullContent: string }>
  ): AxChatResponse => {
    state.fullContent += resp.message?.content || ''

    if (resp.done) {
      return {
        results: [
          {
            content: state.fullContent,
            finishReason: resp.done_reason || 'stop',
          },
        ],
        modelUsage: resp.total_duration
          ? {
              totalTokens: resp.prompt_eval_count + resp.eval_count,
              promptTokens: resp.prompt_eval_count,
              completionTokens: resp.eval_count,
            }
          : undefined,
      }
    }

    return {
      results: [
        {
          content: resp.message?.content || '',
        },
      ],
    }
  }

  override generateEmbedReq = (
    req: Readonly<AxInternalEmbedRequest>
  ): [API, AxAIOllamaEmbedRequest] => {
    const model = req.embedModel

    if (!model) {
      throw new Error('Embed model not set')
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty')
    }

    const apiConfig: API = {
      name: '/embeddings',
    }

    const reqBody: AxAIOllamaEmbedRequest = {
      model,
      prompt: Array.isArray(req.texts) ? req.texts.join(' ') : req.texts,
    }

    return [apiConfig, reqBody]
  }

  override generateEmbedResp = (
    resp: Readonly<AxAIOllamaEmbedResponse>
  ): AxEmbedResponse => {
    return {
      embeddings: [resp.embedding],
      modelUsage: { totalTokens: resp.token_count },
    }
  }
}
