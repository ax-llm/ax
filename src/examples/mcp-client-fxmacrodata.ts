import { AxMCPClient, AxMCPStreamableHTTPTransport } from '@ax-llm/ax';

// From the repository root (Node.js >= 20):
//   npm ci
//   npm run build --workspace=@ax-llm/ax
//   npm run example -- src/examples/mcp-client-fxmacrodata.ts
// No model API key is needed: this example calls MCP tools directly.
// USD data works without an FXMacroData key (announcements on a 15-minute
// delay). Set FXMACRODATA_API_KEY to remove the delay and query the other
// currencies; it is sent as a bearer token.
// Tools and access: https://fxmacrodata.com/documentation/mcp-server?utm_source=github&utm_medium=referral&utm_campaign=ax&utm_content=example
const apiKey = process.env.FXMACRODATA_API_KEY;

const client = new AxMCPClient(
  new AxMCPStreamableHTTPTransport('https://mcp.fxmacrodata.com/mcp', {
    headers: { 'User-Agent': 'ax-fxmacrodata-example/1.0' },
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }),
  { namespace: 'fxmacrodata' }
);

try {
  await client.init();
  const { tools } = await client.listTools();
  for (const name of ['release_calendar', 'latest_announcements']) {
    if (!tools.some((tool) => tool.name === name)) {
      throw new Error(`FXMacroData MCP did not advertise ${name}`);
    }
  }

  // Upcoming scheduled USD releases, with UTC and market-local timestamps.
  const calendar = await client.callTool('release_calendar', {
    currency: 'usd',
    timezone: 'America/New_York',
  });
  if (calendar.isError) {
    throw new Error(
      `FXMacroData calendar failed: ${JSON.stringify(calendar.content)}`
    );
  }
  console.log('Calendar:', JSON.stringify(calendar, null, 2));

  // Latest stored value for every USD indicator.
  const latest = await client.callTool('latest_announcements', {
    currency: 'usd',
  });
  if (latest.isError) {
    throw new Error(
      `FXMacroData latest releases failed: ${JSON.stringify(latest.content)}`
    );
  }
  console.log('Latest:', JSON.stringify(latest, null, 2));
} finally {
  await client.close();
}
