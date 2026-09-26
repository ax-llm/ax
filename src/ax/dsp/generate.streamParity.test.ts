// cspell:ignore thon
import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { fn } from './sig.js';
import { ax } from './template.js';
import type { AxGenDeltaOut } from './types.js';
import { mergeDeltas } from './util.js';

type Chunk = AxChatResponse['results'][number];

// Each script is one chat call: its chunks stream in order, or fold into one
// response when the call is not streamed.
const scriptedAI = (scripts: Chunk[][]) => {
  let call = 0;
  return new AxMockAIService<string>({
    name: 'mock',
    features: { functions: true, streaming: true },
    chatResponse: async (_req, options) => {
      const script = scripts[call++];
      if (!script) throw new Error('scripted client exhausted');
      const chunks = [...script];
      if (!options?.stream) {
        const content = chunks.map((c) => c.content ?? '').join('');
        const thought = chunks.map((c) => c.thought ?? '').join('');
        const functionCalls = chunks.flatMap((c) => c.functionCalls ?? []);
        return {
          results: [
            {
              index: 0,
              ...(content ? { content } : {}),
              ...(thought ? { thought } : {}),
              ...(functionCalls.length ? { functionCalls } : {}),
              finishReason: functionCalls.length ? 'function_call' : 'stop',
            },
          ],
        };
      }
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const next = chunks.shift();
          if (next) controller.enqueue({ results: [next] });
          else controller.close();
        },
      });
    },
  });
};

const content = (text: string): Chunk => ({ index: 0, content: text });
const thought = (text: string): Chunk => ({ index: 0, thought: text });
const call = (id: string, name: string): Chunk => ({
  index: 0,
  functionCalls: [{ id, type: 'function', function: { name, params: '{}' } }],
  finishReason: 'function_call',
});

const tool = (name: string, result: string) =>
  fn(name)
    .description(`Call ${name}`)
    .handler(async () => result)
    .build();

const collect = async <T>(stream: AsyncIterable<AxGenDeltaOut<T>>) => {
  const deltas: AxGenDeltaOut<T>[] = [];
  for await (const delta of stream) deltas.push(delta);
  return deltas;
};

describe('AxGen stream and non-stream parity', () => {
  it('runs asserts and field processors only on the answering step', async () => {
    for (const stream of [false, true]) {
      const gen = ax('question:string -> answer:string', {
        functions: [tool('lookup', 'data')],
      });
      const asserted: unknown[] = [];
      gen.addAssert((out) => {
        asserted.push({ ...out });
        return true;
      });
      const processed: unknown[] = [];
      gen.addFieldProcessor('answer', (value) => {
        processed.push(value);
        return undefined;
      });
      const ai = scriptedAI([
        [content('Answer: partial draft'), call('c1', 'lookup')],
        [content('Answer: final')],
      ]);

      const out = await gen.forward(ai, { question: 'q' }, { stream });

      expect(out).toEqual({ answer: 'final' });
      expect(asserted).toEqual([{ answer: 'final' }]);
      expect(processed).toEqual(['final']);
    }
  });

  it('holds back an opening code fence split across chunks', async () => {
    const split = [content('Answer: ```py'), content('thon\nprint(1)\n```')];
    const whole = [content('Answer: ```python\nprint(1)\n```')];
    for (const chunks of [split, whole]) {
      const gen = ax('question:string -> answer:code');
      const streamed = await gen.forward(
        scriptedAI([chunks]),
        { question: 'q' },
        { stream: true }
      );
      const folded = await gen.forward(scriptedAI([chunks]), {
        question: 'q',
      });
      const deltas = await collect(
        gen.streamingForward(scriptedAI([chunks]), { question: 'q' })
      );

      expect(streamed).toEqual({ answer: 'print(1)' });
      expect(folded).toEqual({ answer: 'print(1)' });
      expect(deltas.map((d) => d.delta)).toEqual([{ answer: 'print(1)' }]);
    }
  });

  it.each([
    [
      'a split closing fence',
      'question:string -> answer:code',
      [content('Answer: ```python\nprint(1)\n``'), content('`')],
      { answer: 'print(1)' },
    ],
    [
      'a whole closing fence',
      'question:string -> answer:code',
      [content('Answer: ```python\nprint(1)\n```')],
      { answer: 'print(1)' },
    ],
    [
      'code that ends in a backtick',
      'question:string -> answer:code',
      [content('Answer: echo `date'), content('`')],
      { answer: 'echo `date`' },
    ],
    [
      'a fenced code field before another field',
      'question:string -> answer:code, reason:string',
      [content('Answer: ```python\nprint(1)\n```\n'), content('Reason: short')],
      { answer: 'print(1)', reason: 'short' },
    ],
  ])(
    'streams %s to the non-streaming value',
    async (_label, signature, chunks, expected) => {
      const gen = ax(signature);
      const folded = await gen.forward(scriptedAI([chunks]), { question: 'q' });
      const streamed = await gen.forward(
        scriptedAI([chunks]),
        { question: 'q' },
        { stream: true }
      );

      expect(folded).toEqual(expected);
      expect(streamed).toEqual(expected);
    }
  );

  it('keeps the thought of a step that calls a stop function', async () => {
    for (const stream of [false, true]) {
      const gen = ax('question:string -> answer:string', {
        functions: [tool('lookup', 'data'), tool('finish', 'done')],
      });
      const ai = scriptedAI([
        [thought('First. '), call('l', 'lookup')],
        [thought('Done.'), call('f', 'finish')],
      ]);

      const out = await gen.forward(
        ai,
        { question: 'q' },
        { stream, showThoughts: true, stopFunction: 'finish' }
      );

      expect(out).toEqual({ thought: 'First. Done.' });
    }
  });

  it('stores a streamed result in the cache with or without a result picker', async () => {
    for (const withPicker of [false, true]) {
      const stored: unknown[] = [];
      const cachingFunction = async (_key: string, value?: unknown) => {
        if (value !== undefined) stored.push(value);
        return undefined;
      };
      const gen = ax('question:string -> answer:string');
      const deltas = await collect(
        gen.streamingForward(
          scriptedAI([[content('Answer: hel'), content('lo')]]),
          { question: 'q' },
          {
            cachingFunction,
            ...(withPicker ? { resultPicker: async () => 0 } : {}),
          }
        )
      );

      let merged: AxGenDeltaOut<{ answer: string }>[] = [];
      for (const delta of deltas) merged = mergeDeltas(merged, delta);
      expect(merged[0]?.delta).toEqual({ answer: 'hello' });
      expect(stored).toEqual([{ answer: 'hello' }]);
    }
  });
});
