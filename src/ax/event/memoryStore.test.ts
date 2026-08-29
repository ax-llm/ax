import { getEventListeners } from 'node:events';

import { describe, expect, it } from 'vitest';

import { AxInMemoryEventStore } from './memoryStore.js';
import type { AxEventIngress } from './types.js';

function ingress(id: string, type: string): AxEventIngress {
  return {
    event: {
      specversion: '1.0',
      id,
      source: 'app://tests',
      type,
      data: { value: id },
    },
  };
}

function descriptor(instanceKey: string) {
  return {
    routeId: 'route',
    action: 'observe' as const,
    instanceKey,
    sizeBytes: 10,
  };
}

describe('AxInMemoryEventStore.waitForWork', () => {
  it('does not leak abort listeners on a reused signal', async () => {
    const store = new AxInMemoryEventStore();
    const controller = new AbortController();
    const { signal } = controller;

    // Mirror a worker loop: repeatedly wait for work, let work arrive (which
    // resolves the wait), then drain the queue so the next iteration waits
    // again. Each resolved wait must clean up its abort listener.
    for (let i = 0; i < 25; i++) {
      const waited = store.waitForWork(signal);
      await store.enqueue({
        ingress: ingress(`event-${i}`, 'work'),
        // A distinct instanceKey per iteration keeps claim() from being blocked
        // by the previously claimed (non-terminal) delivery.
        deliveries: [descriptor(`instance-${i}`)],
        acceptedAt: Date.now(),
        publishTimeoutMs: 1_000,
      });
      await waited;
      // Claim the delivery so it is no longer 'queued' and the next
      // waitForWork() actually waits instead of returning early.
      await store.claim(`worker-${i}`, Date.now());
    }

    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });

  it('still rejects and cleans up when the signal aborts', async () => {
    const store = new AxInMemoryEventStore();
    const controller = new AbortController();
    const { signal } = controller;

    const waited = store.waitForWork(signal);
    const reason = new Error('shutting down');
    controller.abort(reason);

    await expect(waited).rejects.toBe(reason);
    expect(getEventListeners(signal, 'abort').length).toBe(0);
  });
});
