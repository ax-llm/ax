import { ReadableStream } from 'node:stream/web';
import type { Span } from '@opentelemetry/api'; // Ensure Span is imported
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axSpanAttributes, axSpanEvents } from '../trace/trace.js'; // Added import
import type { AxAIFeatures, AxBaseAIArgs } from './base.js';
import {
  AxBaseAI,
  setChatRequestEvents,
  setChatResponseEvents,
} from './base.js'; // Import new functions
import { resetAIMetricsInstruments } from './metrics.js';
import type {
  AxAIServiceImpl,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxChatResponseResult,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo,
  AxTokenUsage,
} from './types.js';

// Mock OpenTelemetry
const mockSpan = {
  attributes: {} as Record<string, unknown>,
  mockEvents: [] as { name: string; attributes: Record<string, unknown> }[],
  setAttribute: vi.fn((key, value) => {
    mockSpan.attributes[key] = value;
  }),
  setAttributes: vi.fn((attrs) => {
    Object.assign(mockSpan.attributes, attrs);
  }),
  addEvent: vi.fn((name, attributes) => {
    mockSpan.mockEvents.push({ name, attributes });
  }),
  end: vi.fn(),
  isRecording: vi.fn(() => true),
  recordException: vi.fn(),
};

const mockTracer = {
  startActiveSpan: vi.fn(
    async (
      _name: string,
      _options: unknown,
      _context: unknown,
      fn: (span: Readonly<typeof mockSpan>) => Promise<unknown>
    ) => {
      // Reset mockSpan for each new span
      mockSpan.attributes = {};
      mockSpan.mockEvents = [];
      mockSpan.setAttribute.mockClear();
      mockSpan.setAttributes.mockClear();
      mockSpan.addEvent.mockClear();
      mockSpan.end.mockClear();
      mockSpan.isRecording.mockClear();
      mockSpan.recordException.mockClear();
      mockSpan.isRecording.mockReturnValue(true);
      if (typeof fn === 'function') {
        return await fn(mockSpan);
      }
      return mockSpan;
    }
  ),
};

// Create a mock fetch implementation - MOVED TO TOP LEVEL
const createMockFetch = (responseFactory: () => Response) => {
  return vi.fn().mockImplementation(async () => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));
    return responseFactory();
  });
};

