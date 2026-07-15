import type { AxAIService, AxProgrammable } from '@ax-llm/ax';
import { eventRoute, eventRuntime, eventTarget } from '@ax-llm/ax';

const ai = {} as AxAIService;
const observed: number[] = [];

const runtime = eventRuntime({
  routes: [
    eventRoute({
      id: 'increment-counter',
      match: { types: ['counter.increment'] },
      action: 'wake',
      instanceKey: ({ identity }) => identity?.accountId ?? 'anonymous',
      target: eventTarget({
        id: 'counter',
        ai,
        createProgram: () => {
          let count = 0;
          return {
            getId: () => 'counter-v1',
            getState: () => ({ count }),
            setState: (state: unknown) => {
              count = (state as { count: number }).count;
            },
            forward: async () => ({ count: ++count }),
            streamingForward: async function* () {},
          } as unknown as AxProgrammable<any, { count: number }> & {
            getState(): unknown;
            setState(state: unknown): void;
          };
        },
        mapInput: () => ({}),
        retrySafety: 'idempotent',
        sinks: [
          {
            id: 'capture',
            write: ({ count }) => {
              observed.push(count);
            },
          },
        ],
      }),
    }),
  ],
});

await runtime.start();
for (const id of ['increment-1', 'increment-2']) {
  await runtime.publish({
    event: {
      specversion: '1.0',
      id,
      source: 'app://counter',
      type: 'counter.increment',
    },
    identity: { accountId: 'demo' },
    trust: 'authenticated',
  });
  await runtime.waitForIdle();
}
console.log(observed); // [1, 2] — state was restored into a fresh program.
await runtime.close();
