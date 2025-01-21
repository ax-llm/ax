import test from 'ava'

import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js'

import { MemoryImpl } from './memory.js'

test('constructor should enforce positive limit', (t) => {
  t.throws(() => new MemoryImpl(0), {
    message: "argument 'limit' must be greater than 0",
  })
  t.throws(() => new MemoryImpl(-1), {
    message: "argument 'limit' must be greater than 0",
  })
})

test('add should store single chat message', (t) => {
  const memory = new MemoryImpl()
  const message: AxChatRequest['chatPrompt'][0] = {
    role: 'user',
    content: 'test message',
  }

  memory.add(message)

  const history = memory.history()
  t.is(history.length, 1)
  t.deepEqual(history[0], message)
})

test('add should store array of chat messages', (t) => {
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
  t.is(history.length, 2)
  t.deepEqual(history, messages)
})

test('add should respect memory limit', (t) => {
  const memory = new MemoryImpl(2)
  const messages: AxChatRequest['chatPrompt'] = [
    { role: 'system', content: 'message 1' },
    { role: 'user', content: 'message 2' },
    { role: 'system', content: 'message 3' },
  ]

  memory.add(messages)

  const history = memory.history()
  t.is(history.length, 2)
  t.deepEqual(history, messages.slice(-2))
})

test('addResult should store assistant message', (t) => {
  const memory = new MemoryImpl()
  const result: AxChatResponseResult = {
    content: 'test response',
    name: 'Claude',
    functionCalls: [],
  }

  memory.addResult(result)

  const last = memory.getLast()
  t.is(last?.role, 'assistant')
  if (last?.role === 'assistant') {
    t.is(last.content, result.content)
    t.is(last.name, result.name)
  }
})

test('rewindToTag should remove and return items from tagged message onwards', (t) => {
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
  t.deepEqual(removed, [
    { role: 'assistant', content: 'second message' },
    { role: 'user', content: 'third message' },
  ])

  // Verify memory state
  t.deepEqual(memory.history(), [{ role: 'user', content: 'first message' }])
})

test('removeByTag should remove all items with specified tag', (t) => {
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
  t.deepEqual(removed, [
    { role: 'assistant', content: 'second message' },
    { role: 'assistant', content: 'fourth message' },
  ])

  // Verify remaining items
  t.deepEqual(memory.history(), [
    { role: 'user', content: 'first message' },
    { role: 'user', content: 'third message' },
  ])
})

test('removeTaggedItems should throw for unknown tag', (t) => {
  const memory = new MemoryImpl()
  const message = {
    role: 'user' as const,
    content: 'test',
  }
  memory.add(message)

  t.throws(() => memory.removeByTag('unknown'), {
    message: 'No items found with tag "unknown"',
  })
})

test('addResult should ignore empty results', (t) => {
  const memory = new MemoryImpl()
  const emptyResult: AxChatResponseResult = {
    content: '',
    functionCalls: [],
  }

  memory.addResult(emptyResult)

  t.is(memory.history().length, 0)
})

test('updateResult should modify last assistant message', (t) => {
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
  t.is(last?.role, 'assistant')
  if (last?.role === 'assistant') {
    t.is(last.content, update.content)
    t.is(last.name, update.name)
  }
})

test('updateResult should add new message if last message is not assistant', (t) => {
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
  t.is(history.length, 2)
  t.deepEqual(history[0], userMessage)

  const lastMessage = history[1]
  if (!lastMessage) {
    t.fail('Expected lastMessage to exist')
    return
  }

  t.is(lastMessage.role, 'assistant')
  if (lastMessage.role === 'assistant') {
    t.is(lastMessage.content, update.content)
  }
})

test('addTag should add tag to last message', (t) => {
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

  t.notThrows(() => memory.rewindToTag('tag2'))
  t.notThrows(() => memory.rewindToTag('tag1'))
})

test('addTag should handle empty memory', (t) => {
  const memory = new MemoryImpl()

  t.notThrows(() => memory.addTag('tag'))
  t.is(memory.history().length, 0)
})

test('rewindToTag should remove messages including and after tag', (t) => {
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
  t.is(history.length, 1)
  t.deepEqual(history[0], message1)
})

test('rewindToTag should throw for unknown tag', (t) => {
  const memory = new MemoryImpl()
  const message: AxChatRequest['chatPrompt'][0] = {
    role: 'user',
    content: 'test',
  }
  memory.add(message)

  t.throws(() => memory.rewindToTag('unknown'), {
    message: 'Tag "unknown" not found',
  })
})

test('reset should clear all messages', (t) => {
  const memory = new MemoryImpl()
  const message: AxChatRequest['chatPrompt'][0] = {
    role: 'user',
    content: 'test',
  }
  memory.add(message)
  memory.addTag('tag')

  memory.reset()

  t.is(memory.history().length, 0)
  t.throws(() => memory.rewindToTag('tag'), { message: 'Tag "tag" not found' })
})

test('getLast should return undefined for empty memory', (t) => {
  const memory = new MemoryImpl()
  t.is(memory.getLast(), undefined)
})

test('getLast should return last message', (t) => {
  const memory = new MemoryImpl()
  const messages: AxChatRequest['chatPrompt'] = [
    { role: 'user', content: 'message 1' },
    { role: 'assistant', content: 'message 2', functionCalls: [] },
  ]

  memory.add(messages)

  const last = memory.getLast()
  t.deepEqual(last, messages[1])
})