const createCapturingFetch = (
  capture: { calls: Array<{ url: string; body?: any }> },
  responses: unknown[]
) => {
  let index = 0;

  return vi
    .fn()
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      let body: unknown;
      try {
        if (init?.body && typeof init.body === 'string') {
          body = JSON.parse(init.body);
        }
      } catch {}

      capture.calls.push({ url: String(url), body });
      const responseBody = responses[Math.min(index, responses.length - 1)];
      index++;

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
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

describe('AxBaseAI', () => {
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
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
    });
    return ai;
  };

  it('should initialize correctly', () => {
    const ai = createTestAI();
    expect(ai.getName()).toBe('test-ai');
    expect(ai.getModelList()).toHaveLength(2);
    expect(ai.getLastUsedChatModel()).toBeUndefined();
  });

  it('should handle features correctly with function', () => {
    const featuresConfig = {
      ...baseConfig,
      supportFor: (model: string) => ({
        functions: model === 'test-model-1',
        streaming: true,
      }),
    };

    const ai = new AxBaseAI(mockImpl, featuresConfig);
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) });

    expect(ai.getFeatures('test-model-1')).toEqual({
      functions: true,
      streaming: true,
    });

    expect(ai.getFeatures('test-model-2')).toEqual({
      functions: false,
      streaming: true,
    });
  });

  it('should handle features correctly with object', () => {
    const features: AxAIFeatures = {
      functions: true,
      streaming: false,
    };

    const featuresConfig = {
      ...baseConfig,
      supportFor: features,
    };

    const ai = new AxBaseAI(mockImpl, featuresConfig);
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) });
    expect(ai.getFeatures()).toEqual(features);
  });

  it('should capture provider request ids from response headers', async () => {
    const ai = createTestAI(
      () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req_header_123',
          },
        })
    );

    const response = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'test' }] },
      { stream: false, sessionId: 'session-123' }
    )) as AxChatResponse;

    expect(response.remoteRequestId).toBe('req_header_123');
    expect(response.sessionId).toBe('session-123');
    expect(response.providerMetadata).toEqual({
      'test-ai': { requestId: 'req_header_123' },
    });
    expect(mockSpan.attributes).toMatchObject({
      [axSpanAttributes.AX_PROVIDER_REQUEST_ID]: 'req_header_123',
      [axSpanAttributes.AX_SESSION_ID]: 'session-123',
      [axSpanAttributes.LLM_CONVERSATION_ID]: 'session-123',
    });
  });

  it('should track metrics correctly', async () => {
    // Mock successful response
    const mockResponse = () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const ai = createTestAI(mockResponse);

    // Make a chat request
    const response = await ai.chat({
      chatPrompt: [{ role: 'user', content: 'test' }],
    });

    // If streaming is true, consume the stream
    if (response instanceof ReadableStream) {
      const reader = response.getReader();

      while (!(await reader.read()).done) {}
    }

    const metrics = ai.getMetrics();
    expect(metrics.latency.chat.samples).toHaveLength(1);
    expect(metrics.errors.chat.count).toBe(0);
  }, 10000);

  describe('streaming token usage diffing', () => {
    type CounterTracker = {
      sums: Record<string, number>;
      meter: AxAIServiceOptions['meter'];
    };

    // Builds a fake OTel meter that records every `counter.add(value)` into a
    // sums map, keyed by counter name. Only counters listed in `tracked` are
    // accumulated; the rest are no-ops. Returns both the sums and the meter
    // for assertions.
    const makeMetricsTestHarness = (
      tracked: readonly string[]
    ): CounterTracker => {
      const sums: Record<string, number> = Object.fromEntries(
        tracked.map((name) => [name, 0])
      );
      const makeCounter = (name: string) => ({
        add: vi.fn((value: number) => {
          if (name in sums) sums[name] += value;
        }),
      });
      const noop = () => ({ add: vi.fn(), record: vi.fn() });
      const meter = {
        createCounter: vi.fn((name: string) =>
          name in sums ? makeCounter(name) : noop()
        ),
        createHistogram: vi.fn(noop),
        createGauge: vi.fn(noop),
        createUpDownCounter: vi.fn(noop),
        createObservableCounter: vi.fn(),
        createObservableGauge: vi.fn(),
        createObservableUpDownCounter: vi.fn(),
        addBatchObservableCallback: vi.fn(),
        removeBatchObservableCallback: vi.fn(),
      } as unknown as AxAIServiceOptions['meter'];
      return { sums, meter };
    };

    const fiveChunkSSE = () => {
      const body = [1, 2, 3, 4, 5]
        .map((i) => `data: {"chunk":${i}}\n\n`)
        .join('');
      return vi.fn().mockResolvedValue(
        new Response(new TextEncoder().encode(body), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );
    };

    const drain = async (response: unknown) => {
      expect(response).toBeInstanceOf(ReadableStream);
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        // Only consumed to drive the pipeline — assertions are on counters.
        while (!(await reader.read()).done) {}
      }
    };

    // Build a minimal streaming AxAIServiceImpl. `onDelta` runs once per
    // streamed event (5 total, one per SSE chunk in fiveChunkSSE) and
    // returns the usage to surface from getTokenUsage(); returning
    // undefined leaves usage absent for that delta.
    const makeStreamingImpl = (
      onDelta: (deltaIdx: number) => AxTokenUsage | undefined,
      reqName = 'test'
    ): AxAIServiceImpl<
      string,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    > => {
      let deltaIdx = 0;
      let usage: AxTokenUsage | undefined;
      return {
        createChatReq: () => [{ name: reqName, headers: {} }, {}],
        createChatResp: () => ({ results: [] }),
        createChatStreamResp: () => {
          deltaIdx += 1;
          const next = onDelta(deltaIdx);
          if (next) usage = next;
          return { results: [{ index: 0, content: 'x' }] };
        },
        getModelConfig: () => ({
          maxTokens: 100,
          temperature: 0,
          stream: true,
        }),
        getTokenUsage: () => usage,
      };
    };

    beforeEach(() => resetAIMetricsInstruments());
    afterEach(() => resetAIMetricsInstruments());

    it('deduplicates cumulative streaming token usage into deltas', async () => {
      const { sums, meter } = makeMetricsTestHarness([
        'ax_llm_input_tokens_total',
        'ax_llm_output_tokens_total',
      ]);

      // Each delta reports a running total, not an increment — the failure mode.
      const impl = makeStreamingImpl((i) => ({
        promptTokens: 100,
        completionTokens: i * 5,
        totalTokens: 100 + i * 5,
      }));

      const ai = new AxBaseAI(impl, baseConfig);
      ai.setOptions({ fetch: fiveChunkSSE(), meter });
      await drain(
        await ai.chat({ chatPrompt: [{ role: 'user', content: 'test' }] })
      );

      // Final cumulative after 5 deltas: 100 prompt, 25 completion. Pre-fix the
      // counters would have summed to 5x these values.
      expect(sums.ax_llm_input_tokens_total).toBe(100);
      expect(sums.ax_llm_output_tokens_total).toBe(25);
    }, 10000);

    it('records cumulative streaming usage when usage is reported on a single event', async () => {
      const { sums, meter } = makeMetricsTestHarness([
        'ax_llm_input_tokens_total',
        'ax_llm_output_tokens_total',
      ]);

      // Only the last delta carries usage.
      const impl = makeStreamingImpl((i) =>
        i === 5
          ? { promptTokens: 80, completionTokens: 42, totalTokens: 122 }
          : undefined
      );

      const ai = new AxBaseAI(impl, baseConfig);
      ai.setOptions({ fetch: fiveChunkSSE(), meter });
      await drain(
        await ai.chat({ chatPrompt: [{ role: 'user', content: 'test' }] })
      );

      expect(sums.ax_llm_input_tokens_total).toBe(80);
      expect(sums.ax_llm_output_tokens_total).toBe(42);
    }, 10000);

    it('prices long-context cost from cumulative usage, not per-delta increments', async () => {
      const { sums, meter } = makeMetricsTestHarness([
        'ax_llm_estimated_cost_total',
      ]);

      // Anthropic-shape: large prompt set at first event, completion grows.
      const impl = makeStreamingImpl(
        (i) => ({
          promptTokens: 250_000,
          completionTokens: i * 100,
          totalTokens: 250_000 + i * 100,
        }),
        'test-long'
      );

      const modelInfo: AxModelInfo[] = [
        {
          name: 'test-model',
          promptTokenCostPer1M: 3,
          completionTokenCostPer1M: 15,
          longContextThreshold: 200_000,
          longContextPromptTokenCostPer1M: 6,
          longContextCompletionTokenCostPer1M: 22.5,
        },
      ];

      const ai = new AxBaseAI(impl, { ...baseConfig, modelInfo });
      ai.setOptions({ fetch: fiveChunkSSE(), meter });
      await drain(
        await ai.chat({ chatPrompt: [{ role: 'user', content: 'test' }] })
      );

      // 250k prompt @ $6/1M + 500 completion @ $22.5/1M.
      const expectedCost = (250_000 * 6) / 1_000_000 + (500 * 22.5) / 1_000_000;
      expect(sums.ax_llm_estimated_cost_total).toBeCloseTo(expectedCost, 6);
    }, 10000);
  });

  it('should handle errors in metrics', async () => {
    // Create an implementation that throws an error
    const errorImpl = {
      ...mockImpl,
      getModelConfig: () => ({
        maxTokens: 100,
        temperature: 0,
        stream: false, // Disable streaming for error handling test
      }),
      createChatReq: () => {
        throw new Error('Test error');
      },
    };

    const ai = createTestAI(createDefaultMockResponse, errorImpl);

    // Make a chat request that will error
    try {
      await ai.chat({ chatPrompt: [] });
    } catch {
      // Expected error
    }

    const metrics = ai.getMetrics();
    expect(metrics.errors.chat.count).toBe(1);
    expect(metrics.errors.chat.rate).toBe(1);
  }, 10000);

  it('should update options correctly', () => {
    const ai = createTestAI();

    const options = {
      debug: false,
      fetch: createMockFetch(createDefaultMockResponse),
    };

    ai.setOptions(options);
    expect(ai.getOptions()).toMatchObject(options);
  });

  it('should throw error when no model is defined', () => {
    const invalidConfig: AxBaseAIArgs<string, string> = {
      ...baseConfig,
      defaults: {
        model: '', // Invalid model
      },
    };

    expect(() => {
      createTestAI(undefined, mockImpl, invalidConfig);
    }).toThrow('No model defined');
  });

  it('should handle API URL and headers updates', async () => {
    const ai = createTestAI();

    const newUrl = 'http://new-test.com';
    const newHeaders = async () => ({ 'X-Test': 'test' });

    ai.setAPIURL(newUrl);
    ai.setHeaders(newHeaders);

    // Basic check, more thorough checks would involve actual calls
    expect(ai.getName()).toBe('test-ai');
  });

  it('should propagate retry options to apiCall', async () => {
    const ai = createTestAI();
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('Error', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    );

    ai.setOptions({
      fetch: mockFetch,
      // @ts-expect-error - testing retry propagation
      retry: {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 10,
        backoffFactor: 1,
      },
    });

    try {
      await ai.chat({ chatPrompt: [{ role: 'user', content: 'test' }] });
    } catch {
      // Expected to fail
    }

    // Initial call + 2 retries = 3 calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  describe('includeRequestBodyInErrors option', () => {
    it('should round-trip through setOptions/getOptions', () => {
      const ai = createTestAI();

      ai.setOptions({ includeRequestBodyInErrors: false });
      expect(ai.getOptions()).toMatchObject({
        includeRequestBodyInErrors: false,
      });

      ai.setOptions({ includeRequestBodyInErrors: true });
      expect(ai.getOptions()).toMatchObject({
        includeRequestBodyInErrors: true,
      });
    });

    it('should exclude request body from error string when set to false', async () => {
      const sensitive = 'sensitive-marker-xyz-123';
      const nonStreamingImpl = {
        ...mockImpl,
        getModelConfig: () => ({
          maxTokens: 100,
          temperature: 0,
          stream: false,
        }),
        createChatReq: () => [
          { name: 'test', headers: {} },
          { payload: sensitive },
        ],
      };
      const ai = createTestAI(undefined, nonStreamingImpl, {
        ...baseConfig,
        supportFor: { functions: true, streaming: false },
      });

      const errorFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'bad' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        })
      );

      ai.setOptions({
        fetch: errorFetch,
        includeRequestBodyInErrors: false,
        // @ts-expect-error - testing
        retry: { maxRetries: 0 },
      });

      let caught: unknown;
      try {
        await ai.chat({ chatPrompt: [{ role: 'user', content: 'test' }] });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(String(caught)).not.toContain(sensitive);
      expect(String(caught)).not.toContain('Request Body:');
    });
  });

  describe('function schema cleanup', () => {
    let ai: AxBaseAI<
      string,
      string,
      AxChatRequest,
      AxEmbedRequest,
      AxChatResponse,
      AxChatResponseResult,
      AxEmbedResponse
    >;

    beforeEach(() => {
      // Create AI instance with non-streaming model config for function cleanup tests
      const nonStreamingMockImpl = {
        ...mockImpl,
        getModelConfig: () => ({
          maxTokens: 100,
          temperature: 0,
          stream: false, // Disable streaming for function cleanup tests
        }),
      };
      ai = createTestAI(createDefaultMockResponse, nonStreamingMockImpl, {
        ...baseConfig,
        supportFor: {
          functions: true,
          streaming: false, // Disable streaming support entirely for these tests
        },
      }) as AxBaseAI<
        string,
        string,
        AxChatRequest,
        AxEmbedRequest,
        AxChatResponse,
        AxChatResponseResult,
        AxEmbedResponse
      >;

      // Ensure tracer is set for proper function execution path
      ai.setOptions({
        fetch: createMockFetch(createDefaultMockResponse),
        tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
      });
    });

    it('should clean up empty parameters object', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema');

      const response = await ai.chat(chatReq, { stream: false }); // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader();

        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled();
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value;
      expect(cleanedFunction.parameters).toBeUndefined();
    }, 10000);

    // ... other function schema cleanup tests ...
    it('should clean up empty required array', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
            parameters: {
              type: 'object',
              properties: {
                someField: {
                  type: 'string',
                  description: 'some field',
                },
              },
              required: [],
            },
          },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema');

      const response = await ai.chat(chatReq, { stream: false }); // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled();
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value;
      expect(cleanedFunction.parameters?.required).toBeUndefined();
      expect(cleanedFunction.parameters?.properties).toBeDefined();
    });

    it('should clean up empty properties object', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
            parameters: {
              type: 'object',
              properties: {},
              required: ['someField'],
            },
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema');

      const response = await ai.chat(chatReq, { stream: false }); // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled();
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value;
      expect(cleanedFunction.parameters?.properties).toBeUndefined();
      expect(cleanedFunction.parameters?.required).toBeDefined();
    });

    it('should preserve non-empty schema parts', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
            parameters: {
              type: 'object',
              properties: {
                someField: {
                  type: 'string',
                  description: 'some field',
                },
              },
              required: ['someField'],
            },
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema');

      const response = await ai.chat(chatReq, { stream: false }); // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled();
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value;
      expect(cleanedFunction.parameters?.properties?.someField).toBeDefined();
      expect(cleanedFunction.parameters?.required).toEqual(['someField']);
    });

    it('should handle undefined parameters', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
          },
        ],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema');

      const response = await ai.chat(chatReq, { stream: false }); // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader();
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled();
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value;
      expect(cleanedFunction.parameters).toBeUndefined();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });
  });

  it('should return only non-internal models in getModelList', () => {
    const ai = new AxBaseAI(mockImpl, {
      ...baseConfig,
      models: [
        { key: 'basic', model: 'model-basic', description: 'Basic model' },
        {
          key: 'advanced',
          model: 'model-advanced',
          description: 'Advanced model',
          isInternal: true,
        },
        { key: 'expert', model: 'model-expert', description: 'Expert model' },
      ],
    });
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) });
    const visibleModels = ai.getModelList();
    expect(visibleModels).toHaveLength(2);
    expect(visibleModels?.map((m) => m.key)).toContain('basic');
    expect(visibleModels?.map((m) => m.key)).toContain('expert');
    expect(visibleModels?.map((m) => m.key)).not.toContain('advanced');
  });

  it('should throw an error if duplicate model keys are provided', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _ai = new AxBaseAI(mockImpl, {
        ...baseConfig,
        models: [
          { key: 'basic', model: 'model-basic', description: 'Basic model' },
          {
            key: 'basic',
            model: 'another-model-basic',
            description: 'Duplicate basic model',
          },
        ],
      });
    }).toThrowError(/Duplicate model key detected: "basic"/);
  });

  it('should throw error for empty content in chat prompt', async () => {
    const ai = createTestAI();

    const chatReq = {
      chatPrompt: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '' }, // Empty content should trigger validation
        { role: 'user', content: 'Another message' },
      ] as AxChatRequest['chatPrompt'],
    };

    await expect(ai.chat(chatReq)).rejects.toThrow();
  });

  it('should throw error for whitespace-only content in chat prompt', async () => {
    const ai = createTestAI();

    const chatReq = {
      chatPrompt: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: '   \n\t  ' }, // Whitespace-only content should trigger validation
        { role: 'user', content: 'Another message' },
      ] as AxChatRequest['chatPrompt'],
    };

    await expect(ai.chat(chatReq)).rejects.toThrow();
  });

  it('should merge flattened per-key modelConfig and options for chat', async () => {
    const captured: {
      req?: AxChatRequest<string> & { modelConfig?: AxModelConfig };
      options?: AxAIServiceOptions;
    } = {};

    const impl: AxAIServiceImpl<
      string,
      string,
      AxChatRequest<string>,
      AxEmbedRequest,
      AxChatResponse,
      AxChatResponseResult,
      AxEmbedResponse
    > = {
      createChatReq: vi.fn((req, options) => {
        captured.req = req as unknown as AxChatRequest<string> & {
          modelConfig?: AxModelConfig;
        };
        captured.options = options;
        return [
          { name: 'chat', headers: {} },
          { ok: true } as unknown as never,
        ];
      }),
      createChatResp: () => ({ results: [] }),
      getModelConfig: () => ({
        maxTokens: 256,
        temperature: 0.1,
        topP: 0.9,
        stream: true,
      }),
      createChatStreamResp: (delta: unknown) => ({
        results: [delta as AxChatResponseResult],
      }),
      getTokenUsage: () => undefined,
    };

    const ai = new AxBaseAI(impl, {
      name: 'merge-test-ai',
      apiURL: 'http://test',
      headers: async () => ({}),
      modelInfo: [{ name: 'm1' } as AxModelInfo],
      defaults: { model: 'm1' },
      supportFor: {
        functions: true,
        streaming: true,
        hasThinkingBudget: true,
        hasShowThoughts: true,
      } as unknown as AxAIFeatures,
      models: [
        {
          key: 'key1',
          description: 'Key 1',
          model: 'm1',
          modelConfig: { temperature: 0.6, topP: 0.8 },
          thinkingTokenBudget: 'low',
          showThoughts: true,
          stream: true,
          debug: true,
        },
      ],
    });

    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) });

    await ai.chat(
      {
        model: 'key1',
        chatPrompt: [{ role: 'user', content: 'hi' }],
        // Per-request should override per-key modelConfig
        modelConfig: { maxTokens: 999, stream: false },
      },
      // Per-request options should override per-key options where provided
      { stream: false, debug: false }
    );

    expect(impl.createChatReq).toHaveBeenCalled();
    expect(captured.req?.modelConfig).toMatchObject({
      // From per-key modelConfig
      temperature: 0.6,
      topP: 0.8,
      // From per-request override
      maxTokens: 999,
      // From per-request options override via modelConfig.stream precedence handling
      stream: false,
    });

    // Options merged: per-key defaults present unless overridden by per-call
    expect(captured.options).toMatchObject({
      thinkingTokenBudget: 'low',
      showThoughts: true,
      // Overridden by call options
      stream: false,
      debug: false,
    });
  });
});

