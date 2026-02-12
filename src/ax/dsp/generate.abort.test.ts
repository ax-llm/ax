import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';

import { AxGen, AxGenerateError } from './generate.js';

describe('AxGen.stop()', () => {
  it('throws when stop() is called during multi-step loop', async () => {
    let callCount = 0;
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        return {
          results: [
            {
              index: 0,
              content: '',
              functionCalls: [
                {
                  id: `call_${callCount}`,
                  type: 'function' as const,
                  function: {
                    name: 'myFunc',
                    params: { userInput: `step ${callCount}` },
                  },
                },
              ],
              finishReason: 'function_call',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const gen = new AxGen('userQuery:string -> answer:string', {
      functions: [
        {
          name: 'myFunc',
          description: 'A test function that does nothing special',
          parameters: {
            type: 'object',
            properties: { userInput: { type: 'string' } },
          },
          func: async () => {
            if (callCount === 1) {
              gen.stop();
            }
            return 'func result';
          },
        },
      ],
      maxSteps: 10,
    });

    await expect(gen.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });

  it('throws when stop() is called before forward()', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });

    const gen = new AxGen('userQuery:string -> answer:string');

    // Call stop before forward
    gen.stop();

    await expect(gen.forward(ai, { userQuery: 'test' })).rejects.toThrow();
  });
});

describe('AxGen between-step abort check', () => {
  it('throws when abort signal is triggered between steps', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        if (callCount === 1) {
          controller.abort('test abort');
        }
        return {
          results: [
            {
              index: 0,
              content: '',
              functionCalls: [
                {
                  id: `call_${callCount}`,
                  type: 'function' as const,
                  function: {
                    name: 'myFunc',
                    params: { userInput: 'data' },
                  },
                },
              ],
              finishReason: 'function_call',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const gen = new AxGen('userQuery:string -> answer:string', {
      functions: [
        {
          name: 'myFunc',
          description: 'A test function that does nothing special',
          parameters: {
            type: 'object',
            properties: { userInput: { type: 'string' } },
          },
          func: async () => 'result',
        },
      ],
      maxSteps: 10,
    });

    await expect(
      gen.forward(
        ai,
        { userQuery: 'test' },
        {
          abortSignal: controller.signal,
        }
      )
    ).rejects.toThrow();
    expect(callCount).toBe(1);
  });

  it('throws immediately with pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('test abort');

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
    });

    const gen = new AxGen('userQuery:string -> answer:string', {
      maxSteps: 10,
    });

    await expect(
      gen.forward(
        ai,
        { userQuery: 'test' },
        {
          abortSignal: controller.signal,
        }
      )
    ).rejects.toThrow();
  });
});

describe('AxGen abort error during LLM call', () => {
  it('throws when abort is triggered during LLM call', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                index: 0,
                content: '',
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'myFunc',
                      params: { userInput: 'data' },
                    },
                  },
                ],
                finishReason: 'function_call',
              },
            ],
            modelUsage: {
              ai: 'mock',
              model: 'mock',
              tokens: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            },
          };
        }
        return {
          results: [
            {
              index: 0,
              content: 'answer: should not appear',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'mock',
            model: 'mock',
            tokens: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
          },
        };
      },
    });

    const gen = new AxGen('userQuery:string -> answer:string', {
      functions: [
        {
          name: 'myFunc',
          description: 'A test function that does nothing special',
          parameters: {
            type: 'object',
            properties: { userInput: { type: 'string' } },
          },
          func: async () => {
            controller.abort('user stopped');
            return 'func result';
          },
        },
      ],
      maxSteps: 10,
    });

    await expect(
      gen.forward(
        ai,
        { userQuery: 'test' },
        {
          abortSignal: controller.signal,
        }
      )
    ).rejects.toThrow();
  });
});

describe('AxGen abort error is not wrapped', () => {
  it('throws AxAIServiceAbortedError directly, not wrapped in AxGenerateError', async () => {
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async (): Promise<AxChatResponse> => {
        throw new AxAIServiceAbortedError('test', 'Aborted by test');
      },
    });

    const gen = new AxGen('userQuery:string -> answer:string', {
      maxSteps: 2,
      maxRetries: 1,
    });

    try {
      await gen.forward(ai, { userQuery: 'test' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AxAIServiceAbortedError);
      expect(e).not.toBeInstanceOf(AxGenerateError);
    }
  });
});
