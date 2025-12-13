import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import {
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceTimeoutError,
} from '../util/apicall.js';
import { AxGen } from './generate.js';
import { f } from './sig.js';

describe('Infrastructure Error Retry', () => {
  it('should retry on 5xx errors and eventually succeed', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;

        // Fail first 2 attempts with 500 error, succeed on 3rd
        if (callCount <= 2) {
          throw new AxAIServiceStatusError(
            500,
            'Internal Server Error',
            'https://api.example.com/chat',
            { test: 'request' },
            { error: 'server_error' }
          );
        }

        return {
          results: [
            {
              index: 0,
              content: 'Answer: Success after retry',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          },
        } as AxChatResponse;
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(
      ai,
      { query: 'test' },
      {
        retryOnError: { maxRetries: 3 },
      }
    );

    expect(result.answer).toBe('Success after retry');
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  it('should retry on network errors and eventually succeed', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;

        if (callCount === 1) {
          throw new AxAIServiceNetworkError(
            new Error('Network connection failed'),
            'https://api.example.com/chat',
            { test: 'request' },
            undefined
          );
        }

        return {
          results: [
            {
              index: 0,
              content: 'Answer: Success after network retry',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          },
        } as AxChatResponse;
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(
      ai,
      { query: 'test' },
      {
        retryOnError: { maxRetries: 2 },
      }
    );

    expect(result.answer).toBe('Success after network retry');
    expect(callCount).toBe(2);
  });

  it('should retry on timeout errors and eventually succeed', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;

        if (callCount === 1) {
          throw new AxAIServiceTimeoutError(
            'https://api.example.com/chat',
            30000,
            { test: 'request' }
          );
        }

        return {
          results: [
            {
              index: 0,
              content: 'Answer: Success after timeout retry',
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          },
        } as AxChatResponse;
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(
      ai,
      { query: 'test' },
      {
        retryOnError: { maxRetries: 2 },
      }
    );

    expect(result.answer).toBe('Success after timeout retry');
    expect(callCount).toBe(2);
  });

  it('should throw error when max infrastructure retries exhausted', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;
        throw new AxAIServiceStatusError(
          503,
          'Service Unavailable',
          'https://api.example.com/chat',
          { test: 'request' },
          { error: 'service_unavailable' }
        );
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    await expect(
      gen.forward(
        ai,
        { query: 'test' },
        {
          retryOnError: { maxRetries: 2 },
        }
      )
    ).rejects.toThrow('Service Unavailable');

    expect(callCount).toBe(3); // Initial + 2 retries
  });

  it('should NOT retry on 4xx errors (client errors)', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;
        throw new AxAIServiceStatusError(
          401,
          'Unauthorized',
          'https://api.example.com/chat',
          { test: 'request' },
          { error: 'unauthorized' }
        );
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    await expect(
      gen.forward(
        ai,
        { query: 'test' },
        {
          retryOnError: { maxRetries: 3 },
        }
      )
    ).rejects.toThrow('Unauthorized');

    expect(callCount).toBe(1); // No retries for 4xx errors
  });

  it(
    'should use custom maxRetries configuration',
    async () => {
      let callCount = 0;

      const ai = new AxMockAIService({
        features: {
          functions: false,
          streaming: false,
          structuredOutputs: false,
        },
        chatResponse: async () => {
          callCount++;
          throw new AxAIServiceStatusError(
            500,
            'Internal Server Error',
            'https://api.example.com/chat',
            { test: 'request' },
            { error: 'server_error' }
          );
        },
      });

      const signature = f()
        .input('query', f.string())
        .output('answer', f.string())
        .build();

      const gen = new AxGen(signature);

      await expect(
        gen.forward(
          ai,
          { query: 'test' },
          {
            retryOnError: { maxRetries: 5 },
          }
        )
      ).rejects.toThrow('Internal Server Error');

      expect(callCount).toBe(6); // Initial + 5 retries
    },
    { timeout: 70000 } // 1s + 2s + 4s + 8s + 16s + 32s = 63s + buffer
  );

  it(
    'should use default maxRetries (3) when not specified',
    async () => {
      let callCount = 0;

      const ai = new AxMockAIService({
        features: {
          functions: false,
          streaming: false,
          structuredOutputs: false,
        },
        chatResponse: async () => {
          callCount++;
          throw new AxAIServiceNetworkError(
            new Error('Network error'),
            'https://api.example.com/chat',
            { test: 'request' },
            undefined
          );
        },
      });

      const signature = f()
        .input('query', f.string())
        .output('answer', f.string())
        .build();

      const gen = new AxGen(signature);

      await expect(
        gen.forward(
          ai,
          { query: 'test' },
          {
            retryOnError: {}, // Empty config, should use default maxRetries: 3
          }
        )
      ).rejects.toThrow('Network error');

      expect(callCount).toBe(4); // Initial + 3 default retries
    },
    { timeout: 20000 } // 1s + 2s + 4s + 8s = 15s + buffer
  );

  it('should handle infrastructure retry followed by validation error retry', async () => {
    let infraCallCount = 0;
    let validationCallCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        infraCallCount++;

        // First infrastructure call fails with 500
        if (infraCallCount === 1) {
          throw new AxAIServiceStatusError(
            500,
            'Internal Server Error',
            'https://api.example.com/chat',
            { test: 'request' },
            { error: 'server_error' }
          );
        }

        // Second infrastructure call succeeds but returns invalid data
        validationCallCount++;

        // Check if this is a validation error correction retry
        const messages = req.chatPrompt;
        const hasErrorCorrection = messages.some((msg) => {
          if (msg.role !== 'user') return false;
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('');
          return content.includes('Need at least 3 items');
        });

        if (hasErrorCorrection) {
          // Validation retry: return valid data
          return {
            results: [
              {
                index: 0,
                content: JSON.stringify({
                  items: [
                    { name: 'item1' },
                    { name: 'item2' },
                    { name: 'item3' },
                  ],
                }),
                finishReason: 'stop',
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30,
              },
            },
          } as AxChatResponse;
        }

        // First successful infrastructure call: return invalid data (1 item)
        return {
          results: [
            {
              index: 0,
              content: JSON.stringify({
                items: [{ name: 'item1' }],
              }),
              finishReason: 'stop',
            },
          ],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          },
        } as AxChatResponse;
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('items', f.object({ name: f.string() }).array())
      .useStructured()
      .build();

    const gen = new AxGen(signature);

    // Add assertion that requires at least 3 items
    gen.addAssert((output) => {
      if (!output.items || output.items.length < 3) {
        return 'Need at least 3 items';
      }
    });

    const result = await gen.forward(
      ai,
      { query: 'test' },
      {
        retryOnError: { maxRetries: 2 },
      }
    );

    expect(result.items).toHaveLength(3);
    expect(infraCallCount).toBe(3); // 1 failed (500) + 2 successful (1 invalid, 1 valid)
    expect(validationCallCount).toBe(2); // 1 invalid + 1 valid
  });
});
