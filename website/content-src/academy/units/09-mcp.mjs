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
    'src/examples/typescript/mcp/modern-dual-era-client.ts',
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
        'You connect one MCP client over the transport that fits your deployment. Streamable HTTP is the normal remote choice and supports both stateful and stateless servers.',
      example:
        "const client = new AxMCPClient(new AxMCPStreamableHTTPTransport(url), { namespace: 'orders' });",
      exampleSteps: [
        {
          label: 'Create the transport',
          note: 'Streamable HTTP connects the client to the remote URL.',
        },
        {
          label: 'Create one client',
          note: 'AxMCPClient owns era classification and the protocol lifecycle.',
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
      id: 'mcp-dual-era-discovery',
      title: 'Classify stateful and stateless MCP',
      minutes: 9,
      apiLabel: 'discover()',
      prerequisites: ['mcp-lifecycle-transports'],
      summary:
        'Automatic era classification keeps one client compatible with stateful 2025-11-25 and stateless 2026-07-28 servers. Modern discovery returns supported versions, capabilities, instructions, cache policy, and server identity.',
      example:
        'const discovery = await client.discover();\nconsole.log(client.getEra(), discovery.supportedVersions);',
      exampleSteps: [
        {
          label: 'Keep automatic classification',
          note: 'Pin an era only when deployment policy already knows the endpoint contract.',
        },
        {
          label: 'Read modern discovery',
          note: 'server/discover is stateless and is available only after the endpoint classifies as modern.',
        },
      ],
      check: choice(
        'Which API should era-neutral code use to inspect tools and resources?',
        [
          'inspectCatalog()',
          'Always call server/discover',
          'Always send initialize manually',
        ],
        0,
        'inspectCatalog() works across both eras; discover() is modern-only.'
      ),
      apiSymbols: ['AxMCPClient'],
    }),
    topic({
      id: 'mcp-catalog',
      title: 'Discover what an MCP server offers',
      minutes: 7,
      apiLabel: 'inspectCatalog()',
      prerequisites: ['mcp-dual-era-discovery'],
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
      id: 'mcp-modern-roundtrips-listening',
      title: 'Fulfill input rounds and listen statelessly',
      minutes: 10,
      apiLabel: 'startListening()',
      prerequisites: ['mcp-catalog'],
      summary:
        'A modern operation may request roots, sampling, or elicitation input before it completes. Modern notifications arrive through a fresh subscriptions/listen POST instead of a resumable session stream.',
      example:
        "const listening = await client.startListening();\nawait listening.ready;\nconst result = await client.callTool('review', input);",
      check: choice(
        'What should a modern reconnect send after a listen stream ends?',
        [
          'A fresh subscriptions/listen request with current interests',
          'A Last-Event-ID session resume header',
          'A JSON-RPC batch',
        ],
        0,
        'Modern listening is stateless and reissues the filter with a fresh request ID.'
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
      prerequisites: [
        'mcp-attach',
        'mcp-auth-security',
        'mcp-modern-roundtrips-listening',
      ],
      summary:
        'Modern servers may return a task from an ordinary tool call, which Ax can auto-await or expose for input, cancellation, and observation. Legacy task-draft APIs remain compatibility-only.',
      example:
        "const outcome = await client.callToolOutcome(name, input);\nif (outcome.kind === 'task') await client.waitForTask(outcome.task.taskId);",
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
