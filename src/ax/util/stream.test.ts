import { describe, expect, it } from 'vitest';

import { TextDecoderStreamPolyfill } from './stream.js';

async function decode(chunks: number[][]): Promise<string[]> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
  const reader = input.pipeThrough(new TextDecoderStreamPolyfill()).getReader();
  const output: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return output;
    output.push(value);
  }
}

describe('TextDecoderStreamPolyfill', () => {
  it('decodes a UTF-8 code point split across byte chunks', async () => {
    await expect(decode([[0xe2], [0x82], [0xac]])).resolves.toEqual(['€']);
  });

  it('flushes an incomplete final UTF-8 sequence as a replacement character', async () => {
    await expect(decode([[0xe2, 0x82]])).resolves.toEqual(['\uFFFD']);
  });
});
