import { AxJSRuntime, AxMCPClient, agent, ai } from '@ax-llm/ax';
import { AxMCPStreamableHTTPTransport } from '@ax-llm/ax/mcp/transports/httpStreamTransport.js';

/*
# Linear MCP configuration
export LINEAR_MCP_TOKEN="your_linear_mcp_or_api_token"
export OPENAI_APIKEY="your_openai_api_key"
*/

const linearToken = process.env.LINEAR_MCP_TOKEN ?? process.env.LINEAR_API_KEY;

if (!linearToken) {
  throw new Error('Set LINEAR_MCP_TOKEN or LINEAR_API_KEY to run this example');
}

const transport = new AxMCPStreamableHTTPTransport(
  'https://mcp.linear.app/mcp',
  {
    authorization: `Bearer ${linearToken}`,
  }
);

const mcpClient = new AxMCPClient(transport, { debug: false });
await mcpClient.init();

const linearAgent = agent(
  'userRequest:string -> response:string "Use Linear MCP tools to inspect and update Linear data. Do not guess issue details; call the available Linear tools when needed."',
  {
    functions: [mcpClient],
    functionDiscovery: true,
    contextFields: [],
    runtime: new AxJSRuntime(),
  }
);

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string,
});

const result = await linearAgent.forward(llm, {
  userRequest: 'Summarize my highest priority assigned Linear issues.',
});

console.log(result.response);
