import { getEventListeners } from 'node:events';

import { describe, expect, it } from 'vitest';

import { AxInMemoryEventStore } from './memoryStore.js';
import { type AxEventIngress, AxManualEventClock } from './types.js';

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

describe('AxInMemoryEventStore.enqueue', () => {
  it.each([
    {
      maxPendingDeliveries: 1,
      maxPendingBytes: 100,
      seedCount: 1,
      deliveryCount: 1,
    },
    {
      maxPendingDeliveries: 2,
      maxPendingBytes: 100,
      seedCount: 2,
      deliveryCount: 1,
    },
    {
      maxPendingDeliveries: 2,
      maxPendingBytes: 10,
      seedCount: 1,
      deliveryCount: 1,
    },
    {
      maxPendingDeliveries: 4,
      maxPendingBytes: 100,
      seedCount: 4,
      deliveryCount: 2,
    },
  ])(
    'deduplicates concurrent publishers after capacity becomes available: %j',
    async ({ seedCount, deliveryCount, ...limits }) => {
      const clock = new AxManualEventClock(1_000);
      const store = new AxInMemoryEventStore({ clock, ...limits });
      const request = {
        ingress: ingress('repeated', 'work'),
        deliveries: Array.from({ length: deliveryCount }, (_, index) =>
          descriptor(`repeated-${index}`)
        ),
        acceptedAt: clock.now(),
        publishTimeoutMs: 1_000,
      };
      const seed = await store.enqueue({
        ...request,
        ingress: ingress('seed', 'work'),
        deliveries: Array.from({ length: seedCount }, (_, index) =>
          descriptor(`seed-${index}`)
        ),
      });

      // Both publishers pass the initial dedupe check while the inbox is full.
      const first = store.enqueue(request);
      const repeated = store.enqueue(request).then(
        (receipt) => ({ receipt }),
        (error: unknown) => ({ error })
      );
      const seeds = await Promise.all(
        seed.deliveryIds.map((id) => store.getDelivery(id))
      );
      await Promise.all(
        seeds.map((delivery) =>
          store.saveDelivery({ ...delivery!, status: 'succeeded' })
        )
      );

      const accepted = await first;
      // A duplicate needs no extra capacity, even if the first delivery fills
      // the inbox again. Advancing the clock exposes an incorrect second wait.
      clock.advanceBy(request.publishTimeoutMs);
      expect(accepted.duplicate).toBe(false);
      expect(await repeated).toEqual({
        receipt: { ...accepted, duplicate: true },
      });

      for (const id of accepted.deliveryIds) {
        const claimed = await store.claim('worker', clock.now());
        expect(claimed?.id).toBe(id);
        await store.saveDelivery({ ...claimed!, status: 'succeeded' });
      }
      expect(await store.claim('other-worker', clock.now())).toBeUndefined();
      expect(await store.isIdle()).toBe(true);
      await store.close();
    }
  );

  it.each([
    { identity: { tenantId: 'other' } },
    { identity: { accountId: 'other' } },
    { identity: { userId: 'other' } },
    { identity: { sessionId: 'other' } },
    { event: { ...ingress('same', 'work').event, source: 'app://other' } },
    { event: { ...ingress('other', 'work').event } },
  ])('preserves distinct dedupe scopes after waiting: %j', async (scope) => {
    const clock = new AxManualEventClock(1_000);
    const store = new AxInMemoryEventStore({ clock, maxPendingDeliveries: 2 });
    const request = {
      ingress: ingress('same', 'work'),
      deliveries: [descriptor('same')],
      acceptedAt: clock.now(),
      publishTimeoutMs: 1_000,
    };
    const seed = await store.enqueue({
      ...request,
      ingress: ingress('seed', 'work'),
      deliveries: [descriptor('seed-1'), descriptor('seed-2')],
    });
    const first = store.enqueue(request);
    const other = store.enqueue({
      ...request,
      ingress: { ...request.ingress, ...scope },
    });
    for (const id of seed.deliveryIds) {
      const delivery = await store.getDelivery(id);
      await store.saveDelivery({ ...delivery!, status: 'succeeded' });
    }
    const receipts = await Promise.all([first, other]);
    expect(receipts.map((receipt) => receipt.duplicate)).toEqual([
      false,
      false,
    ]);
    expect(receipts[0]!.deliveryIds).not.toEqual(receipts[1]!.deliveryIds);
    await store.close();
  });
});

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
