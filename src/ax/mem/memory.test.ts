import { describe, expect, it } from 'vitest'

import type {
  AxChatRequest,
  AxChatResponseResult,
  AxFunctionResult,
} from '../ai/types.js'

import { AxMemory, MemoryImpl } from './memory.js'

describe('MemoryImpl', () => {
  it('constructor should accept options object', () => {
    expect(() => new MemoryImpl()).not.toThrow()
    expect(() => new MemoryImpl({ debug: false })).not.toThrow()
    expect(
      () => new MemoryImpl({ debug: false, debugHideSystemPrompt: true })
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

  // New tests for missing coverage
  it('addFunctionResults should append to existing function message', () => {
    const memory = new MemoryImpl()
    // First add a non-function message to set up the condition
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    memory.addRequest([userMessage], 0)

    // Add first function result - this creates a new function entry
    const functionResults1: AxFunctionResult[] = [
      { index: 0, role: 'function', result: 'result1', functionId: 'func1' },
    ]
    memory.addFunctionResults(functionResults1)

    // Add second function result - this should append to existing function entry
    const functionResults2: AxFunctionResult[] = [
      { index: 0, role: 'function', result: 'result2', functionId: 'func2' },
    ]
    memory.addFunctionResults(functionResults2)

    const last = memory.getLast()
    expect(last?.role).toBe('function')
    expect(last?.chat).toHaveLength(2)
    expect(last?.chat[0]!.value).toEqual({
      role: 'function',
      result: 'result1',
      functionId: 'func1',
    })
    expect(last?.chat[1]!.value).toEqual({
      role: 'function',
      result: 'result2',
      functionId: 'func2',
    })
  })

  it('addFunctionResults should create new function entry when last message is not function', () => {
    const memory = new MemoryImpl()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }
    const functionResults: AxFunctionResult[] = [
      { index: 0, role: 'function', result: 'result1', functionId: 'func1' },
    ]

    memory.addRequest([userMessage], 0)
    memory.addFunctionResults(functionResults)

    const history = memory.history(0)
    expect(history).toHaveLength(2)
    expect(history[1]).toEqual({
      role: 'function',
      result: 'result1',
      functionId: 'func1',
    })
  })

  it('updateResult should add new chat entry when index does not exist', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'initial response',
      functionCalls: [],
    }
    const newIndexUpdate: AxChatResponseResult = {
      index: 1,
      content: 'new index response',
      functionCalls: [],
    }

    memory.addResponse([initial])
    memory.updateResult(newIndexUpdate)

    // Since addResponse creates non-updatable assistant messages,
    // updateResult creates a new assistant message instead of updating the existing one
    const history = memory.history(0)
    const historyIndex1 = memory.history(1)

    // Original message should still exist at index 0
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'initial response',
      functionCalls: [],
    })

    // New message should exist at index 1
    expect(historyIndex1).toHaveLength(1)
    expect(historyIndex1[0]).toEqual({
      role: 'assistant',
      content: 'new index response',
      name: undefined,
      functionCalls: [],
    })
  })

  it('updateResult should not update content when empty or whitespace', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'initial content',
      functionCalls: [],
    }

    memory.addResponse([initial])
    // Since addResponse creates non-updatable messages, updateResult will create new messages
    memory.updateResult({ index: 0, content: '', functionCalls: [] })
    memory.updateResult({ index: 0, content: '   ', functionCalls: [] })

    // First updateResult creates new assistant message, second one updates the updatable message
    const history = memory.history(0)
    expect(history).toHaveLength(2)

    // Original message from addResponse should remain unchanged
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'initial content',
      functionCalls: [],
    })

    // Second message should keep the content from the first updateResult since '   '.trim() === ''
    expect(history[1]).toEqual({
      role: 'assistant',
      content: '', // This remains unchanged because '   '.trim() === '' so no update occurs
      name: undefined,
      functionCalls: [],
    })
  })

  it('updateResult should not update name when empty or whitespace', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'test',
      name: 'Initial Name',
      functionCalls: [],
    }

    memory.addResponse([initial])
    // Since addResponse creates non-updatable messages, updateResult will create new messages
    memory.updateResult({
      index: 0,
      content: 'test',
      name: '',
      functionCalls: [],
    })
    memory.updateResult({
      index: 0,
      content: 'test',
      name: '   ',
      functionCalls: [],
    })

    // First updateResult creates new assistant message, second one updates it
    const history = memory.history(0)
    expect(history).toHaveLength(2)

    // Original message from addResponse should remain unchanged
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'test',
      name: 'Initial Name',
      functionCalls: [],
    })

    // Second message should have empty name from the first call (second call doesn't update empty/whitespace names)
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'test',
      name: '', // First updateResult set this, second one doesn't change it because '   ' is whitespace
      functionCalls: [],
    })
  })

  it('updateResult should not update functionCalls when empty array', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'test',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    }

    memory.addResponse([initial])
    // Since addResponse creates non-updatable messages, updateResult will create new messages
    memory.updateResult({ index: 0, content: 'test', functionCalls: [] })

    // updateResult creates a new assistant message
    const history = memory.history(0)
    expect(history).toHaveLength(2)

    // Original message from addResponse should remain unchanged
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'test',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    })

    // New message should have empty functionCalls since it doesn't get updated when empty
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'test',
      name: undefined,
      functionCalls: [],
    })
  })

  it('updateResult should handle missing chat value properties', () => {
    const memory = new MemoryImpl()
    const initial: AxChatResponseResult = {
      index: 0,
      content: 'test',
      functionCalls: [],
    }

    memory.addResponse([initial])

    // Since addResponse creates non-updatable messages, updateResult creates a new message
    // Try to update name when it doesn't exist in chat.value
    memory.updateResult({ index: 0, name: 'New Name', functionCalls: [] })

    // Should create a new updatable assistant message with all properties including name
    const history = memory.history(0)
    expect(history).toHaveLength(2) // Original + new message
    expect(history[1]).toEqual({
      role: 'assistant',
      content: undefined,
      name: 'New Name',
      functionCalls: [],
    })
  })

  it('addTag should not add duplicate tags', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.addRequest([message], 0)
    memory.addTag('duplicate')
    memory.addTag('duplicate')
    memory.addTag('different')

    const last = memory.getLast()
    expect(last?.tags).toEqual(['duplicate', 'different'])
  })

  it('addTag should work when tags array already exists', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.addRequest([message], 0)
    memory.addTag('first')
    memory.addTag('second')

    const last = memory.getLast()
    expect(last?.tags).toEqual(['first', 'second'])
  })

  it('history should handle function role messages correctly', () => {
    const memory = new MemoryImpl()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    const functionResults: AxFunctionResult[] = [
      { index: 0, role: 'function', result: 'result1', functionId: 'func1' },
      { index: 0, role: 'function', result: 'result2', functionId: 'func2' },
    ]

    memory.addRequest([userMessage], 0)
    memory.addFunctionResults(functionResults)

    const history = memory.history(0)
    expect(history).toHaveLength(3)
    expect(history[1]).toEqual({
      role: 'function',
      result: 'result1',
      functionId: 'func1',
    })
    expect(history[2]).toEqual({
      role: 'function',
      result: 'result2',
      functionId: 'func2',
    })
  })

  it('history should return empty when no matching index found', () => {
    const memory = new MemoryImpl()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.addRequest([message], 0)

    const history = memory.history(999) // Non-existent index
    expect(history).toEqual([])
  })

  it('history should handle different index filtering for function vs non-function roles', () => {
    const memory = new MemoryImpl()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    const functionResults: AxFunctionResult[] = [
      { index: 0, role: 'function', result: 'result1', functionId: 'func1' },
      { index: 1, role: 'function', result: 'result2', functionId: 'func2' },
    ]

    memory.addRequest([userMessage], 0)
    memory.addFunctionResults(functionResults)

    // Index 0 should get user message + func1
    const history0 = memory.history(0)
    expect(history0).toHaveLength(2)
    expect(history0[0]!.role).toBe('user')
    expect(history0[1]).toEqual({
      role: 'function',
      result: 'result1',
      functionId: 'func1',
    })

    // Index 1 should get only func2
    const history1 = memory.history(1)
    expect(history1).toHaveLength(1)
    expect(history1[0]).toEqual({
      role: 'function',
      result: 'result2',
      functionId: 'func2',
    })
  })

  it('updateResult should create updatable messages that can be modified', () => {
    const memory = new MemoryImpl()

    // First updateResult creates an updatable message
    memory.updateResult({
      index: 0,
      content: 'initial content',
      name: 'Initial Name',
      functionCalls: [],
    })

    // Second updateResult should modify the existing updatable message
    memory.updateResult({
      index: 0,
      content: 'updated content',
      name: 'Updated Name',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    })

    const history = memory.history(0)
    expect(history).toHaveLength(1) // Should still be just one message
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'updated content',
      name: 'Updated Name',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    })
  })

  it('updateResult should not modify content/name/functionCalls when values are empty', () => {
    const memory = new MemoryImpl()

    // Create initial updatable message
    memory.updateResult({
      index: 0,
      content: 'initial content',
      name: 'Initial Name',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    })

    // Try to update with empty/whitespace values - should not change anything
    memory.updateResult({
      index: 0,
      content: '',
      name: '   ',
      functionCalls: [],
    })

    const history = memory.history(0)
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual({
      role: 'assistant',
      content: 'initial content',
      name: 'Initial Name',
      functionCalls: [
        {
          id: 'func1',
          type: 'function',
          function: { name: 'test', params: {} },
        },
      ],
    })
  })

  it('updateResult should add new chat entry to updatable message when index does not exist', () => {
    const memory = new MemoryImpl()

    // Create initial updatable message with index 0
    memory.updateResult({
      index: 0,
      content: 'index 0 content',
      functionCalls: [],
    })

    // Add new chat entry with index 1 to the same updatable message
    memory.updateResult({
      index: 1,
      content: 'index 1 content',
      name: 'Assistant',
      functionCalls: [],
    })

    const last = memory.getLast()
    if (!last || last.role !== 'assistant') {
      throw new Error('Last message is not a valid assistant message')
    }
    expect(last.chat).toHaveLength(2)
    expect(last.updatable).toBe(true)

    const history0 = memory.history(0)
    const history1 = memory.history(1)

    expect(history0).toHaveLength(1)
    expect(history0[0]).toEqual({
      role: 'assistant',
      content: 'index 0 content',
      name: undefined,
      functionCalls: [],
    })

    expect(history1).toHaveLength(1)
    expect(history1[0]).toEqual({
      role: 'assistant',
      content: 'index 1 content',
      name: 'Assistant',
      functionCalls: [],
    })
  })
})

