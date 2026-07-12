// ax-example:start
// title: TypeScript Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without converting tools to functions.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 60
// ax-example:end
import {
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStreamableHTTPTransport,
  ai,
  ax,
} from '@ax-llm/ax';
import { AxMCPEventDemoServer } from '../../mcp-event-demo-server.js';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');

const server = new AxMCPEventDemoServer();
const endpoint = await server.start();
const mcp = new AxMCPClient(new AxMCPStreamableHTTPTransport(endpoint), {
  namespace: 'inventory',
});
const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const program = ax(
  'request:string -> answer:string "Use the inventory MCP tool and report its task id."',
  { mcp }
);

try {
  console.log(await program.forward(llm, { request: 'Reindex inventory.' }));
} finally {
  await mcp.close();
  await server.close();
}
