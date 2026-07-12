import { describe, expect, it, vi } from 'vitest';
import { AxAgentClarificationError } from '../agent/agentInternal/agentStateTypes.js';
import type { AxProgrammable } from '../dsp/types.js';
import { AxInMemoryEventStore } from './memoryStore.js';
import { AxEventRuntime, eventRoute, eventTarget } from './runtime.js';
import { AxPushEventSource, AxTimerEventSource } from './sources.js';
import {
  AxEventBackpressureError,
  type AxEventIngress,
  type AxEventSink,
  AxManualEventClock,
} from './types.js';

const ai = {} as any;

function program(
  forward: (input: any, options?: any) => unknown | Promise<unknown>,
  id = 'test-program'
): AxProgrammable<any, any> {
  return {
    getId: () => id,
    forward: (_ai: unknown, input: unknown, options?: unknown) =>
      Promise.resolve(forward(input, options)),
    streamingForward: async function* () {},
  } as unknown as AxProgrammable<any, any>;
}

function ingress(
  id: string,
  type: string,
  options: Partial<AxEventIngress> = {}
): AxEventIngress {
  return {
    event: {
      specversion: '1.0',
      id,
      source: 'app://tests',
      type,
      data: { value: id },
    },
    ...options,
  };
}

describe('AxEventRuntime', () => {
  it('does not invoke a program for observe or unmatched events', async () => {
    const observed = vi.fn();
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute({
          id: 'observe-audit',
          match: { types: ['audit.created'] },
          action: 'observe',
          observe: observed,
        }),
      ],
    });
    await runtime.start();
    const unmatched = await runtime.publish(ingress('1', 'other'));
    const matched = await runtime.publish(ingress('2', 'audit.created'));
    await runtime.waitForIdle();
    expect(unmatched.deliveryIds).toEqual([]);
    expect(matched.deliveryIds).toHaveLength(1);
    expect(observed).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it('persists a program result before dispatching its sink', async () => {
    const store = new AxInMemoryEventStore();
    const runtimeRef: { value?: AxEventRuntime } = {};
    const sink: AxEventSink = {
      id: 'capture',
      write: async (output, context) => {
        const persisted = await runtimeRef.value!.getRun(context.run.id);
        expect(persisted?.output).toEqual(output);
      },
    };
    const target = eventTarget({
      id: 'summarize',
      ai,
      program: program(({ value }) => ({ summary: `seen:${value}` })),
      mapInput: (value) => value.event.data,
      retrySafety: 'idempotent',
      sinks: [sink],
    });
    const runtime = new AxEventRuntime({
      store,
      routes: [
        eventRoute({
          id: 'wake-summary',
          match: { types: ['document.changed'] },
          action: 'wake',
          target,
        }),
      ],
    });
    runtimeRef.value = runtime;
    await runtime.start();
    const receipt = await runtime.publish(ingress('doc-1', 'document.changed'));
    await runtime.waitForIdle();
    const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
    const run = await runtime.getRun(delivery!.runId!);
    expect(run?.status).toBe('succeeded');
    expect(run?.sinks).toEqual([
      { sinkId: 'capture', attempts: 1, status: 'succeeded' },
    ]);
    await runtime.close();
  });

  it('scopes dedupe by verified identity and rejects anonymous auth routes', async () => {
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute({
          id: 'secure-observe',
          match: { types: ['secure.changed'] },
          action: 'observe',
          requireAuthenticated: true,
        }),
      ],
    });
    await runtime.start();
    const anonymous = await runtime.publish(ingress('same', 'secure.changed'));
    const tenantA = ingress('same', 'secure.changed', {
      identity: { tenantId: 'a' },
      trust: 'authenticated',
    });
    const tenantB = ingress('same', 'secure.changed', {
      identity: { tenantId: 'b' },
      trust: 'authenticated',
    });
    const firstA = await runtime.publish(tenantA);
    const secondA = await runtime.publish(tenantA);
    const firstB = await runtime.publish(tenantB);
    await runtime.waitForIdle();
    expect(anonymous.deliveryIds).toEqual([]);
    expect(firstA.duplicate).toBe(false);
    expect(secondA.duplicate).toBe(true);
    expect(firstB.duplicate).toBe(false);
    await runtime.close();
  });

  it('retries only an explicitly idempotent target', async () => {
    let calls = 0;
    const target = eventTarget({
      id: 'retryable',
      ai,
      program: program(() => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return { ok: true };
      }),
      mapInput: (value) => value.event.data,
      retrySafety: 'idempotent',
    });
    const runtime = new AxEventRuntime({
      retryBaseMs: 1,
      retryMaxMs: 1,
      routes: [
        eventRoute({
          id: 'retry-route',
          match: { types: ['retry'] },
          action: 'wake',
          target,
        }),
      ],
    });
    await runtime.start();
    await runtime.publish(ingress('retry-1', 'retry'));
    await runtime.waitForIdle();
    expect(calls).toBe(2);
    expect(await runtime.listDeadLetters()).toEqual([]);
    await runtime.close();
  });

  it('marks an uncertain target failure outcome_unknown without replaying it', async () => {
    const store = new AxInMemoryEventStore();
    const forward = vi.fn(() => {
      throw new Error('may have sent a message');
    });
    const target = eventTarget({
      id: 'unsafe',
      ai,
      program: program(forward),
      mapInput: (value) => value.event.data,
    });
    const runtime = new AxEventRuntime({
      store,
      routes: [
        eventRoute({
          id: 'unsafe-route',
          match: { types: ['unsafe'] },
          action: 'wake',
          target,
        }),
      ],
    });
    await runtime.start();
    const receipt = await runtime.publish(ingress('unsafe-1', 'unsafe'));
    await runtime.waitForIdle();
    const delivery = await store.getDelivery(receipt.deliveryIds[0]!);
    expect(delivery?.status).toBe('outcome_unknown');
    expect(forward).toHaveBeenCalledOnce();
    expect(await runtime.listDeadLetters()).toHaveLength(1);
    await runtime.close();
  });

  it('registers and resumes a correlated continuation', async () => {
    const forward = vi.fn(({ phase }) => ({ phase }));
    const target = eventTarget({
      id: 'continuable',
      ai,
      program: program(forward),
      mapInput: (value, context) => {
        if (value.event.type === 'job.started') {
          context.eventContext.registerContinuation({
            correlation: [{ kind: 'job', value: 'job-42' }],
          });
          return { phase: 'started' };
        }
        return { phase: 'resumed' };
      },
      retrySafety: 'idempotent',
    });
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute({
          id: 'start-job',
          match: { types: ['job.started'] },
          action: 'wake',
          target,
        }),
        eventRoute({
          id: 'resume-job',
          match: { types: ['job.completed'] },
          action: 'resume',
          target,
          correlation: () => ({ kind: 'job', value: 'job-42' }),
        }),
      ],
    });
    await runtime.start();
    await runtime.publish(ingress('job-start', 'job.started'));
    await runtime.waitForIdle();
    await runtime.publish(ingress('job-complete', 'job.completed'));
    await runtime.waitForIdle();
    expect(forward).toHaveBeenNthCalledWith(
      1,
      { phase: 'started' },
      expect.anything()
    );
    expect(forward).toHaveBeenNthCalledWith(
      2,
      { phase: 'resumed' },
      expect.anything()
    );
    await runtime.close();
  });

  it('turns Agent clarification into a durable waiting_event continuation', async () => {
    let calls = 0;
    const target = eventTarget({
      id: 'clarifying-agent',
      ai,
      program: program(() => {
        calls++;
        if (calls === 1) {
          throw new AxAgentClarificationError('Which account?');
        }
        return { answer: 'resumed' };
      }),
      mapInput: (value) => value.event.data,
      retrySafety: 'idempotent',
    });
    const store = new AxInMemoryEventStore();
    const runtime = new AxEventRuntime({
      store,
      routes: [
        eventRoute({
          id: 'ask',
          match: { types: ['agent.ask'] },
          action: 'wake',
          target,
        }),
        eventRoute({
          id: 'answer',
          match: { types: ['agent.answer'] },
          action: 'resume',
          correlation: (value) => ({
            kind: 'ax.clarification',
            value: String((value.event.data as { runId: string }).runId),
          }),
        }),
      ],
    });
    await runtime.start();
    const started = await runtime.publish(ingress('clarify-1', 'agent.ask'));
    await runtime.waitForIdle();
    const delivery = await store.getDelivery(started.deliveryIds[0]!);
    const firstRun = await runtime.getRun(delivery!.runId!);
    expect(firstRun?.status).toBe('waiting_event');
    await runtime.publish({
      ...ingress('clarify-2', 'agent.answer'),
      event: {
        ...ingress('clarify-2', 'agent.answer').event,
        data: { runId: firstRun!.id, answer: 'personal' },
      },
    });
    await runtime.waitForIdle();
    expect(calls).toBe(2);
    await runtime.close();
  });

  it('restores state into a fresh per-instance program from createProgram', async () => {
    const observed: number[] = [];
    const target = eventTarget({
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
          forward: async () => {
            count++;
            observed.push(count);
            return { count };
          },
          streamingForward: async function* () {},
        } as AxProgrammable<any, any> & {
          getState(): unknown;
          setState(state: unknown): void;
        };
      },
      mapInput: (value) => value.event.data,
      retrySafety: 'idempotent',
    });
    const runtime = new AxEventRuntime({
      routes: [
        eventRoute({
          id: 'count',
          match: { types: ['counter.increment'] },
          action: 'wake',
          target,
          instanceKey: () => 'account-1',
        }),
      ],
    });
    await runtime.start();
    await runtime.publish(ingress('counter-1', 'counter.increment'));
    await runtime.waitForIdle();
    await runtime.publish(ingress('counter-2', 'counter.increment'));
    await runtime.waitForIdle();
    expect(observed).toEqual([1, 2]);
    await runtime.close();
  });

  it('debounces and explicitly coalesces to the latest event with a fake clock', async () => {
    const clock = new AxManualEventClock(1_000);
    const seen: unknown[] = [];
    const runtime = new AxEventRuntime({
      clock,
      workerConcurrency: 1,
      routes: [
        eventRoute({
          id: 'debounced',
          match: { types: ['search.changed'] },
          action: 'observe',
          debounceMs: 100,
          coalesce: 'latest',
          observe: (value) => seen.push(value.event.data),
        }),
      ],
    });
    await runtime.start();
    const first = await runtime.publish(ingress('search-1', 'search.changed'));
    const second = await runtime.publish(ingress('search-2', 'search.changed'));
    expect(second.deliveryIds).toEqual(first.deliveryIds);
    clock.advanceBy(99);
    await Promise.resolve();
    expect(seen).toEqual([]);
    clock.advanceBy(1);
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(seen).toEqual([{ value: 'search-2' }]);
    await runtime.close({ drain: false });
  });

  it('supervises timer source failures through onSourceError', async () => {
    const clock = new AxManualEventClock(0);
    const onSourceError = vi.fn();
    const source = new AxTimerEventSource({
      id: 'failing-timer',
      intervalMs: 50,
      type: 'timer.tick',
      clock,
      data: () => {
        throw new Error('timer failed');
      },
    });
    const runtime = new AxEventRuntime({
      clock,
      routes: [],
      sources: [source],
      onSourceError,
    });
    await runtime.start();
    clock.advanceBy(50);
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(onSourceError).toHaveBeenCalledWith(
      'failing-timer',
      expect.objectContaining({ message: 'timer failed' })
    );
    await runtime.close({ drain: false });
  });

  it('refuses durable sources on the volatile store by default', async () => {
    const source = new AxPushEventSource('queue', true);
    const runtime = new AxEventRuntime({ routes: [], sources: [source] });
    await expect(runtime.start()).rejects.toThrow('require a persistent');
  });

  it('uses the injected clock for deterministic backpressure timeouts', async () => {
    const clock = new AxManualEventClock(1_000);
    const store = new AxInMemoryEventStore({
      clock,
      maxPendingDeliveries: 1,
    });
    const descriptor = {
      routeId: 'route',
      action: 'observe' as const,
      instanceKey: 'instance',
      sizeBytes: 10,
    };
    await store.enqueue({
      ingress: ingress('capacity-1', 'capacity'),
      deliveries: [descriptor],
      acceptedAt: clock.now(),
      publishTimeoutMs: 5_000,
    });
    const blocked = store.enqueue({
      ingress: ingress('capacity-2', 'capacity'),
      deliveries: [descriptor],
      acceptedAt: clock.now(),
      publishTimeoutMs: 5_000,
    });
    await Promise.resolve();
    clock.advanceBy(5_000);
    await expect(blocked).rejects.toBeInstanceOf(AxEventBackpressureError);
  });
});