describe('AxMemory', () => {
  it('should handle sessionId operations independently', () => {
    const memory = new AxMemory()
    const message1: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'session1 message',
    }
    const message2: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'session2 message',
    }

    memory.addRequest([message1], 'session1')
    memory.addRequest([message2], 'session2')

    const history1 = memory.history(0, 'session1')
    const history2 = memory.history(0, 'session2')

    expect(history1).toHaveLength(1)
    expect((history1[0] as { content?: string }).content).toBe(
      'session1 message'
    )
    expect(history2).toHaveLength(1)
    expect((history2[0] as { content?: string }).content).toBe(
      'session2 message'
    )
  })

  it('should isolate different sessions', () => {
    const memory = new AxMemory()
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    memory.addRequest([message], 'session1')
    memory.addTag('tag1', 'session1')
    memory.reset('session1')

    // session1 should be empty, but default session should be unaffected
    expect(memory.history(0, 'session1')).toEqual([])
    expect(() => memory.rewindToTag('tag1', 'session1')).toThrow(
      'Tag "tag1" not found'
    )
  })

  it('should handle reset with sessionId vs no sessionId differently', () => {
    const memory = new AxMemory()
    const message1: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'default session',
    }
    const message2: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'named session',
    }

    memory.addRequest([message1]) // default session
    memory.addRequest([message2], 'session1')

    // Reset only named session
    memory.reset('session1')

    expect(memory.history(0)).toHaveLength(1) // default session unchanged
    expect(memory.history(0, 'session1')).toHaveLength(0) // named session reset

    // Reset default session
    memory.reset()

    expect(memory.history(0)).toHaveLength(0) // default session now reset
  })

  it('should handle all methods with sessionId parameter', () => {
    const memory = new AxMemory()
    const userMessage: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test',
    }
    const response: AxChatResponseResult = {
      index: 0,
      content: 'response',
      functionCalls: [],
    }
    const functionResult: AxFunctionResult = {
      index: 0,
      role: 'function',
      result: 'result',
      functionId: 'func1',
    }

    // Test all methods with sessionId
    memory.addRequest([userMessage], 'test-session')
    memory.addResponse([response], 'test-session')
    memory.addFunctionResults([functionResult], 'test-session')
    memory.updateResult(
      { index: 0, content: 'updated', functionCalls: [] },
      'test-session'
    )
    memory.addTag('test-tag', 'test-session')

    const history = memory.history(0, 'test-session')
    expect(history).toHaveLength(4) // user + assistant + function + updated assistant

    const last = memory.getLast('test-session')
    expect(last?.role).toBe('assistant') // updateResult created a new assistant message

    const removed = memory.rewindToTag('test-tag', 'test-session')
    expect(removed).toHaveLength(1) // only the tagged assistant message is removed
  })

  it('should work with debug options', () => {
    const memory = new AxMemory({ debug: false, debugHideSystemPrompt: true })
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }

    // Should not throw with debug enabled
    expect(() => memory.addRequest([message])).not.toThrow()
  })
})

describe('MemoryImpl Debug Logging', () => {
  it('should handle debug logging when debug option is true', () => {
    const memory = new MemoryImpl({ debug: true })
    const message: AxChatRequest['chatPrompt'][0] = {
      role: 'user',
      content: 'test message',
    }
    const response: AxChatResponseResult = {
      index: 0,
      content: 'test response',
      functionCalls: [],
    }

    // These should not throw when debug is enabled
    expect(() => memory.addRequest([message], 0)).not.toThrow()
    expect(() => memory.addResponse([response])).not.toThrow()
  })

  it('should handle debug logging for updateResult with delta vs content paths', () => {
    const memory = new MemoryImpl({ debug: true })

    // Test delta path
    expect(() =>
      memory.updateResult({
        index: 0,
        content: 'test',
        functionCalls: [],
        delta: 'delta content',
      })
    ).not.toThrow()

    // Test content path (no delta)
    expect(() =>
      memory.updateResult({
        index: 0,
        content: 'test content',
        functionCalls: [],
      })
    ).not.toThrow()

    // Test neither delta nor content (should not log)
    expect(() =>
      memory.updateResult({
        index: 0,
        functionCalls: [],
      })
    ).not.toThrow()
  })
})
