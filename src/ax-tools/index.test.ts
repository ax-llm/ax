import { describe, expect, it } from 'vitest';

import { AxMCPStdioTransport, axCreateMCPStdioTransport } from './mcp/index.js';

describe('AxMCPStdioTransport', () => {
  it('should create instance', () => {
    const transport = new AxMCPStdioTransport({
      command: 'sleep',
      args: ['1'],
    });
    expect(transport).toBeInstanceOf(AxMCPStdioTransport);

    // Clean up the process
    transport.terminate();
  });

  it('should create instance with factory function', () => {
    const transport = axCreateMCPStdioTransport({
      command: 'sleep',
      args: ['1'],
    });
    expect(transport).toBeInstanceOf(AxMCPStdioTransport);

    // Clean up the process
    transport.terminate();
  });
});
