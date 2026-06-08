/*
 * Deterministic MCP client smoke:
 * - Uses an in-memory MCP transport, no network and no API key.
 * - Exercises initialize, protocol negotiation, tools/list, tools/call, and
 *   AxMCPClient.toFunction().
 *
 * Run: npm run example -- ts src/examples/mcp-scripted-tools.ts
 */

import {
  AxMCPClient,
  type AxMCPJSONRPCNotification,
  type AxMCPJSONRPCRequest,
  type AxMCPJSONRPCResponse,
  type AxMCPTransport,
} from '@ax-llm/ax';

class ScriptedMCPTransport implements AxMCPTransport {
  notifications: AxMCPJSONRPCNotification[] = [];
  protocolVersion = '2025-11-25';

  async connect(): Promise<void> {}

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion;
  }

  async send(
    message: Readonly<AxMCPJSONRPCRequest<unknown>>
  ): Promise<AxMCPJSONRPCResponse<unknown>> {
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: this.protocolVersion,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'scripted-mcp', version: '1.0.0' },
        },
      };
    }

    if (message.method === 'ping') {
      return { jsonrpc: '2.0', id: message.id, result: {} };
    }

    if (message.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            {
              name: 'lookup_weather',
              description: 'Look up deterministic weather for a city',
              inputSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'City name' },
                },
                required: ['city'],
              },
            },
          ],
        },
      };
    }

    if (message.method === 'tools/call') {
      const params = message.params as {
        name: string;
        arguments?: { city?: string };
      };
      const city = params.arguments?.city ?? 'unknown';
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: `${city}: clear, 21C`,
            },
          ],
          structuredContent: { city, condition: 'clear', temperatureC: 21 },
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method ${message.method}` },
    };
  }

  async sendNotification(
    message: Readonly<AxMCPJSONRPCNotification>
  ): Promise<void> {
    this.notifications.push({ ...message });
  }
}

const transport = new ScriptedMCPTransport();
const client = new AxMCPClient(transport);

await client.init();
await client.ping();

const weather = client.toFunction().find((fn) => fn.name === 'lookup_weather');
if (!weather) {
  throw new Error('lookup_weather was not discovered');
}

const result = await weather.func({ city: 'Vancouver' });

console.log('mcp-scripted-tools', result);
console.log(
  'mcp-notifications',
  transport.notifications.map((notification) => notification.method).join(',')
);
