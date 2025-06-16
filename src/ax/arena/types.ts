import type { AxAgentic } from '../prompts/agent.js'

/**
 * Represents an attachment in an arena message
 */
export type AxArenaMessageAttachment = {
  /** Unique identifier for the attachment */
  id: string
  /** Original filename */
  filename: string
  /** File size in bytes */
  size: number
  /** MIME type of the attachment */
  mimeType: string
  /** Type of attachment */
  type: 'text' | 'image' | 'audio' | 'file'
  /** Base64 encoded data or file path */
  data: string
  /** Optional description or alt text */
  description?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Represents a message in the arena thread
 */
export interface AxArenaMessage {
  /** Unique identifier for the message */
  id: string
  /** ID of the thread this message belongs to */
  threadId: string
  /** Name of the agent or user who sent the message */
  sender: string
  /** The message content as plain text */
  content: string
  /** Optional attachments (files, images, etc.) */
  attachments?: AxArenaMessageAttachment[]
  /** Timestamp when the message was created */
  timestamp: Date
  /** Optional labels */
  labels?: string[]
  /** ID of the message this is responding to, if any */
  replyTo?: string
}

/**
 * Represents a thread in the arena
 */
export interface AxArenaThread {
  /** Unique identifier for the thread */
  id: string
  /** The initial task or prompt that started the thread */
  task: string
  /** List of participating agents */
  agents: AxAgentic[]
  /** All messages in the thread */
  messages: AxArenaMessage[]
  /** Current status of the thread */
  status: 'active' | 'paused' | 'completed' | 'error'
  /** Timestamp when the thread was created */
  createdAt: Date
  /** Timestamp when the thread was last updated */
  updatedAt: Date
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Configuration for the AxArena
 */
export interface AxArenaConfig {
  /** Maximum number of messages per thread */
  maxMessagesPerThread?: number
  /** Maximum number of concurrent threads */
  maxConcurrentThreads?: number
  /** Whether to enable debug logging */
  debug?: boolean
}

/**
 * Options for sending a message to the arena
 */
export interface AxArenaSendMessageOptions {
  /** Specific agents to target (if not provided, arena manager will decide) */
  targetAgents?: string[]
  /** Whether to wait for responses before returning */
  waitForResponses?: boolean
  /** Maximum time to wait for responses in milliseconds */
  responseTimeout?: number
  /** Additional metadata to attach to the message */
  metadata?: Record<string, unknown>
}

/**
 * Response from the arena after processing a message
 */
export interface AxArenaResponse {
  /** The original message that was sent */
  originalMessage: AxArenaMessage
  /** Responses from agents */
  responses: AxArenaMessage[]
  /** Agents that were selected to respond */
  selectedAgents: string[]
  /** Processing time in milliseconds */
  processingTime: number
}

/**
 * Event emitted by the arena
 */
export interface AxArenaEvent {
  /** Type of event */
  type: 'message' | 'response' | 'threadCreated' | 'thread_updated' | 'error'
  /** Thread ID the event relates to */
  threadId: string
  /** Event data */
  data: unknown
  /** Timestamp of the event */
  timestamp: Date
}

/**
 * Arena manager control functions available to the arena manager agent
 */
export interface AxArenaManagerControls {
  /** Get information about all agents in the arena */
  getAgentInfo: () => Array<{
    name: string
    description: string
    features: Record<string, unknown>
  }>

  /** Get the current thread state */
  getThreadState: () => AxArenaThread

  /** Get recent messages from the thread */
  getRecentMessages: (count?: number) => AxArenaMessage[]

  /** Route a message to specific agents */
  routeToAgents: (
    agentNames: string[],
    message: string
  ) => Promise<AxArenaMessage[]>

  /** Send a system message to the thread */
  sendSystemMessage: (content: string) => AxArenaMessage

  /** Update thread metadata */
  updateThreadMetadata: (metadata: Record<string, unknown>) => void

  /** Pause or resume the thread */
  setThreadStatus: (status: AxArenaThread['status']) => void
}

/**
 * Input type for the context consolidator agent
 */
export interface AxArenaConsolidatorInput {
  messages: string
  threadTask: string
}

/**
 * Output type for the context consolidator agent
 */
export interface AxArenaConsolidatorOutput {
  consolidatedTask: string
}

/**
 * Input type for the planning agent
 */
export interface AxArenaPlanningInput {
  consolidatedTask: string
  threadTask: string
  availableAgents: string
}

/**
 * Output type for the planning agent
 */
export interface AxArenaPlanningOutput {
  plan: string
  steps: string
}

/**
 * Represents a single task/step in the execution plan
 */
export interface AxArenaTask {
  /** Unique identifier for the task */
  id: string
  /** Task description */
  description: string
  /** Agent assigned to this task */
  assignedAgentId: string
  /** Agent name assigned to this task */
  assignedAgentName: string
  /** Current status of the task */
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  /** Dependencies - task IDs that must be completed first */
  dependencies: string[]
  /** When the task was created */
  createdAt: Date
  /** When the task was started */
  startedAt?: Date
  /** When the task was completed */
  completedAt?: Date
  /** Task result/output */
  result?: string
  /** Error message if task failed */
  error?: string
}

/**
 * Represents a complete execution plan
 */
export interface AxArenaExecutionPlan {
  /** Unique identifier for the plan */
  id: string
  /** Original consolidated task */
  consolidatedTask: string
  /** All tasks in the plan */
  tasks: AxArenaTask[]
  /** Current status of the plan */
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  /** When the plan was created */
  createdAt: Date
  /** When the plan was started */
  startedAt?: Date
  /** When the plan was completed */
  completedAt?: Date
  /** Current task being executed */
  currentTaskId?: string
}

/**
 * Input type for the task manager (renamed routing agent)
 */
export interface AxArenaTaskManagerInput {
  currentTask: string
  taskId: string
  planContext: string
}

/**
 * Output type for the task manager
 */
export interface AxArenaTaskManagerOutput {
  agentId: string
}

/**
 * Input type for the arena routing manager (legacy - keeping for compatibility)
 */
export interface AxArenaRoutingInput {
  consolidatedTask: string
  threadTask: string
}

/**
 * Output type for the arena routing manager (legacy - keeping for compatibility)
 */
export interface AxArenaRoutingOutput {
  agentId: string
}
