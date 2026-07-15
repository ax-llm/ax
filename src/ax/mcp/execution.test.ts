import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeGlobals } from '../agent/agentInternal/runtimeGlobals.js';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxGen } from '../dsp/generate.js';
import type { AxFunctionCallTrace } from '../dsp/types.js';
import { AxMemory } from '../mem/memory.js';
import { AxUCPClient } from '../ucp/client.js';
import { AX_UCP_VERSION } from '../ucp/types.js';
import { AxMCPClient } from './client.js';
import { AxMCPExecutionContext } from './execution.js';
import type { AxMCPTransport } from './transport.js';

function createInventoryClient() {
  const calls: string[] = [];
  const transport: AxMCPTransport = {
    send: async (request) => {
      calls.push(request.method);
      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'inventory', version: '1.0.0' },
          },
        };
      }
      if (request.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: [
              {
                name: 'lookup_inventory',
                description: 'Look up inventory',
                inputSchema: {
                  type: 'object',
                  properties: {
                    sku: { type: 'string', description: 'Product SKU' },
                  },
                  required: ['sku'],
                },
                outputSchema: {
                  type: 'object',
                  properties: {
                    available: {
                      type: 'number',
                      description: 'Available units',
                    },
                  },
                },
              },
            ],
          },
        };
      }
      if (request.method === 'tools/call') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: { sku: 'sku-1', available: 7 },
            content: [{ type: 'text', text: 'Seven units available' }],
            _meta: { source: 'warehouse-a' },
          },
        };
      }
      return { jsonrpc: '2.0', id: request.id, result: {} };
    },
    sendNotification: async () => {},
  };
  return {
    client: new AxMCPClient(transport, { namespace: 'inventory' }),
    calls,
  };
}

