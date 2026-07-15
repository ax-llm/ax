import { describe, expect, it, vi } from 'vitest';
import { AxSignature } from '../dsp/sig.js';
import type { AxProgrammable } from '../dsp/types.js';
import { AxMCPClient } from '../mcp/client.js';
import { AxMCPExecutionContext } from '../mcp/execution.js';
import type { AxMCPListeningHandle, AxMCPTransport } from '../mcp/transport.js';
import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
  AxMCPResource,
  AxMCPResourceTemplate,
} from '../mcp/types.js';
import {
  AxMCPEventSource,
  axMCPEventRoutes,
  selectResourceSubscriptions,
} from './mcpSource.js';
import { AxEventRuntime, eventRoute, eventTarget } from './runtime.js';
import { AxPushEventSource } from './sources.js';
import type { AxEventIngress, AxEventSourceContext } from './types.js';

const ai = {} as any;

class MCPEventTransport implements AxMCPTransport {
  initializeCount = 0;
  subscribeCount = 0;
  unsubscribeCount = 0;
  listeningCount = 0;
  resources: AxMCPResource[] = [];
  resourceTemplates: AxMCPResourceTemplate[] = [];
  resourceCapabilities: Record<string, unknown> = { subscribe: true };
  subscribedUris: string[] = [];
  unsubscribedUris: string[] = [];
  failNextSubscribe = new Set<string>();
  private handler?: (
    message: Readonly<AxMCPJSONRPCMessage>
  ) => void | Promise<void>;
  private listeners: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

  setMessageHandler(
    handler: (message: Readonly<AxMCPJSONRPCMessage>) => void | Promise<void>
  ): void {
    this.handler = handler;
  }

  async emit(notification: AxMCPJSONRPCNotification): Promise<void> {
    await this.handler?.(notification);
  }

  failListener(index: number, error: unknown): void {
    this.listeners[index]?.reject(error);
  }

  startListening(): AxMCPListeningHandle {
    this.listeningCount++;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.listeners.push({ resolve, reject });
    return { done, close: resolve };
  }

  async send(
    request: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    if (request.method === 'initialize') {
      this.initializeCount++;
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: {
            tools: {},
            resources: this.resourceCapabilities,
            tasks: {},
          },
          serverInfo: { name: 'inventory', version: '1' },
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
              name: 'reindex',
              description: 'Start a reindex task',
              inputSchema: { type: 'object' },
              execution: { taskSupport: 'required' },
            },
          ],
        },
      };
    }
    if (request.method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { resources: structuredClone(this.resources) },
      };
    }
    if (request.method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          resourceTemplates: structuredClone(this.resourceTemplates),
        },
      };
    }
    if (request.method === 'resources/subscribe') {
      const uri = String((request.params as { uri: string }).uri);
      if (this.failNextSubscribe.delete(uri)) {
        throw new Error(`subscribe failed for ${uri}`);
      }
      this.subscribeCount++;
      this.subscribedUris.push(uri);
    }
    if (request.method === 'resources/unsubscribe') {
      const uri = String((request.params as { uri: string }).uri);
      this.unsubscribeCount++;
      this.unsubscribedUris.push(uri);
    }
    if (request.method === 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          task: {
            taskId: 'task-42',
            status: 'working',
            createdAt: '2026-01-01T00:00:00Z',
            lastUpdatedAt: '2026-01-01T00:00:00Z',
            ttl: null,
          },
        },
      };
    }
    return { jsonrpc: '2.0', id: request.id, result: {} };
  }

  async sendNotification(): Promise<void> {}
}

function program(
  signature: string,
  forward: (input: any, options?: any) => unknown | Promise<unknown>
): AxProgrammable<any, any> {
  const parsed = new AxSignature(signature);
  return {
    getId: () => 'mcp-event-program',
    getSignature: () => parsed,
    forward: (_ai: unknown, input: unknown, options?: unknown) =>
      Promise.resolve(forward(input, options)),
    streamingForward: async function* () {},
  } as unknown as AxProgrammable<any, any>;
}

