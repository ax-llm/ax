import { describe, expect, it } from 'vitest';

import { SSEParser } from './sse.js';

const parse = async (chunks: string[]) => {
  const source = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const dropped: string[] = [];
  const reader = source
    .pipeThrough(
      new SSEParser<unknown>({
        onError: (_error, rawData) => {
          dropped.push(rawData);
        },
      })
    )
    .getReader();

  const events: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }

  return { events, dropped };
};

describe('SSEParser', () => {
  it('joins multi-line data fields in a CRLF stream', async () => {
    await expect(
      parse(['data: {"index":\r\ndata: 0}\r\n\r\n'])
    ).resolves.toEqual({ events: [{ index: 0 }], dropped: [] });
  });

  // A \r\n line terminator can land on either side of a chunk boundary: the
  // transport, not the provider, decides where the stream is split. Both
  // framings carry the same bytes and must produce the same events.
  it('joins multi-line data fields when \\r\\n is split across chunks', async () => {
    await expect(
      parse(['data: {"index":\r', '\ndata: 0}\r\n\r\n'])
    ).resolves.toEqual({ events: [{ index: 0 }], dropped: [] });
  });

  // Guards the flush path: at end of stream there is no following \n, so a
  // bare trailing \r is a real line terminator and must still be parsed.
  it('emits a trailing event terminated only by a bare \\r', async () => {
    await expect(parse(['data: {"index":0}\r'])).resolves.toEqual({
      events: [{ index: 0 }],
      dropped: [],
    });
  });
});
