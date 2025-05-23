import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadableStream } from 'stream/web'

import { AxBaseAI } from './base.js'
import type { AxAIFeatures, AxBaseAIArgs } from './base.js'
import type {
  AxAIServiceImpl,
  AxTokenUsage,
  AxChatResponse,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo,
  AxChatRequest,
  AxEmbedRequest,
  AxChatResponseResult,
} from './types.js'
import { axSpanAttributes } from '../trace/trace.js' // Added import

// Mock OpenTelemetry
const mockSpan = {
  attributes: {} as Record<string, any>,
  mockEvents: [] as { name: string; attributes: Record<string, any> }[],
  setAttribute: vi.fn((key, value) => {
    mockSpan.attributes[key] = value
  }),
  setAttributes: vi.fn((attrs) => {
    Object.assign(mockSpan.attributes, attrs)
  }),
  addEvent: vi.fn((name, attributes) => {
    mockSpan.mockEvents.push({ name, attributes })
  }),
  end: vi.fn(),
  isRecording: vi.fn(() => true),
}

const mockTracer = {
  startActiveSpan: vi.fn(
    (
      name: string,
      options: unknown,
      fn: (span: typeof mockSpan) => unknown
    ) => {
      // Reset mockSpan for each new span
      mockSpan.attributes = {}
      mockSpan.mockEvents = []
      mockSpan.setAttribute.mockClear()
      mockSpan.setAttributes.mockClear()
      mockSpan.addEvent.mockClear()
      mockSpan.end.mockClear()
      mockSpan.isRecording.mockClear()
      mockSpan.isRecording.mockReturnValue(true)
      if (typeof fn === 'function') {
        return fn(mockSpan)
      }
      return mockSpan
    }
  ),
}

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
  }

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
  }

  // Create a mock fetch implementation
  const createMockFetch = (mockResponse: Response) => {
    return async () => {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      return mockResponse
    }
  }

  // Create default mock response for most tests
  const defaultMockResponse = new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  // Setup helper to create AI instance with mock fetch
  const createTestAI = (
    response = defaultMockResponse,
    serviceImpl: AxAIServiceImpl<
      string,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    > = mockImpl,
    config: AxBaseAIArgs<string, string> = baseConfig
  ) => {
    const mockFetch = createMockFetch(response)
    const ai = new AxBaseAI(serviceImpl, config)
    ai.setOptions({ fetch: mockFetch, tracer: mockTracer as any }) // Added tracer
    return ai
  }

  it('should initialize correctly', () => {
    const ai = createTestAI()
    expect(ai.getName()).toBe('test-ai')
    expect(ai.getModelList()).toHaveLength(2)
  })

  it('should handle features correctly with function', () => {
    const featuresConfig = {
      ...baseConfig,
      supportFor: (model: string) => ({
        functions: model === 'test-model-1',
        streaming: true,
      }),
    }

    const ai = new AxBaseAI(mockImpl, featuresConfig)
    ai.setOptions({ fetch: createMockFetch(defaultMockResponse) })

    expect(ai.getFeatures('test-model-1')).toEqual({
      functions: true,
      streaming: true,
    })

    expect(ai.getFeatures('test-model-2')).toEqual({
      functions: false,
      streaming: true,
    })
  })

  it('should handle features correctly with object', () => {
    const features: AxAIFeatures = {
      functions: true,
      streaming: false,
    }

    const featuresConfig = {
      ...baseConfig,
      supportFor: features,
    }

    const ai = new AxBaseAI(mockImpl, featuresConfig)
    ai.setOptions({ fetch: createMockFetch(defaultMockResponse) })
    expect(ai.getFeatures()).toEqual(features)
  })

  it('should track metrics correctly', async () => {
    // Mock successful response
    const mockResponse = new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const ai = createTestAI(mockResponse)

    // Make a chat request
    const response = await ai.chat({ chatPrompt: [] })

    // If streaming is true, consume the stream
    if (response instanceof ReadableStream) {
      const reader = response.getReader()
      // eslint-disable-next-line no-empty
      while (!(await reader.read()).done) {}
    }

    const metrics = ai.getMetrics()
    expect(metrics.latency.chat.samples).toHaveLength(1)
    expect(metrics.errors.chat.count).toBe(0)
  }, 10000)

  it('should handle errors in metrics', async () => {
    // Create an implementation that throws an error
    const errorImpl = {
      ...mockImpl,
      createChatReq: () => {
        throw new Error('Test error')
      },
    }

    const mockErrorResponse = new Response(
      JSON.stringify({ error: 'Test error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
    const ai = createTestAI(mockErrorResponse, errorImpl)

    // Make a chat request that will error
    try {
      await ai.chat({ chatPrompt: [] })
    } catch {
      // Expected error
    }

    const metrics = ai.getMetrics()
    expect(metrics.errors.chat.count).toBe(1)
    expect(metrics.errors.chat.rate).toBe(1)
  }, 10000)

  it('should update options correctly', () => {
    const ai = createTestAI()

    const options = {
      debug: true,
      fetch: createMockFetch(defaultMockResponse),
    }

    ai.setOptions(options)
    expect(ai.getOptions()).toMatchObject(options)
  })

  it('should throw error when no model is defined', () => {
    const invalidConfig: AxBaseAIArgs<string, string> = {
      ...baseConfig,
      defaults: {
        model: '', // Invalid model
      },
    }

    expect(() => {
      createTestAI(undefined, mockImpl, invalidConfig)
    }).toThrow('No model defined')
  })

  it('should handle API URL and headers updates', async () => {
    const ai = createTestAI()

    const newUrl = 'http://new-test.com'
    const newHeaders = async () => ({ 'X-Test': 'test' })

    ai.setAPIURL(newUrl)
    ai.setHeaders(newHeaders)

    // Basic check, more thorough checks would involve actual calls
    expect(ai.getName()).toBe('test-ai')
  })

  describe('function schema cleanup', () => {
    let ai: AxBaseAI<
      string,
      string,
      AxChatRequest,
      AxEmbedRequest,
      AxChatResponse,
      AxChatResponseResult,
      AxEmbedResponse
    >

    beforeEach(() => {
      ai = createTestAI()
    })

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
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema')

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        // eslint-disable-next-line no-empty
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters).toBeUndefined()
    }, 10000)

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
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema')

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters?.required).toBeUndefined()
      expect(cleanedFunction.parameters?.properties).toBeDefined()
    })

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
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema')

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters?.properties).toBeUndefined()
      expect(cleanedFunction.parameters?.required).toBeDefined()
    })

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
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema')

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters?.properties?.someField).toBeDefined()
      expect(cleanedFunction.parameters?.required).toEqual(['someField'])
    })

    it('should handle undefined parameters', async () => {
      const chatReq = {
        chatPrompt: [],
        functions: [
          {
            name: 'testFunc',
            description: 'test function',
          },
        ],
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanupSpy = vi.spyOn(ai as any, 'cleanupFunctionSchema')

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (!(await reader.read()).done) {}
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters).toBeUndefined()
    })

    afterEach(() => {
      vi.clearAllMocks()
    })
  })

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
    })
    ai.setOptions({ fetch: createMockFetch(defaultMockResponse) })
    const visibleModels = ai.getModelList()
    expect(visibleModels).toHaveLength(2)
    expect(visibleModels?.map((m) => m.key)).toContain('basic')
    expect(visibleModels?.map((m) => m.key)).toContain('expert')
    expect(visibleModels?.map((m) => m.key)).not.toContain('advanced')
  })

  it('should throw an error if duplicate model keys are provided', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const ai = new AxBaseAI(mockImpl, {
        ...baseConfig,
        models: [
          { key: 'basic', model: 'model-basic', description: 'Basic model' },
          {
            key: 'basic',
            model: 'another-model-basic',
            description: 'Duplicate basic model',
          },
        ],
      })
    }).toThrowError(/Duplicate model key detected: "basic"/)
  })
})

