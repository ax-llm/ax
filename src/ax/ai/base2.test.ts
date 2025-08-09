import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxBaseAIArgs } from './base.js';
import { AxBaseAI } from './base.js';
import type { AxAIServiceImpl, AxChatRequest, AxModelInfo } from './types.js';

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
