import { describe, expect, it } from 'vitest';

import { AxMockAIService, type AxMockAIServiceConfig } from '../ai/mock/api.js';
import type { AxChatRequest, AxFunction } from '../ai/types.js';
import { f } from './sig.js';
import { ax } from './template.js';

describe('Structured Output Function-Call Fallback (__axOutput)', () => {
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

  it('accepts the legacy __finalResult name without advertising it', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          name: f.string(),
          age: f.number().min(18),
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
                params: { user: { name: 'Alice', age: 30 } },
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    let capturedFunctions: readonly { name: string }[] | undefined;
    const originalChat = mockAI.chat;
    mockAI.chat = async (req, options) => {
      capturedFunctions = req.functions;
      return originalChat(req, options);
    };

    const result = await gen.forward(mockAI, { question: 'Who is Alice?' });

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(capturedFunctions?.map((fn) => fn.name)).toContain('__axOutput');
    expect(capturedFunctions?.map((fn) => fn.name)).not.toContain(
      '__finalResult'
    );
  });

  it('streaming: streamingForward() yields extracted result from __axOutput function call chunks', async () => {
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
                        name: '__axOutput',
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

  it('sends synthetic __axOutput function with correct schema and functionCall=required', async () => {
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
                  name: '__axOutput',
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

    // Verify __axOutput function is sent
    const finalResultFn = capturedReq.functions?.find(
      (fn: any) => fn.name === '__axOutput'
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

    // functionCall should force the specific __axOutput function
    expect(capturedReq.functionCall).toEqual({
      type: 'function',
      function: { name: '__axOutput' },
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
                name: '__axOutput',
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

  it('validates constraints on fallback output (same as native path)', async () => {
    const sig = f()
      .input('question', f.string())
      .output(
        'user',
        f.object({
          name: f.string(),
          age: f.number().min(18),
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
                name: '__axOutput',
                params: { user: { name: 'Kid', age: 10 } },
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
      /at least 18/
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

    // __axOutput should NOT be in functions
    const finalResultFn = capturedReq.functions?.find(
      (fn: any) => fn.name === '__axOutput'
    );
    expect(finalResultFn).toBeUndefined();

    // Result should come from parsed content (native structured output path)
    expect(result.user).toEqual({ name: 'Charlie', age: 40 });
    expect(capturedReq.responseFormat?.type).toBe('json_schema');
    expect(
      gen.getChatLog()[0]?.providerMetadata?.ax?.structured_output_rung
    ).toBe('native');
  });

  it('treats an omitted mock structured-output capability as unknown/native', async () => {
    const gen = ax(createSig());
    const mockAI = new AxMockAIService({
      name: 'custom-like',
      features: { functions: false, streaming: false },
    });
    let capturedReq: any;

    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({
              user: { name: 'Compatibility', age: 1 },
            }),
          },
        ],
      };
    };

    expect(mockAI.getFeatures().structuredOutputs).toBeUndefined();
    await gen.forward(mockAI, { question: 'Who?' });

    expect(capturedReq.responseFormat?.type).toBe('json_schema');
    expect(
      gen.getChatLog()[0]?.providerMetadata?.ax?.structured_output_rung
    ).toBe('native');
  });

  it('uses validated json_object for one required code field without tools', async () => {
    const sig = f()
      .input('task', f.string())
      .output('javascriptCode', f.code())
      .useStructured()
      .build();
    const gen = ax(sig);
    const source = `const payload = ${JSON.stringify('x'.repeat(8192))};\nfinal(payload, {})`;
    const mockAI = new AxMockAIService({
      name: 'deepseek-like',
      features: { functions: true, streaming: false, structuredOutputs: false },
    });
    let capturedReq: any;

    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({ javascriptCode: source }),
          },
        ],
      };
    };

    const result = await gen.forward(mockAI, { task: 'write code' });

    expect(result.javascriptCode).toBe(source);
    expect(capturedReq.responseFormat).toEqual({ type: 'json_object' });
    expect(capturedReq.functions ?? []).toHaveLength(0);
    const system = capturedReq.chatPrompt.find(
      (message: any) => message.role === 'system'
    )?.content;
    expect(system).toContain(
      '**Exact JSON shape**: `{"javascriptCode":"<complete source>"}`'
    );
    expect(system).toContain('wire key: `javascriptCode`');
    expect(
      gen.getChatLog()[0]?.providerMetadata?.ax?.structured_output_rung
    ).toBe('json_object');
  });

  it.each([
    ['invented keys', JSON.stringify({ request: 'wrong' })],
    [
      'fenced prose',
      'Here is the result:\n```json\n{"javascriptCode":"wrong"}\n```',
    ],
  ])('corrects %s once and then succeeds', async (_label, invalidContent) => {
    const sig = f()
      .input('task', f.string())
      .output('javascriptCode', f.code())
      .useStructured()
      .build();
    const gen = ax(sig);
    const mockAI = new AxMockAIService({
      name: 'deepseek-like',
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
    });
    let calls = 0;
    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          content:
            calls++ === 0
              ? invalidContent
              : JSON.stringify({ javascriptCode: 'final("ok", {})' }),
        },
      ],
    });

    const result = await gen.forward(
      mockAI,
      { task: 'write code' },
      { maxRetries: 1 }
    );

    expect(calls).toBe(2);
    expect(result.javascriptCode).toBe('final("ok", {})');
  });

  it('uses validated json_object for richer output when functions are unavailable', async () => {
    const gen = ax(createSig());
    const mockAI = new AxMockAIService({
      name: 'functionless',
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
    });
    let capturedReq: any;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { name: 'Dana', age: 22 } }),
          },
        ],
      };
    };

    const result = await gen.forward(mockAI, { question: 'Who?' });

    expect(result.user).toEqual({ name: 'Dana', age: 22 });
    expect(capturedReq.responseFormat).toEqual({ type: 'json_object' });
    expect(capturedReq.functions ?? []).toHaveLength(0);
  });

  it('uses the advertised profile ordering for rich structured output', async () => {
    const gen = ax(createSig());
    const mockAI = new AxMockAIService({
      name: 'vertex-gemma',
      features: {
        functions: true,
        streaming: false,
        structuredOutputs: false,
        structuredOutputModes: ['json_object', 'function'],
      },
    });
    let capturedReq: any;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({ user: { name: 'Gemma', age: 4 } }),
          },
        ],
      };
    };

    await gen.forward(mockAI, { question: 'Who?' });

    expect(capturedReq.responseFormat).toEqual({ type: 'json_object' });
    expect(capturedReq.functions ?? []).toHaveLength(0);
  });

  it('prefers advertised native output before the singleton json_object optimization', async () => {
    const gen = ax(
      f()
        .input('task', f.string())
        .output('javascriptCode', f.code())
        .useStructured()
        .build()
    );
    const mockAI = new AxMockAIService({
      name: 'native-first',
      features: {
        functions: true,
        streaming: false,
        structuredOutputs: true,
        structuredOutputModes: ['native', 'function', 'json_object'],
      },
    });
    let capturedReq: any;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return {
        results: [
          {
            index: 0,
            content: JSON.stringify({ javascriptCode: 'final(42);' }),
          },
        ],
      };
    };

    await gen.forward(mockAI, { task: 'write code' });

    expect(capturedReq.responseFormat?.type).toBe('json_schema');
  });

  it('fails explicit capability modes before sending a request', async () => {
    const gen = ax(createSig());
    const mockAI = new AxMockAIService({
      name: 'unsupported',
      features: {
        functions: false,
        streaming: false,
        structuredOutputs: false,
      },
    });
    let calls = 0;
    mockAI.chat = async () => {
      calls++;
      return { results: [] };
    };

    await expect(
      gen.forward(
        mockAI,
        { question: 'test' },
        { structuredOutputMode: 'native' }
      )
    ).rejects.toThrow(/requires native JSON Schema support/);
    await expect(
      gen.forward(
        mockAI,
        { question: 'test' },
        { structuredOutputMode: 'function' }
      )
    ).rejects.toThrow(/requires function calling support/);
    const advertisedMock = new AxMockAIService({
      name: 'function-only',
      features: {
        functions: true,
        streaming: false,
        structuredOutputs: false,
        structuredOutputModes: ['function'],
      },
    });
    advertisedMock.chat = mockAI.chat;
    await expect(
      gen.forward(
        advertisedMock,
        { question: 'test' },
        { structuredOutputMode: 'json_object' }
      )
    ).rejects.toThrow(/requires JSON object response-format support/);
    expect(calls).toBe(0);
  });

  it.each(['__axOutput', '__finalResult'])(
    'rejects a user function named %s',
    async (name) => {
      const gen = ax(createSig(), {
        functions: [
          {
            name,
            description: 'collision',
            parameters: { type: 'object', properties: {} },
            func: async () => ({}),
          },
        ],
      });
      const mockAI = new AxMockAIService({
        name: 'mock',
        features: {
          functions: true,
          streaming: false,
          structuredOutputs: false,
        },
      });

      await expect(gen.forward(mockAI, { question: 'test' })).rejects.toThrow(
        /reserved for Ax structured-output handling/
      );
    }
  );
});

