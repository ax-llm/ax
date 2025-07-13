# @ax-llm/ax-tools

Node.js-specific tools for the Ax LLM framework.

## Overview

This package provides Node.js-specific functionality that cannot be included in the main `@ax-llm/ax` package due to browser compatibility requirements. The main package is designed to work in both Node.js and browser environments, while this package provides Node.js-only features.

## Features

### MCP Tools

#### AxMCPStdioTransport

A transport for the Model Context Protocol (MCP) that communicates with MCP servers via stdin/stdout. This enables running local MCP servers as child processes.

### Function Tools

#### AxJSInterpreter

A sandboxed JavaScript code execution environment that allows LLMs to run JavaScript code safely. Features configurable permissions for filesystem, network, crypto, and process access.

## Installation

```bash
npm install @ax-llm/ax-tools
```

## Usage

### Basic MCP Stdio Transport

```typescript
import { AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Create a stdio transport for an MCP server
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
  env: process.env
});

// Create MCP client
const client = new AxMCPClient(transport, { debug: true });
await client.init();

// Use the client as a function provider
const functions = client.toFunction();
console.log(`Available functions: ${functions.map(f => f.name).join(', ')}`);
```

### With Factory Function

```typescript
import { axCreateMCPStdioTransport } from '@ax-llm/ax-tools';

const transport = axCreateMCPStdioTransport({
  command: 'uvx',
  args: ['blender-mcp']
});
```

### JavaScript Code Execution

```typescript
import { AxAI, ax, f } from '@ax-llm/ax';
import { AxJSInterpreter, AxJSInterpreterPermission } from '@ax-llm/ax-tools';

const ai = new AxAI({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

// Create interpreter with specific permissions
const interpreter = new AxJSInterpreter({
  permissions: [
    AxJSInterpreterPermission.CRYPTO,
    // AxJSInterpreterPermission.FS,     // Filesystem access
    // AxJSInterpreterPermission.NET,    // Network access
    // AxJSInterpreterPermission.OS,     // OS information
    // AxJSInterpreterPermission.PROCESS // Process control
  ]
});

// Create a generator that uses the interpreter
const mathSolver = ax`
  problem:${f.string('Mathematical problem to solve')} ->
  solution:${f.string('The calculated result')}
`;

const result = await mathSolver.forward(ai, {
  problem: 'Calculate the factorial of 10'
}, {
  functions: [interpreter.toFunction()]
});

console.log(result.solution);
```

### Configuration Options

#### MCP Transport
```typescript
interface StdioTransportConfig {
  command: string;           // The command to execute
  args?: string[];          // Optional arguments
  env?: NodeJS.ProcessEnv;  // Optional environment variables
}
```

#### JS Interpreter Permissions
```typescript
enum AxJSInterpreterPermission {
  FS = 'node:fs',          // Filesystem access
  NET = 'net',             // Network access (http/https)
  OS = 'os',               // Operating system info
  CRYPTO = 'crypto',       // Cryptographic functions
  PROCESS = 'process',     // Process control
}
```

## Examples

### Memory Server

```typescript
import { AxAgent, AxAI, AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

// Initialize MCP client with memory server
const transport = new AxMCPStdioTransport({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory']
});

const client = new AxMCPClient(transport, { debug: false });
await client.init();

// Create agent with memory capabilities
const agent = new AxAgent({
  name: 'MemoryAgent',
  description: 'An agent that can remember information',
  signature: 'userMessage -> response',
  functions: [client]
});

// Use with AI
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!
});

const result = await agent.forward(ai, {
  userMessage: 'Remember that my favorite color is blue'
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

- `send(message: JSONRPCRequest): Promise<JSONRPCResponse>` - Send a request
- `sendNotification(message: JSONRPCNotification): Promise<void>` - Send a notification
- `connect(): Promise<void>` - Connect (no-op for stdio)
- `terminate(): Promise<void>` - Terminate the child process

### axCreateMCPStdioTransport

Factory function to create a new transport instance:

```typescript
axCreateMCPStdioTransport(config: StdioTransportConfig): AxMCPStdioTransport
```

## License

Apache-2.0
