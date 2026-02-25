import {
  type AxAgentFunction,
  type AxFunction,
  AxJSRuntime,
  AxMCPClient,
  agent,
  ai,
} from '@ax-llm/ax';
import { AxMCPHTTPSSETransport } from '@ax-llm/ax/mcp/transports/sseTransport.js';

/*
# Notion MCP configuration
export OPENAI_APIKEY="your_openai_api_key"
# Optional OAuth config
# export MCP_OAUTH_CLIENT_ID="your_client_id"
# export MCP_OAUTH_CLIENT_SECRET="your_client_secret"
# export MCP_OAUTH_REDIRECT_URI="http://localhost:8787/callback"
# export MCP_OAUTH_SCOPES="openid,offline_access"
*/

async function createNotionAgent() {
  // Initialize the MCP client with SSE transport and OAuth 2.1 (per MCP spec)
  const sseTransport = new AxMCPHTTPSSETransport('https://mcp.notion.com/sse', {
    oauth: {
      clientId: process.env.MCP_OAUTH_CLIENT_ID,
      clientSecret: process.env.MCP_OAUTH_CLIENT_SECRET,
      redirectUri:
        process.env.MCP_OAUTH_REDIRECT_URI ?? 'http://localhost:8787/callback',
      scopes: process.env.MCP_OAUTH_SCOPES?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      onAuthCode: async (authorizationUrl: string) => {
        console.log('\n=== Authorization Required (SSE) ===');
        console.log('Open this URL in your browser to authorize:');
        console.log(authorizationUrl);

        // Paste the FULL redirect URL you were sent back to (contains ?code=...)
        const { createInterface } = await import('node:readline/promises');
        const { stdin: input, stdout: output } = await import('node:process');
        const rl = createInterface({ input, output });
        const redirectUrl = await rl.question(
          '\nPaste the FULL redirect URL from your browser: '
        );
        rl.close();

        try {
          const url = new URL(redirectUrl.trim());
          const code = url.searchParams.get('code');
          if (!code)
            throw new Error('No "code" parameter found in redirect URL');
          const redirectUri = `${url.origin}${url.pathname}`;
          return { code, redirectUri };
        } catch (err) {
          throw new Error(`Invalid redirect URL: ${String(err)}`);
        }
      },
    },
  });

  console.log(
    `\nConfiguration for Notion MCP (SSE):\nUsing SSE transport for communication with Notion MCP server.\n`
  );

  const client = new AxMCPClient(sseTransport, { debug: false });
  await client.init();

  const toAgentFunctions = (functions: AxFunction[]): AxAgentFunction[] =>
    functions.map((fn) => ({
      ...fn,
      parameters: fn.parameters ?? { type: 'object', properties: {} },
    }));

  // Create a Notion-augmented agent that can interact with Notion docs
  const notionAgent = agent(
    'userRequest:string -> assistantResponse:string "You are an assistant that can interact with Notion documents and data via SSE. Execute the user\'s request without question and to the best of your abilities."',
    {
      functions: { local: toAgentFunctions(client.toFunction()) },
      contextFields: [],
      runtime: new AxJSRuntime(),
    }
  );

  return notionAgent;
}

// Initialize the AI model
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

// Example usage
async function runNotionSSEExample() {
  console.log('Initializing Notion MCP client (SSE)...');
  const notionAgent = await createNotionAgent();

  console.log('\n--- Requesting Notion document summary (SSE) ---');
  const response = await notionAgent.forward(llm, {
    userRequest:
      'Give me a high-level structural summary of my entire notion workspace.',
  });

  console.log(
    'User: Give me a high-level structural summary of my entire notion workspace.'
  );
  console.log(`Assistant: ${response.assistantResponse}`);
}

// Run the example
(async () => {
  await runNotionSSEExample();
})();
