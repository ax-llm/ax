import { describe, expect, it } from 'vitest';

import type { AxMCPTransport } from '../transport.js';
import {
  AxMCPRecordingTransport,
  AxMCPReplayTransport,
} from './recordingTransport.js';

describe('MCP recording and replay transports', () => {
  it('records raw requests/results and replays them with caller IDs', async () => {
    const inner: AxMCPTransport = {
      send: async (message) => ({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: [{ name: 'one' }] },
      }),
      sendNotification: async () => {},
    };
    const recording = new AxMCPRecordingTransport(inner);
    await recording.send({
      jsonrpc: '2.0',
      id: 'original',
      method: 'tools/list',
    });

    const replay = new AxMCPReplayTransport(recording.getRecording(), {
      strict: true,
    });
    const result = await replay.send({
      jsonrpc: '2.0',
      id: 'replayed',
      method: 'tools/list',
    });

    expect(result).toEqual({
      jsonrpc: '2.0',
      id: 'replayed',
      result: { tools: [{ name: 'one' }] },
    });
  });

  it('passes through era hints and derives replay era without probing', () => {
    const inner = {
      eraHint: 'legacy' as const,
      eraCacheKey: 'https://mcp.example',
      send: async (message: Parameters<AxMCPTransport['send']>[0]) => ({
        jsonrpc: '2.0' as const,
        id: message.id,
        result: {},
      }),
      sendNotification: async () => {},
    } satisfies AxMCPTransport;
    const recording = new AxMCPRecordingTransport(inner);
    expect(recording.eraHint).toBe('legacy');
    expect(recording.eraCacheKey).toBe('https://mcp.example');

    const modernReplay = new AxMCPReplayTransport([
      {
        direction: 'request',
        message: {
          jsonrpc: '2.0',
          id: 'discover-1',
          method: 'server/discover',
          params: {},
        },
        response: {
          jsonrpc: '2.0',
          id: 'discover-1',
          result: {},
        },
      },
    ]);
    const legacyReplay = new AxMCPReplayTransport([
      {
        direction: 'request',
        message: {
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          params: {},
        },
        response: { jsonrpc: '2.0', id: 'init-1', result: {} },
      },
    ]);
    expect(modernReplay.eraHint).toBe('modern');
    expect(legacyReplay.eraHint).toBe('legacy');
  });
});
