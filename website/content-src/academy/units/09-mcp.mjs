import { choice, topic } from '../helpers.mjs';

export const mcpUnit = {
  id: 'mcp',
  number: 9,
  title: 'Connect to external tools and data',
  description:
    'Use MCP to discover and safely connect servers, tools, resources, and long-running tasks.',
  sourceRefs: ['src/ax/skills/ax-mcp.md'],
  examplePaths: [
    'src/examples/typescript/mcp/native-mcp-tools.ts',
    'src/examples/mcp-task-resume-flow.ts',
  ],
  topics: [
    topic({
      id: 'mcp-lifecycle-transports',
      title: 'MCP lifecycle and transports',
      prerequisites: ['typed-tools'],
      summary:
        'AxMCPClient initializes one negotiated session over stdio, Streamable HTTP, legacy HTTP/SSE, resumable SSE, or a custom WebSocket transport. Choose the transport that matches deployment and lifecycle needs.',
      example:
        "const client = new AxMCPClient(new AxMCPStreamableHTTPTransport({ url }), { namespace: 'orders' });",
      check: choice(
        'Which transport is the normal remote HTTP choice for current MCP servers?',
        ['Streamable HTTP', 'An implicit global WebSocket', 'A prompt string'],
        0,
        'Streamable HTTP is the current remote transport; SSE remains a compatibility path.'
      ),
      apiSymbols: ['AxMCPClient', 'AxMCPStreamableHTTPTransport'],
    }),
    topic({
      id: 'mcp-catalog',
      title: 'Catalogs and native capabilities',
      prerequisites: ['mcp-lifecycle-transports'],
      summary:
        'The endpoint owns tool names, prompt names, resources, URI templates, and capabilities. inspectCatalog() discovers those values; applications should not invent identifiers the server can list.',
      example:
        'const catalog = await client.inspectCatalog({ refresh: true });\nconsole.log(catalog.tools, catalog.resources, catalog.capabilities);',
      check: choice(
        'Where should an application learn an MCP server’s tool names?',
        [
          'From the negotiated catalog',
          'From a guessed naming convention',
          'From the Ax output signature',
        ],
        0,
        'Catalog discovery keeps the integration aligned with the live server.'
      ),
      apiSymbols: ['AxMCPClient'],
    }),
    topic({
      id: 'mcp-attach',
      title: 'MCP with AxGen, AxAgent, and AxFlow',
      prerequisites: ['mcp-catalog', 'agent-core', 'flow-state-nodes'],
      summary:
        'Native MCP context can be attached to generators, agents, and flows without flattening every capability into handwritten functions. Tools remain native and task/progress events remain separate from generated output.',
      example:
        "const assistant = agent('request:string -> answer:string', { mcp: client, functionDiscovery: true });",
      check: choice(
        'Why keep MCP progress events separate from Ax output streaming?',
        [
          'They represent protocol task state, not generated output fields',
          'They contain the provider API key',
          'They always wake a model',
        ],
        0,
        'Protocol lifecycle and model output are different channels.'
      ),
      apiSymbols: ['AxMCPClient', 'agent'],
    }),
    topic({
      id: 'mcp-auth-security',
      title: 'OAuth, identity, and endpoint safety',
      prerequisites: ['mcp-lifecycle-transports'],
      summary:
        'MCP can use OAuth, client credentials, and enterprise-managed authorization, but an MCP session ID is not application tenant identity. Remote URL validation and SSRF protections should remain enabled.',
      example:
        "const client = new AxMCPClient(transport, { namespace: 'crm', auth });",
      check: choice(
        'Can an MCP session ID be used as application tenant identity?',
        [
          'No; identity must come from verified application authentication',
          'Yes; session IDs are always user accounts',
          'Only for resource templates',
        ],
        0,
        'Transport session identity and application authorization are separate boundaries.'
      ),
      apiSymbols: ['AxMCPClient'],
    }),
    topic({
      id: 'mcp-tasks-advanced',
      title: 'Tasks, progress, cancellation, Apps, and replay',
      prerequisites: ['mcp-attach', 'mcp-auth-security'],
      summary:
        'MCP tasks can report progress, require input, complete later, or be cancelled. Ax also supports server sampling, elicitation, roots, completions, MCP Apps, recording, and deterministic replay for evaluation.',
      example:
        'const task = await client.callTool({ name, arguments: input, task: { ttl: 60_000 } });',
      check: choice(
        'Why must task polling remain available even when notifications are supported?',
        [
          'Task notifications are optional and may be missed',
          'Polling authorizes every resource',
          'Polling replaces cancellation',
        ],
        0,
        'Notifications improve responsiveness, but polling remains the reliable fallback.'
      ),
      apiSymbols: ['AxMCPClient'],
    }),
  ],
};
