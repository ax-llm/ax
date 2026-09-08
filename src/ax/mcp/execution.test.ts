import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeGlobals } from '../agent/agentInternal/runtimeGlobals.js';
import { agent } from '../agent/index.js';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import type { AxFunctionCallTrace } from '../dsp/types.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { AxMemory } from '../mem/memory.js';
import { AxUCPClient } from '../ucp/client.js';
import { AX_UCP_VERSION } from '../ucp/types.js';
import { AxMCPClient } from './client.js';
import {
  AxMCPExecutionContext,
  axMCPChildExecutionOptions,
  axResolveMCPExecutionContext,
} from './execution.js';
import type { AxMCPTransport } from './transport.js';

function createInventoryClient(namespace = 'inventory') {
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
                name: `lookup_${namespace}`,
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
    client: new AxMCPClient(transport, { namespace }),
    calls,
  };
}

function createCheckoutClient() {
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
  return {
    client: new AxUCPClient({
      profileUrl: 'https://shop.example',
      agentProfile: 'https://agent.example/.well-known/ucp',
      transport: 'rest',
      mcp: { ssrfProtection: { disabled: true } },
    }),
    requests,
  };
}

function chatSystemText(req: Readonly<AxChatRequest<unknown>>): string {
  const system = req.chatPrompt.find((message) => message.role === 'system');
  return typeof system?.content === 'string'
    ? system.content
    : JSON.stringify(system?.content ?? '');
}

