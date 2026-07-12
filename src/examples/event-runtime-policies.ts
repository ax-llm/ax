import { AxPushEventSource, eventRoute, eventRuntime } from '@ax-llm/ax';

const source = new AxPushEventSource('application');
let catalogVersion = 1;

const runtime = eventRuntime({
  sources: [source],
  routes: [
    eventRoute({
      id: 'observe-progress',
      match: { types: ['job.progress'] },
      action: 'observe',
      observe: ({ event }) => console.log('progress', event.data),
    }),
    eventRoute({
      id: 'invalidate-catalog',
      match: { types: ['catalog.changed'] },
      action: 'invalidate',
      invalidator: {
        invalidate: () => {
          catalogVersion++;
        },
      },
    }),
  ],
});

await runtime.start();
await source.publish({
  event: {
    specversion: '1.0',
    id: 'progress-1',
    source: 'app://jobs',
    type: 'job.progress',
    data: { percent: 50 },
  },
  trust: 'trusted',
});
await source.publish({
  event: {
    specversion: '1.0',
    id: 'catalog-1',
    source: 'app://catalog',
    type: 'catalog.changed',
  },
  trust: 'trusted',
});
await runtime.waitForIdle();
console.log('catalog version', catalogVersion);
await runtime.close();
