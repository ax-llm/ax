import { ReadableStream } from 'node:stream/web';

import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse, AxFunction } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';

import { AxGen } from './generate.js';

function makeStream(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let i = 0;
      const push = () => {
        if (i >= chunks.length) {
          controller.close();
          return;
        }
        const chunk = chunks[i++];
        controller.enqueue({
          results: [chunk],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        });
        setTimeout(push, 1);
      };
      setTimeout(push, 1);
    },
  });
}

describe('Memory tags - non-streaming validation correction cleanup', () => {
  it('removes all error-tagged items after successful correction', async () => {
    const signature = 'promptText:string -> finalAnswer:string';
    let call = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        call++;
        return call === 1
          ? {
              results: [
                { index: 0, content: '', finishReason: 'stop' as const },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 0,
                  totalTokens: 1,
                },
              },
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'Final Answer: fixed',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              },
            };
      },
    });

    const memory = new AxMemory();
    const gen = new AxGen<{ promptText: string }, { finalAnswer: string }>(
      signature
    );

    const res = await gen.forward(
      ai,
      { promptText: 'q' },
      {
        strictMode: true,
        mem: memory,
      }
    );
    expect(res.finalAnswer).toBe('fixed');
    expect(memory.rewindToTag('invalid-assistant')).toEqual([]);
    expect(memory.rewindToTag('correction')).toEqual([]);
  });

  it('keeps tags when disableErrorTagStripping=true', async () => {
    const signature = 'promptText:string -> finalAnswer:string';
    let call = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        call++;
        return call === 1
          ? {
              results: [
                { index: 0, content: '', finishReason: 'stop' as const },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 0,
                  totalTokens: 1,
                },
              },
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'Final Answer: fixed',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              },
            };
      },
    });

    const memory = new AxMemory();
    const gen = new AxGen<{ promptText: string }, { finalAnswer: string }>(
      signature
    );

    const res = await gen.forward(
      ai,
      { promptText: 'q' },
      { strictMode: true, mem: memory, disableMemoryCleanup: true }
    );
    expect(res.finalAnswer).toBe('fixed');
    // Tags should still be present
    const invalidRemoved = memory.rewindToTag('invalid-assistant');
    expect(Array.isArray(invalidRemoved)).toBe(true);
    const correctionRemoved = memory.rewindToTag('correction');
    expect(Array.isArray(correctionRemoved)).toBe(true);
  });
});

describe('Memory tags - streaming validation cleanup', () => {
  it('removes error tags after streamed success', async () => {
    const signature = 'inputText:string -> outputText:string';
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Some text without prefix ' },
      { index: 0, content: 'more text' },
      { index: 0, content: 'Output Text: ok', finishReason: 'stop' },
    ];

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: makeStream(chunks),
    });

    const memory = new AxMemory();
    const gen = new AxGen<{ inputText: string }, { outputText: string }>(
      signature
    );

    const res = await gen.forward(
      ai,
      { inputText: 'q' },
      {
        stream: true,
        strictMode: false,
        mem: memory,
      }
    );
    expect(res.outputText).toBe('ok');
    expect(memory.rewindToTag('invalid-assistant')).toEqual([]);
    expect(memory.rewindToTag('correction')).toEqual([]);
  });
});

describe('Memory tags - function error tagging and cleanup', () => {
  it('tags function errors and cleans them after success', async () => {
    const signature = 'queryText:string -> responseText:string';
    const func: AxFunction = {
      name: 'toolX',
      description: 'tool',
      parameters: {
        type: 'object',
        properties: { p: { type: 'string', description: 'p' } },
        required: ['p'],
      },
      func: async () => 'ok',
    };

    let call = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        call++;
        return call === 1
          ? {
              results: [
                {
                  index: 0,
                  content: '',
                  finishReason: 'stop' as const,
                  functionCalls: [
                    {
                      id: 'c1',
                      type: 'function' as const,
                      function: { name: 'toolX', params: { wrong: 'x' } },
                    },
                  ],
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              },
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'Response Text: done',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 1,
                  totalTokens: 2,
                },
              },
            };
      },
    });

    const memory = new AxMemory();
    const gen = new AxGen<{ queryText: string }, { responseText: string }>(
      signature,
      { functions: [func] }
    );

    const res = await gen.forward(ai, { queryText: 'q' }, { mem: memory });
    expect(res.responseText).toBe('done');
    expect(memory.rewindToTag('invalid-assistant')).toEqual([]);
    expect(memory.rewindToTag('correction')).toEqual([]);
  });
});
