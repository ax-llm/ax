import {
  AxAIOpenAIModel,
  AxPushEventSource,
  ai,
  ax,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const summarize = ax('change:string -> summary:string');
const source = new AxPushEventSource('demo');

const runtime = eventRuntime({
  sources: [source],
  routes: [
    eventRoute({
      id: 'summarize-change',
      match: { types: ['document.changed'] },
      action: 'wake',
      requireAuthenticated: true,
      target: eventTarget({
        id: 'change-summary',
        ai: llm,
        program: summarize,
        mapInput: ({ event }) => ({
          change: JSON.stringify(event.data),
        }),
        retrySafety: 'idempotent',
        sinks: [
          {
            id: 'console',
            write: (result, { run }) =>
              console.log(run.id, JSON.stringify(result, null, 2)),
          },
        ],
      }),
    }),
  ],
});

await runtime.start();
await source.publish({
  event: {
    specversion: '1.0',
    id: 'document-change-1',
    source: 'app://documents',
    type: 'document.changed',
    subject: 'document-42',
    data: { title: 'AxEventRuntime guide', status: 'ready' },
  },
  identity: { tenantId: 'demo' },
  trust: 'authenticated',
});
await runtime.waitForIdle();
await runtime.close();
