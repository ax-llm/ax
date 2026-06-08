/*
 * Deterministic MCP stdio framing smoke:
 * - MCP stdio uses one JSON-RPC message per newline.
 * - This example encodes and decodes request, notification, and response frames
 *   without spawning a child process.
 *
 * Run: npm run example -- ts src/examples/mcp-stdio-framing.ts
 */

import type { AxMCPJSONRPCMessage } from '@ax-llm/ax';

const encodeFrame = (message: AxMCPJSONRPCMessage): string =>
  `${JSON.stringify(message)}\n`;

const decodeFrames = (chunk: string): AxMCPJSONRPCMessage[] =>
  chunk
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AxMCPJSONRPCMessage);

const request = {
  jsonrpc: '2.0',
  id: '1',
  method: 'tools/list',
} satisfies AxMCPJSONRPCMessage;

const notification = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
} satisfies AxMCPJSONRPCMessage;

const response = {
  jsonrpc: '2.0',
  id: '1',
  result: { tools: [] },
} satisfies AxMCPJSONRPCMessage;

const wire = [request, notification, response].map(encodeFrame).join('');
const decoded = decodeFrames(wire);

if (decoded.length !== 3) {
  throw new Error(`Expected 3 stdio frames, got ${decoded.length}`);
}

console.log(
  'mcp-stdio-framing',
  decoded
    .map((message) =>
      'method' in message ? message.method : `response:${String(message.id)}`
    )
    .join(' -> ')
);
