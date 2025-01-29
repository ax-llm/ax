import type { AxAPI } from '../../util/apicall.js'
import {
  AxBaseAI,
  axBaseAIDefaultConfig,
  axBaseAIDefaultCreativeConfig,
} from '../base.js'
import { GoogleVertexAuth } from '../google-vertex/auth.js'
import type {
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedResponse,
  AxInternalChatRequest,
  AxInternalEmbedRequest,
  AxModelConfig,
  AxTokenUsage,
} from '../types.js'

import { axModelInfoGoogleGemini } from './info.js'
import {
  type AxAIGoogleGeminiBatchEmbedRequest,
  type AxAIGoogleGeminiBatchEmbedResponse,
  type AxAIGoogleGeminiChatRequest,
  type AxAIGoogleGeminiChatResponse,
  type AxAIGoogleGeminiChatResponseDelta,
  type AxAIGoogleGeminiConfig,
  AxAIGoogleGeminiEmbedModel,
  AxAIGoogleGeminiModel,
  AxAIGoogleGeminiSafetyCategory,
  type AxAIGoogleGeminiSafetySettings,
  AxAIGoogleGeminiSafetyThreshold,
  type AxAIGoogleVertexBatchEmbedRequest,
  type AxAIGoogleVertexBatchEmbedResponse,
} from './types.js'

const safetySettings: AxAIGoogleGeminiSafetySettings = [
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryHarassment,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryHateSpeech,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategorySexuallyExplicit,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
  {
    category: AxAIGoogleGeminiSafetyCategory.HarmCategoryDangerousContent,
    threshold: AxAIGoogleGeminiSafetyThreshold.BlockNone,
  },
]

/**
 * AxAIGoogleGemini: Default Model options for text generation
 */
export const axAIGoogleGeminiDefaultConfig = (): AxAIGoogleGeminiConfig =>
  structuredClone({
    model: AxAIGoogleGeminiModel.Gemini15Pro,
    embedModel: AxAIGoogleGeminiEmbedModel.TextEmbedding004,
    safetySettings,
    ...axBaseAIDefaultConfig(),
  })

export const axAIGoogleGeminiDefaultCreativeConfig =
  (): AxAIGoogleGeminiConfig =>
    structuredClone({
      model: AxAIGoogleGeminiModel.Gemini15Flash,
      embedModel: AxAIGoogleGeminiEmbedModel.TextEmbedding004,
      safetySettings,
      ...axBaseAIDefaultCreativeConfig(),
    })

export interface AxAIGoogleGeminiOptionsTools {
  codeExecution?: boolean
  googleSearchRetrieval?: {
    mode?: 'MODE_DYNAMIC'
    dynamicThreshold?: number
  }
}

export interface AxAIGoogleGeminiArgs {
  name: 'google-gemini'
  apiKey?: string
  projectId?: string
  region?: string
  config?: Readonly<Partial<AxAIGoogleGeminiConfig>>
  options?: Readonly<AxAIServiceOptions & AxAIGoogleGeminiOptionsTools>
  modelMap?: Record<
    string,
    AxAIGoogleGeminiModel | AxAIGoogleGeminiEmbedModel | string
  >
}

