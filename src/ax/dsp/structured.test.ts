import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { f } from './sig.js';
import { ax } from './template.js';

describe('Structured Outputs', () => {
  it('should generate correct JSON schema for nested objects', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          name: f.string(),
          age: f.number(),
          address: f.object({
            city: f.string(),
            zip: f.string(),
          }),
          tags: f.string().array(),
        })
      )
      .build();

    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true },
    });

    // Mock the chat response to verify the request format
    mockAI.chat = async (req) => {
      expect(req.responseFormat).toBeDefined();
      expect(req.responseFormat?.type).toBe('json_schema');

      const schema = req.responseFormat?.schema?.schema;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.user).toBeDefined();
      expect(schema.properties.user.type).toBe('object');
      expect(schema.properties.user.properties.name.type).toBe('string');
      expect(schema.properties.user.properties.age.type).toBe('number');
      expect(schema.properties.user.properties.address.type).toBe('object');
      expect(schema.properties.user.properties.tags.type).toBe('array');

      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({
              user: {
                name: 'John Doe',
                age: 30,
                address: { city: 'New York', zip: '10001' },
                tags: ['developer', 'ai'],
              },
            }),
          },
        ],
      };
    };

    const result = await gen.forward(mockAI, { question: 'Who is John?' });

    expect(result.user).toBeDefined();
    expect(result.user.name).toBe('John Doe');
    expect(result.user.age).toBe(30);
    expect(result.user.address.city).toBe('New York');
    expect(result.user.tags).toHaveLength(2);
  });

  it('should handle streaming with partial JSON parsing', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'inventoryList',
        f.object({
          items: f.object({ id: f.number(), name: f.string() }).array(),
        })
      )
      .build();

    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true },
    });

    // Simulate streaming chunks
    const chunks = [
      '{"inventoryList": {"items": [',
      '{"id": 1, "name": "Item 1"},',
      '{"id": 2, "name": "Item 2"}',
      ']}}',
    ];

    mockAI.chat = async (_req, options) => {
      if (options?.stream) {
        const stream = new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue({
                results: [{ index: 0, content: chunk }],
              });
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            controller.close();
          },
        });
        return stream as any;
      }
      return { results: [] };
    };

    const stream = gen.streamingForward(mockAI, { question: 'List items' });

    let lastResult: any;
    for await (const chunk of stream) {
      lastResult = chunk;
      // In a real scenario, we would check intermediate partial results here
      // But since our mock chunks are quite large, we might get full objects quickly
    }

    expect(lastResult).toBeDefined();
    expect(lastResult.delta.inventoryList).toBeDefined();
    expect(lastResult.delta.inventoryList.items).toHaveLength(2);
    expect(lastResult.delta.inventoryList.items[0].name).toBe('Item 1');
  });

  describe('Validation Errors', () => {
    it('should throw validation error for string minLength constraint violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            username: f.string().min(5),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { username: 'abc' } }), // Too short
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at least 5 characters/
      );
    });

    it('should throw validation error for string maxLength constraint violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            bio: f.string().max(10),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({
              user: { bio: 'This bio is way too long' },
            }),
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at most 10 characters/
      );
    });

    it('should throw validation error for string pattern constraint violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            code: f
              .string()
              .regex(
                '^[A-Z0-9]+$',
                'Must contain only uppercase letters and numbers'
              ),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { code: 'abc-123' } }), // Invalid pattern
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /must match pattern/
      );
    });

    it('should throw validation error for number minimum constraint violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            age: f.number().min(18),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { age: 16 } }), // Too young
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at least 18/
      );
    });

    it('should throw validation error for number maximum constraint violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            rating: f.number().max(5),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { rating: 10 } }), // Too high
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at most 5/
      );
    });

    it('should throw validation error for URL format violation', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            website: f.url(),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { website: 'not a url' } }),
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /Invalid URL format/
      );
    });

    it('should throw validation error for nested object field constraints', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            profile: f.object({
              username: f.string().min(5),
            }),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({
              user: { profile: { username: 'abc' } },
            }),
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at least 5 characters/
      );
    });

    it('should throw validation error for array element constraints', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'results',
          f.object({
            scores: f.number().min(0).max(100).array(),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ results: { scores: [50, 75, 150] } }), // 150 exceeds maximum
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /at most 100/
      );
    });

    it.skip('should throw validation error during streaming with constraints', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            username: f.string().min(5),
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      // Send complete JSON that violates constraints
      mockAI.chat = async (_req, options) => {
        if (options?.stream) {
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue({
                results: [
                  { index: 0, content: '{"user": {"username": "abc"}}' },
                ],
              });
              controller.close();
            },
          });
          return stream as any;
        }
        return { results: [] };
      };

      const stream = gen.streamingForward(mockAI, { question: 'test' });

      await expect(async () => {
        for await (const _chunk of stream) {
          // Iterate through stream
        }
      }).rejects.toThrow(/at least 5 characters/);
    });

    it('should validate required fields in structured outputs', async () => {
      const sig = f()
        .input('question', f.string())
        .output(
          'user',
          f.object({
            name: f.string(),
            email: f.string(), // Required field
          })
        )
        .build();

      const gen = ax(sig);
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: { functions: true, streaming: true },
      });

      mockAI.chat = async () => ({
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { name: 'John' } }), // Missing email
          },
        ],
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /required/i
      );
    });

    // NOTE: Assertions ARE called for structured outputs at processResponse.ts:775
    // after JSON parsing and validation. This is confirmed by code review.
  });
});
