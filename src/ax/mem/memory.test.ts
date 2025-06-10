import { describe, expect, it } from 'vitest'

import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import { MemoryImpl } from './memory.js'

describe('MemoryImpl', () => {
  it('constructor should enforce positive limit', () => {
    expect(() => new MemoryImpl(0)).toThrow(
      "argument 'limit' must be greater than 0"
    )
    expect(() => new MemoryImpl(-1)).toThrow(
      "argument 'limit' must be greater than 0"
    )
  })

  it('add should store single chat message', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.add(message)

    const history = memory.history()
    expect(history.length).toBe(1)
    expect(history[0]).toEqual(message)
  })

  it('add should store array of chat messages', () => {
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

    memory.add(messages)

    const history = memory.history()
    expect(history.length).toBe(2)
    expect(history).toEqual(messages)
  })

  it('add should respect memory limit', () => {
    const memory = new MemoryImpl(2)
    const messages: AxChatRequest['chatPrompt'] = [
      { role: 'system', content: 'message 1' },
      { role: 'user', content: 'message 2' },
      { role: 'system', content: 'message 3' },
    ]

    memory.add(messages)

    const history = memory.history()
    expect(history.length).toBe(2)
    expect(history).toEqual(messages.slice(-2))
  })

  it('addResult should store assistant message', () => {
    const memory = new MemoryImpl()
    const result: AxChatResponseResult = {
      content: 'test response',
      name: 'Claude',
      functionCalls: [],
    }

    memory.addResult(result)

    const last = memory.getLast()
    if (!last || last.chat.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    expect(last.chat.content).toBe(result.content)
    expect(last.chat.name).toBe(result.name)
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

    memory.add(message1)
    memory.add(message2)
    memory.addTag('checkpoint')

    const message3 = {
      role: 'user' as const,
      content: 'third message',
    }

    memory.add(message3)

    // Rewind to checkpoint tag
    const removed = memory.rewindToTag('checkpoint')

    // Check returned items
    expect(removed).toEqual([
      { role: 'assistant', content: 'second message' },
      { role: 'user', content: 'third message' },
    ])

    // Verify memory state
    expect(memory.history()).toEqual([
      { role: 'user', content: 'first message' },
    ])
  })

  it('removeByTag should remove all items with specified tag', () => {
    const memory = new MemoryImpl()

    // Add messages with and without tags
    memory.add({ role: 'user', content: 'first message' })
    memory.add({ role: 'assistant', content: 'second message' })
    memory.addTag('important')

    memory.add({ role: 'user', content: 'third message' })
    memory.add({ role: 'assistant', content: 'fourth message' })
    memory.addTag('important')

    // Remove items with 'important' tag
    const removed = memory.removeByTag('important')

    // Check removed items
    expect(removed).toEqual([
      { role: 'assistant', content: 'second message' },
      { role: 'assistant', content: 'fourth message' },
    ])

    // Verify remaining items
    expect(memory.history()).toEqual([
      { role: 'user', content: 'first message' },
      { role: 'user', content: 'third message' },
    ])
  })

  it('removeTaggedItems should throw for unknown tag', () => {
    const memory = new MemoryImpl()
    const message = {
      role: 'user' as const,
      content: 'test',
    }
    memory.add(message)

    expect(() => memory.removeByTag('unknown')).toThrow(
      'No items found with tag "unknown"'
    )
  })

  it('addResult should ignore empty results', () => {
    const memory = new MemoryImpl()
    const emptyResult: AxChatResponseResult = {
      content: '',
      functionCalls: [],
    }

    memory.addResult(emptyResult)

    expect(memory.history().length).toBe(0)
  })

  it('updateResult should modify last assistant message', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      content: 'initial response',
      name: 'Claude',
      functionCalls: [],
    }
    const update: AxChatResponseResult = {
      content: 'updated response',
      name: 'Claude 2.0',
      functionCalls: [],
    }

    memory.addResult(initial)
    memory.updateResult(update)

    const last = memory.getLast()
    if (!last || last.chat.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    expect(last.chat.content).toBe(update.content)
    expect(last.chat.name).toBe(update.name)
  })

  it('updateResult should add new message if last message is not assistant', () => {
    const memory = new MemoryImpl()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    const update: AxChatResponseResult = {
      content: 'response',
      name: 'Claude',
      functionCalls: [],
    }

    memory.add(userMessage)
    memory.updateResult(update)

    const history = memory.history()
    expect(history.length).toBe(2)
    expect(history[0]).toEqual(userMessage)

    const lastMessage = history[1]
    if (!lastMessage || lastMessage.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    expect(lastMessage.content).toBe(update.content)
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

    memory.add(message1)
    memory.addTag('tag1')
    memory.add(message2)
    memory.addTag('tag2')

    expect(() => memory.rewindToTag('tag2')).not.toThrow()
    expect(() => memory.rewindToTag('tag1')).not.toThrow()
  })

  it('addTag should handle empty memory', () => {
    const memory = new MemoryImpl()

    expect(() => memory.addTag('tag')).not.toThrow()
    expect(memory.history().length).toBe(0)
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

    memory.add(message1)
    memory.add(message2)
    memory.addTag('checkpoint')
    memory.add(message3)

    memory.rewindToTag('checkpoint')

    const history = memory.history()
    expect(history.length).toBe(1)
    expect(history[0]).toEqual(message1)
  })

  it('rewindToTag should throw for unknown tag', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    memory.add(message)

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
    memory.add(message)
    memory.addTag('tag')

    memory.reset()

    expect(memory.history().length).toBe(0)
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

    memory.add(messages)

    const last = memory.getLast()
    expect(last?.chat).toEqual(messages[1])
  })

  it('updateResult should not duplicate logging for streaming function calls', () => {
    const loggedMessages: string[] = []
    const mockLogger = (message: string) => {
      loggedMessages.push(message)
    }

    const memory = new MemoryImpl(10, { debug: true })
    // Override the default logger for testing
    const originalWrite = process.stdout.write
    process.stdout.write = mockLogger as typeof process.stdout.write

    try {
      // Add initial assistant message
      memory.addResult({
        content: '',
        functionCalls: [],
      })

      // Clear logged messages from addResult
      loggedMessages.length = 0

      // Simulate streaming function call with delta
      memory.updateResult({
        content: '',
        functionCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'getCurrentWeather',
              params: '{"location":"San Francisco","units":"imperial"}',
            },
          },
        ],
        delta: '{"location":"San Francisco","units":"imperial"}',
      })

      // Should only log the delta, not the complete function call
      expect(loggedMessages).toHaveLength(1)
      expect(loggedMessages[0]).toContain(
        '{"location":"San Francisco","units":"imperial"}'
      )
      // Should be green (responseContent color) since it's a delta
      expect(loggedMessages[0]).toContain('\x1B[92m')

      // Reset logged messages
      loggedMessages.length = 0

      // Simulate final update without delta (function call complete)
      memory.updateResult({
        content: '',
        functionCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'getCurrentWeather',
              params: '{"location":"San Francisco","units":"imperial"}',
            },
          },
        ],
      })

      // Should log the complete function call (function name + parameters + end marker = 3 messages)
      expect(loggedMessages).toHaveLength(3)
      expect(loggedMessages[0]).toContain('[1] getCurrentWeather') // Function name with index
      expect(loggedMessages[1]).toContain(
        '{"location":"San Francisco","units":"imperial"}'
      )
      expect(loggedMessages[2]).toBe('\n') // functionEnd marker with newline
      // Function name should be white bright, args should be blue
      expect(loggedMessages[0]).toContain('\x1B[97m') // whiteBright
      expect(loggedMessages[1]).toContain('\x1B[94m') // blueBright
    } finally {
      // Restore original stdout.write
      process.stdout.write = originalWrite
    }
  })
})
