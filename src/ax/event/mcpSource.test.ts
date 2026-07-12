import { describe, expect, it, vi } from 'vitest';
import type { AxProgrammable } from '../dsp/types.js';
import { AxMCPClient } from '../mcp/client.js';
import { AxMCPExecutionContext } from '../mcp/execution.js';
import type { AxMCPListeningHandle, AxMCPTransport } from '../mcp/transport.js';
import type {
  AxMCPJSONRPCMessage,
  AxMCPJSONRPCNotification,
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
} from '../mcp/types.js';
import { AxMCPEventSource, axMCPEventRoutes } from './mcpSource.js';
import { AxEventRuntime, eventRoute, eventTarget } from './runtime.js';
import { AxPushEventSource } from './sources.js';

const ai = {} as any;

class MCPEventTransport implements AxMCPTransport {
  initializeCount = 0;
  subscribeCount = 0;
  unsubscribeCount = 0;
  listeningCount = 0;
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
            resources: { subscribe: true },
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
      return { jsonrpc: '2.0', id: request.id, result: { resources: [] } };
    }
    if (request.method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { resourceTemplates: [] },
      };
    }
    if (request.method === 'resources/subscribe') this.subscribeCount++;
    if (request.method === 'resources/unsubscribe') this.unsubscribeCount++;
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
  forward: (input: any, options?: any) => unknown | Promise<unknown>
): AxProgrammable<any, any> {
  return {
    getId: () => 'mcp-event-program',
    forward: (_ai: unknown, input: unknown, options?: unknown) =>
      Promise.resolve(forward(input, options)),
    streamingForward: async function* () {},
  } as unknown as AxProgrammable<any, any>;
}

describe('AxMCPEventSource', () => {
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
            program: program(forward),
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
            program: program(forward),
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
      program: program(async ({ type }, options) => {
        calls.push(type);
        if (type === 'job.start') {
          await taskTool.func?.(
            {},
            {
              eventContext: options.eventContext,
              abortSignal: options.abortSignal,
            }
          );
        }
        return { type };
      }),
      mapInput: ({ event }) => ({ type: event.type }),
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
