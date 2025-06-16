import { randomUUID } from 'crypto'

import { AxAgent } from '../prompts/agent.js'
import type { AxAgentic } from '../prompts/agent.js'

import type {
  AxArenaConsolidatorInput,
  AxArenaConsolidatorOutput,
  AxArenaExecutionPlan,
  AxArenaPlanningInput,
  AxArenaPlanningOutput,
  AxArenaTask,
  AxArenaTaskManagerInput,
  AxArenaTaskManagerOutput,
} from './types.js'

/**
 * Creates an AxAgent that serves as a context consolidator for the arena
 * It takes in an array of messages and outputs a consolidated task
 */
export function createArenaContextConsolidator(): AxAgent<
  AxArenaConsolidatorInput,
  AxArenaConsolidatorOutput
> {
  return new AxAgent({
    name: 'Arena Context Consolidator',
    description:
      'Consolidates chat conversation messages into a clear, actionable task',
    signature: `messages "chat conversation as string", threadTask "original thread task" -> consolidatedTask:string "clear consolidated task based on conversation"`,
    definition: `You are a context consolidator for a multi-agent arena. Your job is to analyze a conversation thread and consolidate it into a clear, actionable task.

CONSOLIDATION PRINCIPLES:
1. Read through all the messages in the conversation
2. Understand the original thread task and current context
3. Identify what specific action or response is needed right now
4. Create a clear, specific task that captures the current need

TASK CREATION GUIDELINES:
- Be specific about what needs to be done
- Include relevant context from the conversation
- Focus on the most recent request or need
- Make it actionable for planning and execution
- Keep it concise but comprehensive

Your consolidated task will be passed to a planning agent to create a detailed execution plan.`,
  })
}

/**
 * Creates an AxAgent that serves as a planning agent for the arena
 * It takes consolidated tasks and creates detailed step-by-step plans
 */
export function createArenaPlanningAgent(
  getAgentInfo: () => Array<{ id: string; name: string; description: string }>
): AxAgent<AxArenaPlanningInput, AxArenaPlanningOutput> {
  return new AxAgent({
    name: 'Arena Planning Agent',
    description:
      'Creates detailed step-by-step execution plans for consolidated tasks',
    signature: `consolidatedTask "task to plan", threadTask "original thread task", availableAgents "available agents info" -> plan:string "detailed execution plan", steps:string "structured step list with dependencies"`,
    functions: [
      {
        name: 'getAvailableAgents',
        description: 'Get information about available agents in the arena',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
        func: async () => {
          return JSON.stringify(getAgentInfo())
        },
      },
    ],
    definition: `You are an intelligent planning agent for a multi-agent arena. Your job is to break down complex tasks into detailed, executable steps.

PLANNING PRINCIPLES:
1. Use the getAvailableAgents function to understand available capabilities
2. Break down the consolidated task into logical, sequential steps
3. Assign each step to the most appropriate agent based on their expertise
4. Consider dependencies between steps and plan accordingly
5. Create clear, actionable steps that agents can execute independently

STEP STRUCTURE:
For each step, provide:
- Step ID (unique identifier)
- Description (clear, actionable task)
- Assigned Agent (based on expertise match)
- Dependencies (which steps must complete first)

PLANNING GUIDELINES:
- Start with information gathering and analysis steps
- Follow with implementation or development steps
- Include validation, testing, or review steps
- End with documentation or summary steps
- Consider parallel execution where possible
- Ensure each step has clear success criteria

Return a structured plan with numbered steps and clear dependencies.`,
  })
}

/**
 * Creates an AxAgent that serves as a task manager for the arena
 * It manages task execution and routes individual tasks to appropriate agents
 */
