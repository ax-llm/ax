import { describe, expect, it, vi } from 'vitest';
import { AxMCPClient } from './client.js';
import type { AxMCPRequestOptions, AxMCPTransport } from './transport.js';

const discovery = {
  resultType: 'complete' as const,
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  ttlMs: 60_000,
  cacheScope: 'private' as const,
};

describe('AxMCPClient x-mcp-header', () => {
  it('filters malformed tools, warns once per revision, and mirrors call args', async () => {
    const logger = vi.fn();
    const calls: Array<Readonly<AxMCPRequestOptions> | undefined> = [];
    const transport: AxMCPTransport = {
      send: async (request, options) => {
        if (request.method === 'server/discover') {
          return { jsonrpc: '2.0', id: request.id, result: discovery };
        }
        if (request.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              tools: [
                {
                  name: 'route',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      region: {
                        type: 'string',
                        'x-mcp-header': 'Region',
                      },
                    },
                  },
                },
                {
                  name: 'invalid',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      amount: {
                        type: 'number',
                        'x-mcp-header': 'Amount',
                      },
                    },
                  },
                },
              ],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        calls.push(options);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { resultType: 'complete', structuredContent: { ok: true } },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      logger,
    });

    await client.init();
    expect(client.getTools().map(({ name }) => name)).toEqual(['route']);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mcp_invalid_tool_header_annotation',
        value: expect.stringContaining('excluded MCP tool invalid'),
      })
    );

    await client.callTool(
      'route',
      { region: 'Hello, 世界' },
      {
        headers: {
          'mcp-param-region': 'caller-cannot-override',
          'X-Request': 'kept',
        },
      }
    );
    expect(calls[0]?.headers).toEqual({
      'X-Request': 'kept',
      'Mcp-Param-Region': '=?base64?SGVsbG8sIOS4lueVjA==?=',
    });

    await client.refresh({ force: true });
    expect(logger).toHaveBeenCalledTimes(2);
  });

  it('refreshes tools and retries HeaderMismatch exactly once', async () => {
    let listCalls = 0;
    const callHeaders: Array<Readonly<Record<string, string>> | undefined> = [];
    const transport: AxMCPTransport = {
      send: async (request, options) => {
        if (request.method === 'server/discover') {
          return { jsonrpc: '2.0', id: request.id, result: discovery };
        }
        if (request.method === 'tools/list') {
          listCalls++;
          const header = listCalls === 1 ? 'Old-Route' : 'New-Route';
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              tools: [
                {
                  name: 'route',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      region: { type: 'string', 'x-mcp-header': header },
                    },
                  },
                },
              ],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        callHeaders.push(options?.headers);
        if (callHeaders.length === 1) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32020, message: 'Header mismatch' },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { resultType: 'complete', structuredContent: { ok: true } },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { era: 'modern' });
    await client.init();

    await expect(
      client.callTool('route', { region: 'west' })
    ).resolves.toMatchObject({ structuredContent: { ok: true } });
    expect(listCalls).toBe(2);
    expect(callHeaders).toEqual([
      { 'Mcp-Param-Old-Route': 'west' },
      { 'Mcp-Param-New-Route': 'west' },
    ]);
  });

  it('does not retry a second HeaderMismatch', async () => {
    let toolCalls = 0;
    const transport: AxMCPTransport = {
      send: async (request) => {
        if (request.method === 'server/discover') {
          return { jsonrpc: '2.0', id: request.id, result: discovery };
        }
        if (request.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              tools: [
                {
                  name: 'route',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      region: { type: 'string', 'x-mcp-header': 'Region' },
                    },
                  },
                },
              ],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        toolCalls++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32020, message: 'Still mismatched' },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { era: 'modern' });
    await client.init();

    await expect(client.callTool('route', { region: 'west' })).rejects.toThrow(
      'RPC Error -32020: Still mismatched'
    );
    expect(toolCalls).toBe(2);
  });
});
