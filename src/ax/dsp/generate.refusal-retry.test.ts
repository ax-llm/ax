import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';
import { AxAIRefusalError } from '../util/apicall.js';
import { fn } from './sig.js';
import { ax } from './template.js';

type Chunk = AxChatResponse['results'][number];
type Script = Chunk[] | Error | { failAfter: Chunk[]; error: Error };

// Each script is one chat call: its chunks stream in order (or fold into one
// response when not streaming); an Error fails the call; failAfter streams its
// chunks and then fails the stream. Every call's prompt is recorded.
const scriptedAI = (scripts: Script[]) => {
  const prompts: AxChatRequest['chatPrompt'][] = [];
  const ai = new AxMockAIService<string>({
    name: 'mock',
    features: { functions: true, streaming: true },
    chatResponse: async (req, options) => {
      prompts.push(structuredClone(req.chatPrompt));
      const script = scripts[prompts.length - 1];
      if (!script) throw new Error('scripted client exhausted');
      if (script instanceof Error) throw script;
      const chunks = Array.isArray(script)
        ? [...script]
        : [...script.failAfter];
      const error = Array.isArray(script) ? undefined : script.error;
      if (!options?.stream) {
        const content = chunks.map((c) => c.content ?? '').join('');
        const functionCalls = chunks.flatMap((c) => c.functionCalls ?? []);
        return {
          results: [
            {
              index: 0,
              ...(content ? { content } : {}),
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
  return { ai, prompts };
};

const content = (text: string): Chunk => ({ index: 0, content: text });
const thought = (text: string): Chunk => ({ index: 0, thought: text });
const refuseAfter = (...chunks: Chunk[]) => ({
  failAfter: chunks,
  error: new AxAIRefusalError('refused'),
});
const lookup = fn('lookup')
  .description('Look something up')
  .handler(async () => 'green')
  .build();

const roles = (prompt: AxChatRequest['chatPrompt']) =>
  prompt.map((message) => message.role);

describe('AxGen refusal retry', () => {
  it('drops a streamed refused turn before retrying', async () => {
    const { ai, prompts } = scriptedAI([
      refuseAfter(content('Answer: I can')),
      [content('Answer: ok')],
    ]);
    const gen = ax('question:string -> answer:string');
    const out = await gen.forward(ai, { question: 'q' }, { stream: true });

    expect(out).toEqual({ answer: 'ok' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.at(-1)?.role).toBe('user');
    expect(roles(prompts[1]!)).not.toContain('assistant');
    expect(prompts[1]).toEqual(prompts[0]);
  });

  it('drops a refused turn that streamed only thinking', async () => {
    const { ai, prompts } = scriptedAI([
      refuseAfter(thought('considering')),
      [content('Answer: ok')],
    ]);
    const gen = ax('question:string -> answer:string');
    const out = await gen.forward(ai, { question: 'q' }, { stream: true });

    expect(out).toEqual({ answer: 'ok' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.at(-1)?.role).toBe('user');
    expect(prompts[1]).toEqual(prompts[0]);
  });

  it('keeps the prompt when a non-streaming refusal wrote nothing', async () => {
    const { ai, prompts } = scriptedAI([
      new AxAIRefusalError('refused'),
      [content('Answer: ok')],
    ]);
    const gen = ax('question:string -> answer:string');
    const out = await gen.forward(ai, { question: 'q' });

    expect(out).toEqual({ answer: 'ok' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.at(-1)?.role).toBe('user');
    expect(prompts[1]).toEqual(prompts[0]);
  });

  it('drops only the refused turn in a later step', async () => {
    const { ai, prompts } = scriptedAI([
      [
        {
          index: 0,
          functionCalls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'lookup', params: '{}' },
            },
          ],
          finishReason: 'function_call',
        },
      ],
      refuseAfter(content('Answer: I can')),
      [content('Answer: green')],
    ]);
    const gen = ax('question:string -> answer:string', { functions: [lookup] });
    const out = await gen.forward(ai, { question: 'q' }, { stream: true });

    expect(out).toEqual({ answer: 'green' });
    expect(prompts).toHaveLength(3);
    expect(roles(prompts[2]!).slice(-2)).toEqual(['assistant', 'function']);
    expect(prompts[2]).toEqual(prompts[1]);
  });

  it('never sends a refused turn back when every attempt refuses', async () => {
    const { ai, prompts } = scriptedAI([
      refuseAfter(content('Answer: I can')),
      refuseAfter(content('Answer: I can')),
    ]);
    const gen = ax('question:string -> answer:string');

    await expect(
      gen.forward(ai, { question: 'q' }, { stream: true, maxRetries: 1 })
    ).rejects.toThrow(/Unable to fix validation error.*Model refused/s);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt.at(-1)?.role).toBe('user');
      expect(roles(prompt)).not.toContain('assistant');
    }
  });

  it('drops the refused turn from the session even with cleanup disabled', async () => {
    const { ai, prompts } = scriptedAI([
      refuseAfter(content('Answer: I can')),
      [content('Answer: ok')],
    ]);
    const mem = new AxMemory();
    const gen = ax('question:string -> answer:string');
    const out = await gen.forward(
      ai,
      { question: 'q' },
      { stream: true, mem, sessionId: 's1', disableMemoryCleanup: true }
    );

    expect(out).toEqual({ answer: 'ok' });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.at(-1)?.role).toBe('user');
    expect(prompts[1]).toEqual(prompts[0]);

    const assistantTurns = mem
      .history(0, 's1')
      .filter((message) => message.role === 'assistant');
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0]).toMatchObject({ content: 'Answer: ok' });
    expect(mem.history(0)).toEqual([]);
  });
});