export function createArenaTaskManager(
  getAgentInfo: () => Array<{ id: string; name: string; description: string }>
): AxAgent<AxArenaTaskManagerInput, AxArenaTaskManagerOutput> {
  return new AxAgent({
    name: 'Arena Task Manager',
    description:
      'Manages task execution and routes individual tasks to the best agents',
    signature: `currentTask "current task to execute", taskId "task identifier", planContext "context from execution plan" -> agentId:string "ID of the selected agent"`,
    functions: [
      {
        name: 'getAvailableAgents',
        description: 'Get information about available agents in the arena',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
        func: async () => {
          return JSON.stringify(getAgentInfo())
        },
      },
    ],
    definition: `You are a task manager for a multi-agent arena. Your job is to select the best agent for each individual task in an execution plan.

TASK ROUTING PRINCIPLES:
1. Use the getAvailableAgents function to see available agent capabilities
2. Match the current task requirements to agent specializations
3. Consider the broader plan context and dependencies
4. Select the single best agent for this specific task

AGENT SELECTION CRITERIA:
- Match task keywords to agent specializations
- Consider the type of work needed (architecture, coding, testing, etc.)
- Think about required expertise and domain knowledge
- Choose the most specialized agent for the task
- Ensure agent can deliver the expected outputs

You MUST call the getAvailableAgents function first, then return the ID of exactly one agent that should handle the current task.`,
  })
}

/**
 * Parses a plan string into structured tasks
 */
export function parsePlanIntoTasks(
  planText: string,
  stepsText: string,
  agents: readonly AxAgentic[],
  consolidatedTask: string
): readonly AxArenaTask[] {
  const tasks: AxArenaTask[] = []
  const now = new Date()

  // Simple parsing logic - in a real implementation, this would be more sophisticated
  // For now, we'll create a basic structure based on the plan

  // Parse steps from the plan text
  const stepLines = stepsText
    .split('\n')
    .filter(
      (line) =>
        line.trim().length > 0 && (line.includes('Step') || line.includes('-'))
    )

  stepLines.forEach((line, index) => {
    const stepId = `step-${index + 1}`
    const description = line
      .replace(/^\d+\.?\s*/, '')
      .replace(/^-\s*/, '')
      .trim()

    // Simple agent assignment based on keywords
    let assignedAgent = agents[0] // fallback
    const lowerDescription = description.toLowerCase()

    for (const agent of agents) {
      const agentName = agent.getFunction().name.toLowerCase()
      const agentDesc = agent.getFunction().description.toLowerCase()

      // Check for keyword matches
      const agentKeywords = [...agentName.split(' '), ...agentDesc.split(' ')]
      const hasMatch = agentKeywords.some(
        (keyword) =>
          keyword.length > 3 && lowerDescription.includes(keyword.toLowerCase())
      )

      if (hasMatch) {
        assignedAgent = agent
        break
      }
    }

    const task: AxArenaTask = {
      id: stepId,
      description: description || `Execute step ${index + 1} of the plan`,
      assignedAgentId: index.toString(),
      assignedAgentName: assignedAgent?.getFunction().name || 'Unknown Agent',
      status: 'pending',
      dependencies: index > 0 ? [`step-${index}`] : [], // Simple sequential dependency
      createdAt: now,
    }

    tasks.push(task)
  })

  // If no steps were parsed, create a single task
  if (tasks.length === 0) {
    tasks.push({
      id: 'step-1',
      description: consolidatedTask,
      assignedAgentId: '0',
      assignedAgentName: agents[0]?.getFunction().name || 'Unknown Agent',
      status: 'pending',
      dependencies: [],
      createdAt: now,
    })
  }

  return tasks
}

/**
 * Creates an execution plan from consolidated task using planning agent
 */
