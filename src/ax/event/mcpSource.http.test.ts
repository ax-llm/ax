import { afterEach, describe, expect, it } from 'vitest';
import {
  AxMCPEventDemoServer,
  waitForDemoSignal,
} from '../../examples/mcp-event-demo-server.js';
import { agent } from '../agent/index.js';
import { AxMockAIService } from '../ai/mock/api.js';
import { flow } from '../flow/flow.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { AxMCPClient } from '../mcp/client.js';
import { AxMCPStreamableHTTPTransport } from '../mcp/transports/httpStreamTransport.js';
import { eventPath } from './mapping.js';
import { AxMCPEventSource, axMCPEventRoutes } from './mcpSource.js';
import { AxEventRuntime, eventRoute, eventTarget } from './runtime.js';
import { AxPushEventSource } from './sources.js';

const usage = {
  ai: 'mock',
  model: 'mock',
  tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};

function localClient(endpoint: string) {
  return new AxMCPClient(
    new AxMCPStreamableHTTPTransport(endpoint, {
      ssrfProtection: { allowHTTP: true, allowLoopback: true },
      reconnect: { initialDelayMs: 10, maxDelayMs: 20 },
    }),
    { namespace: 'inventory' }
  );
}

function agentAI() {
  return new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = String(request.chatPrompt[0]?.content ?? '');
      const content = system.includes('You (`distiller`)')
        ? 'Javascript Code: await respond("Summarize the changed resource", { uri: inputs.uri })'
        : 'Summary: inventory updated';
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
        modelUsage: usage as any,
      };
    },
  });
}

const servers: AxMCPEventDemoServer[] = [];
afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

describe('AxMCPEventSource over real localhost Streamable HTTP/SSE', () => {
  it('wakes an AxAgent, reconnects, restores its subscription, and unsubscribes on close', async () => {
    const server = new AxMCPEventDemoServer();
    servers.push(server);
    const client = localClient(await server.start());
    const source = new AxMCPEventSource({
      client,
      resources: ['demo://inventory'],
      identity: { tenantId: 'tenant-a' },
      trust: 'authenticated',
      reconnectDelayMs: 10,
    });
    const outputs: unknown[] = [];
    let resolveWake!: () => void;
    const wake = new Promise<void>((resolve) => {
      resolveWake = resolve;
    });
    const program = agent('uri:string -> summary:string', {
      runtime: new AxJSRuntime(),
      contextFields: [],
    });
    const target = eventTarget('inventory-agent')
      .program(program)
      .ai(agentAI())
      .wakeInput((input) => input.field('uri', eventPath.data('uri')))
      .retrySafety('idempotent')
      .sink({
        id: 'capture',
        write: (output) => {
          outputs.push(output);
          resolveWake();
        },
      })
      .build();
    const runtime = new AxEventRuntime({
      allowVolatile: true,
      sources: [source],
      routes: [
        eventRoute('resource-wake')
          .types('mcp.resource.updated')
          .sources('mcp://inventory')
          .authenticated()
          .wake(target)
          .build(),
      ],
    });

    try {
      await runtime.start();
      await server.waitForListeningConnection();
      await server.waitForSubscriptionCount(1);
      server.dropListeningConnections();
      await server.waitForListeningConnection();
      server.updateResource();
      await waitForDemoSignal(wake, 'real SSE Agent wake');
      expect(outputs).toEqual([{ summary: 'inventory updated' }]);
    } finally {
      await runtime.close({ drain: false });
      await client.close();
    }
    expect(server.isSubscribed()).toBe(false);
  });

  it('observes task progress and resumes an owned AxFlow continuation on terminal status', async () => {
    const server = new AxMCPEventDemoServer();
    servers.push(server);
    const client = localClient(await server.start());
    const push = new AxPushEventSource('application');
    const source = new AxMCPEventSource({
      client,
      identity: { tenantId: 'tenant-a' },
      trust: 'authenticated',
      reconnectDelayMs: 10,
    });
    let resolveTerminalEvent!: () => void;
    const terminalEvent = new Promise<void>((resolve) => {
      resolveTerminalEvent = resolve;
    });
    const unsubscribeTerminal = client.subscribeEvents((event) => {
      if (event.type === 'task_status' && event.task.status === 'completed') {
        resolveTerminalEvent();
      }
    });
    let modelStep = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        modelStep++;
        if (modelStep === 1) {
          return {
            results: [
              {
                index: 0,
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'task-call-1',
                    type: 'function' as const,
                    function: {
                      name: 'start_reindex',
                      params: { scope: 'inventory' },
                    },
                  },
                ],
              },
            ],
            modelUsage: usage as any,
          };
        }
        return {
          results: [
            {
              index: 0,
              content:
                modelStep === 2
                  ? 'answer: task started'
                  : 'answer: task completed',
              finishReason: 'stop' as const,
            },
          ],
          modelUsage: usage as any,
        };
      },
    });
    const workflow = flow<{ taskRequest: string; phase: string }>()
      .node('handle', 'taskRequest:string, phase:string -> answer:string')
      .execute('handle', (state) => ({
        taskRequest: state.taskRequest,
        phase: state.phase,
      }))
      .returns((state) => ({ answer: state.handleResult.answer as string }));
    let resolveResume!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    const observed: string[] = [];
    const flowOutputs: unknown[] = [];
    const target = eventTarget('task-flow')
      .program(workflow)
      .ai(ai)
      .wakeInput((input) =>
        input
          .field('taskRequest', eventPath.constant('Start reindex'))
          .field('phase', eventPath.constant('start'))
      )
      .resumeInput((input) =>
        input
          .field('taskRequest', eventPath.constant('Reindex finished'))
          .field('phase', eventPath.constant('completed'))
      )
      .forwardOptions({ mcp: client })
      .retrySafety('idempotent')
      .sink({
        id: 'capture',
        write: (output) => {
          flowOutputs.push(output);
          resolveResume();
        },
      })
      .build();
    const runtime = new AxEventRuntime({
      allowVolatile: true,
      sources: [push, source],
      routes: [
        eventRoute('task-start').types('job.start').wake(target).build(),
        ...axMCPEventRoutes({
          client,
          onObserve: ({ event }) => observed.push(event.type),
        }),
      ],
    });

    try {
      await runtime.start();
      await server.waitForListeningConnection();
      await push.publish({
        event: {
          specversion: '1.0',
          id: 'job-1',
          source: 'app://tests',
          type: 'job.start',
        },
        identity: { tenantId: 'tenant-a' },
        trust: 'authenticated',
      });
      await runtime.waitForIdle();
      const taskId = await server.waitForTask();
      server.completeTask(taskId);
      await waitForDemoSignal(terminalEvent, 'terminal MCP client event');
      await runtime.waitForIdle();
      try {
        await waitForDemoSignal(resumed, 'real SSE Flow resume', 2_000);
      } catch (error) {
        throw new Error(
          JSON.stringify({
            cause: String(error),
            observed,
            tasks: client.getKnownTasks(),
            deadLetters: await runtime.listDeadLetters(),
          })
        );
      }
      expect(observed).toContain('mcp.progress');
      expect(modelStep).toBe(3);
      expect(flowOutputs).toEqual([{ answer: 'answer: task completed' }]);
    } finally {
      unsubscribeTerminal();
      await runtime.close({ drain: false });
      await client.close();
    }
  }, 20_000);
});
