import { AxMCPClient, AxMCPStreamableHTTPTransport } from '@ax-llm/ax';

// From the repository root (Node.js >= 20):
//   npm ci
//   npm run build --workspace=@ax-llm/ax
//   npm run example -- src/examples/mcp-client-deed-page.ts
// No account, deed.page key or model API key is needed: this example calls the
// keyless deed.page MCP tools directly. It publishes a small page, checks that
// the public URL loads, then deletes it with the owner token from the first
// publish. Published pages are public, so never publish secrets.
// Tool reference: https://deed.page/docs
const client = new AxMCPClient(
  new AxMCPStreamableHTTPTransport('https://deed.page/mcp', {
    headers: { 'User-Agent': 'ax-deed-page-example/1.0' },
  }),
  { namespace: 'deedpage' }
);

type PublishResult = { url: string; slug: string; token: string };

const textOf = (result: { content?: readonly unknown[] }) =>
  (result.content ?? [])
    .map((part) =>
      typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : ''
    )
    .join('');

try {
  await client.init();
  const { tools } = await client.listTools();
  for (const name of ['publish_site', 'delete_site']) {
    if (!tools.some((tool) => tool.name === name)) {
      throw new Error(`deed.page MCP did not advertise ${name}`);
    }
  }

  const published = await client.callTool('publish_site', {
    files: {
      'index.html':
        '<!doctype html><title>Ax report</title><h1>Hello from Ax</h1>',
    },
    // Safety net: the page expires after an hour even if the delete below fails.
    ttl_seconds: 3600,
  });
  if (published.isError) {
    throw new Error(`deed.page publish failed: ${textOf(published)}`);
  }
  const site = JSON.parse(textOf(published)) as PublishResult;
  console.log('Published:', site.url);

  const page = await fetch(site.url);
  console.log('GET', site.url, page.status);

  // The first publish returns an owner token; keep it to update or delete later.
  const deleted = await client.callTool('delete_site', {
    slug: site.slug,
    token: site.token,
  });
  if (deleted.isError) {
    throw new Error(`deed.page delete failed: ${textOf(deleted)}`);
  }
  console.log('Deleted:', textOf(deleted));
} finally {
  await client.close();
}
