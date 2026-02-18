import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import {
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  AxAIServiceTimeoutError,
  AxTokenLimitError,
} from '../util/apicall.js';
import { AxGen } from './generate.js';
import { f } from './sig.js';

describe('Infrastructure Error Retry', () => {
  beforeAll(() => {
    // Mock setTimeout to run callbacks immediately, skipping exponential backoff
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      if (typeof cb === 'function') {
        cb();
      }
      return 0 as any;
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

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

    // Default retry behavior (retries up to 10 times)
    const result = await gen.forward(ai, { query: 'test' });

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

    const result = await gen.forward(ai, { query: 'test' });

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

    const result = await gen.forward(ai, { query: 'test' });

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

    // Default infrastructure retry limit matches maxRetries (default 3)
    await expect(gen.forward(ai, { query: 'test' })).rejects.toThrow(
      'Service Unavailable'
    );

    expect(callCount).toBe(4); // Initial + 3 retries
  });

  it('should use custom maxRetries for infrastructure errors', async () => {
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
      gen.forward(ai, { query: 'test' }, { maxRetries: 5 })
    ).rejects.toThrow('Internal Server Error');

    expect(callCount).toBe(6); // Initial + 5 retries
  });

  it('should attempt once when maxRetries is 0', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;
        return {
          results: [
            {
              index: 0,
              content: 'Answer: Single attempt works',
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

    const result = await gen.forward(ai, { query: 'test' }, { maxRetries: 0 });

    expect(result.answer).toBe('Single attempt works');
    expect(callCount).toBe(1);
  });

  it('should retry on stream termination errors and eventually succeed', async () => {
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
          throw new AxAIServiceStreamTerminatedError(
            'https://api.example.com/chat',
            { test: 'request' }
          );
        }

        return {
          results: [
            {
              index: 0,
              content: 'Answer: Success after stream retry',
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

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.answer).toBe('Success after stream retry');
    expect(callCount).toBe(2);
  });

  it('should NOT retry on 4xx errors (client errors) by default', async () => {
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

    await expect(gen.forward(ai, { query: 'test' })).rejects.toThrow(
      'Unauthorized'
    );

    expect(callCount).toBe(1); // No retries for 4xx errors
  });

  it('should NOT retry on "max tokens" (400) error (default behavior)', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
      chatResponse: async () => {
        callCount++;
        // Simulate max tokens error (AxTokenLimitError)
        throw new AxTokenLimitError(
          400,
          'Context Length Exceeded',
          'http://test',
          {},
          { error: { code: 'context_length_exceeded' } }
        );
      },
    });

    const signature = f()
      .input('query', f.string())
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature, { ai });

    // Should fail immediately
    await expect(gen.forward(ai, { query: 'test' })).rejects.toThrow();

    expect(callCount).toBe(1); // No retries
  });

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

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.items).toHaveLength(3);
    expect(infraCallCount).toBe(3); // 1 failed (500) + 2 successful (1 invalid, 1 valid)
    expect(validationCallCount).toBe(2); // 1 invalid + 1 valid
  });
});
