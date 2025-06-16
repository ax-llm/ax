# AxArena - Multi-Agent Coordination System

AxArena is a sophisticated messaging and coordination system for orchestrating multiple AxAgent instances with intelligent planning and task management capabilities.

## Architecture Overview

AxArena uses a three-stage process for handling user requests:

1. **Context Consolidation**: Analyzes conversation history and creates a clear, actionable task
2. **Planning**: Breaks down complex tasks into step-by-step execution plans
3. **Task Management**: Executes individual tasks by routing them to the most appropriate agents

### Core Components

#### 1. Context Consolidator Agent
- Analyzes conversation threads and user messages
- Consolidates multiple messages into clear, actionable tasks
- Considers conversation history and original thread context
- Outputs structured tasks suitable for planning

#### 2. Planning Agent
- Takes consolidated tasks and creates detailed execution plans
- Breaks down complex tasks into manageable steps
- Assigns each step to appropriate agents based on expertise
- Manages task dependencies and execution order
- Creates structured plans with step IDs and clear success criteria

#### 3. Task Manager Agent
- Routes individual tasks to the best available agents
- Considers agent specializations and current workload
- Manages task execution state and progress tracking
- Handles task completion and failure scenarios

#### 4. Execution Plans
Each plan contains:
- **Plan ID**: Unique identifier for tracking
- **Tasks**: Individual steps with descriptions, assignments, and dependencies
- **Status Tracking**: Real-time progress monitoring
- **Agent Assignment**: Intelligent routing based on expertise matching

## Features

- **Intelligent Agent Routing**: Automatically selects the best agent for each task
- **Step-by-Step Execution**: Breaks complex requests into manageable tasks
- **Real-time Progress Tracking**: Monitor execution status and agent participation
- **Dependency Management**: Handles task dependencies and sequential execution
- **Event-Driven Architecture**: Real-time updates and notifications
- **Thread Management**: Multiple concurrent conversations with isolated contexts
- **Execution Plan Persistence**: Track and review completed workflows

## Basic Usage

```typescript
import { AxArena, AxAgent } from '@ax-llm/ax'

// Create specialized agents
const architect = new AxAgent({
  name: 'System Architect',
  description: 'Expert in system design and architecture patterns',
  signature: `requirements -> architecture:string, components:string[]`,
})

const developer = new AxAgent({
  name: 'Senior Developer', 
  description: 'Expert in implementation and coding best practices',
  signature: `architecture, specs -> implementation:string, tests:string`,
})

const tester = new AxAgent({
  name: 'QA Engineer',
  description: 'Expert in testing strategies and quality assurance',
  signature: `implementation -> testPlan:string, coverage:string`,
})

// Create arena with planning and task management
const arena = new AxArena({
  maxMessagesPerThread: 1000,
  maxConcurrentThreads: 10,
  debug: true,
})

// Create a development thread
const thread = arena.createThread(
  [architect, developer, tester],
  'Build a high-performance web application'
)

// Send a complex request - planning agent will break it down
const response = await arena.sendMessage(
  thread.id,
  `Create a scalable microservices architecture with:
  1. User authentication and authorization
  2. Real-time data processing pipeline  
  3. Comprehensive testing strategy
  4. Performance monitoring and observability`,
  'product_manager'
)

// Check execution plan
const plan = arena.getExecutionPlan(thread.id)
console.log(`Plan created with ${plan?.tasks.length} tasks`)
console.log(`Status: ${plan?.status}`)

// Review task breakdown
plan?.tasks.forEach((task, index) => {
  console.log(`${index + 1}. ${task.description}`)
  console.log(`   Agent: ${task.assignedAgentName}`)
  console.log(`   Status: ${task.status}`)
})
```

## Advanced Configuration

### Arena Configuration

```typescript
const arena = new AxArena({
  maxMessagesPerThread: 500,    // Maximum messages per conversation
  maxConcurrentThreads: 5,      // Maximum concurrent threads
  debug: true,                  // Enable detailed logging
})
```

### Specialized Agent Teams

```typescript
// CUDA Development Team
const cudaTeam = [
  new AxAgent({
    name: 'CUDA Architect',
    description: 'Expert in CUDA architecture and GPU programming patterns',
    signature: `requirements -> architecture:string, memoryStrategy:string`,
  }),
  new AxAgent({
    name: 'CUDA Developer', 
    description: 'Specialized in CUDA kernel implementation',
    signature: `architecture -> kernelCode:string, launchConfig:string`,
  }),
  new AxAgent({
    name: 'Performance Optimizer',
    description: 'Expert in CUDA performance optimization',
    signature: `kernelCode -> optimizations:string, benchmarks:string`,
  }),
]

// AI/ML Research Team  
const mlTeam = [
  new AxAgent({
    name: 'ML Researcher',
    description: 'Expert in machine learning algorithms and research',
    signature: `problem -> approach:string, methodology:string`,
  }),
  new AxAgent({
    name: 'Data Scientist',
    description: 'Expert in data analysis and feature engineering', 
    signature: `dataset -> features:string[], preprocessing:string`,
  }),
  new AxAgent({
    name: 'ML Engineer',
    description: 'Expert in ML model deployment and productionization',
    signature: `model -> deployment:string, monitoring:string`,
  }),
]
```