describe('setChatResponseEvents', () => {
  let mockSpanInstance: typeof mockSpan;

  beforeEach(() => {
    // Create a fresh mockSpan for each test to avoid interference
    mockSpanInstance = {
      attributes: {},
      mockEvents: [],
      setAttribute: vi.fn((key, value) => {
        mockSpanInstance.attributes[key] = value;
      }),
      setAttributes: vi.fn((attrs) => {
        Object.assign(mockSpanInstance.attributes, attrs);
      }),
      addEvent: vi.fn((name, attributes) => {
        mockSpanInstance.mockEvents.push({ name, attributes });
      }),
      end: vi.fn(),
      isRecording: vi.fn(() => true),
      recordException: vi.fn(),
    };
    // Clear all mock function call history
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle Chat Response with results', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [
        { index: 0, content: 'Hello', finishReason: 'stop' },
        {
          index: 0,
          content: 'Function call',
          finishReason: 'tool_calls' as AxChatResponseResult['finishReason'],
          functionCalls: [
            {
              id: 'call1',
              type: 'function',
              function: { name: 'funcName', params: { arg1: 'val1' } },
            },
          ],
        },
      ],
    };
    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span
    );

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    );

    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(3);
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      2,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({ content: 'Hello' }, null, 2),
      }
    );
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      3,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'tool_calls',
        index: 1,
        message: JSON.stringify(
          {
            content: 'Function call',
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: 'funcName',
                arguments: { arg1: 'val1' },
              },
            ],
          },
          null,
          2
        ),
      }
    );
  });

  it('should add response correlation attributes', () => {
    const mockChatResponse: AxChatResponse = {
      sessionId: 'local-session',
      remoteId: 'resp_123',
      remoteRequestId: 'req_123',
      remoteSessionId: 'provider-session',
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
      results: [{ index: 0, content: 'Hello', finishReason: 'stop' }],
    };

    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span
    );

    expect(mockSpanInstance.attributes).toMatchObject({
      [axSpanAttributes.LLM_RESPONSE_ID]: 'resp_123',
      [axSpanAttributes.LLM_RESPONSE_MODEL]: 'test-model',
      [axSpanAttributes.LLM_CONVERSATION_ID]: 'provider-session',
      [axSpanAttributes.AX_SESSION_ID]: 'local-session',
      [axSpanAttributes.AX_PROVIDER_REQUEST_ID]: 'req_123',
      [axSpanAttributes.AX_PROVIDER_SESSION_ID]: 'provider-session',
    });
  });

  it('should handle Chat Response (Empty Results)', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [],
    };
    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span
    );

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    );
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1);
  });

  it('should handle Response without Model Usage', () => {
    const mockChatResponse: AxChatResponse = {
      results: [{ index: 0, content: 'Hello', finishReason: 'stop' }],
    };
    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span
    );

    expect(mockSpanInstance.setAttributes).not.toHaveBeenCalled();
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({ content: 'Hello' }, null, 2),
      }
    );
  });

  it('should exclude content from telemetry when excludeContentFromTelemetry is true', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [
        { index: 0, content: 'Hello', finishReason: 'stop' },
        {
          index: 0,
          content: 'Function call',
          finishReason: 'tool_calls' as AxChatResponseResult['finishReason'],
          functionCalls: [
            {
              id: 'call1',
              type: 'function',
              function: { name: 'funcName', params: { arg1: 'val1' } },
            },
          ],
        },
      ],
    };
    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span,
      true
    );

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    );

    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(3);
    // First result should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      2,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({}, null, 2),
      }
    );
    // Second result should not have content but should have tool_calls
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      3,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'tool_calls',
        index: 1,
        message: JSON.stringify(
          {
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: 'funcName',
                arguments: { arg1: 'val1' },
              },
            ],
          },
          null,
          2
        ),
      }
    );
  });
});

