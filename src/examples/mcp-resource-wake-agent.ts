import {
  AxAIOpenAIModel,
  AxJSRuntime,
  AxMCPClient,
  AxMCPEventSource,
  AxMCPStreamableHTTPTransport,
  agent,
  ai,
  eventPath,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';
import {
  AxMCPEventDemoServer,
  waitForDemoSignal,
} from './mcp-event-demo-server.js';

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
const inventoryAgent = agent(
  'uri:string -> summary:string "Read the changed MCP resource and summarize it."',
  { runtime: new AxJSRuntime(), contextFields: [] }
);
const source = new AxMCPEventSource({
  client,
  resourceSubscriptions: 'all',
  identity: { tenantId: 'demo' },
  trust: 'authenticated',
});
let completeWake!: () => void;
const wakeCompleted = new Promise<void>((resolve) => {
  completeWake = resolve;
});
const catalog = await client.inspectCatalog();
const inventoryResource = catalog.resources.find(
  ({ name }) => name === 'Inventory snapshot'
);
if (!inventoryResource)
  throw new Error('Inventory resource was not discovered.');
const target = eventTarget('inventory-agent')
  .program(inventoryAgent)
  .ai(llm)
  .input((input) => input.field('uri', eventPath.data('uri')))
  .forwardOptions({
    mcp: client,
    mcpContext: [
      { client: 'inventory', resource: { uri: inventoryResource.uri } },
    ],
  })
  .retrySafety('idempotent')
  .sink({
    id: 'console',
    write: (output) => {
      console.log(output);
      completeWake();
    },
  })
  .build();
const runtime = eventRuntime({
  // Milestones 1-2 intentionally ship only the volatile in-memory store.
  allowVolatile: true,
  sources: [source],
  routes: [
    eventRoute('inventory-resource-wake')
      .sources('mcp://inventory')
      .types('mcp.resource.updated')
      .authenticated()
      .instanceKey(eventPath.subject())
      .wake(target)
      .build(),
  ],
});

try {
  await runtime.start();
  await server.waitForListeningConnection();
  await server.waitForSubscription('demo://inventory');
  server.updateResource();
  await waitForDemoSignal(wakeCompleted, 'the MCP resource wake');
  await runtime.waitForIdle();
} finally {
  await runtime.close({ drain: false });
  await client.close();
  await server.close();
}
