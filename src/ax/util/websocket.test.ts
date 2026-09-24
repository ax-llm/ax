import { describe, expect, it } from 'vitest';

import { parseWebSocketMessage } from './websocket.js';

describe('parseWebSocketMessage', () => {
  const json = '{"setupComplete":{}}';
  const bytes = new TextEncoder().encode(json);
  const pooled = new Uint8Array(bytes.length + 8);
  pooled.set(bytes, 4);

  it.each([
    ['a text frame', { data: json }],
    ['a binary frame read as an ArrayBuffer', { data: bytes.buffer }],
    [
      'a view into a larger buffer',
      { data: pooled.subarray(4, 4 + bytes.length) },
    ],
    ['raw data passed by an EventEmitter socket', Buffer.from(json)],
  ])('reads %s', (_, event) => {
    expect(parseWebSocketMessage(event)).toEqual({ setupComplete: {} });
  });

  it('names data it cannot read synchronously', () => {
    expect(() => parseWebSocketMessage({ data: new Blob([bytes]) })).toThrow(
      'Cannot read a WebSocket message delivered as Blob'
    );
  });
});
