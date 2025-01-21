import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import type { AxAIMemory } from './types.js'

type Writeable<T> = { -readonly [P in keyof T]: T[P] }
type WriteableChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>

type MemoryData = {
  tags?: string[]
  chat: WriteableChatPrompt
}[]

const defaultLimit = 10000

export class MemoryImpl {
  private data: MemoryData = []

  constructor(private limit = defaultLimit) {
    if (limit <= 0) {
      throw Error("argument 'limit' must be greater than 0")
    }
  }

  add(
    value: Readonly<
      AxChatRequest['chatPrompt'][0] | AxChatRequest['chatPrompt']
    >
  ): void {
    if (Array.isArray(value)) {
      this.data.push(...value.map((chat) => ({ chat: structuredClone(chat) })))
    } else {
      this.data.push({
        chat: structuredClone(value) as WriteableChatPrompt,
      })
    }

    if (this.data.length > this.limit) {
      const removeCount = this.data.length - this.limit
      this.data.splice(0, removeCount)
    }
  }

  addResult({
    content,
    name,
    functionCalls,
  }: Readonly<AxChatResponseResult>): void {
    if (!content && (!functionCalls || functionCalls.length === 0)) {
      return
    }
    this.add({ content, name, role: 'assistant', functionCalls })
  }

  updateResult({
    content,
    name,
    functionCalls,
  }: Readonly<AxChatResponseResult>): void {
    const lastItem = this.data.at(-1)

    if (!lastItem || lastItem.chat.role !== 'assistant') {
      this.addResult({ content, name, functionCalls })
      return
    }

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

  getLast(): AxChatRequest['chatPrompt'][0] | undefined {
    const lastItem = this.data.at(-1)
    return lastItem?.chat
  }

  reset(): void {
    this.data = []
  }
}

export class AxMemory implements AxAIMemory {
  private memories = new Map<string, MemoryImpl>()
  private defaultMemory: MemoryImpl

  constructor(private limit = defaultLimit) {
    this.defaultMemory = new MemoryImpl(limit)
  }

  private getMemory(sessionId?: string): MemoryImpl {
    if (!sessionId) {
      return this.defaultMemory
    }

    if (!this.memories.has(sessionId)) {
      this.memories.set(sessionId, new MemoryImpl(this.limit))
    }

    return this.memories.get(sessionId)!
  }

  add(
    value: Readonly<
      AxChatRequest['chatPrompt'][0] | AxChatRequest['chatPrompt']
    >,
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

  addTag(name: string, sessionId?: string): void {
    this.getMemory(sessionId).addTag(name)
  }

  rewindToTag(name: string, sessionId?: string): AxChatRequest['chatPrompt'] {
    return this.getMemory(sessionId).rewindToTag(name)
  }

  history(sessionId?: string): AxChatRequest['chatPrompt'] {
    return this.getMemory(sessionId).history()
  }

  getLast(sessionId?: string): AxChatRequest['chatPrompt'][0] | undefined {
    return this.getMemory(sessionId).getLast()
  }

  reset(sessionId?: string): void {
    if (!sessionId) {
      this.defaultMemory.reset()
    } else {
      this.memories.set(sessionId, new MemoryImpl(this.limit))
    }
  }
}
