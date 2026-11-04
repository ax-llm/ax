import { AxMCPClient, AxMCPStreamableHTTPTransport } from '@ax-llm/ax';

// Optional local repository lookup through Sem (https://github.com/Ataraxy-Labs/sem).
// Install Sem, then start it in another terminal in the same network namespace:
//   export SEM_REPO=/absolute/path/to/checkout
//   export SEM_MCP_HTTP_TOKEN="$(openssl rand -hex 32)"
//   SEM_LOCAL=1 SEM_NO_NETWORK=1 SEM_NO_TELEMETRY=1 sem mcp --http 127.0.0.1:8787
// Pass the SAME token securely to this terminal (do not generate a second token).
// From this repo root, after npm ci and npm run build --workspace=@ax-llm/ax:
//   npm run example -- src/examples/mcp-client-sem.ts parse_config
// No model call: raw MCP results are printed. HTTP Sem exposes discovery, not
// shell/edit tools. Indexes may be written locally. Source must be approved for
// any model provider you subsequently connect; local mode is not an OS sandbox.
const token = process.env.SEM_MCP_HTTP_TOKEN;
if (!token || token.length < 32) {
  throw new Error('Set SEM_MCP_HTTP_TOKEN to the token used by the Sem server');
}
const query = process.argv[2]?.trim();
if (!query) {
  throw new Error('Supply a symbol name, for example: parse_config');
}
const client = new AxMCPClient(
  new AxMCPStreamableHTTPTransport('http://127.0.0.1:8787/mcp', {
    headers: { Authorization: `Bearer ${token}` },
    ssrfProtection: {
      allowHTTP: true,
      allowLoopback: true,
      validateURL: (url) => {
        if (url.origin !== 'http://127.0.0.1:8787') {
          throw new Error('This example permits only the local Sem endpoint');
        }
      },
    },
  }),
  { namespace: 'sem' }
);
try {
  await client.init();
  const result = await client.callTool('sem_find', { query });
  if (result.isError) {
    throw new Error(`Sem lookup failed: ${JSON.stringify(result.content)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
