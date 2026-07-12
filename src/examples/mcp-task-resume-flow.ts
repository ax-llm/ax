import {
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPEventSource,
  AxMCPStreamableHTTPTransport,
  AxPushEventSource,
  ai,
  axMCPEventRoutes,
  eventRoute,
  eventRuntime,
  eventTarget,
  flow,
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
const workflow = flow<{ request: string; phase: string }>()
  .node(
    'handle',
    'request:string, phase:string -> answer:string "During start, call the required inventory tool. During completed, only report the result."'
  )
  .execute('handle', (state) => ({
    request: state.request,
    phase: state.phase,
  }))
  .returns((state) => ({ answer: state.handleResult.answer as string }));
const push = new AxPushEventSource('application');
const mcpSource = new AxMCPEventSource({
  client,
  identity: { tenantId: 'demo' },
  trust: 'authenticated',
});
const target = eventTarget({
  id: 'reindex-flow',
  ai: llm,
  program: workflow,
  mapInput: ({ event }) =>
    event.type === 'job.reindex.requested'
      ? { request: 'Start the inventory reindex.', phase: 'start' }
      : { request: 'The inventory reindex completed.', phase: 'completed' },
  forwardOptions: { mcp: client },
  retrySafety: 'idempotent',
  sinks: [{ id: 'console', write: (output) => console.log(output) }],
});
const runtime = eventRuntime({
  allowVolatile: true,
  sources: [push, mcpSource],
  routes: [
    eventRoute({
      id: 'start-reindex-flow',
      match: { types: ['job.reindex.requested'] },
      action: 'wake',
      target,
    }),
    ...axMCPEventRoutes({
      client,
      onObserve: ({ event }) => console.log(event.type, event.data),
    }),
  ],
});

try {
  await runtime.start();
  await push.publish({
    event: {
      specversion: '1.0',
      id: 'reindex-request-1',
      source: 'app://inventory',
      type: 'job.reindex.requested',
    },
    identity: { tenantId: 'demo' },
    trust: 'authenticated',
  });
  await runtime.waitForIdle();
  const task = client.getKnownTasks()[0];
  if (!task) throw new Error('The flow did not create an MCP task.');
  server.completeTask(task.taskId);
  await runtime.waitForIdle();
} finally {
  await runtime.close({ drain: false });
  await client.close();
  await server.close();
}