class AxAIGoogleGeminiImpl
  implements
    AxAIServiceImpl<
      AxAIGoogleGeminiChatRequest,
      AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
      AxAIGoogleGeminiChatResponse,
      AxAIGoogleGeminiChatResponseDelta,
      AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse
    >
{
  constructor(
    private config: AxAIGoogleGeminiConfig,
    private isVertex: boolean,
    private apiKey?: string,
    private options?: AxAIGoogleGeminiArgs['options']
  ) {}

  getModelConfig(): AxModelConfig {
    const { config } = this
    return {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
      topK: config.topK,
      presencePenalty: config.presencePenalty,
      frequencyPenalty: config.frequencyPenalty,
      stopSequences: config.stopSequences,
      endSequences: config.endSequences,
      stream: config.stream,
      n: config.n,
    } as AxModelConfig
  }

  createChatReq = (
    req: Readonly<AxInternalChatRequest>
  ): [AxAPI, AxAIGoogleGeminiChatRequest] => {
    const model = req.model
    const stream = req.modelConfig?.stream ?? this.config.stream

    if (!req.chatPrompt || req.chatPrompt.length === 0) {
      throw new Error('Chat prompt is empty')
    }

    const apiConfig = {
      name: stream
        ? `/models/${model}:streamGenerateContent?alt=sse`
        : `/models/${model}:generateContent`,
    }

    if (!this.isVertex) {
      const pf = stream ? '&' : '?'
      apiConfig.name += `${pf}key=${this.apiKey}`
    }

    const systemPrompts = req.chatPrompt
      .filter((p) => p.role === 'system')
      .map((p) => p.content)

    const systemInstruction =
      systemPrompts.length > 0
        ? {
            role: 'user' as const,
            parts: [{ text: systemPrompts.join(' ') }],
          }
        : undefined

    const contents: AxAIGoogleGeminiChatRequest['contents'] = req.chatPrompt
      .filter((p) => p.role !== 'system')
      .map((msg, i) => {
        switch (msg.role) {
          case 'user': {
            const parts: Extract<
              AxAIGoogleGeminiChatRequest['contents'][0],
              { role: 'user' }
            >['parts'] = Array.isArray(msg.content)
              ? msg.content.map((c, i) => {
                  switch (c.type) {
                    case 'text':
                      return { text: c.text }
                    case 'image':
                      return {
                        inlineData: { mimeType: c.mimeType, data: c.image },
                      }
                    default:
                      throw new Error(
                        `Chat prompt content type not supported (index: ${i})`
                      )
                  }
                })
              : [{ text: msg.content }]
            return {
              role: 'user' as const,
              parts,
            }
          }

          case 'assistant': {
            let parts: Extract<
              AxAIGoogleGeminiChatRequest['contents'][0],
              { role: 'model' }
            >['parts'] = []

            if (msg.functionCalls) {
              parts = msg.functionCalls.map((f) => {
                const args =
                  typeof f.function.params === 'string'
                    ? JSON.parse(f.function.params)
                    : f.function.params
                return {
                  functionCall: {
                    name: f.function.name,
                    args: args,
                  },
                }
              })

              if (!parts) {
                throw new Error('Function call is empty')
              }

              return {
                role: 'model' as const,
                parts,
              }
            }

            if (!msg.content) {
              throw new Error('Assistant content is empty')
            }

            parts = [{ text: msg.content }]
            return {
              role: 'model' as const,
              parts,
            }
          }

          case 'function': {
            if (!('functionId' in msg)) {
              throw new Error(`Chat prompt functionId is empty (index: ${i})`)
            }
            const parts: Extract<
              AxAIGoogleGeminiChatRequest['contents'][0],
              { role: 'function' }
            >['parts'] = [
              {
                functionResponse: {
                  name: msg.functionId,
                  response: { result: msg.result },
                },
              },
            ]

            return {
              role: 'function' as const,
              parts,
            }
          }

          default:
            throw new Error('Invalid role')
        }
      })

    let tools: AxAIGoogleGeminiChatRequest['tools'] | undefined = []

    if (req.functions && req.functions.length > 0) {
      tools.push({ function_declarations: req.functions })
    }

    if (this.options?.codeExecution) {
      tools.push({ code_execution: {} })
    }

    if (this.options?.googleSearchRetrieval) {
      tools.push({
        google_search_retrieval: {
          dynamic_retrieval_config: this.options.googleSearchRetrieval,
        },
      })
    }

    if (tools.length === 0) {
      tools = undefined
    }

    let toolConfig

    if (req.functionCall) {
      if (req.functionCall === 'none') {
        toolConfig = { function_calling_config: { mode: 'NONE' as const } }
      } else if (req.functionCall === 'auto') {
        toolConfig = { function_calling_config: { mode: 'AUTO' as const } }
      } else if (req.functionCall === 'required') {
        toolConfig = {
          function_calling_config: { mode: 'ANY' as const },
        }
      } else {
        const allowedFunctionNames = req.functionCall.function?.name
          ? {
              allowedFunctionNames: [req.functionCall.function.name],
            }
          : {}
        toolConfig = {
          function_calling_config: { mode: 'ANY' as const },
          ...allowedFunctionNames,
        }
      }
    } else if (tools && tools.length > 0) {
      toolConfig = { function_calling_config: { mode: 'AUTO' as const } }
    }

    const generationConfig = {
      maxOutputTokens: req.modelConfig?.maxTokens ?? this.config.maxTokens,
      temperature: req.modelConfig?.temperature ?? this.config.temperature,
      topP: req.modelConfig?.topP ?? this.config.topP,
      topK: req.modelConfig?.topK ?? this.config.topK,
      candidateCount: 1,
      stopSequences:
        req.modelConfig?.stopSequences ?? this.config.stopSequences,
    }

    const safetySettings = this.config.safetySettings

    const reqValue: AxAIGoogleGeminiChatRequest = {
      contents,
      tools,
      toolConfig,
      systemInstruction,
      generationConfig,
      safetySettings,
    }

    return [apiConfig, reqValue]
  }

  createEmbedReq = (
    req: Readonly<AxInternalEmbedRequest>
  ): [
    AxAPI,
    AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
  ] => {
    const model = req.embedModel

    if (!model) {
      throw new Error('Embed model not set')
    }

    if (!req.texts || req.texts.length === 0) {
      throw new Error('Embed texts is empty')
    }

    let apiConfig
    let reqValue:
      | AxAIGoogleGeminiBatchEmbedRequest
      | AxAIGoogleVertexBatchEmbedRequest

    if (this.isVertex) {
      apiConfig = {
        name: `/models/${model}:predict`,
      }

      reqValue = {
        instances: req.texts.map((text) => ({
          content: text,
        })),
      }
    } else {
      apiConfig = {
        name: `/models/${model}:batchEmbedContents?key=${this.apiKey}`,
      }

      reqValue = {
        requests: req.texts.map((text) => ({
          model: 'models/' + model,
          content: { parts: [{ text }] },
        })),
      }
    }

    return [apiConfig, reqValue]
  }

  createChatResp = (
    resp: Readonly<AxAIGoogleGeminiChatResponse>
  ): AxChatResponse => {
    const results: AxChatResponseResult[] = resp.candidates?.map(
      (candidate) => {
        const result: AxChatResponseResult = {}

        switch (candidate.finishReason) {
          case 'MAX_TOKENS':
            result.finishReason = 'length'
            break
          case 'STOP':
            result.finishReason = 'stop'
            break
          case 'SAFETY':
            throw new Error('Finish reason: SAFETY')
          case 'RECITATION':
            throw new Error('Finish reason: RECITATION')
          case 'MALFORMED_FUNCTION_CALL':
            throw new Error('Finish reason: MALFORMED_FUNCTION_CALL')
        }

        if (!candidate.content || !candidate.content.parts) {
          return result
        }

        for (const part of candidate.content.parts) {
          if ('text' in part) {
            result.content = part.text
            continue
          }
          if ('functionCall' in part) {
            result.functionCalls = [
              {
                id: part.functionCall.name,
                type: 'function',
                function: {
                  name: part.functionCall.name,
                  params: part.functionCall.args,
                },
              },
            ]
          }
        }
        return result
      }
    )

    let modelUsage: AxTokenUsage | undefined
    if (resp.usageMetadata) {
      modelUsage = {
        totalTokens: resp.usageMetadata.totalTokenCount,
        promptTokens: resp.usageMetadata.promptTokenCount,
        completionTokens: resp.usageMetadata.candidatesTokenCount,
      }
    }
    return {
      results,
      modelUsage,
    }
  }

  createChatStreamResp = (
    resp: Readonly<AxAIGoogleGeminiChatResponseDelta>
  ): AxChatResponse => {
    return this.createChatResp(resp)
  }

  createEmbedResp = (
    resp: Readonly<
      AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse
    >
  ): AxEmbedResponse => {
    let embeddings: number[][]
    if (this.isVertex) {
      embeddings = (resp as AxAIGoogleVertexBatchEmbedResponse).predictions.map(
        (prediction) => prediction.embeddings.values
      )
    } else {
      embeddings = (resp as AxAIGoogleGeminiBatchEmbedResponse).embeddings.map(
        (embedding) => embedding.values
      )
    }

    return {
      embeddings,
    }
  }
}

