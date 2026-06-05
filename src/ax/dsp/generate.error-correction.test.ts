import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxGen } from './generate.js';
import { f } from './sig.js';

describe('Error Correction with Structured Outputs', () => {
  it('should not concatenate JSON across retry attempts when validation fails', async () => {
    // Create a mock AI that detects error correction by checking the request
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        // Check if this is an error correction retry by looking for error/correction messages
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
          // Second attempt: valid JSON with 3 items
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

        // First attempt: returns 1 item (will fail validation)
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
      .output(
        'items',
        z.array(z.object({ name: z.string() })).min(3, 'Need at least 3 items')
      )
      .useStructured()
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(ai, { query: 'test' });

    // Verify the result is valid and contains 3 items
    expect(result.items).toBeDefined();
    expect(result.items).toHaveLength(3);
    expect(result.items[0].name).toBe('item1');
    expect(result.items[1].name).toBe('item2');
    expect(result.items[2].name).toBe('item3');
  });

  it('should handle multiple retry attempts without JSON concatenation', async () => {
    let callCount = 0;

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async () => {
        callCount++;

        // Return progressively more items with each call
        const itemCount = callCount;
        const items = Array.from({ length: itemCount }, (_, i) => ({
          id: `id-${i + 1}`,
          value: `value-${i + 1}`,
        }));

        return {
          results: [
            {
              index: 0,
              content: JSON.stringify({ results: items }),
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
      },
    });

    const signature = f()
      .input('query', f.string())
      .output(
        'results',
        z
          .array(z.object({ id: z.string(), value: z.string() }))
          .min(4, 'Need at least 4 items')
      )
      .useStructured()
      .build();

    const gen = new AxGen(signature, { maxRetries: 5 });

    const result = await gen.forward(ai, { query: 'test' });

    // Should succeed on 4th attempt
    expect(result.results).toHaveLength(4);
    expect(result.results[0].id).toBe('id-1');
    expect(result.results[3].id).toBe('id-4');
    expect(callCount).toBe(4);
  });

  it('should produce valid JSON after error correction (not concatenated strings)', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        // Check if this is a retry
        const messages = req.chatPrompt;
        const hasErrorCorrection = messages.some((msg) => {
          if (msg.role !== 'user') return false;
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('');
          return content.includes('Need at least 3 slots');
        });

        if (hasErrorCorrection) {
          // Second attempt: valid JSON with 3 slots
          return {
            results: [
              {
                index: 0,
                content: JSON.stringify({
                  selectedSlots: [
                    {
                      startTimeISO: '2025-06-10T21:00:00Z',
                      endTimeISO: '2025-06-10T22:00:00Z',
                      participantIds: ['p1', 'p2'],
                    },
                    {
                      startTimeISO: '2025-06-10T22:00:00Z',
                      endTimeISO: '2025-06-10T23:00:00Z',
                      participantIds: ['p1', 'p2'],
                    },
                    {
                      startTimeISO: '2025-06-10T20:00:00Z',
                      endTimeISO: '2025-06-10T21:00:00Z',
                      participantIds: ['p1', 'p2'],
                    },
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

        // First attempt: 1 slot (fails validation)
        return {
          results: [
            {
              index: 0,
              content: JSON.stringify({
                selectedSlots: [
                  {
                    startTimeISO: '2025-06-10T21:00:00Z',
                    endTimeISO: '2025-06-10T22:00:00Z',
                    participantIds: ['p1', 'p2'],
                  },
                ],
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
      .output(
        'selectedSlots',
        z
          .array(
            z.object({
              startTimeISO: z.string(),
              endTimeISO: z.string(),
              participantIds: z.array(z.string()),
            })
          )
          .min(3, 'Need at least 3 slots')
      )
      .useStructured()
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(ai, { query: 'test' });

    // The result should be valid JSON, not concatenated strings
    expect(result.selectedSlots).toBeDefined();
    expect(Array.isArray(result.selectedSlots)).toBe(true);
    expect(result.selectedSlots).toHaveLength(3);

    // Verify the structure is intact
    expect(result.selectedSlots[0].startTimeISO).toBe('2025-06-10T21:00:00Z');
    expect(result.selectedSlots[0].participantIds).toEqual(['p1', 'p2']);
  });

  it('should work with plain text mode (hasComplexFields=false) - no state reset', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        // Check if this is a retry
        const messages = req.chatPrompt;
        const hasErrorCorrection = messages.some((msg) => {
          if (msg.role !== 'user') return false;
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('');
          return content.includes('Answer must include response2');
        });

        if (hasErrorCorrection) {
          // Second attempt: includes response2
          return {
            results: [
              {
                index: 0,
                content: 'Answer: response1, response2',
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

        // First attempt: missing response2
        return {
          results: [
            {
              index: 0,
              content: 'Answer: response1',
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

    // Plain text signature (not using .useStructured())
    const signature = f()
      .input('query', f.string())
      .output(
        'answer',
        z.string().refine((answer) => answer.includes('response2'), {
          message: 'Answer must include response2',
        })
      )
      .build();

    const gen = new AxGen(signature);

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.answer).toContain('response2');
  });

  it('should retry when addAssert fails and use the assertion message as correction feedback', async () => {
    let calls = 0;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        calls++;
        const hasAssertionCorrection = req.chatPrompt.some((msg) => {
          if (msg.role !== 'user') return false;
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('');
          return content.includes('answer must contain good');
        });

        return {
          results: [
            {
              index: 0,
              content: `Answer: ${
                hasAssertionCorrection ? 'good answer' : 'bad answer'
              }`,
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

    const gen = new AxGen<{ query: string }, { answer: string }>(
      f().input('query', f.string()).output('answer', f.string()).build()
    );
    gen.addAssert(
      ({ answer }) => answer.includes('good'),
      'answer must contain good'
    );

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.answer).toBe('good answer');
    expect(calls).toBe(2);
  });

  it('should use string returns from addAssert as correction feedback', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: {
        results: [
          {
            index: 0,
            content: JSON.stringify({ answer: 'bad answer' }),
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      } as AxChatResponse,
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      f().input('query', f.string()).output('answer', f.string()).build()
    );
    gen.addAssert(() => 'custom assertion retry');

    await expect(
      gen.forward(ai, { query: 'test' }, { maxRetries: 0 })
    ).rejects.toThrow(/custom assertion retry/);
  });

  it('should throw a clear setup error when addAssert returns false without a message', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: {
        results: [
          {
            index: 0,
            content: JSON.stringify({ answer: 'bad answer' }),
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      } as AxChatResponse,
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      f().input('query', f.string()).output('answer', f.string()).build()
    );
    gen.addAssert(() => false);

    await expect(
      gen.forward(ai, { query: 'test' }, { maxRetries: 0 })
    ).rejects.toThrow(/Assertion failed without message/);
  });

  it('should run addAssert after schema transforms', async () => {
    let assertedAnswer: string | undefined;
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false, structuredOutputs: true },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Answer: ok',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        },
      } as AxChatResponse,
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      f()
        .input('query', f.string())
        .output(
          'answer',
          z.string().transform((value) => value.toUpperCase())
        )
        .build()
    );
    gen.addAssert(({ answer }) => {
      assertedAnswer = answer;
      return answer === 'OK';
    }, 'answer must be transformed');

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.answer).toBe('OK');
    expect(assertedAnswer).toBe('OK');
  });

  it('should retry streaming output when final addAssert fails', async () => {
    let calls = 0;
    const ai = new AxMockAIService<string>({
      features: { functions: false, streaming: true },
      chatResponse: async () => {
        calls++;
        return new ReadableStream<AxChatResponse>({
          start(controller) {
            controller.enqueue({
              results: [
                {
                  index: 0,
                  content: calls === 1 ? 'Answer: bad' : 'Answer: good',
                  finishReason: 'stop',
                },
              ],
            });
            controller.close();
          },
        });
      },
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string'
    );
    gen.addAssert(
      ({ answer }) => answer.includes('good'),
      'answer must contain good'
    );

    const result = await gen.forward(ai, { query: 'test' }, { stream: true });

    expect(result.answer).toContain('good');
    expect(calls).toBe(2);
  });

  it('should retry streaming output when addStreamingAssert fails mid-stream', async () => {
    let calls = 0;
    const ai = new AxMockAIService<string>({
      features: { functions: false, streaming: true },
      chatResponse: async (req: Readonly<AxChatRequest>) => {
        calls++;
        const hasAssertionCorrection = req.chatPrompt.some((msg) => {
          if (msg.role !== 'user') return false;
          const content =
            typeof msg.content === 'string'
              ? msg.content
              : msg.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .join('');
          return content.includes('Do not include forbidden content');
        });

        return new ReadableStream<AxChatResponse>({
          start(controller) {
            controller.enqueue({
              results: [
                {
                  index: 0,
                  content: hasAssertionCorrection
                    ? 'Answer: safe content'
                    : 'Answer: forbidden content',
                  finishReason: 'stop',
                },
              ],
            });
            controller.close();
          },
        });
      },
    });

    const gen = new AxGen<{ query: string }, { answer: string }>(
      'query:string -> answer:string'
    );
    gen.addStreamingAssert(
      'answer',
      (content) => !content.includes('forbidden'),
      'Do not include forbidden content'
    );

    const result = await gen.forward(ai, { query: 'test' }, { stream: true });

    expect(result.answer).toContain('safe');
    expect(calls).toBe(2);
  });
});
