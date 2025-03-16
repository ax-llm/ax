import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

export interface AxAIMemory {
  add(
    result:
      | Readonly<AxChatRequest['chatPrompt']>
      | Readonly<AxChatRequest['chatPrompt'][number]>,
    sessionId?: string
  ): void
  addResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void
  updateResult(
    result: Readonly<AxChatResponseResult> & {
      delta?: string
    },
    sessionId?: string
  ): void

  history(sessionId?: string): AxChatRequest['chatPrompt']
  reset(sessionId?: string): void

  getLast(
    sessionId?: string
  ): { chat: AxChatRequest['chatPrompt'][number]; tags?: string[] } | undefined

  addTag(name: string, sessionId?: string): void
  rewindToTag(name: string, sessionId?: string): AxChatRequest['chatPrompt']
}
