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
const client = new AxMCPClient(stdioTransport, { debug: false })
await client.init()

// Create a memory-augmented agent that can remember past conversations
const memoryAgent = new AxAgent<
  { input: string; userId: string },
  { response: string }
>({
  name: 'MemoryAssistant',
  description:
    'You are an assistant that remembers past conversations with users. You break down the information to be remembered by entity identifiers and the content to remeber. Use the provided database functions to manage memories, search for memories, and add memories. Use multiple searches with different entity identifiers to get a holistic view of the user.',
  signature: 'input, userId -> response',
  functions: [client],
})

// Initialize the AI model
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
})
ai.setOptions({ debug: true })

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
    input: "What's my favorite color?",
    userId,
  })
  console.log('User: What is my favorite color?')
  console.log(`Assistant: ${secondResponse.response}`)

  // Third interaction - the agent should remember information from before
  console.log('\n--- Third interaction (later) ---')
  const thirdResponse = await memoryAgent.forward(ai, {
    input: "What's my favorite color?",
    userId,
  })
  console.log('User: What do you know about me?')
  console.log(`Assistant: ${thirdResponse.response}`)
}

// Run the example
await runConversation()
