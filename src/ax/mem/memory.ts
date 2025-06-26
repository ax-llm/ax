import {
    logChatRequest,
    logChatRequestMessage,
    logResponseDelta,
    logResponseResult,
} from '../ai/debug.js'
import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import type { AxAIMemory, AxMemoryData } from './types.js'

const defaultLimit = 10000

export class MemoryImpl {
    private data: AxMemoryData = []

    constructor(
        private limit = defaultLimit,
        private options?: {
            debug?: boolean
            debugHideSystemPrompt?: boolean
        }
    ) {
        if (limit <= 0) {
            throw Error("argument 'limit' must be greater than 0")
        }
    }

    private addMemory(
        value: AxChatRequest['chatPrompt'][number] | AxChatRequest['chatPrompt']
    ): void {
        if (Array.isArray(value)) {
            this.data.push(...value.map(({ role, ...rest }, index) => ({
                role,
                chat: [{ index, value: structuredClone(rest) }]
            })))
        } else {
            const { role, ...rest } = value
            this.data.push({
                role,
                chat: [{ index: 0, value: structuredClone(rest) }],
            })
        }

        if (this.data.length > this.limit) {
            const removeCount = this.data.length - this.limit
            this.data.splice(0, removeCount)
        }
    }

    add(
        value: AxChatRequest['chatPrompt'][number] | AxChatRequest['chatPrompt']
    ): void {
        this.addMemory(value)

        if (this.options?.debug) {
            debugRequest(value, this.options?.debugHideSystemPrompt)
        }
    }

    private addResultMessages(results: Readonly<AxChatResponseResult[]>): void {
        const messages: AxChatRequest["chatPrompt"] = results.map((result) => {
            const isContentEmpty = typeof result.content === 'string' && result.content.trim() === ''

            if (isContentEmpty) {
                return {
                    name: result.name,
                    role: 'assistant',
                    functionCalls: result.functionCalls,
                    index: result.index
                }
            }

            return {
                role: 'assistant',
                content: result.content,
                name: result.name,
                functionCalls: result.functionCalls,
                index: result.index
            }
        })

        this.addMemory(messages)

        if (this.options?.debug) {
            for (const result of results) {
                debugResponse(result)
            }
        }
    }

    addResults(results: Readonly<AxChatResponseResult[]>): void {
        this.addResultMessages(results)
    }

    updateResult({
        content,
        name,
        functionCalls,
        delta,
        index,
    }: Readonly<AxChatResponseResult & { delta?: string, index: number }>): void {
        const lastItem = this.data.at(-1)

        const log = () => {
            if (this.options?.debug) {
                if (delta && typeof delta === 'string') {
                    debugResponseDelta(delta)
                } else if (!delta && (content || functionCalls)) {
                    debugResponse({ content, name, functionCalls, index })
                }
            }
        }

        if (!lastItem || lastItem.role !== 'assistant') {
            this.data.push({
                role: 'assistant',
                chat: [{ index, value: { content, name, functionCalls } }]
            })
            log()
            return
        }

        const chat = lastItem.chat.find((v) => v.index === index)

        if (!chat) {
            lastItem.chat.push({ index, value: { content, name, functionCalls } })
            log()
            return
        }

        if ('content' in chat.value && typeof content === 'string' && content.trim() !== '') {
            chat.value.content = content
        }

        if ('name' in chat.value && name && name.trim() !== '') {
            chat.value.name = name
        }

        if ('functionCalls' in chat.value && functionCalls && functionCalls.length > 0) {
            chat.value.functionCalls = functionCalls
        }

        log()
    }

    addTag(name: string): void {
        const lastItem = this.data.at(-1)
        if (!lastItem) {
            return
        }

        if (!lastItem.tags) {
            lastItem.tags = []
        }

        if (!lastItem.tags.includes(name)) {
            lastItem.tags.push(name)
        }
    }

    rewindToTag(name: string): AxMemoryData {
        const tagIndex = this.data.findIndex((item) => item.tags?.includes(name))
        if (tagIndex === -1) {
            throw new Error(`Tag "${name}" not found`)
        }

        // Remove and return the tagged item and everything after it
        return this.data.splice(tagIndex)
    }

    removeByTag(name: string): AxMemoryData {
        const indices = this.data.reduce<number[]>((acc, item, index) => {
            if (item.tags?.includes(name)) {
                acc.push(index)
            }
            return acc
        }, [])

        if (indices.length === 0) {
            throw new Error(`No items found with tag "${name}"`)
        }

        return indices
            .reverse()
            .map((index) => this.data.splice(index, 1).at(0))
            .filter((item) => item !== undefined)
            .reverse()
    }

    history(index: number): AxChatRequest['chatPrompt'] {
        const result: AxChatRequest['chatPrompt'] = []

        for (const { role, chat } of this.data) {
            const value = chat.find((v) => v.index === index)?.value
            if (value) {
                result.push({ role, ...value } as AxChatRequest['chatPrompt'][number])
            }
        }

        return result
    }

    getLast():
        | AxMemoryData[number]
        | undefined {
        return this.data.at(-1)
    }

    reset(): void {
        this.data = []
    }
}

export class AxMemory implements AxAIMemory {
    private memories = new Map<string, MemoryImpl>()
    private defaultMemory: MemoryImpl

    constructor(
        private limit = defaultLimit,
        private options?: {
            debug?: boolean
            debugHideSystemPrompt?: boolean
        }
    ) {
        this.defaultMemory = new MemoryImpl(limit, options)
    }

    private getMemory(sessionId?: string): MemoryImpl {
        if (!sessionId) {
            return this.defaultMemory
        }

        if (!this.memories.has(sessionId)) {
            this.memories.set(sessionId, new MemoryImpl(this.limit, this.options))
        }

        return this.memories.get(sessionId) as MemoryImpl
    }

    add(
        value: AxChatRequest['chatPrompt'],
        sessionId?: string
    ): void {
        this.getMemory(sessionId).add(value)
    }

    addResults(results: Readonly<AxChatResponseResult[]>, sessionId?: string): void {
        this.getMemory(sessionId).addResults(results)
    }

    updateResult(
        result: Readonly<AxChatResponseResult & { delta?: string }>,
        sessionId?: string
    ): void {
        this.getMemory(sessionId).updateResult(result)
    }

    addTag(name: string, sessionId?: string) {
        this.getMemory(sessionId).addTag(name)
    }

    rewindToTag(name: string, sessionId?: string) {
        return this.getMemory(sessionId).rewindToTag(name)
    }

    history(index: number, sessionId?: string) {
        return this.getMemory(sessionId).history(index)
    }

    getLast(sessionId?: string) {
        return this.getMemory(sessionId).getLast()
    }

    reset(sessionId?: string): void {
        if (!sessionId) {
            this.defaultMemory.reset()
        } else {
            this.memories.set(sessionId, new MemoryImpl(this.limit, this.options))
        }
    }
}

function debugRequest(
    value: AxChatRequest['chatPrompt'][number] | AxChatRequest['chatPrompt'],
    hideSystemPrompt?: boolean
) {
    if (Array.isArray(value)) {
        logChatRequest(value, hideSystemPrompt)
    } else {
        logChatRequestMessage(value, hideSystemPrompt)
    }
}

function debugResponse(value: Readonly<AxChatResponseResult & { index: number }>) {
    logResponseResult(value)
}

function debugResponseDelta(delta: string) {
    logResponseDelta(delta)
}