describe('native MCP execution', () => {
  it.each(
    [
      { policy: 'all' as const, allowed: ['inventory', 'orders'], own: false },
      { policy: 'none' as const, allowed: [], own: false },
      { policy: ['orders'], allowed: ['orders'], own: false },
      { policy: [], allowed: [], own: false },
      { policy: ['orders'], allowed: ['inventory'], own: true },
    ].flatMap((testCase) =>
      [false, true].map((streaming) => ({ ...testCase, streaming }))
    )
  )(
    'applies child inheritance $policy through actual agent delegation (own=$own, streaming=$streaming)',
    async ({ policy, allowed, own, streaming }) => {
      const inventory = createInventoryClient();
      const orders = createInventoryClient('orders');
      const childInventory = createInventoryClient();
      const expected = allowed.join(',') || 'NO-ACCESS';
      const code = (body: string) =>
        `Javascript Code: \`\`\`javascript\n${body}\n\`\`\``;
      const responses = [
        code('await final("Delegate inventory lookup", {});'),
        code(
          'var delegated = await team.researcher({ question: "lookup" }); console.log(delegated);'
        ),
        code('await final("Look up allowed inventory", {});'),
        code(
          'var observed = []; try { var first = await mcp.inventory.tools.lookup_inventory({sku:"sku-1"}); observed.push("inventory"); } catch (error) { console.log(String(error)); }'
        ),
        code(
          'try { var second = await mcp.orders.tools.lookup_orders({sku:"sku-1"}); observed.push("orders"); } catch (error) { console.log(String(error)); }'
        ),
        code('await final("Report allowed namespaces", {observed});'),
        expected,
        code('await final("Report delegated result", {delegated});'),
        expected,
      ];
      const requests: Readonly<AxChatRequest<unknown>>[] = [];
      const llm = new AxMockAIService({
        features: { functions: true, streaming: false },
        chatResponse: async (request) => {
          requests.push(request);
          const content = responses.shift();
          if (!content) throw new Error('Unexpected model continuation');
          return {
            results: [{ index: 0, content, finishReason: 'stop' as const }],
          };
        },
      });
      const child = agent('question:string -> answer:string', {
        agentIdentity: {
          name: 'researcher',
          description: 'Look up allowed inventory',
        },
        contextFields: [],
        runtime: new AxJSRuntime(),
        functionDiscovery: false,
        directResponse: 'off',
        ...(own ? { mcp: [childInventory.client] } : {}),
      });
      const parent = agent('userQuery:string -> answer:string', {
        functions: [
          {
            namespace: 'team',
            title: 'Researchers',
            description: 'Delegation',
            functions: [child.getFunction()],
          },
        ],
        mcp: [inventory.client, orders.client],
        mcpInheritance: policy,
        contextFields: [],
        runtime: new AxJSRuntime(),
        functionDiscovery: false,
        directResponse: 'off',
      });
      if (streaming) {
        let answer = '';
        for await (const chunk of parent.streamingForward(llm, {
          userQuery: 'Look up inventory',
        }))
          answer += chunk.delta.answer ?? '';
        expect(answer).toBe(expected);
      } else {
        expect(
          (await parent.forward(llm, { userQuery: 'Look up inventory' })).answer
        ).toBe(expected);
      }
      expect(responses).toHaveLength(0);
      expect(
        inventory.calls.filter((method) => method === 'tools/call')
      ).toHaveLength(!own && allowed.includes('inventory') ? 1 : 0);
      expect(
        orders.calls.filter((method) => method === 'tools/call')
      ).toHaveLength(allowed.includes('orders') ? 1 : 0);
      expect(
        childInventory.calls.filter((method) => method === 'tools/call')
      ).toHaveLength(own ? 1 : 0);
      for (const namespace of ['inventory', 'orders']) {
        expect(chatSystemText(requests[1]!)).toContain(
          `mcp.${namespace}.tools.lookup_${namespace}`
        );
        expect(
          chatSystemText(requests[3]!).includes(
            `mcp.${namespace}.tools.lookup_${namespace}`
          )
        ).toBe(allowed.includes(namespace));
      }
      expect(JSON.stringify(requests[7])).toContain(expected);
      for (const index of [0, 1, 2, 3, 4, 5, 7])
        expect(
          requests[index]?.functions?.map((fn) => fn.name) ?? []
        ).not.toContain('lookup_inventory');
    }
  );

  it('keeps explicitly configured child clients ahead of inherited parent clients', async () => {
    const parent = createInventoryClient('parent');
    const child = createInventoryClient('child');
    const inherited = new AxMCPExecutionContext(parent.client);
    const resolved = await axResolveMCPExecutionContext(
      { _mcpExecutionContext: inherited },
      { mcp: child.client, mcpInheritance: 'none' }
    );
    expect(resolved).not.toBe(inherited);
    expect(resolved?.clients).toEqual([child.client]);
    expect(resolved?.inheritance).toBe('none');
    expect(child.calls).toContain('tools/list');
    expect(parent.calls).toEqual([]);
    expect(resolved?.forChild()).toBeUndefined();
  });

  it('removes the inherited MCP context when child inheritance is none', () => {
    const { client } = createInventoryClient();
    const context = new AxMCPExecutionContext(client, 'none');
    const control = { token: 'same-controller' };
    const options = axMCPChildExecutionOptions({
      _mcpExecutionContext: context,
      mcp: client,
      mcpContext: { requestId: 'parent-request' },
      control,
      eventContext: { eventId: 'event-1' },
    });
    expect(options).not.toHaveProperty('_mcpExecutionContext');
    expect(options).not.toHaveProperty('mcp');
    expect(options).not.toHaveProperty('mcpContext');
    expect(options.control).toBe(control);
    expect(options.eventContext).toEqual({ eventId: 'event-1' });
  });

  afterEach(() => vi.unstubAllGlobals());
  it('exposes modern required tasks and registers a continuation', async () => {
    const transport: AxMCPTransport = {
      send: async (request) => {
        if (request.method === 'server/discover') {
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: {
                tools: {},
                extensions: { 'io.modelcontextprotocol/tasks': {} },
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
            result: {
              tools: [
                {
                  name: 'slow',
                  inputSchema: { type: 'object' },
                  execution: { taskSupport: 'required' },
                },
              ],
              ttlMs: 60_000,
              cacheScope: 'private',
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            resultType: 'task',
            taskId: 'task-modern',
            status: 'working',
            createdAt: '2026-07-28T00:00:00Z',
            lastUpdatedAt: '2026-07-28T00:00:01Z',
            ttlMs: 60_000,
          },
        };
      },
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, {
      era: 'modern',
      namespace: 'durable',
    });
    const context = new AxMCPExecutionContext(client);
    await context.initialize();
    const registerContinuation = vi.fn(() => 'continuation-1');

    await expect(
      context
        .getToolBindings()[0]
        ?.func?.({}, { eventContext: { registerContinuation } as any })
    ).resolves.toMatchObject({
      resultType: 'task',
      taskId: 'task-modern',
    });
    expect(registerContinuation).toHaveBeenCalledWith({
      correlation: [{ kind: 'mcp.task', value: 'durable:task-modern' }],
      metadata: {
        namespace: 'durable',
        taskId: 'task-modern',
        tool: 'slow',
      },
    });
  });

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
    expect(calls).toEqual([
      'server/discover',
      'initialize',
      'tools/list',
      'tools/call',
    ]);
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

  it('documents MCP tools by runtime path without leaking native functions to either RLM stage (#575)', async () => {
    const { client, calls } = createInventoryClient();
    const actorRequests: Readonly<AxChatRequest<unknown>>[] = [];
    let executorTurn = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        const system = chatSystemText(req);
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
        });
        if (system.includes('You (`distiller`)')) {
          actorRequests.push(req);
          return reply(
            'Javascript Code: ```javascript\nawait final("Look up sku-1 inventory", {});\n```'
          );
        }
        if (system.includes('You (`executor`)')) {
          actorRequests.push(req);
          executorTurn++;
          return reply(
            executorTurn === 1
              ? 'Javascript Code: ```javascript\nconst inventoryResult = await mcp.inventory.tools.lookup_inventory({ sku: "sku-1" });\nconsole.log(inventoryResult);\n```'
              : 'Javascript Code: ```javascript\nawait final("Report the inventory result", { inventoryResult });\n```'
          );
        }
        return reply('answer: Seven units available');
      },
    });
    const a = agent('userQuery:string -> answer:string', {
      mcp: [client],
      contextFields: [],
      runtime: new AxJSRuntime(),
    });

    const result = await a.forward(ai, { userQuery: 'get rows' });

    expect(result.answer).toContain('Seven units available');
    expect(calls).toContain('tools/call');
    expect(actorRequests).toHaveLength(3);
    for (const request of actorRequests) {
      expect(request.functions?.map((fn) => fn.name) ?? []).not.toContain(
        'lookup_inventory'
      );
      const system = chatSystemText(request);
      expect(system).toContain('mcp.inventory.tools.lookup_inventory');
      expect(system).not.toMatch(/(^|[^.])\blookup_inventory\s*\(/);
    }
    expect(chatSystemText(actorRequests[0]!)).not.toContain(
      'There is no executor phase and there are no external tools'
    );
  });

  it('attaches REST-backed UCP operations natively without an MCP adapter', async () => {
    const { client: ucp, requests } = createCheckoutClient();
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

  it('documents UCP operations under `ucp.<ns>.<name>` for RLM actors', async () => {
    const { client: ucp, requests } = createCheckoutClient();
    const actorRequests: Readonly<AxChatRequest<unknown>>[] = [];
    let executorTurn = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (req) => {
        const system = chatSystemText(req);
        const reply = (content: string) => ({
          results: [{ index: 0, content, finishReason: 'stop' as const }],
        });
        if (system.includes('You (`distiller`)')) {
          actorRequests.push(req);
          return reply(
            'Javascript Code: ```javascript\nawait final("Create a checkout", {});\n```'
          );
        }
        if (system.includes('You (`executor`)')) {
          actorRequests.push(req);
          executorTurn++;
          return reply(
            executorTurn === 1
              ? 'Javascript Code: ```javascript\nconst checkoutResult = await ucp.ucp.create_checkout({ checkout: { line_items: [] } });\nconsole.log(checkoutResult);\n```'
              : 'Javascript Code: ```javascript\nawait final("Report the checkout result", { checkoutResult });\n```'
          );
        }
        return reply('answer: checkout-1');
      },
    });
    const a = agent('userQuery:string -> answer:string', {
      ucp: [ucp],
      contextFields: [],
      runtime: new AxJSRuntime(),
    });

    const result = await a.forward(ai, { userQuery: 'start checkout' });

    expect(result.answer).toContain('checkout-1');
    expect(requests.some((request) => request.init?.method === 'POST')).toBe(
      true
    );
    expect(actorRequests).toHaveLength(3);
    for (const request of actorRequests) {
      expect(request.functions?.map((fn) => fn.name) ?? []).not.toContain(
        'create_checkout'
      );
      const system = chatSystemText(request);
      expect(system).toContain('ucp.ucp.create_checkout');
      expect(system).not.toContain('mcp.ucp.tools.create_checkout');
    }
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