describe('Structured output beside user functions', () => {
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

  const createLookupUser = (executed: string[]): AxFunction => ({
    name: 'lookupUser',
    description: 'Look up a user by name',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'User name' } },
      required: ['name'],
    },
    func: async ({ name }: { name: string }) => {
      executed.push(name);
      return { name, age: 30 };
    },
  });

  // Mirrors the Gemini provider: native JSON Schema output and the function
  // rung are both verified.
  const createGeminiLikeAI = (
    features: Partial<
      NonNullable<AxMockAIServiceConfig<string>['features']>
    > = {}
  ) =>
    new AxMockAIService<string>({
      name: 'gemini-like',
      features: {
        functions: true,
        streaming: false,
        structuredOutputs: true,
        structuredOutputModes: ['native', 'function'],
        ...features,
      },
    });

  const jsonAnswer = {
    results: [
      {
        index: 0,
        content: JSON.stringify({ user: { name: 'Alice', age: 30 } }),
        finishReason: 'stop' as const,
      },
    ],
  };

  it('keeps native JSON Schema output while user functions stay callable', async () => {
    const gen = ax(createSig(), { functions: [createLookupUser([])] });
    const mockAI = createGeminiLikeAI();
    let capturedReq: Readonly<AxChatRequest<unknown>> | undefined;
    mockAI.chat = async (req) => {
      capturedReq ??= req;
      return jsonAnswer;
    };

    const result = await gen.forward(mockAI, { question: 'Who is Alice?' });

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(capturedReq?.responseFormat?.type).toBe('json_schema');
    expect(capturedReq?.functions?.map((fn) => fn.name)).toEqual([
      'lookupUser',
    ]);
    expect(
      gen.getChatLog()[0]?.providerMetadata?.ax?.structured_output_rung
    ).toBe('native');
  });

  it("answers through __axOutput beside the tools with structuredOutputMode 'function'", async () => {
    const executed: string[] = [];
    const gen = ax(createSig(), { functions: [createLookupUser(executed)] });
    const mockAI = createGeminiLikeAI();
    const requests: Readonly<AxChatRequest<unknown>>[] = [];
    mockAI.chat = async (req) => {
      requests.push(req);
      const call =
        requests.length === 1
          ? { name: 'lookupUser', params: { name: 'Alice' } }
          : {
              name: '__axOutput',
              params: { user: { name: 'Alice', age: 30 } },
            };
      return {
        results: [
          {
            index: 0,
            functionCalls: [
              {
                id: `call-${requests.length}`,
                type: 'function' as const,
                function: call,
              },
            ],
            finishReason: 'function_call' as const,
          },
        ],
      };
    };

    const result = await gen.forward(
      mockAI,
      { question: 'How old is Alice?' },
      { structuredOutputMode: 'function' }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(executed).toEqual(['Alice']);
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      expect(req.responseFormat).toBeUndefined();
      expect(req.functions?.map((fn) => fn.name)).toEqual([
        'lookupUser',
        '__axOutput',
      ]);
    }
    const system = requests[0]?.chatPrompt.find(
      (message) => message.role === 'system'
    )?.content;
    expect(system).toContain(
      'Return the complete output by calling `__axOutput`'
    );
    expect(
      gen.getChatLog()[0]?.providerMetadata?.ax?.structured_output_rung
    ).toBe('function');
  });

  it('renders internal prompts for the selected rung', async () => {
    const createGen = () =>
      ax(createSig(), { functions: [createLookupUser([])] });
    const values = { question: 'How old is Alice?' };

    const functionRung = await createGen()._measurePromptCharsForInternalUse(
      createGeminiLikeAI(),
      values,
      { structuredOutputMode: 'function' }
    );
    const nativeRung = await createGen()._measurePromptCharsForInternalUse(
      createGeminiLikeAI(),
      values
    );

    // The function rung lists __axOutput and swaps the JSON formatting rule.
    expect(functionRung.systemPromptCharacters).not.toBe(
      nativeRung.systemPromptCharacters
    );
  });

  it('keeps native JSON Schema output without user functions', async () => {
    const gen = ax(createSig());
    const mockAI = createGeminiLikeAI();
    let capturedReq: Readonly<AxChatRequest<unknown>> | undefined;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return jsonAnswer;
    };

    const result = await gen.forward(mockAI, { question: 'Who is Alice?' });

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(capturedReq?.responseFormat?.type).toBe('json_schema');
    expect(capturedReq?.functions ?? []).toHaveLength(0);
  });

  it.each([
    ['none', { functionCall: 'none' as const }],
    ['an explicit native mode', { structuredOutputMode: 'native' as const }],
    ['prompt-emulated functions', { functionCallMode: 'prompt' as const }],
  ])(
    'keeps native JSON Schema output for %s',
    async (_label, forwardOptions) => {
      const gen = ax(createSig(), { functions: [createLookupUser([])] });
      const mockAI = createGeminiLikeAI();
      let capturedReq: Readonly<AxChatRequest<unknown>> | undefined;
      mockAI.chat = async (req) => {
        capturedReq ??= req;
        return jsonAnswer;
      };

      const result = await gen.forward(
        mockAI,
        { question: 'Who is Alice?' },
        forwardOptions
      );

      expect(result.user).toEqual({ name: 'Alice', age: 30 });
      expect(capturedReq?.responseFormat?.type).toBe('json_schema');
      expect(capturedReq?.functions?.map((fn) => fn.name) ?? []).not.toContain(
        '__axOutput'
      );
    }
  );

  it('keeps native JSON Schema output for providers without the function rung', async () => {
    const gen = ax(createSig(), { functions: [createLookupUser([])] });
    const mockAI = createGeminiLikeAI({ structuredOutputModes: ['native'] });
    let capturedReq: Readonly<AxChatRequest<unknown>> | undefined;
    mockAI.chat = async (req) => {
      capturedReq = req;
      return jsonAnswer;
    };

    await gen.forward(mockAI, { question: 'Who is Alice?' });

    expect(capturedReq?.responseFormat?.type).toBe('json_schema');
    expect(capturedReq?.functions?.map((fn) => fn.name)).toEqual([
      'lookupUser',
    ]);
  });
});

