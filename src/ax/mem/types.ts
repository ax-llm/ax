import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

export type AxMemoryData = {
    tags?: string[]
    role: AxChatRequest['chatPrompt'][number]['role']
    chat: { index: number, value: Omit<AxChatRequest['chatPrompt'][number], 'role'> }[]
}[]

export interface AxAIMemory {
    add(
        result: Readonly<AxChatRequest['chatPrompt']>,
        sessionId?: string
    ): void
    addResults(
        results: Readonly<AxChatResponseResult[]>,
        sessionId?: string
    ): void
    updateResult(
        results: Readonly<AxChatResponseResult> & { delta?: string },
        sessionId?: string,
    ): void

    history(index: number, sessionId?: string): AxChatRequest['chatPrompt']
    reset(sessionId?: string): void

    getLast(
        sessionId?: string,
    ): AxMemoryData[number] | undefined

    addTag(name: string, sessionId?: string): void
    rewindToTag(name: string, sessionId?: string): AxMemoryData
}
