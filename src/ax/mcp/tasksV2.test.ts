import { describe, expect, it, vi } from 'vitest';
import { AxMCPClient } from './client.js';
import { AxMCPProtocolError } from './errors.js';
import { AX_MCP_TASKS_EXTENSION } from './extensions.js';
import type { AxMCPTransport } from './transport.js';
import type {
  AxMCPJSONRPCRequest,
  AxMCPJSONRPCResponse,
  AxMCPTask,
} from './types.js';

const completedResult = {
  resultType: 'complete' as const,
  content: [{ type: 'text' as const, text: 'done' }],
  structuredContent: { done: true },
};

function task(
  status: AxMCPTask['status'],
  extra: Partial<AxMCPTask> = {}
): AxMCPTask {
  return {
    taskId: 'task-1',
    status,
    createdAt: '2026-07-28T00:00:00Z',
    lastUpdatedAt: '2026-07-28T00:00:01Z',
    ttlMs: 60_000,
    pollIntervalMs: 0,
    ...extra,
  };
}

function modernTransport(
  handler: (
    request: Readonly<AxMCPJSONRPCRequest<unknown>>
  ) => unknown | Promise<unknown>,
  requests: AxMCPJSONRPCRequest[] = []
): AxMCPTransport {
  return {
    send: async (request) => {
      requests.push(structuredClone(request));
      let result: unknown;
      if (request.method === 'server/discover') {
        result = {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: {
            tools: {},
            extensions: { [AX_MCP_TASKS_EXTENSION]: {} },
          },
          ttlMs: 60_000,
          cacheScope: 'private',
        };
      } else if (request.method === 'tools/list') {
        result = {
          resultType: 'complete',
          tools: [{ name: 'slow', inputSchema: { type: 'object' } }],
          ttlMs: 60_000,
          cacheScope: 'private',
        };
      } else {
        result = await handler(request);
      }
      return { jsonrpc: '2.0', id: request.id, result } as AxMCPJSONRPCResponse;
    },
    sendNotification: async () => {},
  };
}

