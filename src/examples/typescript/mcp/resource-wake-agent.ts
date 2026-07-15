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
  eventPath,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';
import {
  AxMCPEventDemoServer,
  waitForDemoSignal,
} from '../../mcp-event-demo-server.js';

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
  config: { model: AxAIOpenAIModel.GPT54Mini },
});
const program = agent('uri:string -> summary:string', {
  runtime: new AxJSRuntime(),
});
let completeWake!: () => void;
const wakeCompleted = new Promise<void>((resolve) => {
  completeWake = resolve;
});
const target = eventTarget('inventory-agent')
  .program(program)
  .ai(llm)
  .input((input) => input.field('uri', eventPath.data('uri')))
  .forwardOptions({ mcp })
  .sink({
    id: 'console',
    write: (output) => {
      console.log(output);
      completeWake();
    },
  })
  .build();
const runtime = eventRuntime({
  allowVolatile: true,
  sources: [
    new AxMCPEventSource({
      client: mcp,
      resourceSubscriptions: 'all',
      identity: { tenantId: 'demo' },
      trust: 'authenticated',
    }),
  ],
  routes: [
    eventRoute('resource-wake')
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
  await mcp.close();
  await server.close();
}
