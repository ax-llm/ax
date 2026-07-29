import { describe, expect, it, vi } from 'vitest';
import { AxMCPClient } from './client.js';
import type { AxMCPTransport } from './transport.js';
import type { AxMCPJSONRPCRequest } from './types.js';

const discovery = {
  resultType: 'complete' as const,
  supportedVersions: ['2026-07-28'],
  capabilities: { tools: {} },
  ttlMs: 60_000,
  cacheScope: 'private' as const,
};

describe('AxMCPClient MRTR', () => {
  it('uses fresh IDs, exact current-round inputs, and byte-exact request state', async () => {
    const calls: AxMCPJSONRPCRequest[] = [];
    const state = '\u0000opaque-state-🔥';
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
              tools: [{ name: 'work', inputSchema: { type: 'object' } }],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        calls.push(request);
        if (calls.length === 1) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'input_required',
              inputRequests: {
                sample: {
                  method: 'sampling/createMessage',
                  params: { messages: [], maxTokens: 8 },
                },
              },
              requestState: state,
            },
          };
        }
        if (calls.length === 2) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'input_required',
              inputRequests: { roots: { method: 'roots/list' } },
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resultType: 'complete',
            content: [{ type: 'text', text: 'done' }],
          },
        };
      },
      sendNotification: async () => {},
    };
    const sampling = vi.fn(async () => ({
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'sampled' },
      model: 'test-model',
    }));
    const client = new AxMCPClient(transport, {
      era: 'modern',
      roots: [{ uri: 'file:///workspace' }],
      sampling,
    });
    await client.init();

    await expect(client.callTool('work', { value: 1 })).resolves.toMatchObject({
      resultType: 'complete',
    });

    expect(new Set(calls.map((call) => call.id))).toHaveLength(3);
    expect(calls[0]?.params).not.toHaveProperty('inputResponses');
    expect(calls[0]?.params).not.toHaveProperty('requestState');
    expect(calls[1]?.params).toMatchObject({
      arguments: { value: 1 },
      requestState: state,
      inputResponses: {
        sample: {
          role: 'assistant',
          content: { type: 'text', text: 'sampled' },
          model: 'test-model',
        },
      },
    });
    expect(calls[2]?.params).toMatchObject({
      arguments: { value: 1 },
      inputResponses: {
        roots: { roots: [{ uri: 'file:///workspace' }] },
      },
    });
    expect(calls[2]?.params).not.toHaveProperty('requestState');
    expect(calls[2]?.params).not.toHaveProperty('inputResponses.sample');
  });

  it('applies the MRTR loop to prompts/get and resources/read', async () => {
    const completed = new Set<string>();
    const transport: AxMCPTransport = {
      send: async (request) => {
        if (request.method === 'server/discover') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              ...discovery,
              capabilities: { prompts: {}, resources: {} },
            },
          };
        }
        if (request.method === 'prompts/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { prompts: [], resultType: 'complete' },
          };
        }
        if (request.method === 'resources/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { resources: [], resultType: 'complete' },
          };
        }
        if (request.method === 'resources/templates/list') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { resourceTemplates: [], resultType: 'complete' },
          };
        }
        if (!completed.has(request.method)) {
          completed.add(request.method);
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'input_required',
              inputRequests: { roots: { method: 'roots/list' } },
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result:
            request.method === 'prompts/get'
              ? { resultType: 'complete', messages: [] }
              : { resultType: 'complete', contents: [] },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      roots: [{ uri: 'file:///workspace' }],
    });
    await client.init();

    await expect(client.getPrompt('prompt')).resolves.toEqual({
      resultType: 'complete',
      messages: [],
    });
    await expect(client.readResource('file:///resource')).resolves.toEqual({
      resultType: 'complete',
      contents: [],
    });
  });

  it('fails clearly for missing handlers and enforces the round cap', async () => {
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
              tools: [
                { name: 'missing', inputSchema: { type: 'object' } },
                { name: 'loop', inputSchema: { type: 'object' } },
              ],
            },
          };
        }
        toolCalls++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resultType: 'input_required',
            inputRequests:
              (request.params as { name?: string }).name === 'missing'
                ? {
                    answer: {
                      method: 'elicitation/create',
                      params: {
                        message: 'Continue?',
                        requestedSchema: { type: 'object', properties: {} },
                      },
                    },
                  }
                : undefined,
            requestState: 'retry',
          },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      maxInputRounds: 1,
    });
    await client.init();

    await expect(client.callTool('missing')).rejects.toThrow(
      'server requested elicitation/create without a matching client handler'
    );
    const callsBeforeLoop = toolCalls;
    await expect(client.callTool('loop')).rejects.toThrow(
      'MCP tools/call exceeded 1 input rounds'
    );
    expect(toolCalls - callsBeforeLoop).toBe(2);
  });

  it('holds the tool concurrency slot across input fulfillment and retries', async () => {
    let releaseInput!: () => void;
    const inputGate = new Promise<void>((resolve) => {
      releaseInput = resolve;
    });
    const toolCalls: AxMCPJSONRPCRequest[] = [];
    const sampling = vi.fn(async () => {
      await inputGate;
      return {
        role: 'assistant' as const,
        content: { type: 'text' as const, text: 'ready' },
        model: 'test-model',
      };
    });
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
              tools: [{ name: 'work', inputSchema: { type: 'object' } }],
            },
          };
        }
        toolCalls.push(request);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result:
            toolCalls.length === 1
              ? {
                  resultType: 'input_required',
                  inputRequests: {
                    sample: {
                      method: 'sampling/createMessage',
                      params: { messages: [], maxTokens: 8 },
                    },
                  },
                }
              : { resultType: 'complete', content: [] },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      maxConcurrency: 1,
      sampling,
    });
    await client.init();

    const first = client.callTool('work');
    const second = client.callTool('work');
    await vi.waitFor(() => expect(sampling).toHaveBeenCalledOnce());
    expect(toolCalls).toHaveLength(1);
    releaseInput();
    await Promise.all([first, second]);
    expect(toolCalls).toHaveLength(3);
  });
});