describe('native MCP execution', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('attaches an MCP client to AxGen without calling toFunction()', async () => {
    const { client, calls } = createInventoryClient();
    const adapterSpy = vi.spyOn(client, 'toFunction');
    const traces: AxFunctionCallTrace[] = [];
    let step = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        step++;
        if (step === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'mcp-call-1',
                    type: 'function' as const,
                    function: {
                      name: 'lookup_inventory',
                      params: { sku: 'sku-1' },
                    },
                  },
                ],
              },
            ],
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: 7 units',
              finishReason: 'stop' as const,
            },
          ],
        };
      },
    });
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );
    const mem = new AxMemory();

    const result = await gen.forward(
      ai,
      { question: 'How many?' },
      {
        mcp: client,
        mem,
        onFunctionCall: (call) => traces.push({ ...call }),
      }
    );

    expect(result.answer).toBe('answer: 7 units');
    expect(adapterSpy).not.toHaveBeenCalled();
    expect(calls).toEqual(['initialize', 'tools/list', 'tools/call']);
    expect(traces[0]?.result).toMatchObject({
      structuredContent: { sku: 'sku-1', available: 7 },
      _meta: { source: 'warehouse-a' },
    });
    expect(
      mem.history(0).find((message) => message.role === 'function')
        ?.protocolResult
    ).toMatchObject({
      protocol: {
        kind: 'mcp',
        namespace: 'inventory',
        name: 'lookup_inventory',
      },
      value: {
        structuredContent: { sku: 'sku-1', available: 7 },
        _meta: { source: 'warehouse-a' },
      },
    });
  });

  it('initializes an attached client only once across AxGen runs', async () => {
    const { client, calls } = createInventoryClient();
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'answer: ok',
            finishReason: 'stop' as const,
          },
        ],
      },
    });
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );

    await gen.forward(ai, { question: 'one' }, { mcp: client });
    await gen.forward(ai, { question: 'two' }, { mcp: client });

    expect(calls.filter((method) => method === 'initialize')).toHaveLength(1);
    expect(calls.filter((method) => method === 'tools/list')).toHaveLength(1);
  });

  it('exposes native MCP modules to the AxAgent runtime', async () => {
    const { client } = createInventoryClient();
    const context = new AxMCPExecutionContext(client);
    await context.initialize();
    const globals = buildRuntimeGlobals({
      agentFunctions: [],
      agentFunctionModuleMetadata: new Map(),
      functionDiscoveryEnabled: false,
      stagePolicy: { executesTools: true },
      _activeMCPExecutionContext: context,
    }) as any;

    const result = await globals.mcp.inventory.tools.lookup_inventory({
      sku: 'sku-1',
    });

    expect(result).toMatchObject({
      structuredContent: { sku: 'sku-1', available: 7 },
      _meta: { source: 'warehouse-a' },
    });
  });

  it('attaches REST-backed UCP operations natively without an MCP adapter', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        if (!init?.method) {
          return Response.json({
            ucp: {
              version: AX_UCP_VERSION,
              services: {
                'dev.ucp.shopping': [
                  {
                    version: AX_UCP_VERSION,
                    transport: 'rest',
                    endpoint: 'https://shop.example/ucp',
                  },
                ],
              },
              capabilities: {
                'dev.ucp.shopping.checkout': [{ version: AX_UCP_VERSION }],
              },
            },
          });
        }
        return Response.json({
          ucp: { version: AX_UCP_VERSION, status: 'success' },
          id: 'checkout-1',
          status: 'incomplete',
        });
      })
    );
    const ucp = new AxUCPClient({
      profileUrl: 'https://shop.example',
      agentProfile: 'https://agent.example/.well-known/ucp',
      transport: 'rest',
      mcp: { ssrfProtection: { disabled: true } },
    });
    let step = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        step++;
        return step === 1
          ? {
              results: [
                {
                  index: 0,
                  finishReason: 'stop' as const,
                  functionCalls: [
                    {
                      id: 'ucp-call-1',
                      type: 'function' as const,
                      function: {
                        name: 'create_checkout',
                        params: { checkout: { line_items: [] } },
                      },
                    },
                  ],
                },
              ],
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'answer: checkout-1',
                  finishReason: 'stop' as const,
                },
              ],
            };
      },
    });
    const gen = new AxGen<{ question: string }, { answer: string }>(
      'question:string -> answer:string'
    );

    const result = await gen.forward(
      ai,
      { question: 'Start checkout' },
      { ucp }
    );

    expect(result.answer).toBe('answer: checkout-1');
    expect(requests[1]).toMatchObject({
      url: 'https://shop.example/ucp/checkout-sessions',
      init: { method: 'POST', body: JSON.stringify({ line_items: [] }) },
    });
  });

  it('serializes logical task/subscription intent and rebinds live clients', async () => {
    const createClient = () => {
      const calls: string[] = [];
      const transport: AxMCPTransport = {
        send: async (request) => {
          calls.push(request.method);
          if (request.method === 'initialize') {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: {
                  tasks: {},
                  resources: { subscribe: true },
                },
                serverInfo: { name: 'durable', version: '1' },
              },
            };
          }
          if (request.method === 'resources/list') {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: { resources: [] },
            };
          }
          if (request.method === 'tasks/get') {
            return {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                taskId: 'remote-task-1',
                status: 'working',
                createdAt: '2026-01-01T00:00:00Z',
                lastUpdatedAt: '2026-01-01T00:00:01Z',
                ttl: 60_000,
              },
            };
          }
          return { jsonrpc: '2.0', id: request.id, result: {} };
        },
        sendNotification: async () => {},
      };
      return {
        client: new AxMCPClient(transport, { namespace: 'durable' }),
        calls,
      };
    };
    const first = createClient();
    const firstContext = new AxMCPExecutionContext(first.client);
    await firstContext.initialize();
    await first.client.getTask('remote-task-1');
    await first.client.subscribeResource('file:///watched');
    const state = firstContext.getContinuationState();

    expect(state).toEqual({
      clients: [
        {
          namespace: 'durable',
          tasks: [{ taskId: 'remote-task-1', status: 'working' }],
          subscriptions: ['file:///watched'],
        },
      ],
    });
    expect(JSON.stringify(state)).not.toMatch(/token|secret|transport/i);

    const restored = createClient();
    const restoredContext = new AxMCPExecutionContext(restored.client);
    await restoredContext.restoreContinuationState(state);

    expect(restored.calls).toContain('tasks/get');
    expect(restored.calls).toContain('resources/subscribe');
    await restored.client.unsubscribeResource('file:///watched');
    expect(restored.client.getResourceSubscriptions()).toEqual([
      'file:///watched',
    ]);
    const other = new AxMCPClient(
      {
        send: async (request) => ({
          jsonrpc: '2.0',
          id: request.id,
          result:
            request.method === 'initialize'
              ? {
                  protocolVersion: '2025-11-25',
                  capabilities: {},
                  serverInfo: { name: 'other', version: '1' },
                }
              : {},
        }),
        sendNotification: async () => {},
      },
      { namespace: 'other' }
    );
    await expect(
      new AxMCPExecutionContext(other).restoreContinuationState(state)
    ).rejects.toThrow('unbound namespace durable');
  });
});
