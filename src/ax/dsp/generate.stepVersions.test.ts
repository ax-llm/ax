// cspell:ignore Pariss
import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxAIServiceNetworkError } from '../util/apicall.js';
import { fn } from './sig.js';
import { ax } from './template.js';
import type { AxGenDeltaOut } from './types.js';
import { mergeDeltas } from './util.js';

type Chunk = AxChatResponse['results'][number];
type Script = Chunk[] | Error | { failAfter: Chunk[]; error: Error };

// Each script is one chat call: its chunks stream in order (or fold into one
// response when not streaming); an Error fails the call; failAfter streams its
// chunks and then fails the stream.
const scriptedAI = (scripts: Script[]) => {
  let call = 0;
  return new AxMockAIService<string>({
    name: 'mock',
    features: { functions: true, streaming: true },
    chatResponse: async (_req, options) => {
      const script = scripts[call++];
      if (!script) throw new Error('scripted client exhausted');
      if (script instanceof Error) throw script;
      const chunks = Array.isArray(script)
        ? [...script]
        : [...script.failAfter];
      const error = Array.isArray(script) ? undefined : script.error;
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
          else if (error) controller.error(error);
          else controller.close();
        },
      });
    },
  });
};

const content = (text: string): Chunk => ({ index: 0, content: text });
const thought = (text: string): Chunk => ({ index: 0, thought: text });
const lookupCall = (id: string): Chunk => ({
  index: 0,
  functionCalls: [
    { id, type: 'function', function: { name: 'lookup', params: '{}' } },
  ],
  finishReason: 'function_call',
});
const lookup = fn('lookup')
  .description('Look something up')
  .handler(async () => 'green')
  .build();

async function stream(
  gen: ReturnType<typeof ax>,
  scripts: Script[],
  options: Record<string, unknown> = {}
) {
  const deltas: AxGenDeltaOut<Record<string, unknown>>[] = [];
  for await (const delta of gen.streamingForward(
    scriptedAI(scripts),
    { question: 'q' },
    options
  )) {
    deltas.push(structuredClone(delta));
  }
  // Consumers discard older versions and merge the rest.
  let buffer: AxGenDeltaOut<Record<string, unknown>>[] = [];
  let version = 0;
  for (const delta of deltas) {
    if (delta.version !== version) buffer = [];
    version = delta.version;
    buffer = mergeDeltas(buffer, structuredClone(delta));
  }
  return { deltas, merged: buffer[0]?.delta ?? {} };
}

const versions = (deltas: readonly { version: number }[]) =>
  deltas.map((delta) => delta.version);
const nonDecreasing = (values: number[]) =>
  values.every((value, index) => index === 0 || value >= values[index - 1]!);

const askOnce = () => {
  let asked = false;
  return () => {
    if (asked) return undefined;
    asked = true;
    return 'Please double-check and answer again.';
  };
};