describe('AxMCPClient Tasks extension v2', () => {
  it('advertises the extension and auto-awaits an unsolicited task', async () => {
    const requests: AxMCPJSONRPCRequest[] = [];
    const transport = modernTransport((request) => {
      if (request.method === 'tools/call') {
        return { resultType: 'task', ...task('working') };
      }
      if (request.method === 'tasks/get') {
        return task('completed', { result: completedResult });
      }
      throw new Error(`Unexpected method ${request.method}`);
    }, requests);
    const client = new AxMCPClient(transport, { era: 'modern' });

    await client.init();
    await expect(client.callTool('slow', {})).resolves.toMatchObject({
      structuredContent: { done: true },
    });

    expect(requests[0]?.params).toMatchObject({
      _meta: {
        'io.modelcontextprotocol/clientCapabilities': {
          extensions: { [AX_MCP_TASKS_EXTENSION]: {} },
        },
      },
    });
    expect(requests.map(({ method }) => method)).toContain('tasks/get');
  });

  it('exposes a durable task without polling when requested', async () => {
    const requests: AxMCPJSONRPCRequest[] = [];
    const client = new AxMCPClient(
      modernTransport((request) => {
        if (request.method === 'tools/call') {
          return { resultType: 'task', ...task('working') };
        }
        throw new Error(`Unexpected method ${request.method}`);
      }, requests),
      { era: 'modern' }
    );
    await client.init();

    await expect(
      client.callTool('slow', {}, { taskHandling: 'expose' })
    ).resolves.toMatchObject({
      resultType: 'task',
      taskId: 'task-1',
      status: 'working',
    });
    expect(requests.some(({ method }) => method === 'tasks/get')).toBe(false);
  });

  it('fulfills input_required through tasks/update and then completes', async () => {
    const requests: AxMCPJSONRPCRequest[] = [];
    let updated = false;
    const elicitation = vi.fn(async () => ({
      action: 'accept' as const,
      content: { approved: true },
    }));
    const client = new AxMCPClient(
      modernTransport((request) => {
        if (request.method === 'tools/call') {
          return { resultType: 'task', ...task('working') };
        }
        if (request.method === 'tasks/get') {
          return updated
            ? task('completed', { result: completedResult })
            : task('input_required', {
                inputRequests: {
                  approval: {
                    method: 'elicitation/create',
                    params: {
                      message: 'Approve the operation?',
                      requestedSchema: {
                        type: 'object',
                        properties: { approved: { type: 'boolean' } },
                      },
                    },
                  },
                },
              });
        }
        if (request.method === 'tasks/update') {
          updated = true;
          return {};
        }
        throw new Error(`Unexpected method ${request.method}`);
      }, requests),
      { era: 'modern', elicitation }
    );
    await client.init();

    await expect(client.callTool('slow', {})).resolves.toMatchObject({
      structuredContent: { done: true },
    });
    expect(elicitation).toHaveBeenCalledOnce();
    expect(
      requests.find(({ method }) => method === 'tasks/update')?.params
    ).toMatchObject({
      taskId: 'task-1',
      inputResponses: {
        approval: { action: 'accept', content: { approved: true } },
      },
    });
  });

  it('surfaces an embedded failed-task error as a typed protocol error', async () => {
    const client = new AxMCPClient(
      modernTransport((request) => {
        if (request.method === 'tools/call') {
          return { resultType: 'task', ...task('working') };
        }
        if (request.method === 'tasks/get') {
          return task('failed', {
            error: {
              code: -32091,
              message: 'index failed',
              data: { shard: 3 },
            },
          });
        }
        throw new Error(`Unexpected method ${request.method}`);
      }),
      { era: 'modern' }
    );
    await client.init();

    const operation = client.callTool('slow', {});
    await expect(operation).rejects.toBeInstanceOf(AxMCPProtocolError);
    await expect(operation).rejects.toMatchObject({
      code: -32091,
      data: { shard: 3 },
    });
  });

  it('supports empty-result update and cancel but gates legacy task methods', async () => {
    const methods: string[] = [];
    const client = new AxMCPClient(
      modernTransport((request) => {
        methods.push(request.method);
        if (
          request.method === 'tasks/update' ||
          request.method === 'tasks/cancel'
        ) {
          return {};
        }
        throw new Error(`Unexpected method ${request.method}`);
      }),
      { era: 'modern' }
    );
    await client.init();

    await expect(
      client.provideTaskInput('task-1', {})
    ).resolves.toBeUndefined();
    await expect(client.cancelTask('task-1')).resolves.toBeUndefined();
    await expect(client.listTasks()).rejects.toThrow(
      'only available for legacy'
    );
    await expect(client.getTaskResult('task-1')).rejects.toThrow(
      'only available for legacy'
    );
    await expect(client.callToolTask('slow')).rejects.toThrow(
      'only available for legacy'
    );
    expect(methods).toEqual(['tasks/update', 'tasks/cancel']);
  });

  it('honors extension opt-out and rejects unnegotiated task results', async () => {
    const requests: AxMCPJSONRPCRequest[] = [];
    const client = new AxMCPClient(
      modernTransport((request) => {
        if (request.method === 'tools/call') {
          return { resultType: 'task', ...task('working') };
        }
        throw new Error(`Unexpected method ${request.method}`);
      }, requests),
      { era: 'modern', tasksExtension: false }
    );
    await client.init();

    expect(client.hasTasksCapability()).toBe(false);
    expect(requests[0]?.params).not.toMatchObject({
      _meta: {
        'io.modelcontextprotocol/clientCapabilities': {
          extensions: { [AX_MCP_TASKS_EXTENSION]: {} },
        },
      },
    });
    await expect(client.callTool('slow', {})).rejects.toThrow(
      'without negotiating io.modelcontextprotocol/tasks'
    );
  });
});
