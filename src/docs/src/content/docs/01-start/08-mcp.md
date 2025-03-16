---
title: Model Context Protocol (MCP)
description: Model Context Protocol (MCP), allowing your agents to access external tools, and resources through a standardized interface.
---

Ax provides seamless integration with the Model Context Protocol (MCP), allowing your agents to access external tools, and resources through a standardized interface.

## Using AxMCPClient

The `AxMCPClient` allows you to connect to any MCP-compatible server and use its capabilities within your Ax agents:

```typescript
import { AxMCPClient, AxMCPStdioTransport } from '@ax-llm/ax'

// Initialize an MCP client with a transport
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
})

// Create the client with optional debug mode
const client = new AxMCPClient(transport, { debug: true })

// Initialize the connection
await client.init()

// Use the client's functions in an agent
const memoryAgent = new AxAgent({
  name: 'MemoryAssistant',
  description: 'An assistant with persistent memory',
  signature: 'input, userId -> response',
  functions: [client], // Pass the client as a function provider
})

// Or use the client with AxGen
const memoryGen = new AxGen('input, userId -> response', {
    functions: [client]
})
```