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
      title: 'Connect to an MCP server',
      minutes: 8,
      apiLabel: 'AxMCPClient',
      prerequisites: ['typed-tools'],
      summary:
        'You initialize one negotiated MCP session over the transport that fits your deployment. Streamable HTTP is the normal current choice for a remote server.',
      example:
        "const client = new AxMCPClient(new AxMCPStreamableHTTPTransport({ url }), { namespace: 'orders' });",
      exampleSteps: [
        {
          label: 'Create the transport',
          note: 'Streamable HTTP connects the client to the remote URL.',
        },
        {
          label: 'Create one client session',
          note: 'AxMCPClient owns negotiation and the protocol lifecycle.',
        },
        {
          label: 'Use a namespace',
          note: 'orders keeps discovered names clear when several servers are attached.',
        },
      ],
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
      title: 'Discover what an MCP server offers',
      minutes: 7,
      apiLabel: 'inspectCatalog()',
      prerequisites: ['mcp-lifecycle-transports'],
      summary:
        'You inspect the negotiated catalog for tools, prompts, resources, templates, and capabilities. Your app uses server-owned identifiers instead of guessing them.',
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
      title: 'Give Ax programs native MCP tools',
      minutes: 8,
      prerequisites: ['mcp-catalog', 'agent-core', 'flow-state-nodes'],
      summary:
        'You attach native MCP context to generators, agents, and flows without rewriting every capability as a host tool. Protocol progress remains separate from generated output.',
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
      title: 'Connect to remote MCP safely',
      minutes: 10,
      prerequisites: ['mcp-lifecycle-transports'],
      summary:
        'You authorize remote MCP with OAuth, client credentials, or enterprise policy while keeping application identity separate. URL validation and SSRF protections stay enabled.',
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
      title: 'Handle long-running MCP work',
      minutes: 11,
      prerequisites: ['mcp-attach', 'mcp-auth-security'],
      summary:
        'You can monitor progress, provide requested input, cancel, or resume work that finishes later. Recording and deterministic replay make the protocol lifecycle testable.',
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
