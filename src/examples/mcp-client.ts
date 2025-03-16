import {
  AxAgent,
  AxAI,
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStdioTransport,
} from '@ax-llm/ax'

// Initialize the MCP client with server-memory
const stdioTransport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
})
const client = new AxMCPClient(stdioTransport, { debug: true })
await client.init()

// Create a memory-augmented agent that can remember past conversations
const memoryAgent = new AxAgent<
  { input: string; userId: string },
  { response: string }
>({
  name: 'MemoryAssistant',
  description: 'An assistant that remembers past conversations with users',
  signature: 'input, userId -> response',
  functions: [client],
})

// Initialize the AI model
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  models: [
    {
      key: 'default',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Default model for conversations',
    },
  ],
})

// Example conversation flow
async function runConversation() {
  const userId = 'user123'

  // First interaction - the agent will store this in memory
  console.log('\n--- First interaction ---')
  const firstResponse = await memoryAgent.forward(ai, {
    input: 'My name is Alice and my favorite color is blue.',
    userId,
  })
  console.log('User: My name is Alice and my favorite color is blue.')
  console.log(`Assistant: ${firstResponse.response}`)

  // Second interaction - the agent should remember information from before
  console.log('\n--- Second interaction (later) ---')
  const secondResponse = await memoryAgent.forward(ai, {
    input: "What's Alice's favorite color?",
    userId,
  })
  console.log("User: What's Alice's favorite color?")
  console.log(`Assistant: ${secondResponse.response}`)

  // Third interaction - testing memory persistence
  console.log('\n--- Third interaction (even later) ---')
  const thirdResponse = await memoryAgent.forward(ai, {
    input:
      'Can you remind me what my name is and summarize what you know about me?',
    userId,
  })
  console.log(
    'User: Can you remind me what my name is and summarize what you know about me?'
  )
  console.log(`Assistant: ${thirdResponse.response}`)
}

// Run the example
await runConversation()
