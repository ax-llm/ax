// TS-derived goldens for how AxMCPClient hands a tool call's task to the caller:
// callTool (awaits a modern task), callTool with taskHandling 'expose' (returns
// the flattened CreateTaskResult) and callToolOutcome ({kind, result | task}).
// Each case replays scripted server responses through a real TS client and
// records what the call returns (or throws) and which requests it sends after
// init. A legacy server's task-shaped result is a plain result under all three
// APIs, as TypeScript reads it (legacy tasks come only from callToolTask).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxMCPClient } from '../../../src/ax/mcp/client.js';
import type { AxMCPTransport } from '../../../src/ax/mcp/transport.js';

const root = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();

type ScriptedResponse = { method: string; result: unknown };
type Api = 'call_tool' | 'call_tool_expose' | 'call_tool_outcome';

const tool = {
  name: 'start_reindex',
  description: 'Start an inventory reindex',
  inputSchema: {
    type: 'object' as const,
    properties: { scope: { type: 'string' as const } },
  },
};
const modernDiscovery = (tasks: boolean) => ({
  resultType: 'complete',
  supportedVersions: ['2026-07-28'],
  ttlMs: 60000,
  cacheScope: 'private',
  capabilities: {
    tools: {},
    ...(tasks ? { extensions: { 'io.modelcontextprotocol/tasks': {} } } : {}),
  },
});
const legacyInitialize = {
  protocolVersion: '2025-11-25',
  capabilities: { tools: {}, tasks: {} },
  serverInfo: { name: 'fixture', version: '1.0.0' },
};
const modernTask = {
  resultType: 'task',
  taskId: 'task-7',
  status: 'working',
  createdAt: '2026-07-28T00:00:00Z',
  lastUpdatedAt: '2026-07-28T00:00:01Z',
  ttlMs: 60000,
  pollIntervalMs: 0,
};
const completedTask = {
  taskId: 'task-7',
  status: 'completed',
  createdAt: '2026-07-28T00:00:00Z',
  lastUpdatedAt: '2026-07-28T00:00:02Z',
  ttlMs: 60000,
  pollIntervalMs: 0,
  result: {
    resultType: 'complete',
    content: [{ type: 'text', text: 'Reindexed 42 inventory records' }],
    structuredContent: { indexed: 42 },
  },
};
const modernComplete = {
  resultType: 'complete',
  content: [{ type: 'text', text: 'Reindexed 7 records' }],
  structuredContent: { indexed: 7 },
};
const legacyTaskResult = {
  task: {
    taskId: 'legacy-3',
    status: 'working',
    createdAt: '2025-11-25T00:00:00Z',
    lastUpdatedAt: '2025-11-25T00:00:00Z',
    ttl: null,
    pollInterval: 250,
  },
};
const legacyComplete = {
  content: [{ type: 'text', text: 'Reindexed 5 records' }],
  structuredContent: { indexed: 5 },
};

const scenarios: {
  name: string;
  era: 'modern' | 'legacy';
  responses: ScriptedResponse[];
}[] = [
  {
    name: 'modern task',
    era: 'modern',
    responses: [
      { method: 'server/discover', result: modernDiscovery(true) },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: modernTask },
      { method: 'tasks/get', result: completedTask },
    ],
  },
  {
    name: 'modern complete',
    era: 'modern',
    responses: [
      { method: 'server/discover', result: modernDiscovery(true) },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: modernComplete },
    ],
  },
  {
    name: 'modern task without the tasks extension',
    era: 'modern',
    responses: [
      { method: 'server/discover', result: modernDiscovery(false) },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: modernTask },
    ],
  },
  {
    name: 'modern invalid task',
    era: 'modern',
    responses: [
      { method: 'server/discover', result: modernDiscovery(true) },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: { ...modernTask, status: 'queued' } },
    ],
  },
  {
    name: 'legacy task-shaped result',
    era: 'legacy',
    responses: [
      { method: 'initialize', result: legacyInitialize },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: legacyTaskResult },
    ],
  },
  {
    name: 'legacy complete',
    era: 'legacy',
    responses: [
      { method: 'initialize', result: legacyInitialize },
      { method: 'tools/list', result: { tools: [tool] } },
      { method: 'tools/call', result: legacyComplete },
    ],
  },
];

const apis: Api[] = ['call_tool', 'call_tool_expose', 'call_tool_outcome'];
const args = { scope: 'all' };
const cases: Record<string, unknown>[] = [];
for (const scenario of scenarios) {
  for (const api of apis) {
    const remaining = scenario.responses.map((response) => ({ ...response }));
    const sent: string[] = [];
    const transport: AxMCPTransport = {
      async send(request) {
        sent.push(request.method);
        const index = remaining.findIndex(
          (response) => response.method === request.method
        );
        const result = index >= 0 ? remaining.splice(index, 1)[0]!.result : {};
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: structuredClone(result),
        };
      },
      async sendNotification() {},
    };
    const client = new AxMCPClient(transport, {
      namespace: 'inventory',
      era: scenario.era,
    });
    await client.init();
    sent.length = 0;
    let output: unknown;
    let error: string | undefined;
    try {
      output =
        api === 'call_tool'
          ? await client.callTool(tool.name, args)
          : api === 'call_tool_expose'
            ? await client.callTool(tool.name, args, { taskHandling: 'expose' })
            : await client.callToolOutcome(tool.name, args);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    cases.push({
      name: `${scenario.name}: ${api}`,
      era: scenario.era,
      api,
      responses: scenario.responses,
      expected_methods: [...sent],
      ...(error !== undefined
        ? { expected_error: error }
        : { expected: structuredClone(output) }),
    });
    await client.close();
  }
}

const dir = join(root, 'ir', 'conformance', 'axmcp');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'tool-task-handling.json'),
  `${JSON.stringify(
    {
      kind: 'mcp',
      operation: 'tool_task_handling',
      name: 'tool-task-handling',
      description:
        'callTool awaits a modern task, callTool with taskHandling expose returns the flattened CreateTaskResult, and callToolOutcome returns {kind: complete, result} or {kind: task, task}. A legacy server task-shaped result is a plain result under all three. expected_methods lists the requests each call sends after init.',
      source: {
        tsDerived: true,
        extractor: 'tools/axir/extractors/mcp-task-handling-goldens.ts',
        reference: ['src/ax/mcp/client.ts'],
      },
      client_options: { namespace: 'inventory' },
      arguments: args,
      tool: tool.name,
      cases,
    },
    null,
    2
  )}\n`
);
console.log('wrote TS-derived MCP tool task-handling fixture');