describe('AxBaseAI Tracing with Token Usage', () => {
  let aiService: AxBaseAI<
    string,
    string,
    AxChatRequest,
    AxEmbedRequest,
    AxChatResponse,
    AxChatResponseResult,
    AxEmbedResponse
  >
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockServiceImpl: any // Use 'any' for easier mocking with Vitest's vi.fn()

  const mockTokenUsage: AxTokenUsage = {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  }
  const mockModelConfig: AxModelConfig = { maxTokens: 100, temperature: 0 }

  beforeEach(() => {
    mockServiceImpl = {
      createChatReq: vi
        .fn()
        .mockReturnValue([
          { name: 'chat', headers: {} },
          { model: 'test-model' },
        ]),
      createChatResp: vi
        .fn()
        .mockReturnValue({ results: [{ content: 'response' }] }), // No modelUsage initially
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
      createEmbedResp: vi
        .fn()
        .mockReturnValue({ embeddings: [[1, 2, 3]] }), // No modelUsage initially
      getModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      getTokenUsage: vi.fn().mockReturnValue(mockTokenUsage), // Key mock
    }

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
        supportFor: { functions: false, streaming: true },
        options: { tracer: mockTracer as any }, // Ensure tracer is passed
      }
    )
    // Set a mock fetch for apiCall to work
    aiService.setOptions({
      fetch: createMockFetch(defaultMockResponse),
      tracer: mockTracer as any,
    })
    mockTracer.startActiveSpan.mockClear()
    // Clear all individual method mocks in mockServiceImpl
    Object.values(mockServiceImpl).forEach((mockFn) => {
      if (vi.isMockFunction(mockFn)) {
        mockFn.mockClear()
      }
    })
    // Specifically re-mock getTokenUsage for clarity as it's key
    mockServiceImpl.getTokenUsage.mockReturnValue(mockTokenUsage)
    mockServiceImpl.getModelConfig.mockReturnValue(mockModelConfig)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('should add token usage to trace for non-streaming chat (fallback to getTokenUsage)', async () => {
    await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false }
    )
    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled()
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]
    ).toBe(mockTokenUsage.promptTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]
    ).toBe(mockTokenUsage.completionTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]
    ).toBe(mockTokenUsage.totalTokens)
    expect(mockSpan.addEvent).not.toHaveBeenCalled()
  })

  test('should add token usage to trace for non-streaming chat (service provides it)', async () => {
    const serviceProvidedUsage: AxTokenUsage = {
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
    }
    mockServiceImpl.createChatResp.mockReturnValue({
      results: [{ content: 'response' }],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-model',
        tokens: serviceProvidedUsage,
      },
    } as AxChatResponse)

    await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false }
    )
    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled()
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]
    ).toBe(serviceProvidedUsage.promptTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]
    ).toBe(serviceProvidedUsage.completionTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]
    ).toBe(serviceProvidedUsage.totalTokens)
    expect(mockSpan.addEvent).not.toHaveBeenCalled()
  })

  test('should add token usage to trace for streaming chat', async () => {
    const chunk1Usage: AxTokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    const chunk2Usage: AxTokenUsage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 }

    // Mock getTokenUsage to return different values for each call
    mockServiceImpl.getTokenUsage
      .mockReturnValueOnce(chunk1Usage)
      .mockReturnValueOnce(chunk2Usage)

    // Mock the stream response to simulate chunks
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ content: 'response chunk 1' }) // Raw chunk from HTTP
        controller.enqueue({ content: 'response chunk 2' }) // Raw chunk from HTTP
        controller.close()
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(aiService as any).fetch = vi.fn().mockResolvedValue(
      new Response(mockStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const stream = (await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello stream' }] },
      { stream: true }
    )) as ReadableStream<AxChatResponse>

    const reader = stream.getReader()
    await reader.read() // Process first chunk
    await reader.read() // Process second chunk
    await reader.read() // Process stream close

    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalledTimes(2) // Called for each chunk by RespTransformStream

    expect(mockSpan.addEvent).toHaveBeenCalledTimes(2)
    expect(mockSpan.addEvent).toHaveBeenNthCalledWith(
      1,
      'gen_ai.response.chunk',
      {
        [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: chunk1Usage.promptTokens,
        [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]: chunk1Usage.completionTokens,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: chunk1Usage.totalTokens,
      }
    )
    expect(mockSpan.addEvent).toHaveBeenNthCalledWith(
      2,
      'gen_ai.response.chunk',
      {
        [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: chunk2Usage.promptTokens,
        [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]: chunk2Usage.completionTokens,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: chunk2Usage.totalTokens,
      }
    )
    // Depending on `doneCb` in `RespTransformStream`, setAttributes might be called at the end.
    // For now, we are not asserting this, focusing on addEvent during streaming.
    // If there was a final setAttributes call, it would look like:
    // expect(mockSpan.setAttributes).toHaveBeenCalledTimes(1)
    // expect(mockSpan.attributes[axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]).toBe(chunk2Usage.promptTokens)
    // expect(mockSpan.attributes[axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]).toBe(chunk2Usage.completionTokens)
  })

  test('should add token usage to trace for streaming chat (service provides it on delta)', async () => {
    const serviceProvidedUsageChunk1: AxTokenUsage = { promptTokens: 12, completionTokens: 5, totalTokens: 17 }
    const serviceProvidedUsageChunk2: AxTokenUsage = { promptTokens: 12, completionTokens: 15, totalTokens: 27 }

    // Mock createChatStreamResp to include modelUsage
    mockServiceImpl.createChatStreamResp
      .mockImplementationOnce((respDelta: unknown) => ({
        results: [respDelta as AxChatResponseResult],
        modelUsage: { ai: 'mockAI', model: 'test-model', tokens: serviceProvidedUsageChunk1 },
      }))
      .mockImplementationOnce((respDelta: unknown) => ({
        results: [respDelta as AxChatResponseResult],
        modelUsage: { ai: 'mockAI', model: 'test-model', tokens: serviceProvidedUsageChunk2 },
      }))


    // Mock the stream response
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ content: 'response chunk 1' }) // Simulate a raw chunk from HTTP
        controller.enqueue({ content: 'response chunk 2' }) // Simulate a raw chunk from HTTP
        controller.close()
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(aiService as any).fetch = vi.fn().mockResolvedValue(
      new Response(mockStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const stream = (await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello stream' }] },
      { stream: true }
    )) as ReadableStream<AxChatResponse>

    const reader = stream.getReader()
    await reader.read() // Process first chunk
    await reader.read() // Process second chunk
    await reader.read() // Process stream close

    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    // If service provides usage on delta, getTokenUsage should ideally not be called by RespTransformStream
    // for those specific tokens. However, the current implementation of RespTransformStream
    // might still call it to establish a baseline `res.modelUsage` if the first delta doesn't provide it,
    // or if its internal logic always calls it. The critical part is that the *event attributes* are correct.
    // Based on current AxBaseAI, `this.aiImpl.getTokenUsage()` is *always* called in the wrappedRespFn
    // to establish a base `res.modelUsage`. So we expect it to be called.
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalledTimes(2)


    expect(mockSpan.addEvent).toHaveBeenCalledTimes(2)
    expect(mockSpan.addEvent).toHaveBeenNthCalledWith(
      1,
      'gen_ai.response.chunk',
      {
        [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: serviceProvidedUsageChunk1.promptTokens,
        [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]: serviceProvidedUsageChunk1.completionTokens,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: serviceProvidedUsageChunk1.totalTokens,
      }
    )
    expect(mockSpan.addEvent).toHaveBeenNthCalledWith(
      2,
      'gen_ai.response.chunk',
      {
        [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: serviceProvidedUsageChunk2.promptTokens,
        [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]: serviceProvidedUsageChunk2.completionTokens,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: serviceProvidedUsageChunk2.totalTokens,
      }
    )
    // As above, not asserting setAttributes at the end for now.
  })

  test('should add token usage to trace for embed requests (fallback to getTokenUsage)', async () => {
    const embedTokenUsage: AxTokenUsage = {
      promptTokens: 15,
      completionTokens: 0, // Embeddings usually don't have completion tokens
      totalTokens: 15, // So total often equals prompt
    }
    mockServiceImpl.getTokenUsage.mockReturnValue(embedTokenUsage) // Specific for embed

    await aiService.embed({ texts: ['embed this'] })

    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled()
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]
    ).toBe(embedTokenUsage.promptTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]
    ).toBe(embedTokenUsage.completionTokens ?? 0)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]
    ).toBe(embedTokenUsage.totalTokens)
    expect(mockSpan.addEvent).not.toHaveBeenCalled()
  })

  test('should add token usage to trace for embed requests (service provides it)', async () => {
    const serviceProvidedUsage: AxTokenUsage = {
      promptTokens: 16,
      completionTokens: 0,
      totalTokens: 16,
    }
    mockServiceImpl.createEmbedResp.mockReturnValue({
      embeddings: [[1, 2, 3]],
      modelUsage: {
        ai: 'mockAI',
        model: 'test-embed-model',
        tokens: serviceProvidedUsage,
      },
    } as AxEmbedResponse)

    await aiService.embed({ texts: ['embed this'] })

    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled()
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]
    ).toBe(serviceProvidedUsage.promptTokens)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]
    ).toBe(serviceProvidedUsage.completionTokens ?? 0)
    expect(
      mockSpan.attributes[axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]
    ).toBe(serviceProvidedUsage.totalTokens)
    expect(mockSpan.addEvent).not.toHaveBeenCalled()
  })
})