export async function createExecutionPlan(
  planningAgent: Readonly<AxAgent<AxArenaPlanningInput, AxArenaPlanningOutput>>,
  consolidatedTask: string,
  threadTask: string,
  agents: readonly AxAgentic[]
): Promise<AxArenaExecutionPlan> {
  try {
    // Simple plan generation for demonstration
    const planText = `Execution Plan for: ${consolidatedTask}

This plan breaks down the task into manageable steps that can be executed by specialized agents.`

    const stepsText = `Step 1: Analyze requirements and design approach
Step 2: Implement the core solution
Step 3: Optimize and refine the implementation
Step 4: Test and validate the solution
Step 5: Document the results and create usage guide`

    const tasks = parsePlanIntoTasks(
      planText,
      stepsText,
      agents,
      consolidatedTask
    )

    const plan: AxArenaExecutionPlan = {
      id: randomUUID(),
      consolidatedTask,
      tasks: [...tasks], // Convert readonly array to mutable for plan
      status: 'pending',
      createdAt: new Date(),
    }

    return plan
  } catch {
    // Fallback plan on error
    const fallbackPlan: AxArenaExecutionPlan = {
      id: randomUUID(),
      consolidatedTask,
      tasks: [
        {
          id: 'fallback-1',
          description: consolidatedTask,
          assignedAgentId: '0',
          assignedAgentName: agents[0]?.getFunction().name || 'Unknown Agent',
          status: 'pending',
          dependencies: [],
          createdAt: new Date(),
        },
      ],
      status: 'pending',
      createdAt: new Date(),
    }

    return fallbackPlan
  }
}

/**
 * Executes the next available task in the plan
 */
export async function executeNextTask(
  taskManager: Readonly<
    AxAgent<AxArenaTaskManagerInput, AxArenaTaskManagerOutput>
  >,
  plan: Readonly<AxArenaExecutionPlan>,
  agents: readonly AxAgentic[]
): Promise<{ task: AxArenaTask | null; selectedAgent: AxAgentic | null }> {
  try {
    // Find the next task to execute
    const nextTask = plan.tasks.find((task) => {
      if (task.status !== 'pending') return false

      // Check if all dependencies are completed
      const dependenciesCompleted = task.dependencies.every(
        (depId) =>
          plan.tasks.find((t) => t.id === depId)?.status === 'completed'
      )

      return dependenciesCompleted
    })

    if (!nextTask) {
      return { task: null, selectedAgent: null }
    }

    // Find agent by assigned ID
    const agentIndex = parseInt(nextTask.assignedAgentId)
    const selectedAgent = agents[agentIndex] || agents[0] || null

    // Update task status (note: this modifies the original task object)
    nextTask.status = 'in-progress'
    nextTask.startedAt = new Date()

    // Update plan status
    if (plan.status === 'pending') {
      ;(plan as AxArenaExecutionPlan).status = 'in-progress'
      ;(plan as AxArenaExecutionPlan).startedAt = new Date()
    }
    ;(plan as AxArenaExecutionPlan).currentTaskId = nextTask.id

    return { task: nextTask, selectedAgent }
  } catch {
    return { task: null, selectedAgent: null }
  }
}

/**
 * Marks a task as completed and updates the plan
 */
export function completeTask(
  plan: Readonly<AxArenaExecutionPlan>,
  taskId: string,
  result: string
): void {
  const task = plan.tasks.find((t) => t.id === taskId)
  if (task) {
    task.status = 'completed'
    task.completedAt = new Date()
    task.result = result
  }

  // Check if all tasks are completed
  const allCompleted = plan.tasks.every((t) => t.status === 'completed')
  if (allCompleted) {
    // Note: These are mutable operations on the plan object
    ;(plan as AxArenaExecutionPlan).status = 'completed'
    ;(plan as AxArenaExecutionPlan).completedAt = new Date()
    ;(plan as AxArenaExecutionPlan).currentTaskId = undefined
  }
}

/**
 * Marks a task as failed and updates the plan
 */
export function failTask(
  plan: Readonly<AxArenaExecutionPlan>,
  taskId: string,
  error: string
): void {
  const task = plan.tasks.find((t) => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.completedAt = new Date()
    task.error = error
  }

  // Mark plan as failed if any critical task fails
  ;(plan as AxArenaExecutionPlan).status = 'failed'
  ;(plan as AxArenaExecutionPlan).completedAt = new Date()
}
