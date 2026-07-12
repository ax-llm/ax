# @ax-llm/ax-tools

Node.js-specific tools for the Ax LLM framework.

## Overview

This package provides Node.js-specific functionality that cannot be included in
the main `@ax-llm/ax` package due to browser compatibility requirements. The
main package is designed to work in both Node.js and browser environments, while
this package provides Node.js-only features.

## Features

### MCP Tools

#### AxMCPStdioTransport

A transport for the Model Context Protocol (MCP) that communicates with MCP
servers via stdin/stdout. This enables running local MCP servers as child
processes.

### Persistent event runtime store

`@ax-llm/ax-tools/event/sqlite` exports `AxSQLiteEventStore` and
`AX_SQLITE_EVENT_STANDARD_RETENTION`. It supports cooperating Node processes
that share a local SQLite file. It is not intended for network filesystems.

### Function Tools

`AxJSRuntime` has moved to `@ax-llm/ax`.

## Installation

```bash
npm install @ax-llm/ax-tools
```

## Usage

### Basic MCP Stdio Transport

```typescript
import { ax, AxMCPClient } from "@ax-llm/ax";
import { AxMCPStdioTransport } from "@ax-llm/ax-tools";

// Create a stdio transport for an MCP server
const transport = new AxMCPStdioTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
  env: process.env,
});

// Create MCP client
const client = new AxMCPClient(transport, { debug: true });
await client.init();

// Attach the live client natively to AxGen, AxAgent, or AxFlow.
const program = ax('question:string -> answer:string', { mcp: client });
```

### With Factory Function

```typescript
import { axCreateMCPStdioTransport } from "@ax-llm/ax-tools";

const transport = axCreateMCPStdioTransport({
  command: "uvx",
  args: ["blender-mcp"],
});
```

### JavaScript Code Execution

Use `AxJSRuntime` from `@ax-llm/ax`:

```typescript
import { ai, AxJSRuntime, AxJSRuntimePermission } from "@ax-llm/ax";
```

### Configuration Options

#### MCP Transport

```typescript
interface StdioTransportConfig {
  command: string; // The command to execute
  args?: string[]; // Optional arguments
  env?: NodeJS.ProcessEnv; // Optional environment variables
}
```

#### JS Interpreter Permissions

See `@ax-llm/ax` docs for `AxJSRuntimePermission`.

## Examples

### Memory Server

```typescript
import { ai, AxAgent, AxMCPClient } from "@ax-llm/ax";
import { AxMCPStdioTransport } from "@ax-llm/ax-tools";

// Initialize MCP client with memory server
const transport = new AxMCPStdioTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
});

const client = new AxMCPClient(transport, { debug: false });
await client.init();

// Create agent with memory capabilities
const agent = new AxAgent({
  name: "MemoryAgent",
  description: "An agent that can remember information",
  signature: "userMessage -> response",
  functions: [client],
});

// Use with AI
const ai = ai({
  name: "openai",
  apiKey: process.env.OPENAI_APIKEY!,
});

const result = await agent.forward(ai, {
  userMessage: "Remember that my favorite color is blue",
});
```

### Cleanup

Always clean up the transport when done:

```typescript
// Terminate the child process
await transport.terminate();
```

## API Reference

### AxMCPStdioTransport

#### Constructor

```typescript
new AxMCPStdioTransport(config: StdioTransportConfig)
```

#### Methods

- `send(message: AxMCPJSONRPCRequest): Promise<AxMCPJSONRPCResponse>` - Send a
  request
- `sendNotification(message: AxMCPJSONRPCNotification): Promise<void>` - Send a
  notification
- `connect(): Promise<void>` - Connect (no-op for stdio)
- `terminate(): Promise<void>` - Terminate the child process

### axCreateMCPStdioTransport

Factory function to create a new transport instance:

```typescript
axCreateMCPStdioTransport(config: StdioTransportConfig): AxMCPStdioTransport
```

## License

Apache-2.0
