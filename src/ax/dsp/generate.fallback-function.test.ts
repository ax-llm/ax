import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { f } from './sig.js';
import { ax } from './template.js';

describe('Structured Output Function-Call Fallback (__finalResult)', () => {
  // Shared signature: complex output field triggers hasComplexFields() === true
  const createSig = () =>
    f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          name: f.string(),
          age: f.number(),
        })
      )
      .build();

  it('non-streaming: forward() returns extracted result from __finalResult function call', async () => {
    const sig = createSig();
    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: false },
    });

    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          functionCalls: [
            {
              id: '1',
              type: 'function' as const,
              function: {
                name: '__finalResult',
                params: { user: { name: 'Alice', age: 30 } },
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    const result = await gen.forward(mockAI, { question: 'Who is Alice?' });

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
  });

  it('streaming: streamingForward() yields extracted result from __finalResult function call chunks', async () => {
    const sig = createSig();
    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: false },
    });

    mockAI.chat = async (_req, options) => {
      if (options?.stream) {
        const stream = new ReadableStream({
          async start(controller) {
            // Chunk 1: function name + empty params
            controller.enqueue({
              results: [
                {
                  index: 0,
                  functionCalls: [
                    {
                      id: '1',
                      type: 'function' as const,
                      function: {
                        name: '__finalResult',
                        params: '',
                      },
                    },
                  ],
                },
              ],
            });
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Chunk 2: partial params
            controller.enqueue({
              results: [
                {
                  index: 0,
                  functionCalls: [
                    {
                      id: '1',
                      type: 'function' as const,
                      function: {
                        name: '',
                        params: '{"user":{"name":"Bob"',
                      },
                    },
                  ],
                },
              ],
            });
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Chunk 3: rest of params + finish
            controller.enqueue({
              results: [
                {
                  index: 0,
                  functionCalls: [
                    {
                      id: '1',
                      type: 'function' as const,
                      function: {
                        name: '',
                        params: ',"age":25}}',
                      },
                    },
                  ],
                  finishReason: 'stop' as const,
                },
              ],
            });

            controller.close();
          },
        });
        return stream as ReturnType<typeof mockAI.chat>;
      }
      return { results: [] };
    };

    const stream = gen.streamingForward(mockAI, { question: 'Who is Bob?' });

    let finalUser: { name?: string; age?: number } | undefined;
    for await (const chunk of stream) {
      if (chunk.delta.user) {
        finalUser = chunk.delta.user as { name: string; age: number };
      }
    }

    expect(finalUser).toEqual({ name: 'Bob', age: 25 });
  });

  it('sends synthetic __finalResult function with correct schema and functionCall=required', async () => {
    const sig = createSig();
    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: false },
    });

    let capturedReq: any;

    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            functionCalls: [
              {
                id: '1',
                type: 'function' as const,
                function: {
                  name: '__finalResult',
                  params: { user: { name: 'Test', age: 1 } },
                },
              },
            ],
            finishReason: 'stop' as const,
          },
        ],
      };
    };

    await gen.forward(mockAI, { question: 'test' });

    // Verify __finalResult function is sent
    const finalResultFn = capturedReq.functions?.find(
      (fn: any) => fn.name === '__finalResult'
    );
    expect(finalResultFn).toBeDefined();
    expect(finalResultFn.parameters).toBeDefined();
    expect(finalResultFn.parameters.properties.user).toBeDefined();
    expect(finalResultFn.parameters.properties.user.type).toBe('object');
    expect(finalResultFn.parameters.properties.user.properties.name.type).toBe(
      'string'
    );
    expect(finalResultFn.parameters.properties.user.properties.age.type).toBe(
      'number'
    );

    // functionCall should force the specific __finalResult function
    expect(capturedReq.functionCall).toEqual({
      type: 'function',
      function: { name: '__finalResult' },
    });
  });

  it('validates field constraints on fallback output (same as native path)', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          username: f.string().min(5),
          age: f.number(),
        })
      )
      .build();

    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: false },
    });

    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          functionCalls: [
            {
              id: '1',
              type: 'function' as const,
              function: {
                name: '__finalResult',
                params: { user: { username: 'abc', age: 30 } }, // username too short
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
      /at least 5 characters/
    );
  });

  it('runs assertions on fallback output (same as native path)', async () => {
    const sig = createSig();
    const gen = ax(sig);

    gen.addAssert(({ user }: { user?: { name: string; age: number } }) => {
      if (user && user.age < 18) {
        return false;
      }
      return true;
    }, 'User must be at least 18 years old');

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: false },
    });

    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          functionCalls: [
            {
              id: '1',
              type: 'function' as const,
              function: {
                name: '__finalResult',
                params: { user: { name: 'Kid', age: 10 } },
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
      /User must be at least 18 years old/
    );
  });

  it('fallback is NOT activated when structuredOutputs is true', async () => {
    const sig = createSig();
    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: false, structuredOutputs: true },
    });

    let capturedReq: any;

    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({
              user: { name: 'Charlie', age: 40 },
            }),
          },
        ],
      };
    };

    const result = await gen.forward(mockAI, { question: 'Who is Charlie?' });

    // __finalResult should NOT be in functions
    const finalResultFn = capturedReq.functions?.find(
      (fn: any) => fn.name === '__finalResult'
    );
    expect(finalResultFn).toBeUndefined();

    // Result should come from parsed content (native structured output path)
    expect(result.user).toEqual({ name: 'Charlie', age: 40 });
  });
});