describe('AxGen step versions', () => {
  for (const [first, second] of [
    ['Paris', 'London'],
    ['Pariss', 'Paris'],
  ] as const) {
    it(`a feedback step replaces the earlier answer (${first} -> ${second})`, async () => {
      const scripts = [
        [content(`Answer: ${first}`)],
        [content(`Answer: ${second}`)],
      ];
      const gen = ax('question:string -> answer:string');
      gen.addFieldProcessor('answer', askOnce());
      const out = await gen.forward(scriptedAI(scripts), { question: 'q' });
      expect(out).toEqual({ answer: second });

      const streamed = ax('question:string -> answer:string');
      streamed.addFieldProcessor('answer', askOnce());
      const { deltas, merged } = await stream(streamed, scripts);
      expect(deltas).toEqual([
        { version: 0, index: 0, delta: { answer: first } },
        { version: 1, index: 0, delta: { answer: second } },
      ]);
      expect(merged).toEqual({ answer: second });
    });
  }

  it('a step that streamed content before its tool call is replaced by the answer', async () => {
    const scripts = [
      [content('Answer: draft'), lookupCall('c1')],
      [content('Answer: final')],
    ];
    const gen = ax('question:string -> answer:string', { functions: [lookup] });
    const { deltas, merged } = await stream(gen, scripts);
    expect(deltas).toEqual([
      { version: 0, index: 0, delta: { answer: 'draft' } },
      { version: 1, index: 0, delta: { answer: 'final' } },
    ]);
    expect(merged).toEqual({ answer: 'final' });
    const out = await gen.forward(scriptedAI(scripts), { question: 'q' });
    expect(out).toEqual(merged);
  });

  it('the new version carries the thought yielded so far', async () => {
    const scripts = [
      [thought('A '), content('Answer: first')],
      [thought('B'), content('Answer: second')],
    ];
    const gen = ax('question:string -> answer:string');
    gen.addFieldProcessor('answer', askOnce());
    const { deltas, merged } = await stream(gen, scripts, {
      showThoughts: true,
    });
    expect(deltas).toEqual([
      { version: 0, index: 0, delta: { thought: 'A ' } },
      { version: 0, index: 0, delta: { answer: 'first' } },
      { version: 1, index: 0, delta: { thought: 'A ' } },
      { version: 1, index: 0, delta: { thought: 'B' } },
      { version: 1, index: 0, delta: { answer: 'second' } },
    ]);
    expect(merged).toEqual({ thought: 'A B', answer: 'second' });

    const forwarded = ax('question:string -> answer:string');
    forwarded.addFieldProcessor('answer', askOnce());
    const out = await forwarded.forward(
      scriptedAI(scripts),
      { question: 'q' },
      { showThoughts: true, stream: true }
    );
    expect(out).toEqual(merged);
  });

  it('versions never decrease after a validation retry in an earlier step', async () => {
    const scripts = [
      [content('Answer: x')],
      [thought('T1 '), lookupCall('c1')],
      [thought('T2'), content('Answer: 42')],
    ];
    const gen = ax('question:string -> answer:number', { functions: [lookup] });
    const { deltas, merged } = await stream(gen, scripts, {
      showThoughts: true,
    });
    expect(nonDecreasing(versions(deltas))).toBe(true);
    expect(merged).toEqual({ thought: 'T1 T2', answer: 42 });
    const out = await gen.forward(
      scriptedAI(scripts),
      { question: 'q' },
      { showThoughts: true, stream: true }
    );
    expect(out).toEqual(merged);
  });

  it('an infrastructure retry after a validation retry keeps the version', async () => {
    const scripts: Script[] = [
      [content('Answer: first\nScore: bad')],
      {
        failAfter: [content('Answer: sec')],
        error: new AxAIServiceNetworkError(
          new Error('socket hang up'),
          'mock://chat',
          undefined,
          undefined
        ),
      },
      [content('Answer: second\nScore: 4')],
    ];
    const gen = ax('question:string -> answer:string, score:number');
    const { deltas, merged } = await stream(gen, scripts);
    expect(deltas).toEqual([
      { version: 0, index: 0, delta: { answer: 'first' } },
      { version: 1, index: 0, delta: { answer: 'sec' } },
      { version: 1, index: 0, delta: { answer: 'ond' } },
      { version: 1, index: 0, delta: { score: 4 } },
    ]);
    expect(merged).toEqual({ answer: 'second', score: 4 });
  }, 10_000);

  it('keeps runs without an output reset unchanged', async () => {
    const plain = await stream(ax('question:string -> answer:string'), [
      [content('Answer: hel'), content('lo')],
    ]);
    expect(plain.deltas).toEqual([
      { version: 0, index: 0, delta: { answer: 'hel' } },
      { version: 0, index: 0, delta: { answer: 'lo' } },
    ]);

    const toolLoop = await stream(
      ax('question:string -> answer:string', { functions: [lookup] }),
      [
        [thought('Look '), thought('up. '), lookupCall('c1')],
        [thought('Answer.'), content('Answer: green')],
      ],
      { showThoughts: true }
    );
    expect(toolLoop.deltas).toEqual([
      { version: 0, index: 0, delta: { thought: 'Look ' } },
      { version: 0, index: 0, delta: { thought: 'up. ' } },
      { version: 0, index: 0, delta: { thought: 'Answer.' } },
      { version: 0, index: 0, delta: { answer: 'green' } },
    ]);
    expect(toolLoop.merged).toEqual({
      thought: 'Look up. Answer.',
      answer: 'green',
    });
  });
});
