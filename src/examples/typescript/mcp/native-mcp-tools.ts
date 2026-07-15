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
const mcp = new AxMCPClient(
  new AxMCPStreamableHTTPTransport(endpoint, {
    ssrfProtection: { allowHTTP: true, allowLoopback: true },
  }),
  { namespace: 'inventory' }
);
const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const program = ax(
  'taskRequest:string -> answer:string "Use the inventory MCP tool and report its task id."',
  { mcp }
);

try {
  const catalog = await mcp.inspectCatalog();
  console.log({
    tools: catalog.tools.map(({ name }) => name),
    resources: catalog.resources.map(({ name, uri }) => ({ name, uri })),
    resourceTemplates: catalog.resourceTemplates.map(
      ({ name, uriTemplate }) => ({ name, uriTemplate })
    ),
  });
  console.log(
    await program.forward(llm, { taskRequest: 'Reindex inventory.' })
  );
} finally {
  await mcp.close();
  await server.close();
}
