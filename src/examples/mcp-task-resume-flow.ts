import {
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPEventSource,
  AxMCPStreamableHTTPTransport,
  AxPushEventSource,
  ai,
  axMCPEventRoutes,
  eventPath,
  eventRoute,
  eventRuntime,
  eventTarget,
  flow,
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
const workflow = flow<{ taskRequest: string; phase: string }>()
  .node(
    'handle',
    'taskRequest:string, phase:string -> answer:string "During start, call the required inventory tool. During completed, only report the result."'
  )
  .execute('handle', (state) => ({
    taskRequest: state.taskRequest,
    phase: state.phase,
  }))
  .returns((state) => ({ answer: state.handleResult.answer as string }));
const push = new AxPushEventSource('application');
const mcpSource = new AxMCPEventSource({
  client,
  identity: { tenantId: 'demo' },
  trust: 'authenticated',
});
let completeResume!: () => void;
const resumeCompleted = new Promise<void>((resolve) => {
  completeResume = resolve;
});
const target = eventTarget('reindex-flow')
  .program(workflow)
  .ai(llm)
  .wakeInput((input) =>
    input
      .field('taskRequest', eventPath.constant('Start the inventory reindex.'))
      .field('phase', eventPath.constant('start'))
  )
  .resumeInput((input) =>
    input
      .field(
        'taskRequest',
        eventPath.constant('The inventory reindex completed.')
      )
      .field('phase', eventPath.constant('completed'))
  )
  .forwardOptions({ mcp: client })
  .retrySafety('idempotent')
  .sink({
    id: 'console',
    write: (output) => {
      console.log(output);
      completeResume();
    },
  })
  .build();
const runtime = eventRuntime({
  allowVolatile: true,
  sources: [push, mcpSource],
  routes: [
    eventRoute('start-reindex-flow')
      .types('job.reindex.requested')
      .wake(target)
      .build(),
    ...axMCPEventRoutes({
      client,
      onObserve: ({ event }) => console.log(event.type, event.data),
    }),
  ],
});

try {
  await runtime.start();
  await server.waitForListeningConnection();
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
  const taskId = await server.waitForTask();
  server.completeTask(taskId);
  await waitForDemoSignal(resumeCompleted, 'the MCP task continuation');
  await runtime.waitForIdle();
} finally {
  await runtime.close({ drain: false });
  await client.close();
  await server.close();
}