describe('thought on the native and function rungs', () => {
  const createSig = () =>
    f()
      .input('question', f.string())
      .output('user', f.object({ name: f.string(), age: f.number() }))
      .build();

  const createAI = (structuredOutputs: boolean) =>
    new AxMockAIService<string>({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs },
    });

  const streamOf = (chunks: unknown[]) =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });

  it('returns the thought of a native JSON answer', async () => {
    const mockAI = createAI(true);
    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          thought: 'THOUGHT-NATIVE',
          content: JSON.stringify({ user: { name: 'Alice', age: 30 } }),
          finishReason: 'stop' as const,
        },
      ],
    });

    const result = await ax(createSig()).forward(
      mockAI,
      { question: 'q' },
      { showThoughts: true, stream: false }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect((result as Record<string, unknown>).thought).toBe('THOUGHT-NATIVE');
  });

  it('returns the thought of an __axOutput answer', async () => {
    const mockAI = createAI(false);
    mockAI.chat = async () => ({
      results: [
        {
          index: 0,
          thought: 'THOUGHT-FUNCTION',
          functionCalls: [
            {
              id: '1',
              type: 'function' as const,
              function: {
                name: '__axOutput',
                params: { user: { name: 'Alice', age: 30 } },
              },
            },
          ],
          finishReason: 'stop' as const,
        },
      ],
    });

    const result = await ax(createSig()).forward(
      mockAI,
      { question: 'q' },
      { showThoughts: true, stream: false }
    );

    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect((result as Record<string, unknown>).thought).toBe(
      'THOUGHT-FUNCTION'
    );
  });

  it('returns the thought of a streamed native JSON answer', async () => {
    const mockAI = createAI(true);
    mockAI.chat = (async () =>
      streamOf([
        { results: [{ index: 0, thought: 'THOUGHT-STREAM-NATIVE' }] },
        {
          results: [
            {
              index: 0,
              content: JSON.stringify({ user: { name: 'Bob', age: 25 } }),
              finishReason: 'stop',
            },
          ],
        },
      ])) as unknown as typeof mockAI.chat;

    const result = await ax(createSig()).forward(
      mockAI,
      { question: 'q' },
      { showThoughts: true, stream: true }
    );

    expect(result.user).toEqual({ name: 'Bob', age: 25 });
    expect((result as Record<string, unknown>).thought).toBe(
      'THOUGHT-STREAM-NATIVE'
    );
  });

  it('returns the thought of a streamed __axOutput answer', async () => {
    const mockAI = createAI(false);
    mockAI.chat = (async () =>
      streamOf([
        { results: [{ index: 0, thought: 'THOUGHT-STREAM-FUNCTION' }] },
        {
          results: [
            {
              index: 0,
              functionCalls: [
                {
                  id: '1',
                  type: 'function',
                  function: {
                    name: '__axOutput',
                    params: '{"user":{"name":"Bob","age":25}}',
                  },
                },
              ],
              finishReason: 'stop',
            },
          ],
        },
      ])) as unknown as typeof mockAI.chat;

    const result = await ax(createSig()).forward(
      mockAI,
      { question: 'q' },
      { showThoughts: true, stream: true }
    );

    expect(result.user).toEqual({ name: 'Bob', age: 25 });
    expect((result as Record<string, unknown>).thought).toBe(
      'THOUGHT-STREAM-FUNCTION'
    );
  });
});

