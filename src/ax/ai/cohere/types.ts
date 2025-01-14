import type { AxModelConfig } from '../types.js'

/**
 * Cohere: Models for text generation
 */
export enum AxAICohereModel {
  CommandRPlus = 'command-r-plus',
  CommandR = 'command-r',
  Command = 'command',
  CommandLight = 'command-light',
}

/**
 * Cohere: Models for use in embeddings
 */
export enum AxAICohereEmbedModel {
  EmbedEnglishV30 = 'embed-english-v3.0',
  EmbedEnglishLightV30 = 'embed-english-light-v3.0',
  EmbedMultiLingualV30 = 'embed-multilingual-v3.0',
  EmbedMultiLingualLightV30 = 'embed-multilingual-light-v3.0',
}

/**
 * Cohere: Model options for text generation
 */
export type AxAICohereConfig = AxModelConfig & {
  model: AxAICohereModel
  embedModel?: AxAICohereEmbedModel
}

export type AxAICohereChatResponseToolCalls = {
  name: string
  parameters?: object
}[]

export type AxAICohereChatRequestToolResults = {
  call: AxAICohereChatResponseToolCalls[0]
  outputs: object[]
}[]

export type AxAICohereChatRequest = {
  message?: string
  preamble?: string
  chat_history: (
    | {
        role: 'CHATBOT'
        message: string
        tool_calls?: AxAICohereChatResponseToolCalls
      }
    | {
        role: 'SYSTEM'
        message: string
      }
    | {
        role: 'USER'
        message: string
      }
    | {
        role: 'TOOL'
        message?: string
        tool_results: AxAICohereChatRequestToolResults
      }
  )[]

  model: AxAICohereModel | string
  max_tokens?: number
  temperature?: number
  k?: number
  p?: number
  frequency_penalty?: number
  presence_penalty?: number
  end_sequences?: readonly string[]
  stop_sequences?: string[]
  tools?: {
    name: string
    description: string
    parameter_definitions: Record<
      string,
      {
        description: string
        type: string
        required: boolean
      }
    >
  }[]
  tool_results?: AxAICohereChatRequestToolResults
}

export type AxAICohereChatResponse = {
  response_id: string
  meta: {
    billed_units: {
      input_tokens: number
      output_tokens: number
    }
  }
  generation_id: string
  text: string
  finish_reason:
    | 'COMPLETE'
    | 'ERROR'
    | 'ERROR_TOXIC'
    | 'ERROR_LIMIT'
    | 'USER_CANCEL'
    | 'MAX_TOKENS'
  tool_calls: AxAICohereChatResponseToolCalls
}

export type AxAICohereChatResponseDelta = AxAICohereChatResponse & {
  event_type:
    | 'stream-start'
    | 'text-generation'
    | 'tool-calls-generation'
    | 'stream-end'
}

export type AxAICohereEmbedRequest = {
  texts: readonly string[]
  model: AxAICohereModel | string
  truncate: string
}

export type AxAICohereEmbedResponse = {
  id: string
  texts: string[]
  model: string
  embeddings: number[][]
}
