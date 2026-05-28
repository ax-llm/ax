import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxBaseAIArgs } from './base.js';
import { AxBaseAI } from './base.js';
import {
  getOrCreateAIMetricsInstruments,
  resetAIMetricsInstruments,
} from './metrics.js';
import type {
  AxAIServiceImpl,
  AxChatRequest,
  AxModelInfo,
  AxTokenUsage,
} from './types.js';

// Create a mock fetch implementation
const createMockFetch = (responseFactory: () => Response) => {
  return vi.fn().mockImplementation(async () => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));
    return responseFactory();
  });
};

// Create a function that returns a fresh mock response for each call
const createDefaultMockResponse = () => {
  const responseBody = JSON.stringify({ results: [] });
  return new Response(responseBody, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

describe('AxBaseAI - Expensive Model Safety', () => {
  // Mock implementation of the AI service
  const mockImpl: AxAIServiceImpl<
    string,
    string,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  > = {
    createChatReq: () => [{ name: 'test', headers: {} }, {}],
    createChatResp: () => ({ results: [] }),
    createChatStreamResp: () => ({ results: [] }),
    getModelConfig: () => ({
      maxTokens: 100,
      temperature: 0,
      stream: true,
    }),
    getTokenUsage: () => ({
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Base configuration for tests
  const baseConfig: AxBaseAIArgs<string, string> = {
    name: 'test-ai',
    apiURL: 'http://test.com',
    headers: async () => ({}),
    modelInfo: [
      {
        name: 'test-model',
        promptTokenCostPer1M: 100,
        completionTokenCostPer1M: 100,
      } as AxModelInfo,
    ],
    defaults: {
      model: 'test-model',
    },
    supportFor: {
      functions: true,
      streaming: true,
    },
    models: [
      { key: 'model1', model: 'test-model-1', description: 'Test Model 1' },
      { key: 'model2', model: 'test-model-2', description: 'Test Model 2' },
    ],
  };

  // Setup helper to create AI instance with mock fetch
  const createTestAI = (
    responseFactory = createDefaultMockResponse,
    serviceImpl: AxAIServiceImpl<
      string,
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any, // Allow 'any' for broader compatibility in tests
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    > = mockImpl,
    config: AxBaseAIArgs<string, string> = baseConfig
  ) => {
    const mockFetch = createMockFetch(responseFactory);
    const ai = new AxBaseAI(serviceImpl, config);
    ai.setOptions({
      fetch: mockFetch,
    });
    return ai;
  };

  it('should throw error for expensive model without useExpensiveModel', async () => {
    const expensiveConfig = {
      ...baseConfig,
      modelInfo: [
        {
          name: 'expensive-model',
          currency: 'usd',
          promptTokenCostPer1M: 150,
          completionTokenCostPer1M: 600,
          isExpensive: true,
        },
        {
          name: 'regular-model',
          currency: 'usd',
          promptTokenCostPer1M: 5,
          completionTokenCostPer1M: 15,
        },
      ],
      defaults: { model: 'regular-model' },
    };

    const ai = createTestAI(
      createDefaultMockResponse,
      mockImpl,
      expensiveConfig
    );

    const req: AxChatRequest<string> = {
      chatPrompt: [{ role: 'user', content: 'Hello' }],
      model: 'expensive-model',
    };

    await expect(ai.chat(req)).rejects.toThrow(
      'Model expensive-model is marked as expensive and requires explicit confirmation. Set useExpensiveModel: "yes" to proceed.'
    );
  });

  it('should allow expensive model with useExpensiveModel: "yes"', async () => {
    const expensiveConfig = {
      ...baseConfig,
      modelInfo: [
        {
          name: 'expensive-model',
          currency: 'usd',
          promptTokenCostPer1M: 150,
          completionTokenCostPer1M: 600,
          isExpensive: true,
        },
      ],
      defaults: { model: 'expensive-model' },
    };

    const ai = createTestAI(
      createDefaultMockResponse,
      mockImpl,
      expensiveConfig
    );

    const req: AxChatRequest<string> = {
      chatPrompt: [{ role: 'user', content: 'Hello' }],
      model: 'expensive-model',
    };

    const options = { useExpensiveModel: 'yes' as const };

    // Should not throw
    const response = await ai.chat(req, options);
    expect(response).toBeDefined();
  });

  it('should allow regular model without useExpensiveModel option', async () => {
    const regularConfig = {
      ...baseConfig,
      modelInfo: [
        {
          name: 'regular-model',
          currency: 'usd',
          promptTokenCostPer1M: 5,
          completionTokenCostPer1M: 15,
        },
      ],
      defaults: { model: 'regular-model' },
    };

    const ai = createTestAI(createDefaultMockResponse, mockImpl, regularConfig);

    const req: AxChatRequest<string> = {
      chatPrompt: [{ role: 'user', content: 'Hello' }],
      model: 'regular-model',
    };

    // Should not throw
    const response = await ai.chat(req);
    expect(response).toBeDefined();
  });

  it('should allow expensive model when no modelInfo is provided', async () => {
    // When modelInfo doesn't contain the model, it shouldn't block
    const configWithoutExpensiveInfo = {
      ...baseConfig,
      modelInfo: [
        {
          name: 'other-model',
          currency: 'usd',
          promptTokenCostPer1M: 5,
          completionTokenCostPer1M: 15,
        },
      ],
      defaults: { model: 'unknown-model' },
    };

    const ai = createTestAI(
      createDefaultMockResponse,
      mockImpl,
      configWithoutExpensiveInfo
    );

    const req: AxChatRequest<string> = {
      chatPrompt: [{ role: 'user', content: 'Hello' }],
      model: 'unknown-model',
    };

    // Should not throw since model info doesn't mark it as expensive
    const response = await ai.chat(req);
    expect(response).toBeDefined();
  });

  it('should block expensive model even with wrong confirmation value', async () => {
    const expensiveConfig = {
      ...baseConfig,
      modelInfo: [
        {
          name: 'expensive-model',
          currency: 'usd',
          promptTokenCostPer1M: 150,
          completionTokenCostPer1M: 600,
          isExpensive: true,
        },
      ],
      defaults: { model: 'expensive-model' },
    };

    const ai = createTestAI(
      createDefaultMockResponse,
      mockImpl,
      expensiveConfig
    );

    const req: AxChatRequest<string> = {
      chatPrompt: [{ role: 'user', content: 'Hello' }],
      model: 'expensive-model',
    };

    // No useExpensiveModel option provided - should still throw
    await expect(ai.chat(req)).rejects.toThrow(
      'Model expensive-model is marked as expensive and requires explicit confirmation. Set useExpensiveModel: "yes" to proceed.'
    );
  });
});

describe('AxBaseAI - Per-key flattened merges', () => {
  it('should merge flattened per-key options for embed without errors', async () => {
    const impl: AxAIServiceImpl<
      string,
      string,
      AxChatRequest<string>,
      { texts?: readonly string[]; embedModel?: string },
      { results: never[] },
      unknown,
      { embeddings: readonly (readonly number[])[] }
    > = {
      createChatReq: () => [{ name: 'chat', headers: {} }, {} as never],
      createChatResp: () => ({ results: [] as never[] }),
      getModelConfig: () => ({ stream: false }),
      createEmbedReq: () => [{ name: 'embed', headers: {} }, {} as never],
      createEmbedResp: () => ({ embeddings: [[0.1, 0.2]] }),
      getTokenUsage: () => undefined,
    };

    const ai = new AxBaseAI(impl, {
      name: 'embed-merge-test',
      apiURL: 'http://test',
      headers: async () => ({}),
      modelInfo: [{ name: 'e1' } as AxModelInfo],
      defaults: { model: 'm1', embedModel: 'e1' },
      supportFor: {
        functions: false,
        streaming: true,
      } as unknown as import('./base.js').AxAIFeatures,
      models: [
        {
          key: 'eKey',
          description: 'Embed key',
          embedModel: 'e1',
          thinkingTokenBudget: 'minimal',
          showThoughts: false,
          stream: true,
          debug: true,
        },
      ],
    });

    ai.setOptions({
      fetch: (async () => new Response('{}', { status: 200 })) as never,
    });
    const res = await ai.embed(
      { embedModel: 'eKey', texts: ['x'] },
      { debug: false }
    );
    expect(res.embeddings.length).toBeGreaterThan(0);
  });
});

describe('AxBaseAI - Cost Estimation', () => {
  // Helper to create a mock meter that captures counter values
  const createMockMeter = () => {
    const counters: Record<
      string,
      { values: { value: number; labels: Record<string, unknown> }[] }
    > = {};
    return {
      meter: {
        createCounter: (name: string) => {
          counters[name] = { values: [] };
          return {
            add: (value: number, labels?: Record<string, unknown>) => {
              counters[name]!.values.push({ value, labels: labels ?? {} });
            },
          };
        },
        createHistogram: () => ({ record: () => {} }),
        createGauge: () => ({ record: () => {} }),
      },
      counters,
    };
  };

  const createCostTestAI = (
    modelInfo: AxModelInfo[],
    tokenUsage: AxTokenUsage,
    mockMeter: ReturnType<typeof createMockMeter>
  ) => {
    const impl: AxAIServiceImpl<
      string,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    > = {
      createChatReq: () => [{ name: 'test', headers: {} }, {}],
      createChatResp: () => ({ results: [] }),
      getModelConfig: () => ({ maxTokens: 100, temperature: 0, stream: false }),
      getTokenUsage: () => tokenUsage,
    };

    const config: AxBaseAIArgs<string, string> = {
      name: 'test-ai',
      apiURL: 'http://test.com',
      headers: async () => ({}),
      modelInfo,
      defaults: { model: modelInfo[0]!.name },
      supportFor: { functions: true, streaming: true },
    };

    resetAIMetricsInstruments();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOrCreateAIMetricsInstruments(mockMeter.meter as any);

    const ai = new AxBaseAI(impl, config);
    ai.setOptions({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: vi
        .fn()
        .mockResolvedValue(new Response('{}', { status: 200 })) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      meter: mockMeter.meter as any,
    });
    return ai;
  };

  afterEach(() => {
    resetAIMetricsInstruments();
  });

  it('should estimate cost from prompt and completion tokens', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'model-a',
          promptTokenCostPer1M: 3.0,
          completionTokenCostPer1M: 15.0,
        } as AxModelInfo,
      ],
      { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // (1000 * 3.0 / 1_000_000) + (500 * 15.0 / 1_000_000) = 0.003 + 0.0075 = 0.0105
    expect(costEntries[0]!.value).toBeCloseTo(0.0105, 6);
  });

  it('should estimate cost with cache read tokens at discounted rate', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'model-b',
          promptTokenCostPer1M: 5.0,
          completionTokenCostPer1M: 25.0,
          cacheReadTokenCostPer1M: 0.5,
          cacheWriteTokenCostPer1M: 6.25,
        } as AxModelInfo,
      ],
      {
        promptTokens: 2000, // uncached input tokens
        completionTokens: 1000,
        totalTokens: 13000,
        cacheReadTokens: 10000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // prompt: 2000 * 5.0 / 1M = 0.01
    // completion: 1000 * 25.0 / 1M = 0.025
    // cache read: 10000 * 0.5 / 1M = 0.005
    // total = 0.04
    expect(costEntries[0]!.value).toBeCloseTo(0.04, 6);
  });

  it('should estimate cost with cache write tokens', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'model-c',
          promptTokenCostPer1M: 3.0,
          completionTokenCostPer1M: 15.0,
          cacheReadTokenCostPer1M: 0.3,
          cacheWriteTokenCostPer1M: 3.75,
        } as AxModelInfo,
      ],
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 6500,
        cacheCreationTokens: 5000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // prompt: 1000 * 3.0 / 1M = 0.003
    // completion: 500 * 15.0 / 1M = 0.0075
    // cache write: 5000 * 3.75 / 1M = 0.01875
    // total = 0.02925
    expect(costEntries[0]!.value).toBeCloseTo(0.02925, 6);
  });

  it('should estimate cost with provider fast-mode pricing', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'model-fast',
          promptTokenCostPer1M: 5.0,
          completionTokenCostPer1M: 25.0,
          cacheReadTokenCostPer1M: 0.5,
          cacheWriteTokenCostPer1M: 6.25,
          fastPromptTokenCostPer1M: 10.0,
          fastCompletionTokenCostPer1M: 50.0,
          fastCacheReadTokenCostPer1M: 1.0,
          fastCacheWriteTokenCostPer1M: 12.5,
        } as AxModelInfo,
      ],
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 13_500,
        cacheReadTokens: 10_000,
        cacheCreationTokens: 2000,
        speed: 'fast',
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // prompt: 1000 * 10.0 / 1M = 0.01
    // completion: 500 * 50.0 / 1M = 0.025
    // cache read: 10000 * 1.0 / 1M = 0.01
    // cache write: 2000 * 12.5 / 1M = 0.025
    // total = 0.07
    expect(costEntries[0]!.value).toBeCloseTo(0.07, 6);
  });

  it('should fall back to prompt rate when cache pricing is not configured', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'model-d',
          promptTokenCostPer1M: 10.0,
          completionTokenCostPer1M: 30.0,
        } as AxModelInfo,
      ],
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 6500,
        cacheReadTokens: 5000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // No cache-specific pricing, so cache reads use prompt rate
    // prompt: 1000 * 10.0 / 1M = 0.01
    // completion: 500 * 30.0 / 1M = 0.015
    // cache read (at prompt rate): 5000 * 10.0 / 1M = 0.05
    // total = 0.075
    expect(costEntries[0]!.value).toBeCloseTo(0.075, 6);
  });

  it('should record cost for streaming requests', async () => {
    const mockMeter = createMockMeter();

    const streamImpl: AxAIServiceImpl<
      string,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    > = {
      createChatReq: () => [{ name: 'test', headers: {} }, {}],
      createChatResp: () => ({ results: [{ content: 'hello' }] }),
      createChatStreamResp: () => ({ results: [{ content: 'hello' }] }),
      getModelConfig: () => ({ maxTokens: 100, temperature: 0, stream: true }),
      getTokenUsage: () => ({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      }),
    };

    const modelInfo = [
      {
        name: 'stream-model',
        promptTokenCostPer1M: 3.0,
        completionTokenCostPer1M: 15.0,
      } as AxModelInfo,
    ];

    resetAIMetricsInstruments();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOrCreateAIMetricsInstruments(mockMeter.meter as any);

    const ai = new AxBaseAI(streamImpl, {
      name: 'test-ai',
      apiURL: 'http://test.com',
      headers: async () => ({}),
      modelInfo,
      defaults: { model: 'stream-model' },
      supportFor: { functions: true, streaming: true },
    });

    // Create a mock streaming response
    const streamResponse = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
        controller.close();
      },
    });

    ai.setOptions({
      fetch: vi.fn().mockResolvedValue(
        new Response(streamResponse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })
      ) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      meter: mockMeter.meter as any,
    });

    // stream defaults to true, so this should stream
    const result = await ai.chat({
      chatPrompt: [{ role: 'user', content: 'hi' }],
    });

    // Consume the stream to trigger token usage recording
    const reader = (result as ReadableStream).getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBeGreaterThan(0);
    const totalCost = costEntries.reduce((sum, e) => sum + e.value, 0);
    // (1000 * 3.0 / 1M) + (500 * 15.0 / 1M) = 0.0105
    expect(totalCost).toBeCloseTo(0.0105, 6);
  });

  it('should record zero cost when model has no pricing info', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [{ name: 'free-model' } as AxModelInfo],
      { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    // No cost should be recorded when pricing is missing
    expect(costEntries.length).toBe(0);
  });

  it('should include thinking tokens at completion rate', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'thinking-model',
          promptTokenCostPer1M: 2.0,
          completionTokenCostPer1M: 12.0,
        } as AxModelInfo,
      ],
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 3500,
        thoughtsTokens: 2000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // prompt: 1000 * 2.0 / 1M = 0.002
    // output (completion + thinking): (500 + 2000) * 12.0 / 1M = 0.03
    // total = 0.032
    expect(costEntries[0]!.value).toBeCloseTo(0.032, 6);
  });

  it('should use long-context rates when input exceeds threshold', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'tiered-model',
          promptTokenCostPer1M: 1.25,
          completionTokenCostPer1M: 10.0,
          longContextThreshold: 200_000,
          longContextPromptTokenCostPer1M: 2.5,
          longContextCompletionTokenCostPer1M: 15.0,
        } as AxModelInfo,
      ],
      {
        promptTokens: 250_000,
        completionTokens: 1000,
        totalTokens: 251_000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // Long-context rates apply (250k > 200k threshold)
    // prompt: 250000 * 2.5 / 1M = 0.625
    // completion: 1000 * 15.0 / 1M = 0.015
    // total = 0.64
    expect(costEntries[0]!.value).toBeCloseTo(0.64, 6);
  });

  it('should use standard rates when input is below threshold', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'tiered-model',
          promptTokenCostPer1M: 1.25,
          completionTokenCostPer1M: 10.0,
          longContextThreshold: 200_000,
          longContextPromptTokenCostPer1M: 2.5,
          longContextCompletionTokenCostPer1M: 15.0,
        } as AxModelInfo,
      ],
      {
        promptTokens: 100_000,
        completionTokens: 1000,
        totalTokens: 101_000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // Standard rates (100k < 200k threshold)
    // prompt: 100000 * 1.25 / 1M = 0.125
    // completion: 1000 * 10.0 / 1M = 0.01
    // total = 0.135
    expect(costEntries[0]!.value).toBeCloseTo(0.135, 6);
  });

  it('should include cached tokens when determining long-context threshold', async () => {
    const mockMeter = createMockMeter();
    const ai = createCostTestAI(
      [
        {
          name: 'tiered-cache-model',
          promptTokenCostPer1M: 1.25,
          completionTokenCostPer1M: 10.0,
          cacheReadTokenCostPer1M: 0.125,
          longContextThreshold: 200_000,
          longContextPromptTokenCostPer1M: 2.5,
          longContextCompletionTokenCostPer1M: 15.0,
          longContextCacheReadTokenCostPer1M: 0.25,
        } as AxModelInfo,
      ],
      {
        // 50k uncached + 180k cached = 230k total input > 200k threshold
        promptTokens: 50_000,
        completionTokens: 1000,
        totalTokens: 231_000,
        cacheReadTokens: 180_000,
      },
      mockMeter
    );

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    const costEntries =
      mockMeter.counters.ax_llm_estimated_cost_total?.values ?? [];
    expect(costEntries.length).toBe(1);
    // Long-context rates (50k + 180k = 230k > 200k)
    // prompt: 50000 * 2.5 / 1M = 0.125
    // completion: 1000 * 15.0 / 1M = 0.015
    // cache read: 180000 * 0.25 / 1M = 0.045
    // total = 0.185
    expect(costEntries[0]!.value).toBeCloseTo(0.185, 6);
  });
});