function createSourceContext(): {
  context: AxEventSourceContext;
  errors: unknown[];
  ingresses: AxEventIngress[];
} {
  const errors: unknown[] = [];
  const ingresses: AxEventIngress[] = [];
  return {
    errors,
    ingresses,
    context: {
      signal: new AbortController().signal,
      reportError: (error) => errors.push(error),
      publish: async (ingress) => {
        ingresses.push(structuredClone(ingress));
        return {
          eventId: ingress.event.id,
          accepted: true,
          duplicate: false,
          durability: 'volatile',
          deliveryIds: [],
        };
      },
    },
  };
}

describe('AxMCPEventSource', () => {
  it('defaults to no resource subscriptions and excludes templates from all-resource selection', async () => {
    const transport = new MCPEventTransport();
    transport.resources = [
      { uri: 'demo://inventory', name: 'inventory' },
      { uri: 'demo://orders', name: 'orders' },
    ];
    transport.resourceTemplates = [
      { uriTemplate: 'demo://customers/{id}', name: 'customer' },
    ];
    const client = new AxMCPClient(transport, { namespace: 'inventory' });

    const defaultContext = createSourceContext();
    const defaultHandle = await new AxMCPEventSource({ client }).start(
      defaultContext.context
    );
    expect(transport.subscribedUris).toEqual([]);
    await defaultHandle?.close();

    const allContext = createSourceContext();
    const allHandle = await new AxMCPEventSource({
      client,
      resourceSubscriptions: 'all',
    }).start(allContext.context);
    expect(transport.subscribedUris).toEqual([
      'demo://inventory',
      'demo://orders',
    ]);
    expect(transport.subscribedUris).not.toContain('demo://customers/{id}');
    await allHandle?.close();
  });

  it('supports selector and explicit URI policies with deterministic deduplication', async () => {
    const transport = new MCPEventTransport();
    transport.resources = [
      {
        uri: 'demo://inventory',
        name: 'inventory',
        mimeType: 'application/json',
      },
      { uri: 'demo://readme', name: 'readme', mimeType: 'text/plain' },
    ];
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    await client.init();
    const catalog = await client.inspectCatalog();
    expect(
      selectResourceSubscriptions(
        {
          select: (resource) => resource.mimeType === 'application/json',
        },
        catalog
      )
    ).toEqual(['demo://inventory']);
    expect(
      selectResourceSubscriptions(['demo://z', 'demo://a', 'demo://z'], catalog)
    ).toEqual(['demo://a', 'demo://z']);

    const sourceContext = createSourceContext();
    const source = new AxMCPEventSource({
      client,
      resourceSubscriptions: {
        select: (resource) => resource.name === 'inventory',
      },
    });
    const handle = await source.start(sourceContext.context);
    expect(transport.subscribedUris).toEqual(['demo://inventory']);
    await handle?.close();
  });

  it('reconciles catalog additions and removals before publishing list changes', async () => {
    const transport = new MCPEventTransport();
    transport.resources = [
      { uri: 'demo://a', name: 'a' },
      { uri: 'demo://b', name: 'b' },
    ];
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    const sourceContext = createSourceContext();
    const handle = await new AxMCPEventSource({
      client,
      resourceSubscriptions: 'all',
    }).start(sourceContext.context);

    transport.resources = [
      { uri: 'demo://b', name: 'b' },
      { uri: 'demo://c', name: 'c' },
    ];
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
    });

    expect(client.getResourceSubscriptions()).toEqual(['demo://b', 'demo://c']);
    expect(transport.unsubscribedUris).toEqual(['demo://a']);
    expect(transport.subscribedUris).toEqual([
      'demo://a',
      'demo://b',
      'demo://c',
    ]);
    expect(sourceContext.ingresses.at(-1)?.event.type).toBe(
      'mcp.catalog.changed'
    );
    await handle?.close();
  });

  it('tracks manual and event-source owners without duplicate wire calls', async () => {
    const transport = new MCPEventTransport();
    transport.resources = [{ uri: 'demo://inventory', name: 'inventory' }];
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    await client.init();
    await client.subscribeResource('demo://inventory');

    const firstContext = createSourceContext();
    const secondContext = createSourceContext();
    const first = await new AxMCPEventSource({
      client,
      resourceSubscriptions: 'all',
    }).start(firstContext.context);
    const second = await new AxMCPEventSource({
      client,
      resourceSubscriptions: 'all',
    }).start(secondContext.context);
    expect(transport.subscribeCount).toBe(1);

    await first?.close();
    await second?.close();
    expect(transport.unsubscribeCount).toBe(0);
    await client.unsubscribeResource('demo://inventory');
    expect(transport.unsubscribeCount).toBe(1);
  });

  it('retains the prior selection on selector failure and retries partial changes', async () => {
    const transport = new MCPEventTransport();
    transport.resources = [{ uri: 'demo://a', name: 'a' }];
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    let selectorFails = false;
    const sourceContext = createSourceContext();
    const handle = await new AxMCPEventSource({
      client,
      resourceSubscriptions: {
        select: (resource) => {
          if (selectorFails) throw new Error('selector failed');
          return resource.name !== 'ignored';
        },
      },
    }).start(sourceContext.context);

    selectorFails = true;
    transport.resources = [{ uri: 'demo://b', name: 'b' }];
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
    });
    expect(client.getResourceSubscriptions()).toEqual(['demo://a']);
    expect(sourceContext.errors).toHaveLength(1);

    selectorFails = false;
    transport.failNextSubscribe.add('demo://b');
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
    });
    expect(client.getResourceSubscriptions()).toEqual([]);
    expect(sourceContext.errors).toHaveLength(2);
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/list_changed',
    });
    expect(client.getResourceSubscriptions()).toEqual(['demo://b']);
    await handle?.close();
  });

  it('rejects ambiguous aliases and policies unsupported by the server', async () => {
    const transport = new MCPEventTransport();
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    expect(
      () =>
        new AxMCPEventSource({
          client,
          resources: ['demo://a'],
          resourceSubscriptions: 'all',
        })
    ).toThrow('Specify either resourceSubscriptions');

    transport.resourceCapabilities = { listChanged: true };
    const sourceContext = createSourceContext();
    await expect(
      new AxMCPEventSource({
        client,
        resourceSubscriptions: 'all',
      }).start(sourceContext.context)
    ).rejects.toThrow('does not advertise resource subscriptions');
  });

  it('keeps existing callbacks and wakes an authenticated Agent only through an explicit route', async () => {
    const transport = new MCPEventTransport();
    const existing = vi.fn();
    const client = new AxMCPClient(transport, {
      namespace: 'inventory',
      onResourceUpdated: existing,
    });
    const source = new AxMCPEventSource({
      client,
      identity: { tenantId: 'tenant-a' },
      trust: 'authenticated',
    });
    const forward = vi.fn(() => ({ handled: true }));
    const runtime = new AxEventRuntime({
      allowVolatile: true,
      sources: [source],
      routes: [
        eventRoute({
          id: 'wake-resource-owner',
          match: {
            sources: ['mcp://inventory'],
            types: ['mcp.resource.updated'],
          },
          action: 'wake',
          requireAuthenticated: true,
          target: eventTarget({
            id: 'resource-agent',
            ai,
            program: program(
              'namespace:string, uri:string -> handled:boolean',
              forward
            ),
            mapInput: ({ event }) => event.data,
            retrySafety: 'idempotent',
          }),
        }),
      ],
    });
    await runtime.start();
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///inventory.csv' },
    });
    await runtime.waitForIdle();
    expect(existing).toHaveBeenCalledWith('file:///inventory.csv');
    expect(forward).toHaveBeenCalledOnce();
    await runtime.close({ drain: false });
  });

  it('keeps anonymous MCP notifications out of authenticated routes', async () => {
    const transport = new MCPEventTransport();
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    const forward = vi.fn();
    const runtime = new AxEventRuntime({
      allowVolatile: true,
      sources: [new AxMCPEventSource({ client })],
      routes: [
        eventRoute({
          id: 'secure-resource',
          match: { types: ['mcp.resource.updated'] },
          action: 'wake',
          requireAuthenticated: true,
          target: eventTarget({
            id: 'secure-agent',
            ai,
            program: program(
              'namespace:string, uri:string -> handled:boolean',
              forward
            ),
            mapInput: ({ event }) => event.data,
          }),
        }),
      ],
    });
    await runtime.start();
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri: 'file:///private' },
    });
    await runtime.waitForIdle();
    expect(forward).not.toHaveBeenCalled();
    await runtime.close({ drain: false });
  });

  it('registers a task continuation, observes progress, and resumes on terminal status', async () => {
    const transport = new MCPEventTransport();
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    const mcp = new AxMCPExecutionContext(client);
    await mcp.initialize();
    const taskTool = mcp.getToolBindings()[0]!;
    const push = new AxPushEventSource('application');
    const mcpSource = new AxMCPEventSource({
      client,
      identity: { tenantId: 'tenant-a' },
      trust: 'authenticated',
    });
    const calls: string[] = [];
    const target = eventTarget({
      id: 'task-flow',
      ai,
      program: program(
        'eventType:string -> handledEventType:string',
        async ({ eventType }, options) => {
          calls.push(eventType);
          if (eventType === 'job.start') {
            await taskTool.func?.(
              {},
              {
                eventContext: options.eventContext,
                abortSignal: options.abortSignal,
              }
            );
          }
          return { handledEventType: eventType };
        }
      ),
      mapInput: ({ event }) => ({ eventType: event.type }),
      retrySafety: 'idempotent',
    });
    const observed = vi.fn();
    const runtime = new AxEventRuntime({
      allowVolatile: true,
      sources: [push, mcpSource],
      routes: [
        eventRoute({
          id: 'start-task',
          match: { types: ['job.start'] },
          action: 'wake',
          target,
        }),
        ...axMCPEventRoutes({ client, onObserve: observed }),
      ],
    });
    await runtime.start();
    await push.publish({
      event: {
        specversion: '1.0',
        id: 'start-1',
        source: 'app://jobs',
        type: 'job.start',
      },
      identity: { tenantId: 'tenant-a' },
      trust: 'authenticated',
    });
    await runtime.waitForIdle();
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'task-42', progress: 0.5 },
    });
    await transport.emit({
      jsonrpc: '2.0',
      method: 'notifications/tasks/status',
      params: {
        task: {
          taskId: 'task-42',
          status: 'completed',
          createdAt: '2026-01-01T00:00:00Z',
          lastUpdatedAt: '2026-01-01T00:01:00Z',
          ttl: null,
        },
      },
    });
    await runtime.waitForIdle();
    expect(observed).toHaveBeenCalledOnce();
    expect(calls).toEqual(['job.start', 'mcp.task.status']);
    await runtime.close({ drain: false });
  });

  it('reinitializes and restores logical subscriptions after listener failure', async () => {
    const transport = new MCPEventTransport();
    const client = new AxMCPClient(transport, { namespace: 'inventory' });
    await client.init();
    await client.subscribeResource('file:///catalog');
    const errors: unknown[] = [];
    const listening = await client.startListening({
      retryDelayMs: 0,
      onError: (error) => errors.push(error),
    });
    transport.failListener(0, new Error('connection reset'));
    for (let index = 0; index < 20 && transport.listeningCount < 2; index++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(errors).toHaveLength(1);
    expect(transport.initializeCount).toBe(2);
    expect(transport.subscribeCount).toBe(2);
    expect(transport.listeningCount).toBe(2);
    await listening.close();
  });
});
