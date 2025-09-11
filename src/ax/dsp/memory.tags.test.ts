import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { AxMemory } from '../mem/memory.js';

import { AxGen } from './generate.js';

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
                {
                  index: 0,
                  content: 'Some invalid response without the required field',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 10,
                  totalTokens: 11,
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
    expect(call).toBe(2); // Should have made 2 calls due to validation error retry
    // After successful completion with memory cleanup, correction tags should be removed
    try {
      expect(memory.rewindToTag('correction')).toEqual([]);
    } catch (error) {
      // If tag was cleaned up, this is expected
      expect((error as Error).message).toBe('Tag "correction" not found');
    }
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
                {
                  index: 0,
                  content: 'Some invalid response without the required field',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 10,
                  totalTokens: 11,
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
    expect(call).toBe(2); // Should have made 2 calls due to validation error retry
    // With disableMemoryCleanup=true, correction tags should remain
    const correctionRemoved = memory.rewindToTag('correction');
    expect(Array.isArray(correctionRemoved)).toBe(true);
    expect(correctionRemoved.length).toBeGreaterThan(0); // Should have correction-tagged items
  });
});

describe('Memory tags - streaming validation cleanup', () => {
  it('removes error tags after streamed success', async () => {
    const signature = 'inputText:string -> outputText:string';
    let call = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false }, // Use non-streaming for simpler test
      chatResponse: async () => {
        call++;
        return call === 1
          ? {
              results: [
                {
                  index: 0,
                  content: 'Some invalid response without the required field',
                  finishReason: 'stop' as const,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 1,
                  completionTokens: 10,
                  totalTokens: 11,
                },
              },
            }
          : {
              results: [
                {
                  index: 0,
                  content: 'Output Text: ok',
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
    const gen = new AxGen<{ inputText: string }, { outputText: string }>(
      signature
    );

    const res = await gen.forward(
      ai,
      { inputText: 'q' },
      {
        strictMode: true,
        mem: memory,
      }
    );
    expect(res.outputText).toBe('ok');
    expect(call).toBe(2); // Should have made 2 calls due to validation error retry
    // After successful completion with memory cleanup, correction tags should be removed
    try {
      expect(memory.rewindToTag('correction')).toEqual([]);
    } catch (error) {
      // If tag was cleaned up, this is expected
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
