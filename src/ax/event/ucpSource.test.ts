import { describe, expect, it, vi } from 'vitest';
import { AxUCPWebhookEventSource } from './ucpSource.js';

describe('AxUCPWebhookEventSource', () => {
  it('verifies before publishing and keeps application identity outside data', async () => {
    const verifyOrderEvent = vi.fn(async () => ({
      id: 'order-1',
      checkout_id: 'checkout-1',
      event_id: 'business-event-1',
      event_type: 'fulfilled',
      status: 'complete',
    }));
    const publish = vi.fn(async () => ({
      eventId: 'hook-1',
      accepted: true,
      duplicate: false,
      durability: 'persistent' as const,
      deliveryIds: ['delivery-1'],
    }));
    const source = new AxUCPWebhookEventSource({
      client: { verifyOrderEvent },
      identity: { tenantId: 'tenant-1', accountId: 'buyer-1' },
    });
    source.start({
      publish,
      signal: new AbortController().signal,
      reportError: vi.fn(),
      capabilities: {
        durability: 'persistent',
        coordination: 'single-worker',
        leases: false,
        transactions: true,
        compareAndSet: true,
        outputPersistence: true,
      },
    });
    const request = new Request('https://app.example/ucp/hooks', {
      method: 'POST',
      headers: {
        'UCP-Agent': 'profile="https://shop.example/.well-known/ucp"',
        'Webhook-Id': 'hook-1',
      },
      body: '{}',
    });

    await source.ingest(request);

    expect(verifyOrderEvent).toHaveBeenCalledBefore(publish);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { tenantId: 'tenant-1', accountId: 'buyer-1' },
        trust: 'authenticated',
        event: expect.objectContaining({
          id: 'hook-1',
          source: 'https://shop.example/.well-known/ucp',
          type: 'ucp.order.fulfilled',
          data: expect.not.objectContaining({ tenantId: expect.anything() }),
        }),
      }),
      undefined
    );
  });

  it('publishes an anonymous untrusted event without an application mapping', async () => {
    const publish = vi.fn(async () => ({
      eventId: 'hook-2',
      accepted: true,
      duplicate: false,
      durability: 'persistent' as const,
      deliveryIds: [],
    }));
    const source = new AxUCPWebhookEventSource({
      client: {
        verifyOrderEvent: async () => ({
          id: 'order-2',
          checkout_id: 'checkout-2',
        }),
      },
      identity: { sessionId: 'not-an-application-identity' },
    });
    source.start({
      publish,
      signal: new AbortController().signal,
      reportError: vi.fn(),
      capabilities: {
        durability: 'persistent',
        coordination: 'single-worker',
        leases: false,
        transactions: true,
        compareAndSet: true,
        outputPersistence: true,
      },
    });

    await source.ingest(
      new Request('https://app.example/ucp/hooks', {
        method: 'POST',
        headers: { 'Webhook-Id': 'hook-2' },
        body: '{}',
      })
    );

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ identity: undefined, trust: 'untrusted' }),
      undefined
    );
  });

  it('never publishes a request rejected by UCP verification', async () => {
    const publish = vi.fn();
    const source = new AxUCPWebhookEventSource({
      client: {
        verifyOrderEvent: async () => {
          throw new Error('signature_invalid');
        },
      },
      identity: { tenantId: 'tenant-1' },
    });
    source.start({
      publish,
      signal: new AbortController().signal,
      reportError: vi.fn(),
      capabilities: {
        durability: 'persistent',
        coordination: 'single-worker',
        leases: false,
        transactions: true,
        compareAndSet: true,
        outputPersistence: true,
      },
    });

    await expect(
      source.ingest(
        new Request('https://app.example/ucp/hooks', {
          method: 'POST',
          body: '{}',
        })
      )
    ).rejects.toThrow('signature_invalid');
    expect(publish).not.toHaveBeenCalled();
  });
});