describe('setChatRequestEvents', () => {
  let mockSpanInstance: typeof mockSpan;

  beforeEach(() => {
    mockSpanInstance = {
      attributes: {},
      mockEvents: [],
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      addEvent: vi.fn(),
      end: vi.fn(),
      isRecording: vi.fn(() => true),
      recordException: vi.fn(),
    };
    // Clear all mock function call history
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle system message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'system', content: 'System prompt' }],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      { content: 'System prompt' }
    );
    // User message event should also be called, even if empty
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    );
  });

  it('should handle user message string content', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'user', content: 'User message' }],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'User message' }
    );
  });

  it('should handle user message array content', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'User message part 1' },
            { type: 'text', text: 'User message part 2' },
          ],
        },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'User message part 1\nUser message part 2' }
    );
  });

  it('should handle assistant message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'assistant', content: 'Assistant message' }],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      { content: 'Assistant message' }
    );
  });

  it('should handle assistant message with function calls', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        {
          role: 'assistant',
          content: 'Assistant says something',
          functionCalls: [
            {
              id: 'fc1',
              type: 'function',
              function: { name: 'func_name', params: { argA: 'valA' } },
            },
          ],
        },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      {
        content: 'Assistant says something',
        function_calls: JSON.stringify(
          [
            {
              id: 'fc1',
              type: 'function',
              function: 'func_name',
              arguments: { argA: 'valA' },
            },
          ],
          null,
          2
        ),
      }
    );
  });

  it('should handle function message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'function', functionId: 'fn1', result: 'Function result' },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_TOOL_MESSAGE,
      { id: 'fn1', content: 'Function result' }
    );
  });

  it('should handle multiple messages of different roles', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'system', content: 'System setup' },
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Question?' },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      { content: 'System setup' }
    );
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      { content: 'Hello!' }
    );
    // User messages are aggregated
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'Hi there\nQuestion?' }
    );
  });

  it('should handle empty chatPrompt', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    // GEN_AI_USER_MESSAGE should still be called with empty content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    );
  });

  it('should handle chatPrompt with only non-text user content parts', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        {
          role: 'user',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: [{ type: 'image_url', image_url: 'test.png' } as any],
        },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span);
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    );
  });

  it('should exclude content from telemetry when excludeContentFromTelemetry is true', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
        { role: 'function', functionId: 'fn1', result: 'Function result' },
      ],
    };
    setChatRequestEvents(req, mockSpanInstance as unknown as Span, true);

    // System message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      {}
    );

    // Assistant message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      {}
    );

    // Function message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_TOOL_MESSAGE,
      { id: 'fn1' }
    );

    // User message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      {}
    );
  });
});

