import type { AxModelConfig } from '../types.js'

export enum AxAIRekaModel {
  RekaCore = 'reka-core',
  RekaFlash = 'reka-flash',
  RekaEdge = 'reka-edge',
}

export type AxAIRekaConfig = Omit<AxModelConfig, 'topK'> & {
  model: AxAIRekaModel
  stop?: readonly string[]
  useSearchEngine?: boolean
}

export type AxAIRekaUsage = {
  input_tokens: number
  output_tokens: number
}

export type AxAIRekaChatRequest = {
  model: string
  messages: (
    | {
        role: 'user'
        content:
          | string
          | {
              type: 'text'
              text: string
            }[]
      }
    | {
        role: 'assistant'
        content:
          | string
          | {
              type: 'text'
              text: string
            }[]
      }
  )[]
  usage?: AxAIRekaUsage
  response_format?: { type: string }
  max_tokens: number
  temperature?: number
  top_p?: number
  top_k?: number
  stream?: boolean
  stop?: readonly string[]
  presence_penalty?: number
  frequency_penalty?: number
  use_search_engine?: boolean
}

export type AxAIRekaChatResponse = {
  id: string
  model: string
  responses: {
    message: {
      content:
        | string
        | {
            type: 'text'
            text: string
          }
    }
    finish_reason: 'stop' | 'length' | 'context'
  }[]
  usage?: AxAIRekaUsage
}

export type AxAIRekaChatResponseDelta = {
  id: string
  model: string
  responses: {
    chunk: AxAIRekaChatResponse['responses'][0]['message']
    finish_reason: AxAIRekaChatResponse['responses'][0]['finish_reason']
  }[]
  usage?: AxAIRekaUsage
}