describe('deprecated responseFormatWithFunctions flag', () => {
  it('is ignored: auto keeps the native rung beside callable tools', async () => {
    const sig = f()
      .input('question', f.string())
      .output('user', f.object({ name: f.string(), age: f.number() }))
      .build();
    const gen = ax(sig, {
      functions: [
        {
          name: 'lookup',
          description: 'Look up a user',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string' } },
            required: ['q'],
          },
          func: async () => 'Alice, 30',
        },
      ],
    });
    let sent: AxChatRequest | undefined;
    const mockAI = new AxMockAIService({
      name: 'mock',
      features: {
        functions: true,
        streaming: true,
        structuredOutputs: true,
        responseFormatWithFunctions: false,
      },
      chatResponse: async (req) => {
        sent = req as AxChatRequest;
        return {
          results: [
            {
              index: 0,
              content: JSON.stringify({ user: { name: 'Alice', age: 30 } }),
              finishReason: 'stop' as const,
            },
          ],
        };
      },
    });
    const result = await gen.forward(mockAI, { question: 'Who?' });
    expect(result.user).toEqual({ name: 'Alice', age: 30 });
    expect(sent?.functions?.map((fn) => fn.name)).not.toContain('__axOutput');
    expect(sent?.responseFormat).toBeDefined();
  });
});