describe('AxBaseAI Tracing with Token Usage', () => {
  let aiService: AxBaseAI<
    string,
    string,
    AxChatRequest,
    AxEmbedRequest,
    AxChatResponse,
    AxChatResponseResult,
    AxEmbedResponse
  >;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockServiceImpl: any; // Use 'any' for easier mocking with Vitest's vi.fn()

  const mockTokenUsage: AxTokenUsage = {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  };
  const mockModelConfig: AxModelConfig = {
    maxTokens: 100,
    temperature: 0,
    stream: false,
  }; // Set stream to false for non-streaming tests

  beforeEach(() => {
    // Reset the mock span completely
    mockSpan.attributes = {};
    mockSpan.mockEvents = [];
    mockSpan.setAttribute.mockClear();
    mockSpan.setAttributes.mockClear();
    mockSpan.addEvent.mockClear();
    mockSpan.end.mockClear();
    mockSpan.isRecording.mockClear();
    mockSpan.recordException.mockClear();
    mockSpan.isRecording.mockReturnValue(true);

    mockServiceImpl = {
      createChatReq: vi.fn().mockReturnValue([
        { name: 'chat', headers: {} },
        {
          model: 'test-model',
          chatPrompt: [{ role: 'user', content: 'hello' }],
        }, // Added chatPrompt for setChatRequestEvents
      ]),
      createChatResp: vi
        .fn()
        .mockReturnValue({ results: [{ index: 0, content: 'response' }] }), // No modelUsage initially
      createChatStreamResp: vi
        .fn()
        .mockImplementation((respDelta: unknown) => ({
          results: [respDelta as AxChatResponseResult],
        })), // No modelUsage initially
      createEmbedReq: vi
        .fn()
        .mockReturnValue([
          { name: 'embed', headers: {} },
          { model: 'test-embed-model' },
        ]),
      createEmbedResp: vi.fn().mockReturnValue({ embeddings: [[1, 2, 3]] }), // No modelUsage initially
      getModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      getTokenUsage: vi.fn().mockReturnValue(mockTokenUsage), // Key mock
    };

    aiService = new AxBaseAI(
      mockServiceImpl as AxAIServiceImpl<
        string,
        string,
        AxChatRequest,
        AxEmbedRequest,
        AxChatResponse,
        AxChatResponseResult,
        AxEmbedResponse
      >,
      {
        name: 'mockAI',
        apiURL: 'http://localhost',
        headers: async () => ({}),
        modelInfo: [{ name: 'test-model' } as AxModelInfo],
        defaults: { model: 'test-model', embedModel: 'test-embed-model' },
        supportFor: { functions: false, streaming: false }, // Disable streaming support for non-streaming tests
        options: {
          tracer: mockTracer as unknown as AxAIServiceOptions['tracer'], // Set tracer in constructor
        },
      }
    );
    // Set a mock fetch for apiCall to work - use fresh response for each test
    // Also set tracer again to ensure it's properly set
    aiService.setOptions({
      fetch: createMockFetch(createDefaultMockResponse), // Create fresh response
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'], // Set tracer again to ensure it's set
    });
    mockTracer.startActiveSpan.mockClear();
    // Clear all individual method mocks in mockServiceImpl
    Object.values(mockServiceImpl).forEach((mockFn) => {
      if (vi.isMockFunction(mockFn)) {
        mockFn.mockClear();
      }
    });
    // Specifically re-mock getTokenUsage for clarity as it's key
    mockServiceImpl.getTokenUsage.mockReturnValue(mockTokenUsage);
    mockServiceImpl.getModelConfig.mockReturnValue(mockModelConfig);
    // Ensure createChatReq is re-mocked for each test if needed, or provide a default that includes chatPrompt
    mockServiceImpl.createChatReq.mockReturnValue([
      { name: 'chat', headers: {} },
      { model: 'test-model', chatPrompt: [{ role: 'user', content: 'hello' }] },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add token usage to trace for non-streaming chat (fallback to getTokenUsage)', async () => {
    await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false } // Explicitly disable streaming
    );
    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled();
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: mockTokenUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        mockTokenUsage.completionTokens,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: mockTokenUsage.totalTokens,
    });
    // setChatRequestEvents: user (1 event)
    // setChatResponseEvents: usage (1 event), choice (1 event)
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(3);
  });

  it('should add token usage to trace for non-streaming chat (service provides it)', async () => {
    const serviceProvidedUsage: AxTokenUsage = {
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
    };
    mockServiceImpl.createChatResp.mockReturnValue({
      results: [{ index: 0, content: 'response' }],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-model',
        tokens: serviceProvidedUsage,
      },
    } as AxChatResponse);

    await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false } // Explicitly disable streaming
    );
    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled(); // Should use service provided
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
        serviceProvidedUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        serviceProvidedUsage.completionTokens,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
        serviceProvidedUsage.totalTokens,
    });
    // setChatRequestEvents: user (1 event)
    // setChatResponseEvents: usage (1 event), choice (1 event)
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(3);
  });

  // Temporarily skip the streaming tests as they require complex setup
  it('should add token usage to trace for streaming chat', async () => {
    // Enable streaming config
    const streamingModelConfig = {
      maxTokens: 100,
      temperature: 0,
      stream: true,
    };
    mockServiceImpl.getModelConfig.mockReturnValue(streamingModelConfig);

    const mockStreamingResponse = {
      results: [{ index: 0, content: 'response' }],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-model',
        tokens: mockTokenUsage,
      },
    };

    // Mock a readable stream response
    const responseBody = JSON.stringify(mockStreamingResponse);

    const mockResponse = () =>
      new Response(responseBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    aiService.setOptions({
      fetch: createMockFetch(mockResponse),
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
    });

    mockServiceImpl.createChatStreamResp.mockReturnValue(mockStreamingResponse);

    const response = await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: true }
    );

    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      while (!(await reader.read()).done) {}
    }

    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
  });

  it('should add token usage to trace for streaming chat (service provides it on delta)', async () => {
    // Enable streaming config
    const streamingModelConfig = {
      maxTokens: 100,
      temperature: 0,
      stream: true,
    };
    mockServiceImpl.getModelConfig.mockReturnValue(streamingModelConfig);

    // Enable streaming support for this test
    aiService = new AxBaseAI(
      mockServiceImpl as AxAIServiceImpl<
        string,
        string,
        AxChatRequest,
        AxEmbedRequest,
        AxChatResponse,
        AxChatResponseResult,
        AxEmbedResponse
      >,
      {
        name: 'mockAI',
        apiURL: 'http://localhost',
        headers: async () => ({}),
        modelInfo: [{ name: 'test-model' } as AxModelInfo],
        defaults: { model: 'test-model', embedModel: 'test-embed-model' },
        supportFor: { functions: false, streaming: true }, // Enable streaming for this test
        options: {
          tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
        },
      }
    );

    const serviceProvidedUsage: AxTokenUsage = {
      promptTokens: 12,
      completionTokens: 24,
      totalTokens: 36,
    };

    const mockStreamingResponse = {
      results: [{ index: 0, content: 'response' }],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-model',
        tokens: serviceProvidedUsage,
      },
    };

    // Mock a readable stream response
    const responseBody = JSON.stringify(mockStreamingResponse);

    const mockResponse = () =>
      new Response(responseBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    aiService.setOptions({
      fetch: createMockFetch(mockResponse),
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
    });

    // Replace the implementation to always return the response with modelUsage
    mockServiceImpl.createChatStreamResp.mockImplementation(
      () => mockStreamingResponse
    );

    const response = await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: true }
    );

    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      while (!(await reader.read()).done) {}
    }

    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled(); // Should use service provided
  });

  it('should add token usage to trace for embed requests (fallback to getTokenUsage)', async () => {
    // Ensure non-streaming config for embed test
    const embedModelConfig = { maxTokens: 100, temperature: 0, stream: false };
    mockServiceImpl.getModelConfig.mockReturnValue(embedModelConfig);

    const embedTokenUsage: AxTokenUsage = {
      promptTokens: 15,
      completionTokens: 0, // Embeddings usually don't have completion tokens
      totalTokens: 15, // So total often equals prompt
    };
    mockServiceImpl.getTokenUsage.mockReturnValue(embedTokenUsage); // Specific for embed

    await aiService.embed({ texts: ['embed this'] });

    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled();
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: embedTokenUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        embedTokenUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: embedTokenUsage.totalTokens,
    });
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(1);
  });

  it('should add token usage to trace for embed requests (service provides it)', async () => {
    // Ensure non-streaming config for embed test
    const embedModelConfig = { maxTokens: 100, temperature: 0, stream: false };
    mockServiceImpl.getModelConfig.mockReturnValue(embedModelConfig);

    const serviceProvidedUsage: AxTokenUsage = {
      promptTokens: 16,
      completionTokens: 0,
      totalTokens: 16,
    };
    mockServiceImpl.createEmbedResp.mockReturnValue({
      embeddings: [[1, 2, 3]],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-embed-model',
        tokens: serviceProvidedUsage,
      },
    } as AxEmbedResponse);

    await aiService.embed({ texts: ['embed this'] });

    expect(mockTracer.startActiveSpan).toHaveBeenCalled();
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled();
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
        serviceProvidedUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        serviceProvidedUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
        serviceProvidedUsage.totalTokens,
    });
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(1);
  });

  describe('explicit context cache identity', () => {
    const createCacheAwareImpl = () =>
      ({
        createChatReq: vi.fn(() => [{ name: '/chat', headers: {} }, {}]),
        createChatResp: vi.fn(() => ({
          results: [{ content: 'ok' }],
        })),
        createChatStreamResp: vi.fn(() => ({ results: [] })),
        getModelConfig: vi.fn(() => ({
          maxTokens: 100,
          temperature: 0,
          stream: false,
        })),
        getTokenUsage: vi.fn(() => ({
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
        })),
        supportsContextCache: vi.fn(() => true),
        buildCacheCreateOp: vi.fn((req) => ({
          type: 'create' as const,
          apiConfig: { name: '/cached', headers: {} },
          request: {
            functions: req.functions,
            functionCall: req.functionCall,
          },
          parseResponse: () => ({
            name: `cache-${Math.random()}`,
            expiresAt: '2099-01-01T00:00:00Z',
            tokenCount: 4096,
          }),
        })),
        prepareCachedChatReq: vi.fn((_req, _options, cacheName) => ({
          apiConfig: { name: '/chat', headers: {} },
          request: { cachedContent: cacheName },
        })),
      }) satisfies AxAIServiceImpl<
        string,
        string,
        unknown,
        unknown,
        unknown,
        unknown,
        unknown
      >;

    const createCacheAwareAI = (
      impl: ReturnType<typeof createCacheAwareImpl>,
      fetch: ReturnType<typeof createCapturingFetch>
    ) => {
      const ai = new AxBaseAI(impl, {
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
        models: [
          { key: 'model1', model: 'test-model-1', description: 'Test Model 1' },
        ],
        supportFor: {
          functions: true,
          streaming: false,
          media: {
            images: { supported: false, formats: [] },
            audio: { supported: false, formats: [] },
            files: { supported: false, formats: [], uploadMethod: 'none' },
            urls: {
              supported: false,
              webSearch: false,
              contextFetching: false,
            },
          },
          caching: {
            supported: true,
            types: ['persistent'],
          },
          thinking: false,
          multiTurn: true,
        },
      });
      ai.setOptions({ fetch, tracer: mockTracer as any });
      return ai;
    };

    it('reuses the same cache when cached tools and function config match', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        {},
      ]);
      const impl = createCacheAwareImpl();
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const req = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'hello' },
        ],
        functions: [
          { name: 'search', description: 'search', cache: true },
          { name: 'route', description: 'route' },
        ],
        functionCall: {
          type: 'function' as const,
          function: { name: 'route' },
        },
      };

      await ai.chat(req, {
        stream: false,
        contextCache: { minTokens: 0, registry },
      });
      await ai.chat(req, {
        stream: false,
        contextCache: { minTokens: 0, registry },
      });

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(1);
      expect(impl.prepareCachedChatReq).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(1);
      expect(capture.calls).toHaveLength(3);
    });

    it('creates distinct caches when cached tool state differs', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        { name: 'cache-2', expireTime: '2099-01-01T00:00:00Z' },
        {},
      ]);
      const impl = createCacheAwareImpl();
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const baseReq = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'hello' },
        ],
      };

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'search', description: 'search', cache: true },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: { minTokens: 0, registry },
        }
      );

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'searchV2', description: 'search', cache: true },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: { minTokens: 0, registry },
        }
      );

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(2);
      expect(capture.calls).toHaveLength(4);
    });

    it('reuses the same system-only cache when only request-time tools differ', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        {},
      ]);
      const impl = createCacheAwareImpl();
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const baseReq = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'hello' },
        ],
      };

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'search', description: 'search' },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'searchV2', description: 'search' },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(1);
      expect(impl.prepareCachedChatReq).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(1);
      expect(capture.calls).toHaveLength(3);
    });

    it('creates distinct system caches when provider-declared cached tool state differs', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        { name: 'cache-2', expireTime: '2099-01-01T00:00:00Z' },
        {},
      ]);
      const impl = {
        ...createCacheAwareImpl(),
        getContextCacheToolState: vi.fn((req) => ({
          functions: req.functions,
          functionCall: req.functionCall,
        })),
      };
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const baseReq = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'hello' },
        ],
      };

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'search', description: 'search' },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      await ai.chat(
        {
          ...baseReq,
          functions: [
            { name: 'searchV2', description: 'search' },
            { name: 'route', description: 'route' },
          ],
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(2);
      expect(capture.calls).toHaveLength(4);
    });

    it('creates distinct system caches when provider-declared function-call config differs', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        { name: 'cache-2', expireTime: '2099-01-01T00:00:00Z' },
        {},
      ]);
      const impl = {
        ...createCacheAwareImpl(),
        getContextCacheToolState: vi.fn((req) => ({
          functions: req.functions,
          functionCall: req.functionCall,
        })),
      };
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const baseReq = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'hello' },
        ],
        functions: [
          { name: 'search', description: 'search' },
          { name: 'route', description: 'route' },
        ],
      };

      await ai.chat(
        {
          ...baseReq,
          functionCall: {
            type: 'function' as const,
            function: { name: 'route' },
          },
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      await ai.chat(
        {
          ...baseReq,
          functionCall: 'auto' as const,
        },
        {
          stream: false,
          contextCache: {
            minTokens: 0,
            cacheBreakpoint: 'system',
            registry,
          },
        }
      );

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(2);
      expect(capture.calls).toHaveLength(4);
    });

    it('creates distinct caches when cached function-style example content differs', async () => {
      const capture = { calls: [] as Array<{ url: string; body?: any }> };
      const fetch = createCapturingFetch(capture, [
        { name: 'cache-1', expireTime: '2099-01-01T00:00:00Z' },
        {},
        { name: 'cache-2', expireTime: '2099-01-01T00:00:00Z' },
        {},
      ]);
      const impl = createCacheAwareImpl();
      const ai = createCacheAwareAI(impl, fetch);

      const registryData = new Map<string, any>();
      const registry = {
        get: vi.fn(async (key: string) => registryData.get(key)),
        set: vi.fn(async (key: string, value: unknown) => {
          registryData.set(key, value);
        }),
      };

      const baseReq = {
        chatPrompt: [
          { role: 'system' as const, content: 'system', cache: true },
          { role: 'user' as const, content: 'Example question' },
          {
            role: 'assistant' as const,
            functionCalls: [
              {
                id: 'example-0',
                type: 'function' as const,
                function: {
                  name: '__finalResult',
                  params: { answer: 'Use search' },
                },
              },
            ],
          },
          {
            role: 'function' as const,
            functionId: 'example-0',
            result: 'done',
            cache: true,
          },
          { role: 'user' as const, content: 'Live question' },
        ],
      };

      await ai.chat(baseReq, {
        stream: false,
        contextCache: { minTokens: 0, registry },
      });

      await ai.chat(
        {
          chatPrompt: [
            baseReq.chatPrompt[0]!,
            baseReq.chatPrompt[1]!,
            {
              role: 'assistant' as const,
              functionCalls: [
                {
                  id: 'example-0',
                  type: 'function' as const,
                  function: {
                    name: '__finalResult',
                    params: { answer: 'Use database lookup' },
                  },
                },
              ],
            },
            baseReq.chatPrompt[3]!,
            baseReq.chatPrompt[4]!,
          ],
        },
        {
          stream: false,
          contextCache: { minTokens: 0, registry },
        }
      );

      expect(impl.buildCacheCreateOp).toHaveBeenCalledTimes(2);
      expect(registry.set).toHaveBeenCalledTimes(2);
      expect(capture.calls).toHaveLength(4);
    });
  });
});
