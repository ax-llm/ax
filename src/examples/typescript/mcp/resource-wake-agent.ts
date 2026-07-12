// ax-example:start
// title: TypeScript MCP Resource Wake
// group: mcp
// description: Routes a subscribed MCP resource update through AxEventRuntime to an authenticated Agent.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// story: 61
// ax-example:end
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
  config: { model: AxAIOpenAIModel.GPT54Mini },
});
const program = agent('uri:string -> summary:string', {
  runtime: new AxJSRuntime(),
});
const runtime = eventRuntime({
  allowVolatile: true,
  sources: [
    new AxMCPEventSource({
      client: mcp,
      resources: ['demo://inventory'],
      identity: { tenantId: 'demo' },
      trust: 'authenticated',
    }),
  ],
  routes: [
    eventRoute({
      id: 'resource-wake',
      action: 'wake',
      requireAuthenticated: true,
      match: { types: ['mcp.resource.updated'] },
      target: eventTarget({
        id: 'inventory-agent',
        ai: llm,
        program,
        mapInput: ({ event }) => ({ uri: (event.data as { uri: string }).uri }),
        forwardOptions: { mcp },
        sinks: [{ id: 'console', write: console.log }],
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
  await mcp.close();
  await server.close();
}
