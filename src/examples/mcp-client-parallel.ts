import { randomUUID } from 'node:crypto';
import { AxMCPClient, AxMCPStreamableHTTPTransport } from '@ax-llm/ax';

// From the repository root (Node.js >= 20):
//   npm ci
//   npm run build --workspace=@ax-llm/ax
//   npm run example -- src/examples/mcp-client-parallel.ts
// No Parallel or model API key is needed: this example calls MCP tools directly.
// Anonymous access is for exploration and light use, with lower rate limits.
// Tool schemas and limits: https://docs.parallel.ai/integrations/mcp/search-mcp
const client = new AxMCPClient(
  new AxMCPStreamableHTTPTransport('https://search.parallel.ai/mcp', {
    headers: { 'User-Agent': 'ax-parallel-search-example/1.0' },
  }),
  { namespace: 'parallel' }
);

// Keep one identifier across the related search and fetch calls.
const sessionId = randomUUID();
const searchQueries = [
  'Parallel Search MCP tools',
  'Parallel MCP anonymous access',
];

try {
  await client.init();
  const { tools } = await client.listTools();
  for (const name of ['web_search', 'web_fetch']) {
    if (!tools.some((tool) => tool.name === name)) {
      throw new Error(`Parallel MCP did not advertise ${name}`);
    }
  }

  const search = await client.callTool('web_search', {
    objective: 'Find the official documentation for Parallel Search MCP tools.',
    search_queries: searchQueries,
    session_id: sessionId,
  });
  if (search.isError) {
    throw new Error(
      `Parallel search failed: ${JSON.stringify(search.content)}`
    );
  }
  console.log('Search:', JSON.stringify(search, null, 2));

  // Fetch the known documentation URL for exact setup details.
  const page = await client.callTool('web_fetch', {
    urls: ['https://docs.parallel.ai/integrations/mcp/search-mcp'],
    objective:
      'Find anonymous access requirements and the available MCP tools.',
    search_queries: searchQueries,
    session_id: sessionId,
  });
  if (page.isError) {
    throw new Error(`Parallel fetch failed: ${JSON.stringify(page.content)}`);
  }
  console.log('Fetch:', JSON.stringify(page, null, 2));
} finally {
  await client.close();
}
