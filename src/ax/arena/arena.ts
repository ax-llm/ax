import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'

import type { AxAgentic } from '../prompts/agent.js'

import {
  completeTask,
  createArenaContextConsolidator,
  createArenaPlanningAgent,
  createArenaTaskManager,
  createExecutionPlan,
  executeNextTask,
  failTask,
} from './router.js'
import type {
  AxArenaConfig,
  AxArenaEvent,
  AxArenaExecutionPlan,
  AxArenaMessage,
  AxArenaMessageAttachment,
  AxArenaResponse,
  AxArenaSendMessageOptions,
  AxArenaThread,
} from './types.js'

/**
 * AxArena - A messaging system for coordinating multiple AxAgent instances
 * with planning and task management capabilities
 */
export class AxArena extends EventEmitter {
  private threads: Map<string, AxArenaThread> = new Map()
  private executionPlans: Map<string, AxArenaExecutionPlan> = new Map()
  private config: Required<AxArenaConfig>
  private contextConsolidator = createArenaContextConsolidator()
  private planningAgent = createArenaPlanningAgent(() =>
    this.getAgentInfoForThread()
  )
  private taskManager = createArenaTaskManager(() =>
    this.getAgentInfoForThread()
  )

  private currentThreadId: string | null = null

  constructor(config?: AxArenaConfig) {
    super()

    this.config = {
      maxMessagesPerThread: config?.maxMessagesPerThread ?? 1000,
      maxConcurrentThreads: config?.maxConcurrentThreads ?? 10,
      debug: config?.debug ?? false,
    }
  }

  /**
   * Creates a new thread with the given agents and task
   */
  public createThread(
    agents: AxAgentic[],
    task: string,
    options?: {
      threadId?: string
      metadata?: Record<string, unknown>
    }
  ): AxArenaThread {
    if (this.threads.size >= this.config.maxConcurrentThreads) {
      throw new Error(
        `Maximum number of concurrent threads (${this.config.maxConcurrentThreads}) reached`
      )
    }

    const threadId = options?.threadId ?? randomUUID()
    const now = new Date()

    const thread: AxArenaThread = {
      id: threadId,
      task,
      agents,
      messages: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: options?.metadata ?? {},
    }

    this.threads.set(threadId, thread)

    // Add initial system message with the task
    const initialMessage: AxArenaMessage = {
      id: randomUUID(),
      threadId,
      sender: 'system',
      content: task,
      timestamp: now,
    }

    thread.messages.push(initialMessage)

    this.emitEvent({
      type: 'threadCreated',
      threadId,
      data: thread,
      timestamp: now,
    })

    if (this.config.debug) {
      console.log(
        `[AxArena] Created thread ${threadId} with ${agents.length} agents`
      )
    }

    return thread
  }

