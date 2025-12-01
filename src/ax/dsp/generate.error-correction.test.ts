import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../ai/types.js';
import { AxGen } from './generate.js';
import { f } from './sig.js';

describe('Error Correction with Structured Outputs', () => {
  it('should not concatenate JSON across retry attempts when validation fails', async () => {
    // Create a mock AI that detects error correction by checking the request
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
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

        // First attempt: returns 1 item (will fail assertion)
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

    // Add assertion that requires at least 3 items (will fail on first attempt)
    gen.addAssert((output) => {
      if (!output.items || output.items.length < 3) {
        return 'Need at least 3 items';
      }
    });

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
      features: { functions: false, streaming: false },
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
        f.object({ id: f.string(), value: f.string() }).array()
      )
      .useStructured()
      .build();

    const gen = new AxGen(signature, { maxRetries: 5 });

    // Require at least 4 items
    gen.addAssert((output) => {
      if (!output.results || output.results.length < 4) {
        return `Need at least 4 items, got ${output.results?.length}`;
      }
    });

    const result = await gen.forward(ai, { query: 'test' });

    // Should succeed on 4th attempt
    expect(result.results).toHaveLength(4);
    expect(result.results[0].id).toBe('id-1');
    expect(result.results[3].id).toBe('id-4');
    expect(callCount).toBe(4);
  });

  it('should produce valid JSON after error correction (not concatenated strings)', async () => {
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
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

        // First attempt: 1 slot (fails assertion)
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
        f
          .object({
            startTimeISO: f.string(),
            endTimeISO: f.string(),
            participantIds: f.string().array(),
          })
          .array()
      )
      .useStructured()
      .build();

    const gen = new AxGen(signature);

    // Assertion that requires at least 3 slots
    gen.addAssert((output) => {
      if (!output.selectedSlots || output.selectedSlots.length < 3) {
        return `Need at least 3 slots, got ${output.selectedSlots?.length}`;
      }
    });

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
      features: { functions: false, streaming: false },
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
      .output('answer', f.string())
      .build();

    const gen = new AxGen(signature);

    gen.addAssert((output) => {
      if (!output.answer || !output.answer.includes('response2')) {
        return 'Answer must include response2';
      }
    });

    const result = await gen.forward(ai, { query: 'test' });

    expect(result.answer).toContain('response2');
  });
});
