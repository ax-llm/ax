// eslint-disable-next-line monorepo-cop/no-relative-import-outside-package
import { AxMCPClient } from '../ax/mcp/client.js'
// eslint-disable-next-line monorepo-cop/no-relative-import-outside-package
import { AxMCPStdioTransport } from '../ax/mcp/stdioTransport.js'

const stdioTransport = new AxMCPStdioTransport('npx', [
  '-y',
  '@modelcontextprotocol/server-memory',
])
const client = new AxMCPClient(stdioTransport, { debug: true })
await client.init()

const functions = client.getFunctions()
console.log(functions)
