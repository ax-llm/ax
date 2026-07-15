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
});
