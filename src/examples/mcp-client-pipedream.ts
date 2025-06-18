import { AxAgent, AxAI, AxAIOpenAIModel, AxMCPClient } from '@ax-llm/ax'
import { AxMCPStreambleHTTPTransport } from '@ax-llm/ax/mcp/httpTransport.js'
import { createBackendClient } from '@pipedream/sdk/server'

/*
# Pipedream configuration
export PIPEDREAM_ENVIRONMENT="your_environment"
export PIPEDREAM_CLIENT_ID="your_client_id"
export PIPEDREAM_CLIENT_SECRET="your_client_secret"  
export PIPEDREAM_PROJECT_ID="your_project_id"

# OpenAI API key for the AI model
export OPENAI_APIKEY="your_openai_api_key"
*/

// Environment variables for Pipedream configuration
const pipedreamEnvironment = 'development'
const pipedreamClientId = process.env.PIPEDREAM_CLIENT_ID as string
const pipedreamClientSecret = process.env.PIPEDREAM_CLIENT_SECRET as string
const pipedreamProjectId = process.env.PIPEDREAM_PROJECT_ID as string

// Initialize the Pipedream SDK client
const pd = createBackendClient({
  environment: pipedreamEnvironment,
  credentials: {
    clientId: pipedreamClientId,
    clientSecret: pipedreamClientSecret,
  },
  projectId: pipedreamProjectId,
})

// Get app information and access token
async function setupPipedreamMCP() {
  // Find the app to use for the MCP server (Notion in this case)
  const apps = await pd.getApps({ q: 'notion' })
  if (!apps.data[0]) {
    throw new Error('No Notion app found')
  }
  const appSlug = apps.data[0].name_slug // e.g., "notion"
  const appLabel = apps.data[0].name // e.g., "Notion"

  // Get access token for MCP server auth
  const accessToken = await pd.rawAccessToken()

  // Send the unique ID that you use to identify this user in your system
  const externalUserId = 'abc-123' // Used in MCP URL to identify the user

  return { appSlug, appLabel, accessToken, externalUserId }
}

async function createNotionAgent() {
  const { appSlug, appLabel, accessToken, externalUserId } =
    await setupPipedreamMCP()

  // Initialize the MCP client with Pipedream's streamable HTTP transport
  const httpTransport = new AxMCPStreambleHTTPTransport(
    'https://remote.mcp.pipedream.net',
    {
      headers: {
        'x-pd-project-id': pipedreamProjectId,
        'x-pd-environment': pipedreamEnvironment,
        'x-pd-external-user-id': externalUserId,
        'x-pd-app-slug': appSlug,
      },
      authorization: `Bearer ${accessToken}`,
    }
  )

  console.log(`
Configuration for Pipedream MCP:
- App: ${appLabel} (${appSlug})
- User ID: ${externalUserId}
- Environment: ${pipedreamEnvironment}
- Project ID: ${pipedreamProjectId}
- Access Token: ${accessToken.substring(0, 10)}...

Using streamable HTTP transport for real-time communication with Pipedream MCP server.
`)

  const client = new AxMCPClient(httpTransport, { debug: false })
  await client.init()

  // Create a Notion-augmented agent that can interact with Notion docs
  const notionAgent = new AxAgent<
    { userRequest: string },
    { assistantResponse: string }
  >({
    name: 'NotionAssistant',
    description: `You are an assistant that can interact with ${appLabel} documents and data. You can read, search, and analyze Notion content to help users with their requests. Use the provided Notion functions to access and work with the user's documents.`,
    signature: 'userRequest -> assistantResponse',
    functions: [client],
  })

  return notionAgent
}

// Initialize the AI model
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
  config: { model: AxAIOpenAIModel.GPT4OMini },
})
ai.setOptions({ debug: true })

// Example usage
async function runNotionExample() {
  console.log('Initializing Notion MCP client...')
  const notionAgent = await createNotionAgent()

  console.log('\n--- Requesting Notion document summary and email draft ---')
  const response = await notionAgent.forward(ai, {
    userRequest:
      'Summarize my most recently created Notion doc for me and help draft an email to our customers',
  })

  console.log(
    'User: Summarize my most recently created Notion doc for me and help draft an email to our customers'
  )
  console.log(`Assistant: ${response.assistantResponse}`)
}

// Run the example
await runNotionExample()
