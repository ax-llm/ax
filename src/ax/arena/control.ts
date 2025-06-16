import type { AxFunction } from '../ai/types.js'

import type { AxArena } from './arena.js'

/**
 * Creates an AxFunction for getting a specific thread by ID
 */
export function getThreadFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'getThread',
    description: `Get the arena thread with ID ${threadId}`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      return JSON.stringify(thread, null, 2)
    },
  }
}

/**
 * Creates an AxFunction for getting all threads in the arena
 */
export function getAllThreadsFunction(arena: Readonly<AxArena>): AxFunction {
  return {
    name: 'getAllThreads',
    description: 'Get all threads in the arena',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const threads = arena.getAllThreads()
      return JSON.stringify(threads, null, 2)
    },
  }
}

/**
 * Creates an AxFunction for getting agents from a specific thread
 */
export function getAgentsFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'getAgents',
    description: `Get all agents participating in thread ${threadId}`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      const agents = thread.agents.map((agent) => ({
        name: agent.getFunction().name,
        description: agent.getFunction().description,
        features: agent.getFeatures(),
      }))
      return JSON.stringify(agents, null, 2)
    },
  }
}

/**
 * Creates an AxFunction for pausing a thread
 */
export function pauseThreadFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'pauseThread',
    description: `Pause thread ${threadId} to stop processing new messages`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      arena.pauseThread(threadId)
      return `Thread ${threadId} has been paused`
    },
  }
}

/**
 * Creates an AxFunction for resuming a thread
 */
export function resumeThreadFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'resumeThread',
    description: `Resume thread ${threadId} to continue processing messages`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      arena.resumeThread(threadId)
      return `Thread ${threadId} has been resumed`
    },
  }
}

/**
 * Creates an AxFunction for completing a thread
 */
export function completeThreadFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'completeThread',
    description: `Mark thread ${threadId} as completed, stopping all further processing`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      arena.completeThread(threadId)
      return `Thread ${threadId} has been marked as completed`
    },
  }
}

/**
 * Creates an AxFunction for deleting a thread
 */
export function deleteThreadFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'deleteThread',
    description: `Delete thread ${threadId} permanently from the arena`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    func: async () => {
      const deleted = arena.deleteThread(threadId)
      if (deleted) {
        return `Thread ${threadId} has been deleted`
      } else {
        return `Thread with ID ${threadId} not found`
      }
    },
  }
}

/**
 * Creates an AxFunction for sending a message to a specific thread
 */
export function sendMessageFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'sendMessage',
    description: `Send a message to thread ${threadId}`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content of the message to send',
        },
        sender: {
          type: 'string',
          description: 'The name of the sender (agent or user)',
        },
      },
      required: ['content', 'sender'],
    },
    func: async ({
      content,
      sender,
    }: Readonly<{ content: string; sender: string }>) => {
      try {
        await arena.sendMessage(threadId, content, sender)
        return `Message sent successfully to thread ${threadId}`
      } catch (error) {
        return `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    },
  }
}

/**
 * Creates an AxFunction for getting recent messages from a thread
 */
export function getMessagesFunction(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction {
  return {
    name: 'getMessages',
    description: `Get recent messages from thread ${threadId}`,
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description:
            'Maximum number of recent messages to retrieve (default: 10)',
        },
      },
      required: [],
    },
    func: async ({
      limit = 10,
    }: {
      limit?: number
    } = {}) => {
      const thread = arena.getThread(threadId)
      if (!thread) {
        return `Thread with ID ${threadId} not found`
      }
      const recentMessages = thread.messages.slice(-limit)
      return JSON.stringify(recentMessages, null, 2)
    },
  }
}

/**
 * Helper function to create all arena control functions for a specific thread
 */
export function createArenaControlFunctions(
  arena: Readonly<AxArena>,
  threadId: string
): AxFunction[] {
  return [
    getThreadFunction(arena, threadId),
    getAgentsFunction(arena, threadId),
    pauseThreadFunction(arena, threadId),
    resumeThreadFunction(arena, threadId),
    completeThreadFunction(arena, threadId),
    deleteThreadFunction(arena, threadId),
    sendMessageFunction(arena, threadId),
    getMessagesFunction(arena, threadId),
  ]
}

/**
 * Helper function to create general arena functions (not thread-specific)
 */
export function createGeneralArenaFunctions(arena: AxArena): AxFunction[] {
  return [getAllThreadsFunction(arena)]
}
