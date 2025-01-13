import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
export type AxWritableChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>[]

export interface AxAIMemory {
  add(
    result: Readonly<
      AxChatRequest['chatPrompt'] | AxChatRequest['chatPrompt'][0]
    >,
    sessionId?: string
  ): void
  addResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void
  updateResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void

  history(sessionId?: string): AxChatRequest['chatPrompt']
  reset(sessionId?: string): void

  getLast(sessionId?: string): AxChatRequest['chatPrompt'][0] | undefined
}
