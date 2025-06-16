import {
  AxAgent,
  AxAI,
  AxAIOpenAIModel,
  AxArena,
  type AxArenaEvent,
  type AxArenaMessage,
} from '@ax-llm/ax'

// Initialize AI instance (will use environment variables)
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: {
    model: AxAIOpenAIModel.GPT35Turbo,
  },
})

// Create specialized story writing agents with AI
const worldBuilder = new AxAgent({
  ai,
  name: 'World Builder',
  description:
    'Expert in creating rich fictional worlds, settings, and backgrounds',
  signature: `storyRequirements "story requirements and genre" -> worldDescription:string "detailed world setting", characters:string "main characters overview"`,
})

const plotDeveloper = new AxAgent({
  ai,
  name: 'Plot Developer',
  description:
    'Specialized in crafting compelling storylines, plot structures, and narrative arcs',
  signature: `worldDescription "world setting", characters "character descriptions" -> plotOutline:string "detailed plot structure", conflicts:string "main conflicts and tensions"`,
})

const dialogueWriter = new AxAgent({
  ai,
  name: 'Dialogue Writer',
  description:
    'Expert in writing natural, engaging dialogue and character interactions',
  signature: `plotOutline "plot structure", characters "character descriptions" -> dialogue:string "sample dialogue scenes", characterVoices:string "unique voice for each character"`,
})

const narrativeWriter = new AxAgent({
  ai,
  name: 'Narrative Writer',
  description:
    'Specialized in descriptive writing, scene setting, and narrative flow',
  signature: `plotOutline "plot outline", worldDescription "world setting" -> narrative:string "narrative passages", sceneDescriptions:string "vivid scene descriptions"`,
})

const editor = new AxAgent({
  ai,
  name: 'Story Editor',
  description: 'Expert in story editing, pacing, consistency, and final polish',
  signature: `story "complete story draft", plotOutline "original plot" -> editedStory:string "polished final story", improvements:string "editing suggestions and changes"`,
})

// Create the story writing arena
const storyArena = new AxArena({
  maxMessagesPerThread: 50,
  maxConcurrentThreads: 3,
  debug: true,
})

// Story project examples
const storyProject = {
  genre: 'Science Fiction',
  theme: 'First Contact',
  requirements: `
      - Short story (1000-1500 words)
      - Near-future setting (50 years from now)
      - Focus on the emotional impact of first contact with aliens
      - Include both human and alien perspectives
      - Themes of communication, understanding, and connection
    `,
  complexity: 'Medium',
}