  /**
   * Sends a message to a thread and processes it through the planning and task management system
   */
  public async sendMessage(
    threadId: string,
    content: string,
    sender: string = 'user',
    options?: AxArenaSendMessageOptions
  ): Promise<AxArenaResponse> {
    const thread = this.threads.get(threadId)
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`)
    }

    if (thread.status !== 'active') {
      throw new Error(
        `Thread ${threadId} is not active (status: ${thread.status})`
      )
    }

    if (thread.messages.length >= this.config.maxMessagesPerThread) {
      throw new Error(
        `Thread ${threadId} has reached maximum message limit (${this.config.maxMessagesPerThread})`
      )
    }

    const startTime = Date.now()
    const now = new Date()

    // Create the message
    const message: AxArenaMessage = {
      id: randomUUID(),
      threadId,
      sender,
      content,
      timestamp: now,
      attachments: options?.metadata?.attachments as
        | AxArenaMessageAttachment[]
        | undefined,
      labels: options?.metadata?.labels as string[],
      replyTo: options?.metadata?.replyTo as string,
    }

    // Add message to thread
    thread.messages.push(message)
    thread.updatedAt = now

    this.emitEvent({
      type: 'message',
      threadId,
      data: message,
      timestamp: now,
    })

    if (this.config.debug) {
      console.log(
        `[AxArena] Message sent to thread ${threadId}: ${content.substring(0, 100)}...`
      )
    }

    // Set current thread for agent info lookup
    this.currentThreadId = threadId

    try {
      const responses: AxArenaMessage[] = []
      const selectedAgents: string[] = []

      // Step 1: Context consolidation
      const consolidatedTask = this.consolidateContext(
        thread.messages,
        thread.task
      )

      if (this.config.debug) {
        console.log(`[AxArena] Consolidated task: ${consolidatedTask}`)
      }

      // Step 2: Create or get execution plan
      let plan = this.executionPlans.get(threadId)
      if (!plan) {
        plan = await createExecutionPlan(
          this.planningAgent,
          consolidatedTask,
          thread.task,
          thread.agents
        )
        this.executionPlans.set(threadId, plan)

        if (this.config.debug) {
          console.log(
            `[AxArena] Created execution plan with ${plan.tasks.length} tasks`
          )
          console.log(`[AxArena] Plan tasks:`)
          plan.tasks.forEach((task, index) => {
            console.log(
              `   ${index + 1}. ${task.description} -> ${task.assignedAgentName}`
            )
          })
        }
      }

      // Step 3: Execute tasks sequentially until completion or no more tasks available
      let taskExecuted = false
      let maxIterations = plan.tasks.length + 1 // Prevent infinite loops
      let iterations = 0

      while (iterations < maxIterations) {
        const { task, selectedAgent } = await executeNextTask(
          this.taskManager,
          plan,
          thread.agents
        )

        if (!task || !selectedAgent) {
          // No more tasks to execute
          break
        }

        taskExecuted = true
        selectedAgents.push(selectedAgent.getFunction().name)

        if (this.config.debug) {
          console.log(
            `[AxArena] Executing task: ${task.id} - ${task.description}`
          )
          console.log(
            `[AxArena] Assigned to: ${selectedAgent.getFunction().name}`
          )
        }

        // Execute the selected agent with the task description
        try {
          // For now, create a structured response based on the task
          // TODO: Integrate with actual agent execution when method is available
          const taskResult = `Task completed by ${selectedAgent.getFunction().name}: ${task.description}`

          const responseMessage: AxArenaMessage = {
            id: randomUUID(),
            threadId,
            sender: selectedAgent.getFunction().name,
            content: taskResult,
            timestamp: new Date(),
          }

          thread.messages.push(responseMessage)
          responses.push(responseMessage)

          // Mark task as completed
          completeTask(plan, task.id, taskResult)

          this.emitEvent({
            type: 'response',
            threadId,
            data: responseMessage,
            timestamp: responseMessage.timestamp,
          })

          if (this.config.debug) {
            console.log(
              `[AxArena] Task ${task.id} completed by ${selectedAgent.getFunction().name}`
            )
          }
        } catch (error) {
          // Handle agent execution error
          const errorMessage = `Agent execution failed: ${error}`
          const fallbackResult = `[Error] Unable to execute task: ${task.description}`

          const errorResponse: AxArenaMessage = {
            id: randomUUID(),
            threadId,
            sender: selectedAgent.getFunction().name,
            content: fallbackResult,
            timestamp: new Date(),
          }

          thread.messages.push(errorResponse)
          responses.push(errorResponse)

          // Mark task as failed
          failTask(plan, task.id, errorMessage)

          this.emitEvent({
            type: 'response',
            threadId,
            data: errorResponse,
            timestamp: errorResponse.timestamp,
          })

          if (this.config.debug) {
            console.log(`[AxArena] Task ${task.id} failed: ${errorMessage}`)
          }
        }

        iterations++
      }

      // Check if plan is complete
      if (plan.status === 'completed') {
        if (this.config.debug) {
          console.log(
            `[AxArena] Execution plan completed for thread ${threadId}`
          )
        }

        // Create plan completion summary
        const summaryMessage: AxArenaMessage = {
          id: randomUUID(),
          threadId,
          sender: 'system',
          content: `Execution plan completed successfully. All ${plan.tasks.length} tasks have been executed.`,
          timestamp: new Date(),
        }

        thread.messages.push(summaryMessage)
        responses.push(summaryMessage)

        this.emitEvent({
          type: 'response',
          threadId,
          data: summaryMessage,
          timestamp: summaryMessage.timestamp,
        })
      }

      if (!taskExecuted) {
        // No tasks were executed, provide fallback response
        const fallbackResponse: AxArenaMessage = {
          id: randomUUID(),
          threadId,
          sender: 'system',
          content: 'No actionable tasks found for the current request.',
          timestamp: new Date(),
        }

        thread.messages.push(fallbackResponse)
        responses.push(fallbackResponse)

        this.emitEvent({
          type: 'response',
          threadId,
          data: fallbackResponse,
          timestamp: fallbackResponse.timestamp,
        })
      }

      thread.updatedAt = new Date()

      this.emitEvent({
        type: 'thread_updated',
        threadId,
        data: thread,
        timestamp: new Date(),
      })

      const processingTime = Date.now() - startTime

      return {
        originalMessage: message,
        responses,
        selectedAgents,
        processingTime,
      }
    } finally {
      this.currentThreadId = null
    }
  }

  /**
   * Gets the current execution plan for a thread
   */
  public getExecutionPlan(threadId: string): AxArenaExecutionPlan | undefined {
    return this.executionPlans.get(threadId)
  }

  /**
   * Gets all execution plans
   */
  public getAllExecutionPlans(): AxArenaExecutionPlan[] {
    return Array.from(this.executionPlans.values())
  }

  /**
   * Gets a thread by ID
   */
  public getThread(threadId: string): AxArenaThread | undefined {
    return this.threads.get(threadId)
  }

  /**
   * Gets all threads
   */
  public getAllThreads(): AxArenaThread[] {
    return Array.from(this.threads.values())
  }

  /**
   * Pauses a thread
   */
  public pauseThread(threadId: string): void {
    const thread = this.threads.get(threadId)
    if (thread) {
      thread.status = 'paused'
      thread.updatedAt = new Date()
    }
  }

  /**
   * Resumes a thread
   */
  public resumeThread(threadId: string): void {
    const thread = this.threads.get(threadId)
    if (thread) {
      thread.status = 'active'
      thread.updatedAt = new Date()
    }
  }

  /**
   * Completes a thread
   */
  public completeThread(threadId: string): void {
    const thread = this.threads.get(threadId)
    if (thread) {
      thread.status = 'completed'
      thread.updatedAt = new Date()
    }
  }

  /**
   * Deletes a thread and its execution plan
   */
  public deleteThread(threadId: string): boolean {
    this.executionPlans.delete(threadId)
    return this.threads.delete(threadId)
  }

  /**
   * Simple context consolidation (placeholder for actual AI-powered consolidation)
   */
  private consolidateContext(
    messages: readonly AxArenaMessage[],
    threadTask: string
  ): string {
    // For now, use simple consolidation until AI service is configured
    // TODO: Implement actual consolidator call when AI service is available

    const latestMessage = messages[messages.length - 1]
    if (latestMessage && latestMessage.sender !== 'system') {
      return latestMessage.content
    }

    return threadTask
  }

  /**
   * Gets agent information for the current thread (used by planning and task management agents)
   */
  private getAgentInfoForThread(): Array<{
    id: string
    name: string
    description: string
  }> {
    if (!this.currentThreadId) {
      return []
    }

    const thread = this.threads.get(this.currentThreadId)
    if (!thread) {
      return []
    }

    return thread.agents.map((agent, index) => {
      const func = agent.getFunction()
      return {
        id: index.toString(), // Use index as ID for now
        name: func.name,
        description: func.description,
      }
    })
  }

  /**
   * Emits an event
   */
  private emitEvent(event: Readonly<AxArenaEvent>): void {
    this.emit(event.type, event)
    this.emit('event', event)
  }
}
