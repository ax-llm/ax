import { describe, expect, it } from 'vitest';

import { SSEParser } from './sse.js';

interface ParseOptions<T> {
  dataParser?: (data: string) => T;
  emitIncompleteEventOnEof?: boolean;
}

const parse = async <T = unknown>(
  chunks: string[],
  options: ParseOptions<T> = {}
) => {
  const source = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const dropped: string[] = [];
  const reader = source
    .pipeThrough(
      new SSEParser<T>({
        ...options,
        onError: (_error, rawData) => {
          dropped.push(rawData);
        },
      })
    )
    .getReader();

  const events: T[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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

  it('emits a provider-compatible final event without a line terminator', async () => {
    await expect(parse(['data: {"index":0}'])).resolves.toEqual({
      events: [{ index: 0 }],
      dropped: [],
    });
  });

  // Guards the flush path: at end of stream there is no following \n, so a
  // bare trailing \r is a real line terminator and must still be parsed.
  it('emits a trailing event terminated only by a bare \\r', async () => {
    await expect(parse(['data: {"index":0}\r'])).resolves.toEqual({
      events: [{ index: 0 }],
      dropped: [],
    });
  });

  it('can discard an incomplete final event in strict SSE mode', async () => {
    await expect(
      parse(['data: {"index":0}\n'], { emitIncompleteEventOnEof: false })
    ).resolves.toEqual({ events: [], dropped: [] });
  });

  it('preserves SSE field whitespace and empty data lines', async () => {
    const dataParser = (data: string) => data;

    await expect(
      parse(['data:\ndata:  value  \n\n'], { dataParser })
    ).resolves.toEqual({ events: ['\n value  '], dropped: [] });
  });

  it('compares field names literally and ignores unknown fields without colons', async () => {
    await expect(
      parse([' data: {"ignored":true}\nunknown\n\ndata: {"index":0}\n\n'])
    ).resolves.toEqual({ events: [{ index: 0 }], dropped: [] });
  });

  it('processes a data field without a colon as an empty value', async () => {
    await expect(
      parse(['data\n\n'], { dataParser: (data) => data })
    ).resolves.toEqual({ events: [''], dropped: [] });
  });

  it('strips one leading BOM before parsing fields', async () => {
    await expect(parse(['\uFEFFdata: {"index":0}\n\n'])).resolves.toEqual({
      events: [{ index: 0 }],
      dropped: [],
    });
  });

  it('terminates and cancels the upstream stream at [DONE]', async () => {
    let resolveCancelled: (() => void) | undefined;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(
          'data: {"index":0}\n\ndata: [DONE]\n\ndata: {"index":1}\n\n'
        );
      },
      cancel() {
        resolveCancelled?.();
      },
    });
    const reader = source.pipeThrough(new SSEParser()).getReader();

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { index: 0 },
    });
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(cancelled).resolves.toBeUndefined();
  });
});
