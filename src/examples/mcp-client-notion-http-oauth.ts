import { AxMCPClient, agent, ai } from '@ax-llm/ax';
import { AxMCPStreambleHTTPTransport } from '@ax-llm/ax/mcp/transports/httpStreamTransport.js';

/*
# Notion MCP configuration
export OPENAI_APIKEY="your_openai_api_key"
*/

async function createNotionAgent() {
  // Initialize the MCP client with a generic OAuth 2.1 flow (per MCP spec)
  const httpTransport = new AxMCPStreambleHTTPTransport(
    'https://mcp.notion.com/mcp',
    {
      oauth: {
        clientId: process.env.MCP_OAUTH_CLIENT_ID,
        clientSecret: process.env.MCP_OAUTH_CLIENT_SECRET,
        redirectUri:
          process.env.MCP_OAUTH_REDIRECT_URI ??
          'http://localhost:8787/callback',
        // Optionally request scopes: e.g., ['openid', 'offline_access']
        scopes: process.env.MCP_OAUTH_SCOPES?.split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        onAuthCode: async (authorizationUrl: string) => {
          console.log('\n=== Authorization Required ===');
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
    }
  );

  console.log(`
Configuration for Notion MCP:
Using HTTP transport for communication with Notion MCP server.
`);

  const client = new AxMCPClient(httpTransport, { debug: false });
  await client.init();

  // Create a Notion-augmented agent that can interact with Notion docs
  const notionAgent = agent('userRequest:string -> assistantResponse:string', {
    name: 'NotionAssistant',
    description:
      "You are an assistant that can interact with Notion documents and data via HTTP. Execute the user's request without question and to the best of your abilities.",
    functions: [client],
  });

  return notionAgent;
}

// Initialize the AI model
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

// Example usage
async function runNotionExample() {
  console.log('Initializing Notion MCP client...');
  const notionAgent = await createNotionAgent();

  console.log('\n--- Requesting Notion document summary ---');
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
  await runNotionExample();
})();
