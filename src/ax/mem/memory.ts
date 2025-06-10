import {
  logChatRequest,
  logChatRequestMessage,
  logResponseDelta,
  logResponseResult,
} from '../ai/debug.js'
import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import type { AxAIMemory } from './types.js'

type MemoryData = {
  tags?: string[]
  chat: AxChatRequest['chatPrompt'][number]
}[]

const defaultLimit = 10000

export class MemoryImpl {
  private data: MemoryData = []

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
      this.data.push(...value.map((chat) => ({ chat: structuredClone(chat) })))
    } else {
      this.data.push({
        chat: structuredClone(value),
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

  private addResultMessage({
    content,
    name,
    functionCalls,
  }: Readonly<AxChatResponseResult>): void {
    if (!content && (!functionCalls || functionCalls.length === 0)) {
      return
    }
    this.addMemory({ content, name, role: 'assistant', functionCalls })
  }

  addResult({
    content,
    name,
    functionCalls,
  }: Readonly<AxChatResponseResult>): void {
    this.addResultMessage({ content, name, functionCalls })

    if (this.options?.debug) {
      debugResponse({ content, name, functionCalls })
    }
  }

  updateResult({
    content,
    name,
    functionCalls,
    delta,
  }: Readonly<AxChatResponseResult & { delta?: string }>): void {
    const lastItem = this.data.at(-1)

    if (!lastItem || lastItem.chat.role !== 'assistant') {
      this.addResultMessage({ content, name, functionCalls })
    } else {
      if ('content' in lastItem.chat && content) {
        lastItem.chat.content = content
      }
      if ('name' in lastItem.chat && name) {
        lastItem.chat.name = name
      }
      if ('functionCalls' in lastItem.chat && functionCalls) {
        lastItem.chat.functionCalls = functionCalls
      }
    }

    if (this.options?.debug) {
      if (delta && typeof delta === 'string') {
        debugResponseDelta(delta)
      } else if (!delta && (content || functionCalls)) {
        debugResponse({ content, name, functionCalls })
      }
    }
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

  rewindToTag(name: string): AxChatRequest['chatPrompt'] {
    const tagIndex = this.data.findIndex((item) => item.tags?.includes(name))
    if (tagIndex === -1) {
      throw new Error(`Tag "${name}" not found`)
    }

    // Remove and return the tagged item and everything after it
    const removedItems = this.data.splice(tagIndex)
    return removedItems.map((item) => item.chat)
  }

  removeByTag(name: string): AxChatRequest['chatPrompt'] {
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
      .map((index) => this.data.splice(index, 1).at(0)?.chat)
      .filter(Boolean)
      .reverse() as AxChatRequest['chatPrompt']
  }

  history(): AxChatRequest['chatPrompt'] {
    return this.data.map((item) => item.chat)
  }

  getLast():
    | { chat: AxChatRequest['chatPrompt'][number]; tags?: string[] }
    | undefined {
    const lastItem = this.data.at(-1)
    if (!lastItem) return undefined
    // Merge the tags into the chat object so that consumers can inspect them.
    return {
      chat: lastItem.chat,
      tags: lastItem.tags,
    }
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
    value: AxChatRequest['chatPrompt'][number] | AxChatRequest['chatPrompt'],
    sessionId?: string
  ): void {
    this.getMemory(sessionId).add(value)
  }

  addResult(result: Readonly<AxChatResponseResult>, sessionId?: string): void {
    this.getMemory(sessionId).addResult(result)
  }

  updateResult(
    result: Readonly<AxChatResponseResult>,
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

  history(sessionId?: string) {
    return this.getMemory(sessionId).history()
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

function debugResponse(value: Readonly<AxChatResponseResult>) {
  logResponseResult(value)
}

function debugResponseDelta(delta: string) {
  logResponseDelta(delta)
}
