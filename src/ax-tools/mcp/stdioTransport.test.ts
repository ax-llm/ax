import { describe, expect, it } from 'vitest';
import {
  AxMCPStdioTransport,
  axCreateMCPStdioTransport,
} from './stdioTransport.js';

describe('AxMCPStdioTransport', () => {
  it('should create transport instances', () => {
    const transport = new AxMCPStdioTransport({
      command: 'sleep',
      args: ['1'],
    });

    expect(transport).toBeInstanceOf(AxMCPStdioTransport);
    transport.terminate();
  });

  it('should create transport with factory function', () => {
    const transport = axCreateMCPStdioTransport({
      command: 'sleep',
      args: ['1'],
    });

    expect(transport).toBeInstanceOf(AxMCPStdioTransport);
    transport.terminate();
  });
});
