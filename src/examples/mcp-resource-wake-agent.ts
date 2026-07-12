import {
  AxAIOpenAIModel,
  AxJSRuntime,
  AxMCPClient,
  AxMCPEventSource,
  AxMCPStreamableHTTPTransport,
  agent,
  ai,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';
import { AxMCPEventDemoServer } from './mcp-event-demo-server.js';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');

const server = new AxMCPEventDemoServer();
const endpoint = await server.start();
const client = new AxMCPClient(new AxMCPStreamableHTTPTransport(endpoint), {
  namespace: 'inventory',
});
const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const inventoryAgent = agent(
  'uri:string -> summary:string "Read the changed MCP resource and summarize it."',
  { runtime: new AxJSRuntime(), contextFields: [] }
);
const source = new AxMCPEventSource({
  client,
  resources: ['demo://inventory'],
  identity: { tenantId: 'demo' },
  trust: 'authenticated',
});
const runtime = eventRuntime({
  // Milestones 1-2 intentionally ship only the volatile in-memory store.
  allowVolatile: true,
  sources: [source],
  routes: [
    eventRoute({
      id: 'inventory-resource-wake',
      match: {
        sources: ['mcp://inventory'],
        types: ['mcp.resource.updated'],
      },
      action: 'wake',
      requireAuthenticated: true,
      target: eventTarget({
        id: 'inventory-agent',
        ai: llm,
        program: inventoryAgent,
        mapInput: ({ event }) => ({
          uri: (event.data as { uri: string }).uri,
        }),
        forwardOptions: {
          mcp: client,
          mcpContext: [
            { client: 'inventory', resource: { uri: 'demo://inventory' } },
          ],
        },
        retrySafety: 'idempotent',
        sinks: [{ id: 'console', write: (output) => console.log(output) }],
      }),
    }),
  ],
});

try {
  await runtime.start();
  server.updateResource();
  await runtime.waitForIdle();
} finally {
  await runtime.close({ drain: false });
  await client.close();
  await server.close();
}
