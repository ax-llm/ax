import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxMCPClient } from '../../../src/ax/mcp/client.js';
import type { AxMCPInheritance } from '../../../src/ax/mcp/execution.js';
import {
  AxMCPExecutionContext,
  axMCPChildExecutionOptions,
} from '../../../src/ax/mcp/execution.js';
import { AxUCPClient } from '../../../src/ax/ucp/client.js';

const mcp = ['inventory', 'orders'];
const ucp = ['merchant'];
const cases: Record<string, unknown>[] = [];
for (const inheritance of [
  'all',
  'none',
  [],
  ['orders'],
  ['orders', 'inventory'],
  ['merchant', 'orders'],
  ['missing'],
  ['inventory', 'inventory'],
  ['merchant', 'merchant'],
] satisfies AxMCPInheritance[]) {
  const clients = mcp.map(
    (namespace) =>
      new AxMCPClient(
        {
          async send() {
            throw new Error('Inheritance selection must not send a request');
          },
          async sendNotification() {},
        },
        { namespace }
      )
  );
  const merchants = ucp.map(
    (namespace) =>
      new AxUCPClient({
        namespace,
        profileUrl: 'https://merchant.example/ucp',
        agentProfile: 'https://agent.example/ucp',
        schemaValidation: false,
      })
  );
  const context = new AxMCPExecutionContext(clients, inheritance, merchants);
  const control = {};
  try {
    const options = axMCPChildExecutionOptions({
      _mcpExecutionContext: context,
      mcp: clients,
      ucp: merchants,
      control,
    });
    if (options.control !== control || 'mcp' in options || 'ucp' in options)
      throw new Error('Child options lost their ownership boundary');
    const child = options._mcpExecutionContext;
    if (inheritance === 'none' && child)
      throw new Error('Disabled inheritance retained the parent context');
    cases.push({
      inheritance,
      expected: {
        mcp: child?.clients.map((client) => client.getNamespace()) ?? [],
        ucp: child?.ucpClients.map((client) => client.getNamespace()) ?? [],
      },
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/^(Unknown inherited MCP|Duplicate MCP)/.test(error.message)
    )
      throw error;
    cases.push({
      inheritance,
      expected_error: error instanceof Error ? error.message : String(error),
    });
  }
}
const dir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axmcp'
);
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'execution-context-inheritance.json'),
  `${JSON.stringify({ kind: 'mcp', operation: 'inheritance_plan', name: 'execution-context-inheritance', source: { tsDerived: true, extractor: 'tools/axir/extractors/mcp-inheritance-goldens.ts', reference: ['src/ax/mcp/execution.ts', 'src/ax/mcp/execution.test.ts'] }, mcp, ucp, cases }, null, 2)}\n`
);

const discovery = {
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  ttlMs: 60000,
  cacheScope: 'private',
  capabilities: { tools: {} },
};
const clientSpecs = mcp.map((namespace) => ({
  namespace,
  responses: [
    { jsonrpc: '2.0', result: discovery },
    {
      jsonrpc: '2.0',
      result: {
        tools: [
          {
            name: `lookup_${namespace}`,
            description: 'Read the selected namespace',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
          },
        ],
      },
    },
    {
      jsonrpc: '2.0',
      result: {
        resultType: 'complete',
        structuredContent: { namespace, reference: `${namespace}-REF` },
        content: [{ type: 'text', text: `${namespace}-REF` }],
      },
    },
  ],
}));
const nativeCases: Record<string, unknown>[] = [];
for (const inheritance of [
  'all',
  'none',
  [],
  ['orders'],
  ['orders', 'inventory'],
  ['missing'],
  ['inventory', 'inventory'],
] satisfies AxMCPInheritance[]) {
  const sent = new Map<string, string[]>();
  const calls = new Map<string, unknown[]>();
  const clients = clientSpecs.map((spec) => {
    const requests: string[] = [];
    sent.set(spec.namespace, requests);
    const toolCalls: unknown[] = [];
    calls.set(spec.namespace, toolCalls);
    let index = 0;
    return new AxMCPClient(
      {
        async send(request) {
          requests.push(request.method);
          if (request.method === 'tools/call')
            toolCalls.push({
              name: request.params?.name,
              arguments: request.params?.arguments,
            });
          const response =
            spec.responses[Math.min(index++, spec.responses.length - 1)];
          if (!response) throw new Error('Unexpected inheritance request');
          return { ...response, id: request.id };
        },
        async sendNotification() {},
      },
      { namespace: spec.namespace, era: 'modern' }
    );
  });
  const context = new AxMCPExecutionContext(clients, inheritance);
  let selected: string[] = [];
  const results: unknown[] = [];
  let error: string | undefined;
  try {
    const child = axMCPChildExecutionOptions({
      _mcpExecutionContext: context,
    })._mcpExecutionContext;
    if (child) {
      await child.initialize();
      selected = child.clients.map((client) => client.getNamespace());
      for (const tool of child.getToolBindings())
        results.push(await tool.func({ query: 'scope-probe' }, {}));
    }
  } catch (caught) {
    if (
      !(caught instanceof Error) ||
      !/^(Unknown inherited MCP|Duplicate MCP)/.test(caught.message)
    )
      throw caught;
    error = caught.message;
  }
  const record: Record<string, unknown> = {
    inheritance,
    ...(error ? { expected_error: error } : { expected_namespaces: selected }),
    expected_results: results,
    expected_methods: Object.fromEntries(
      [...sent].map(([name, methods]) => [name, [...methods]])
    ),
  };
  await context.initialize();
  const parentResults: unknown[] = [];
  for (const tool of context.getToolBindings())
    parentResults.push(await tool.func({ query: 'parent-probe' }, {}));
  record.expected_parent_results = parentResults;
  record.expected_parent_methods = Object.fromEntries(sent);
  record.expected_calls = Object.fromEntries(calls);
  nativeCases.push(record);
  await Promise.all(clients.map((client) => client.close()));
}
writeFileSync(
  join(dir, 'execution-context-inheritance-requests.json'),
  `${JSON.stringify({ kind: 'mcp', operation: 'inheritance_context', name: 'execution-context-inheritance-requests', source: { tsDerived: true, extractor: 'tools/axir/extractors/mcp-inheritance-goldens.ts', reference: ['src/ax/mcp/execution.ts'] }, clients: clientSpecs.map((spec) => ({ ...spec, responses: [...spec.responses, spec.responses[spec.responses.length - 1]] })), cases: nativeCases }, null, 2)}\n`
);

writeFileSync(
  join(dir, 'execution-context-agent-attachment.json'),
  `${JSON.stringify(
    {
      kind: 'mcp',
      operation: 'inheritance_agent_context',
      name: 'execution-context-agent-attachment',
      source: {
        tsDerived: true,
        extractor: 'tools/axir/extractors/mcp-inheritance-goldens.ts',
        reference: ['src/ax/mcp/execution.ts'],
        notes:
          'Replays the TypeScript context request oracle through generated agent invocation and checks preservation of an ordinary tool.',
      },
      agent_options: {
        functions: [
          {
            name: 'local_echo',
            description: 'Return the local reference',
            parameters: { type: 'object', properties: {} },
          },
        ],
        callable_results: { 'tools.local_echo': { value: 'LOCAL-17' } },
      },
      expected_local_result: { status: 'ok', value: 'LOCAL-17' },
      clients: clientSpecs.map((spec) => ({
        ...spec,
        responses: [
          ...spec.responses,
          spec.responses[spec.responses.length - 1],
        ],
      })),
      cases: nativeCases,
    },
    null,
    2
  )}\n`
);