## Event Handling

AxArena emits events for real-time monitoring:

```typescript
// Listen to all arena events
arena.on('event', (event) => {
  console.log(`Event: ${event.type} in thread ${event.threadId}`)
})

// Listen to specific events
arena.on('message', (event) => {
  console.log(`New message: ${event.data.content}`)
})

arena.on('response', (event) => {
  console.log(`Agent response: ${event.data.sender}`)
})

arena.on('threadCreated', (event) => {
  console.log(`New thread created: ${event.threadId}`)
})

arena.on('thread_updated', (event) => {
  console.log(`Thread updated: ${event.threadId}`)
})
```

## Execution Plan Management

### Monitoring Plan Progress

```typescript
// Get current execution plan
const plan = arena.getExecutionPlan(threadId)

if (plan) {
  console.log(`Plan Status: ${plan.status}`)
  console.log(`Progress: ${plan.tasks.filter(t => t.status === 'completed').length}/${plan.tasks.length}`)
  
  // Check individual task status
  plan.tasks.forEach(task => {
    console.log(`Task ${task.id}: ${task.status}`)
    if (task.result) {
      console.log(`Result: ${task.result}`)
    }
  })
}
```

### Task Lifecycle

Each task goes through these states:
- `pending`: Task created but not started
- `in-progress`: Task assigned and being executed  
- `completed`: Task finished successfully
- `failed`: Task encountered an error

### Plan Status

Execution plans have these states:
- `pending`: Plan created but execution not started
- `in-progress`: Tasks are being executed
- `completed`: All tasks completed successfully
- `failed`: Plan failed due to critical task failure

## Thread Management

```typescript
// Create thread with metadata
const thread = arena.createThread(
  agents,
  'Complex development project',
  {
    metadata: {
      project: 'webapp-v2',
      priority: 'high',
      deadline: '2024-03-01',
    }
  }
)

// Thread lifecycle management
arena.pauseThread(thread.id)   // Pause execution
arena.resumeThread(thread.id)  // Resume execution  
arena.completeThread(thread.id) // Mark as completed
arena.deleteThread(thread.id)  // Delete thread and execution plan

// Get thread information
const allThreads = arena.getAllThreads()
const specificThread = arena.getThread(thread.id)
```

## Real-World Example: CUDA Kernel Development

```typescript
import { demonstrateCudaArena } from '@ax-llm/ax-examples'

// Run comprehensive CUDA kernel development workflow
await demonstrateCudaArena()
```

This example demonstrates:
- Planning agent breaking down complex CUDA development into steps
- Task manager routing each step to specialized agents
- Real-time progress tracking and agent coordination
- Complete workflow from architecture to documentation

## API Reference

### AxArena Methods

- `createThread(agents, task, options?)`: Create new conversation thread
- `sendMessage(threadId, content, sender?, options?)`: Send message with planning and execution
- `getThread(threadId)`: Get thread by ID
- `getExecutionPlan(threadId)`: Get execution plan for thread
- `getAllThreads()`: Get all threads
- `getAllExecutionPlans()`: Get all execution plans
- `pauseThread(threadId)`: Pause thread execution
- `resumeThread(threadId)`: Resume thread execution
- `completeThread(threadId)`: Mark thread as completed
- `deleteThread(threadId)`: Delete thread and its execution plan

### Event Types

- `threadCreated`: New thread created
- `message`: New message received
- `response`: Agent response generated
- `thread_updated`: Thread state changed
- `event`: All events (catch-all)

## Integration with AI Services

When AI services are configured, AxArena will use:

1. **Context Consolidator Agent**: Advanced conversation analysis and task consolidation
2. **Planning Agent**: Intelligent task breakdown and dependency management  
3. **Task Manager Agent**: Smart agent selection based on expertise matching

Without AI services, AxArena falls back to rule-based routing and simple task execution while maintaining the same API and workflow structure.

## Best Practices

1. **Agent Specialization**: Create agents with clear, distinct specializations
2. **Task Granularity**: Design tasks that can be completed by individual agents
3. **Dependency Management**: Structure workflows with clear dependencies
4. **Progress Monitoring**: Use events and execution plans to track progress
5. **Error Handling**: Monitor task failures and implement recovery strategies
6. **Thread Organization**: Use metadata to organize and categorize threads

AxArena provides a powerful foundation for building sophisticated multi-agent workflows with intelligent planning and coordination capabilities. 