/**
 * AxAIGoogleGemini: AI Service
 */
export class AxAIGoogleGemini extends AxBaseAI<
  AxAIGoogleGeminiChatRequest,
  AxAIGoogleGeminiBatchEmbedRequest | AxAIGoogleVertexBatchEmbedRequest,
  AxAIGoogleGeminiChatResponse,
  AxAIGoogleGeminiChatResponseDelta,
  AxAIGoogleGeminiBatchEmbedResponse | AxAIGoogleVertexBatchEmbedResponse
> {
  constructor({
    apiKey,
    projectId,
    region,
    config,
    options,
    modelMap,
  }: Readonly<Omit<AxAIGoogleGeminiArgs, 'name'>>) {
    const isVertex = projectId !== undefined && region !== undefined

    let apiURL
    let headers

    if (isVertex) {
      apiURL = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/`
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
        throw new Error('GoogleGemini AI API key not set')
      }
      apiURL = 'https://generativelanguage.googleapis.com/v1beta'
      headers = async () => ({})
    }

    const _config = {
      ...axAIGoogleGeminiDefaultConfig(),
      ...config,
    }

    const aiImpl = new AxAIGoogleGeminiImpl(_config, isVertex, apiKey, options)

    super(aiImpl, {
      name: 'GoogleGeminiAI',
      apiURL,
      headers,
      modelInfo: axModelInfoGoogleGemini,
      models: {
        model: _config.model as AxAIGoogleGeminiModel,
        embedModel: _config.embedModel as AxAIGoogleGeminiEmbedModel,
      },
      options,
      supportFor: { functions: true, streaming: true },
      modelMap,
    })
  }
}
