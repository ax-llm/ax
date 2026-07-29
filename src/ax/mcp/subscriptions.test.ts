import { describe, expect, it, vi } from 'vitest';
import { AxMCPClient } from './client.js';
import type { AxMCPListeningHandle, AxMCPTransport } from './transport.js';
import type { AxMCPJSONRPCMessage, AxMCPJSONRPCRequest } from './types.js';

describe('AxMCPClient subscriptions/listen', () => {
  it('waits for acknowledgment, strips subscription metadata, and restarts for URI changes', async () => {
    const requests: AxMCPJSONRPCRequest[] = [];
    const ordinaryMethods: string[] = [];
    let messageHandler:
      | ((message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>)
      | undefined;
    const transport: AxMCPTransport = {
      setMessageHandler: (handler) => {
        messageHandler = handler;
      },
      send: async (request) => {
        ordinaryMethods.push(request.method);
        if (request.method === 'server/discover') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {
                tools: { listChanged: true },
                resources: { listChanged: true },
              },
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        if (request.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: [], ttlMs: 60_000, cacheScope: 'private' },
          };
        }
        if (request.method === 'resources/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { resources: [], ttlMs: 60_000, cacheScope: 'private' },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resourceTemplates: [],
            ttlMs: 60_000,
            cacheScope: 'private',
          },
        };
      },
      sendNotification: async () => {},
      openRequestStream: (request): AxMCPListeningHandle => {
        requests.push(request);
        let close!: () => void;
        const done = new Promise<void>((resolve) => {
          close = resolve;
        });
        queueMicrotask(() => {
          void messageHandler?.({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: {
              _meta: {
                'io.modelcontextprotocol/subscriptionId': request.id,
              },
              notifications: (
                request.params as {
                  notifications: Record<string, unknown>;
                }
              ).notifications,
            },
          });
        });
        return { done, close };
      },
    };
    const onNotification = vi.fn();
    const client = new AxMCPClient(transport, {
      era: 'modern',
      onNotification,
    });
    client.subscribeEvents(() => {});
    await client.init();
    await client.subscribeResource('file:///one');

    const listening = await client.startListening({ retryDelayMs: 0 });
    await listening.ready;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.params).toMatchObject({
      notifications: {
        toolsListChanged: true,
        resourcesListChanged: true,
        resourceSubscriptions: ['file:///one'],
      },
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      },
    });
    expect(onNotification).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'notifications/subscriptions/acknowledged',
      params: {
        notifications: {
          toolsListChanged: true,
          resourcesListChanged: true,
          resourceSubscriptions: ['file:///one'],
        },
      },
    });

    await client.subscribeResource('file:///two');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.id).not.toBe(requests[0]?.id);
    expect(requests[1]?.params).toMatchObject({
      notifications: {
        resourceSubscriptions: ['file:///one', 'file:///two'],
      },
    });
    expect(ordinaryMethods).not.toContain('resources/subscribe');
    expect(ordinaryMethods).not.toContain('resources/unsubscribe');

    await listening.close();
  });

  it('ignores notifications correlated to a different subscription', async () => {
    let messageHandler:
      | ((message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>)
      | undefined;
    const onNotification = vi.fn();
    const transport: AxMCPTransport = {
      setMessageHandler: (handler) => {
        messageHandler = handler;
      },
      send: async (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: {},
          ttlMs: 60_000,
          cacheScope: 'private',
        },
      }),
      sendNotification: async () => {},
      openRequestStream: (request) => {
        let close!: () => void;
        const done = new Promise<void>((resolve) => {
          close = resolve;
        });
        queueMicrotask(() => {
          void messageHandler?.({
            jsonrpc: '2.0',
            method: 'notifications/subscriptions/acknowledged',
            params: {
              _meta: {
                'io.modelcontextprotocol/subscriptionId': request.id,
              },
              notifications: {},
            },
          });
        });
        return { done, close };
      },
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      onNotification,
    });
    await client.init();
    const listening = await client.startListening();
    await listening.ready;
    onNotification.mockClear();

    await messageHandler?.({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: {
        _meta: { 'io.modelcontextprotocol/subscriptionId': 'other' },
      },
    });
    expect(onNotification).not.toHaveBeenCalled();
    await listening.close();
  });
});
