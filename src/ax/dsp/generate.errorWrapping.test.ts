import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { AxGenerateError } from './generate.js';
import { ax } from './template.js';

const client = (contents: string[]) => {
  let call = 0;
  return new AxMockAIService<string>({
    name: 'mock',
    features: { functions: false, streaming: false },
    chatResponse: async () => ({
      results: [
        {
          index: 0,
          content: contents[Math.min(call++, contents.length - 1)]!,
          finishReason: 'stop',
        },
      ],
    }),
  });
};

const failure = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as Error & { cause?: unknown; details?: unknown };
  }
  throw new Error('expected the forward to fail');
};

describe('AxGen error wrapping', () => {
  // The words in a message used to decide the wrapping: an error that said
  // "required" or "missing" was returned bare.
  it.each(['upstream service unavailable', 'upstream token required'])(
    'wraps a field processor error (%s) by its type, not its words',
    async (message) => {
      const original = new Error(message);
      const gen = ax('question:string -> answer:string');
      gen.addFieldProcessor('answer', () => {
        throw original;
      });

      const error = await failure(() =>
        gen.forward(client(['Answer: hi']), { question: 'q' })
      );

      expect(error).toBeInstanceOf(AxGenerateError);
      expect(error.message).toBe(`Generate failed: ${message}`);
      expect(error.cause).toBe(original);
      expect(error.details).toBeDefined();
    }
  );

  it.each([
    [
      'a required field that stays missing',
      'question:string -> answer:string, reason:string',
      'Answer: hi',
      "Generate failed: Unable to fix validation error: Required field not found: 'Reason'",
    ],
    [
      'a value that stays the wrong type',
      'question:string -> count:number',
      'Count: many',
      "Generate failed: Unable to fix validation error: Field 'Count' has an invalid value 'many'",
    ],
  ])(
    'wraps exhausted validation retries for %s the same way',
    async (_label, signature, content, prefix) => {
      const gen = ax(signature);

      const error = await failure(() =>
        gen.forward(client([content]), { question: 'q' }, { maxRetries: 1 })
      );

      expect(error).toBeInstanceOf(AxGenerateError);
      expect(error.message.startsWith(prefix)).toBe(true);
    }
  );

  // Without streaming, the LLM Output section used to be empty.
  it('ends exhausted retries with the last answer, without streaming too', async () => {
    const gen = ax('question:string -> answer:string, score:number');

    const error = await failure(() =>
      gen.forward(
        client(['Answer: x\nScore: nope']),
        { question: 'q' },
        { maxRetries: 0 }
      )
    );

    expect(
      error.message.endsWith('\n\nLLM Output:\nAnswer: x\nScore: nope')
    ).toBe(true);
    expect((error.cause as Error).message).toContain(
      'LLM Output:\nAnswer: x\nScore: nope'
    );
  });

  it('reports every sample of the last attempt, joined with ---', async () => {
    const gen = ax('question:string -> answer:string, score:number');
    const samples = new AxMockAIService<string>({
      name: 'mock',
      features: { functions: false, streaming: false },
      chatResponse: async () => ({
        results: [
          { index: 0, content: 'Answer: a\nScore: nope', finishReason: 'stop' },
          { index: 1, content: 'Answer: b\nScore: 2', finishReason: 'stop' },
        ],
      }),
    });

    const error = await failure(() =>
      gen.forward(samples, { question: 'q' }, { maxRetries: 0, sampleCount: 2 })
    );

    expect(error.message).toContain(
      'LLM Output:\nAnswer: a\nScore: nope\n---\nAnswer: b\nScore: 2'
    );
  });
});
