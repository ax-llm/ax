import {
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStreamableHTTPTransport,
  ai,
  ax,
} from '@ax-llm/ax';
import { AxMCPEventDemoServer } from './mcp-event-demo-server.js';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');

const server = new AxMCPEventDemoServer();
const endpoint = await server.start();
const client = new AxMCPClient(
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
const reindex = ax(
  'taskRequest:string -> answer:string "Use the inventory MCP tool and report the returned task id."',
  { mcp: client }
);

try {
  console.log(
    await reindex.forward(llm, {
      taskRequest: 'Start an inventory reindex for the west warehouse.',
    })
  );
} finally {
  await client.close();
  await server.close();
}
