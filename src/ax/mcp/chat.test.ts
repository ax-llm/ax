import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { axMCPChat } from './chat.js';
import { AxMCPClient } from './client.js';
import type { AxMCPTransport } from './transport.js';

describe('axMCPChat', () => {
  it('runs the native MCP tool loop and retains raw protocol results', async () => {
    const transport: AxMCPTransport = {
      send: async (request) => ({
        jsonrpc: '2.0',
        id: request.id,
        result:
          request.method === 'initialize'
            ? {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'inventory', version: '1' },
              }
            : request.method === 'tools/list'
              ? {
                  tools: [
                    { name: 'inventory', inputSchema: { type: 'object' } },
                  ],
                }
              : {
                  structuredContent: { available: 4 },
                  content: [{ type: 'text', text: 'four' }],
                },
      }),
      sendNotification: async () => {},
    };
    const client = new AxMCPClient(transport, { namespace: 'warehouse' });
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
                  functionCalls: [
                    {
                      id: 'call-1',
                      type: 'function' as const,
                      function: { name: 'inventory', params: {} },
                    },
                  ],
                  finishReason: 'stop' as const,
                },
              ],
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'There are four.',
                  finishReason: 'stop' as const,
                },
              ],
            };
      },
    });

    const result = await axMCPChat(
      ai,
      { chatPrompt: [{ role: 'user', content: 'Stock?' }] },
      { mcp: client }
    );

    expect(result.response.results[0]?.content).toBe('There are four.');
    expect(
      result.messages.find((message) => message.role === 'function')
        ?.protocolResult
    ).toMatchObject({
      protocol: { kind: 'mcp', namespace: 'warehouse', name: 'inventory' },
      value: { structuredContent: { available: 4 } },
    });
  });
});
