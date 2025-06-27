import { describe, expect, it } from 'vitest'

import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import { MemoryImpl } from './memory.js'

describe('MemoryImpl', () => {
  it('constructor should accept options object', () => {
    expect(() => new MemoryImpl()).not.toThrow()
    expect(() => new MemoryImpl({ debug: false })).not.toThrow()
    expect(
      () => new MemoryImpl({ debug: true, debugHideSystemPrompt: true })
    ).not.toThrow()
  })

  it('addRequest should store single chat message', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.addRequest([message], 0)

    const history = memory.history(0)
    expect(history.length).toBe(1)
    expect(history[0]).toEqual(message)
  })

  it('addRequest should store array of chat messages', () => {
    const memory = new MemoryImpl()
    const messages: AxChatRequest['chatPrompt'] = [
      {
        role: 'user',
        content: 'message 1',
      },
      {
        role: 'assistant',
        content: 'message 2',
        functionCalls: [],
      },
    ]

    memory.addRequest(messages, 0)

    // When adding an array, all messages get the same index
    const history = memory.history(0)
    expect(history.length).toBe(2)
    expect(history[0]).toEqual(messages[0])
    expect(history[1]).toEqual(messages[1])
  })

  it('addResponse should store assistant message', () => {
    const memory = new MemoryImpl()
    const result: AxChatResponseResult = {
      index: 0,
      content: 'test response',
      name: 'Claude',
      functionCalls: [],
    }

    memory.addResponse([result])

    const last = memory.getLast()
    if (!last || last.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    const chat = last.chat.find((c) => c.index === 0)
    const assistantValue = chat?.value as { content?: string; name?: string }
    expect(assistantValue?.content).toBe(result.content)
    expect(assistantValue?.name).toBe(result.name)
  })

  it('rewindToTag should remove and return items from tagged message onwards', () => {
    const memory = new MemoryImpl()

    // Add a few messages
    const message1 = {
      role: 'user' as const,
      content: 'first message',
    }
    const message2 = {
      role: 'assistant' as const,
      content: 'second message',
    }

    memory.addRequest([message1], 0)
    memory.addRequest([message2], 0)
    memory.addTag('checkpoint')

    const message3 = {
      role: 'user' as const,
      content: 'third message',
    }

    memory.addRequest([message3], 0)

    // Rewind to checkpoint tag
    const removed = memory.rewindToTag('checkpoint')

    // Check returned items - rewindToTag returns raw AxMemoryData structure
    expect(removed).toEqual([
      {
        role: 'assistant',
        chat: [
          { index: 0, value: { role: 'assistant', content: 'second message' } },
        ],
        tags: ['checkpoint'],
      },
      {
        role: 'user',
        chat: [{ index: 0, value: { role: 'user', content: 'third message' } }],
      },
    ])

    // Verify memory state
    expect(memory.history(0)).toEqual([
      { role: 'user', content: 'first message' },
    ])
  })

  it('removeByTag should remove all items with specified tag', () => {
    const memory = new MemoryImpl()

    // Add messages with and without tags
    memory.addRequest([{ role: 'user', content: 'first message' }], 0)
    memory.addRequest([{ role: 'assistant', content: 'second message' }], 0)
    memory.addTag('important')

    memory.addRequest([{ role: 'user', content: 'third message' }], 0)
    memory.addRequest([{ role: 'assistant', content: 'fourth message' }], 0)
    memory.addTag('important')

    // Remove items with 'important' tag
    const removed = memory.removeByTag('important')

    // Check removed items - removeByTag returns raw AxMemoryData structure
    expect(removed).toEqual([
      {
        role: 'assistant',
        chat: [
          { index: 0, value: { role: 'assistant', content: 'second message' } },
        ],
        tags: ['important'],
      },
      {
        role: 'assistant',
        chat: [
          { index: 0, value: { role: 'assistant', content: 'fourth message' } },
        ],
        tags: ['important'],
      },
    ])

    // Verify remaining items
    expect(memory.history(0)).toEqual([
      { role: 'user', content: 'first message' },
      { role: 'user', content: 'third message' },
    ])
  })

  it('removeByTag should throw for unknown tag', () => {
    const memory = new MemoryImpl()
    const message = {
      role: 'user' as const,
      content: 'test',
    }
    memory.addRequest([message], 0)

    expect(() => memory.removeByTag('unknown')).toThrow(
      'No items found with tag "unknown"'
    )
  })

  it('addResponse should handle empty results', () => {
    const memory = new MemoryImpl()
    const emptyResult: AxChatResponseResult = {
      index: 0,
      content: '',
      functionCalls: [],
    }

    memory.addResponse([emptyResult])

    expect(memory.history(0).length).toBe(1)
  })

  it('updateResult should modify last assistant message', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'initial response',
      name: 'Claude',
      functionCalls: [],
    }
    const update: AxChatResponseResult = {
      index: 0,
      content: 'updated response',
      name: 'Claude 2.0',
      functionCalls: [],
    }

    memory.addResponse([initial])
    memory.updateResult(update)

    const last = memory.getLast()
    if (!last || last.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    const chat = last.chat.find((c) => c.index === 0)
    expect((chat?.value as unknown as { content?: string })?.content).toBe(
      update.content
    )
    expect((chat?.value as unknown as { name?: string })?.name).toBe(
      update.name
    )
  })

  it('updateResult should add new message if last message is not assistant', () => {
    const memory = new MemoryImpl()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    const update: AxChatResponseResult = {
      index: 0,
      content: 'response',
      name: 'Claude',
      functionCalls: [],
    }

    memory.addRequest([userMessage], 0)

    // updateResult doesn't throw when last message is not assistant;
    // it creates a new assistant message instead
    memory.updateResult(update)

    const history = memory.history(0)
    expect(history.length).toBe(2) // user message + new assistant message
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'response',
      name: 'Claude',
      functionCalls: [],
    })
  })

  it('addTag should add tag to last message', () => {
    const memory = new MemoryImpl()
    const message1: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test1',
    }
    const message2: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test2',
    }

    memory.addRequest([message1], 0)
    memory.addTag('tag1')
    memory.addRequest([message2], 0)
    memory.addTag('tag2')

    expect(() => memory.rewindToTag('tag2')).not.toThrow()
    expect(() => memory.rewindToTag('tag1')).not.toThrow()
  })

  it('addTag should handle empty memory', () => {
    const memory = new MemoryImpl()

    expect(() => memory.addTag('tag')).not.toThrow()
    expect(memory.history(0).length).toBe(0)
  })

  it('rewindToTag should remove messages including and after tag', () => {
    const memory = new MemoryImpl()
    const message1: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'message 1',
    }
    const message2: AxChatRequest['chatPrompt'][0] = {
      role: 'system',
      content: 'message 2',
    }
    const message3: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'message 3',
    }

    memory.addRequest([message1], 0)
    memory.addRequest([message2], 0)
    memory.addTag('checkpoint')
    memory.addRequest([message3], 0)

    memory.rewindToTag('checkpoint')

    const history = memory.history(0)
    expect(history.length).toBe(1)
    expect(history[0]).toEqual(message1)
  })

  it('rewindToTag should throw for unknown tag', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    memory.addRequest([message], 0)

    expect(() => memory.rewindToTag('unknown')).toThrow(
      'Tag "unknown" not found'
    )
  })

  it('reset should clear all messages', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    memory.addRequest([message], 0)
    memory.addTag('tag')

    memory.reset()

    expect(memory.history(0).length).toBe(0)
    expect(() => memory.rewindToTag('tag')).toThrow('Tag "tag" not found')
  })

  it('getLast should return undefined for empty memory', () => {
    const memory = new MemoryImpl()
    expect(memory.getLast()).toBeUndefined()
  })

  it('getLast should return last message', () => {
    const memory = new MemoryImpl()
    const messages: AxChatRequest['chatPrompt'] = [
      { role: 'user', content: 'message 1' },
      { role: 'assistant', content: 'message 2', functionCalls: [] },
    ]

    memory.addRequest(messages, 0)

    const last = memory.getLast()
    // getLast returns raw AxMemoryData structure, not a flat message
    expect(last?.chat).toEqual([
      {
        index: 0,
        value: { role: 'assistant', content: 'message 2', functionCalls: [] },
      },
    ])
  })
})
