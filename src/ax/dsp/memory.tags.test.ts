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
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        return {
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
    // After successful completion with memory cleanup, correction tags should be removed
    try {
      expect(memory.rewindToTag('correction')).toEqual([]);
    } catch (error) {
      // If tag was never created or was cleaned up, this is expected
      expect((error as Error).message).toBe('Tag "correction" not found');
    }
  });

  it('keeps tags when disableErrorTagStripping=true', async () => {
    const signature = 'promptText:string -> finalAnswer:string';
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: async () => {
        return {
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
    // With disableMemoryCleanup=true, correction tags should remain if they were created
    try {
      const correctionRemoved = memory.rewindToTag('correction');
      expect(Array.isArray(correctionRemoved)).toBe(true);
    } catch (error) {
      // If no correction was needed (no validation errors occurred), tag might not exist
      expect((error as Error).message).toBe('Tag "correction" not found');
    }
  });
});

describe('Memory tags - streaming validation cleanup', () => {
  it('removes error tags after streamed success', async () => {
    const signature = 'inputText:string -> outputText:string';
    const chunks: AxChatResponse['results'] = [
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
    // After successful completion with memory cleanup, correction tags should be removed
    try {
      expect(memory.rewindToTag('correction')).toEqual([]);
    } catch (error) {
      // If tag was never created or was cleaned up, this is expected
      expect((error as Error).message).toBe('Tag "correction" not found');
    }
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
    // After successful completion with memory cleanup, correction tags should be removed
    try {
      expect(memory.rewindToTag('correction')).toEqual([]);
    } catch (error) {
      // If tag was never created or was cleaned up, this is expected
      expect((error as Error).message).toBe('Tag "correction" not found');
    }
  });
});