async function demonstrateStoryArena() {
  console.log('📚 Collaborative Story Writing Arena')
  console.log('='.repeat(60))

  // Check if AI is properly configured
  if (!process.env.OPENAI_APIKEY) {
    console.log('⚠️  Warning: No OPENAI_APIKEY found in environment variables')
  }

  // Create specialized writing team
  const agents = [
    worldBuilder,
    plotDeveloper,
    dialogueWriter,
    narrativeWriter,
    editor,
  ]

  console.log('👥 Specialized Writing Team:')
  agents.forEach((agent) => {
    const func = agent.getFunction()
    console.log(`• ${func.name}: ${func.description}`)
  })
  console.log()

  // Select a story project to work on
  const project = storyProject

  // Create writing thread
  const thread = storyArena.createThread(
    agents,
    `Create a compelling ${project.genre.toLowerCase()} story about ${project.theme.toLowerCase()}`,
    {
      metadata: {
        genre: project.genre,
        theme: project.theme,
        requirements: project.requirements,
        targetLength: '1000-1500 words',
        deadline: '2024-02-01',
      },
    }
  )

  console.log(`📝 Created writing thread: ${thread.id}`)
  console.log(`📖 Genre: ${project.genre}`)
  console.log(`🎭 Theme: ${project.theme}`)
  console.log(`📋 Requirements:${project.requirements}`)
  console.log()

  // Listen to writing events
  storyArena.on('message', (event: AxArenaEvent) => {
    console.log(`📨 New message in thread ${event.threadId}`)
  })

  storyArena.on('response', (event: AxArenaEvent) => {
    const message = event.data as AxArenaMessage
    console.log(`✍️  ${message.sender}:`)
    console.log(`   ${message.content.substring(0, 150)}...`)
    console.log()
  })

  console.log('🔄 Starting collaborative story writing workflow...')
  console.log()

  try {
    // Send a comprehensive story writing request
    const storyRequest = `Create a compelling science fiction story about first contact with the following requirements:

    Genre: Science Fiction
    Theme: First Contact with Alien Life
    Setting: Near future (circa 2075)
    Length: 1000-1500 words
    
    Story Elements:
    - Emotional focus on the human experience of first contact
    - Include both human and alien perspectives if possible
    - Themes of communication, understanding, and hope
    - Realistic near-future technology
    - Strong character development
    - Surprising but logical resolution
    
    Please create a complete, polished story with rich world-building, engaging characters, and compelling narrative.`

    console.log('📝 Sending story request to writing team...')
    console.log(
      `💭 Request: Create a science fiction story about first contact...`
    )
    console.log()

    const response = await storyArena.sendMessage(
      thread.id,
      storyRequest,
      'client'
    )

    console.log(
      `✅ Story creation completed! Writers executed ${response.selectedAgents.length} tasks`
    )
    console.log(`✍️  Writers involved: ${response.selectedAgents.join(', ')}`)
    console.log(`⏱️  Total writing time: ${response.processingTime}ms`)
    console.log()

    // Show the execution plan details
    const plan = storyArena.getExecutionPlan(thread.id)
    if (plan) {
      console.log('📊 Writing Plan Details:')
      console.log(`   Plan ID: ${plan.id}`)
      console.log(`   Status: ${plan.status}`)
      console.log(`   Total Tasks: ${plan.tasks.length}`)
      console.log(
        `   Completed Tasks: ${plan.tasks.filter((t) => t.status === 'completed').length}`
      )
      console.log()

      console.log('📋 Writing Process Breakdown:')
      plan.tasks.forEach((task, index) => {
        const statusIcon =
          task.status === 'completed'
            ? '✅'
            : task.status === 'in-progress'
              ? '🔄'
              : task.status === 'failed'
                ? '❌'
                : '⏳'
        console.log(`   ${index + 1}. ${statusIcon} ${task.description}`)
        console.log(`      └── Writer: ${task.assignedAgentName}`)
        console.log(`      └── Status: ${task.status}`)
        if (task.result) {
          console.log(`      └── Output: ${task.result.substring(0, 100)}...`)
        }
        console.log()
      })
    }

    // Demonstrate follow-up revision request
    console.log('🔄 Sending revision request...')
    const revisionRequest =
      'Please revise the story to add more emotional depth to the first contact moment and enhance the alien perspective.'

    const followUpResponse = await storyArena.sendMessage(
      thread.id,
      revisionRequest,
      'editor'
    )

    console.log(
      `✅ Revision completed with ${followUpResponse.selectedAgents.length} additional tasks`
    )
    console.log(`⏱️  Revision time: ${followUpResponse.processingTime}ms`)
  } catch (error) {
    console.error(`❌ Error in story writing workflow: ${error}`)
  }

  // Display final story summary
  const finalThread = storyArena.getThread(thread.id)
  if (finalThread) {
    console.log('\n📖 Story Writing Session Summary:')
    console.log(`   Genre: ${project.genre}`)
    console.log(`   Theme: ${project.theme}`)
    console.log(`   Total messages: ${finalThread.messages.length}`)
    console.log(`   Thread status: ${finalThread.status}`)
    console.log(
      `   Writing session duration: ${finalThread.updatedAt.getTime() - finalThread.createdAt.getTime()}ms`
    )

    // Writer participation summary
    const writerParticipation = agents.reduce(
      (acc, agent) => {
        const agentName = agent.getFunction().name
        const responseCount = finalThread.messages.filter(
          (m) => m.sender === agentName
        ).length
        acc[agentName] = responseCount
        return acc
      },
      {} as Record<string, number>
    )

    console.log('\n👥 Writer Participation:')
    Object.entries(writerParticipation).forEach(([writer, count]) => {
      console.log(`   ${writer}: ${count} contributions`)
    })

    // Show writing timeline
    console.log('\n📅 Writing Timeline:')
    finalThread.messages
      .filter((m) => m.sender !== 'system')
      .slice(-6) // Show last 6 messages
      .forEach((msg, index) => {
        const timeFromStart =
          msg.timestamp.getTime() - finalThread.createdAt.getTime()
        console.log(`   ${index + 1}. [+${timeFromStart}ms] ${msg.sender}`)
        console.log(`      ${msg.content.substring(0, 80)}...`)
      })
  }

  console.log('\n🎉 Collaborative story writing session completed!')
  console.log('📚 Ready for the next creative project!')
}

// Available story projects for demonstration
function showAvailableProjects() {
  console.log('\n📚 Available Story Projects:')
  storyProjects.forEach((project, index) => {
    console.log(`\n${index + 1}. ${project.genre}: ${project.theme}`)
    console.log(`   Requirements: ${project.requirements.trim()}`)
    console.log(`   Complexity: ${project.complexity}`)
  })
}

// Writing analytics simulation
async function simulateWritingAnalytics() {
  console.log('\n📊 Writing Analytics Dashboard')
  console.log('-'.repeat(40))

  const analytics = {
    'Story Completion Times': {
      'World Building': '2.3 minutes',
      'Plot Development': '3.1 minutes',
      'Dialogue Writing': '2.8 minutes',
      'Narrative Writing': '4.2 minutes',
      'Final Editing': '1.9 minutes',
    },
    'Writer Efficiency': {
      'World Builder': '92% accuracy',
      'Plot Developer': '88% consistency',
      'Dialogue Writer': '95% natural flow',
      'Narrative Writer': '90% descriptive quality',
      'Story Editor': '97% polish rate',
    },
  }

  Object.entries(analytics).forEach(([category, metrics]) => {
    console.log(`\n📈 ${category}:`)
    Object.entries(metrics).forEach(([metric, value]) => {
      console.log(`   ${metric}: ${value}`)
    })
  })
}

// Main execution
async function main() {
  await demonstrateStoryArena()
  showAvailableProjects()
  await simulateWritingAnalytics()
}

// Run the story writing arena demonstration
if (import.meta.url.includes('arena.ts')) {
  main().catch(console.error)
}

export { demonstrateStoryArena, storyProjects, storyArena }
