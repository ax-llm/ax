// cspell:ignore CAVS abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu héllo wörld
import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { ax } from '../dsp/template.js';
import { createHash, sha256 } from './crypto.js';

const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');

describe('createHash(sha256)', () => {
  // FIPS 180-4 / NIST CAVS SHA-256 test vectors.
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('hashes %j to the NIST digest', (input, expected) => {
    expect(digest(input)).toBe(expected);
  });

  it('hashes a million "a" to the NIST digest', () => {
    expect(digest('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    );
  });

  it('matches Web Crypto at every padding boundary and for UTF-8 input', async () => {
    const inputs = [
      ...[55, 56, 57, 63, 64, 65, 119, 120, 128].map((n) => 'x'.repeat(n)),
      'héllo wörld',
      '日本語のテキスト',
      '😀 emoji',
    ];
    for (const input of inputs) {
      expect(digest(input)).toBe(await sha256(input));
    }
  });

  it('hashes the concatenation of its updates', () => {
    expect(createHash('sha256').update('ab').update('c').digest('hex')).toBe(
      digest('abc')
    );
  });
});

describe('AxGen cache keys', () => {
  it('give inputs whose 32-bit hashes collided their own keys and answers', async () => {
    const cache = new Map<string, unknown>();
    const cachingFunction = async (key: string, value?: unknown) => {
      if (value !== undefined) {
        cache.set(key, value);
        return undefined;
      }
      return cache.get(key);
    };
    const gen = ax('question:string -> answer:string');
    const answerFor = (question: string) =>
      new AxMockAIService<string>({
        name: 'mock',
        features: { functions: false, streaming: false },
        chatResponse: async () => ({
          results: [
            {
              index: 0,
              content: `Answer: model answer for ${question}`,
              finishReason: 'stop',
            },
          ],
        }),
      });

    // "Aa" and "BB" have the same 32-bit Java-style hash code.
    const first = await gen.forward(
      answerFor('Aa'),
      { question: 'Aa' },
      { cachingFunction }
    );
    const second = await gen.forward(
      answerFor('BB'),
      { question: 'BB' },
      { cachingFunction }
    );

    expect(first).toEqual({ answer: 'model answer for Aa' });
    expect(second).toEqual({ answer: 'model answer for BB' });
    expect(cache.size).toBe(2);
  });
});
