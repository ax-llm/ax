import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxMCPClient } from '../../../src/ax/mcp/client.js';
import type { AxMCPTransport } from '../../../src/ax/mcp/transport.js';

const root = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const tool = {
  name: 'lookup',
  description: 'Find a reference',
  inputSchema: {
    type: 'object' as const,
    properties: { query: { type: 'string' as const } },
    required: ['query'],
    additionalProperties: false,
  },
};
const discovery = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  ttlMs: 60000,
  cacheScope: 'private',
  capabilities: { tools: {} },
};
const result = {
  resultType: 'complete',
  structuredContent: { reference: 'REF-42' },
  content: [{ type: 'text', text: 'REF-42' }],
};
const cases: Record<string, unknown>[] = [];
for (const [name, decision] of [
  ['lookup', true],
  ['lookup', false],
  ['lookup', undefined],
  ['missing', true],
] as const) {
  const sent: string[] = [];
  const observed: Record<string, unknown>[] = [];
  const transport: AxMCPTransport = {
    async send(request) {
      sent.push(request.method);
      const value =
        request.method === 'server/discover'
          ? discovery
          : request.method === 'tools/list'
            ? { tools: [tool] }
            : result;
      return { jsonrpc: '2.0', id: request.id, result: value };
    },
    async sendNotification() {},
  };
  const client = new AxMCPClient(transport, {
    namespace: 'orders',
    era: 'modern',
    authorizeToolCall(call) {
      if (call.client !== client)
        throw new Error('Authorization lost the client');
      observed.push({
        namespace: call.namespace,
        tool: call.tool,
        arguments: call.arguments,
      });
      return decision;
    },
  });
  await client.init();
  let output: unknown;
  let error: string | undefined;
  try {
    output = await client.callTool(name, { query: 'REF-42' });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  cases.push({
    name,
    decision: decision ?? null,
    expected_context: observed[0],
    expected_authorization_calls: observed.length,
    expected_tool_requests: sent.filter((method) => method === 'tools/call')
      .length,
    ...(error ? { expected_error: error } : { expected_result: output }),
  });
  await client.close();
}
const dir = join(root, 'ir', 'conformance', 'axmcp');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'native-tool-host-authorization.json'),
  `${JSON.stringify(
    {
      kind: 'mcp',
      operation: 'tool_authorization',
      name: 'native-tool-host-authorization',
      source: {
        tsDerived: true,
        extractor: 'tools/axir/extractors/mcp-authorization-goldens.ts',
        reference: ['src/ax/mcp/client.ts'],
      },
      client_options: { namespace: 'orders', era: 'modern' },
      responses: [discovery, { tools: [tool] }, result].map((value) => ({
        jsonrpc: '2.0',
        id: 'fixture',
        result: value,
      })),
      cases,
    },
    null,
    2
  )}\n`
);
console.log('wrote TS-derived MCP host-authorization fixture');
