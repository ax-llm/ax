import { describe, expect, it } from 'vitest';
import { AxMCPClient } from './client.js';
import type { AxMCPTransport } from './transport.js';
import type { AxMCPJSONRPCMessage } from './types.js';

describe('AxMCPClient modern cache metadata', () => {
  it('skips fresh catalog calls unless refresh is forced and exposes TTL state', async () => {
    const counts = new Map<string, number>();
    const transport: AxMCPTransport = {
      send: async (request) => {
        counts.set(request.method, (counts.get(request.method) ?? 0) + 1);
        if (request.method === 'server/discover') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {
                tools: {},
                prompts: {},
                resources: {},
              },
              ttlMs: 60_000,
              cacheScope: 'public',
            },
          };
        }
        const result = {
          resultType: 'complete',
          ttlMs: 60_000,
          cacheScope: 'private',
        };
        if (request.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { ...result, tools: [] },
          };
        }
        if (request.method === 'prompts/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { ...result, prompts: [] },
          };
        }
        if (request.method === 'resources/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { ...result, resources: [] },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { ...result, resourceTemplates: [] },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { era: 'modern' });
    await client.init();
    const revision = client.getCatalogRevision();

    await client.refresh({ force: false });
    expect(client.getCatalogRevision()).toBe(revision);
    expect(counts.get('tools/list')).toBe(1);
    expect(counts.get('prompts/list')).toBe(1);
    expect(counts.get('resources/list')).toBe(1);
    expect(counts.get('resources/templates/list')).toBe(1);

    const snapshot = await client.inspectCatalog();
    expect(snapshot.cache.tools).toMatchObject({
      ttlMs: 60_000,
      cacheScope: 'private',
      fetchedAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });

    await client.refresh({ force: true });
    expect(client.getCatalogRevision()).toBe(revision + 1);
    expect(counts.get('tools/list')).toBe(2);
  });

  it('treats absent catalog TTL as always stale', async () => {
    let listCalls = 0;
    const transport: AxMCPTransport = {
      send: async (request) => {
        if (request.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'legacy', version: '1' },
            },
          };
        }
        listCalls++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { tools: [] },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { era: 'legacy' });
    await client.init();
    await client.refresh({ force: false });

    expect(listCalls).toBe(2);
    const cache = (await client.inspectCatalog()).cache.tools;
    expect(cache).toMatchObject({ ttlMs: undefined });
    expect(cache).not.toHaveProperty('expiresAt');
  });

  it('caches resources/read only when opted in and invalidates on updates', async () => {
    let reads = 0;
    let messageHandler:
      | ((message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>)
      | undefined;
    const transport: AxMCPTransport = {
      setMessageHandler: (handler) => {
        messageHandler = handler;
      },
      send: async (request) => {
        if (request.method === 'server/discover') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { resources: {} },
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        if (request.method === 'resources/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { resources: [], ttlMs: 60_000, cacheScope: 'private' },
          };
        }
        if (request.method === 'resources/templates/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resourceTemplates: [],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        reads++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resultType: 'complete',
            contents: [{ uri: 'demo://cached', text: String(reads) }],
            ttlMs: 60_000,
            cacheScope: 'private',
          },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      readCache: true,
    });
    await client.init();

    expect(
      (await client.readResource('demo://cached')).contents[0]
    ).toMatchObject({
      text: '1',
    });
    expect(
      (await client.readResource('demo://cached')).contents[0]
    ).toMatchObject({
      text: '1',
    });
    expect(reads).toBe(1);

    await messageHandler?.({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'demo://cached' },
    });
    expect(
      (await client.readResource('demo://cached')).contents[0]
    ).toMatchObject({
      text: '2',
    });
  });
});
