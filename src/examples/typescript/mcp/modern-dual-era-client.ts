// ax-example:start
// title: TypeScript Modern MCP Client
// group: mcp
// description: Classifies a modern endpoint, reads discovery metadata, fulfills MRTR input, and auto-awaits Tasks v2.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 15
// story: 63
// ax-example:end
import {
  AxAIOpenAIModel,
  AxMCPClient,
  AxMCPStreamableHTTPTransport,
  ai,
  ax,
} from '@ax-llm/ax';
import { AxMCPEventDemoServer } from '../../mcp-event-demo-server.js';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY.');

const server = new AxMCPEventDemoServer({ era: 'modern' });
const endpoint = await server.start();
const mcp = new AxMCPClient(
  new AxMCPStreamableHTTPTransport(endpoint, {
    ssrfProtection: { allowHTTP: true, allowLoopback: true },
  }),
  {
    namespace: 'inventory',
    era: 'auto',
    readCache: true,
    elicitation: async () => ({
      action: 'accept',
      content: { confirmed: true },
    }),
  }
);
const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
});
const reindex = ax(
  'reindexRequest:string -> answer:string "Call start_reindex with the requested scope and report the completed indexed count."',
  { mcp }
);

try {
  const discovery = await mcp.discover();
  if (mcp.getEra() !== 'modern') throw new Error('Expected modern MCP');

  const catalog = await mcp.inspectCatalog();
  const mrtr = await mcp.callTool('mrtr_one_round');
  console.log({
    versions: discovery.supportedVersions,
    cache: catalog.cache,
    mrtr: mrtr.structuredContent,
  });

  console.log(
    await reindex.forward(llm, {
      reindexRequest: 'Reindex the west warehouse inventory.',
    })
  );
} finally {
  await mcp.close();
  await server.close();
}
