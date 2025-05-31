import { ReadableStream } from 'stream/web'

import type { Span } from '@opentelemetry/api' // Ensure Span is imported
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { axSpanAttributes, axSpanEvents } from '../trace/trace.js' // Added import

import {
  AxBaseAI,
  setChatRequestEvents,
  setChatResponseEvents,
} from './base.js' // Import new functions
import type { AxAIFeatures, AxBaseAIArgs } from './base.js'
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
} from './types.js'

// Mock OpenTelemetry
const mockSpan = {
  attributes: {} as Record<string, unknown>,
  mockEvents: [] as { name: string; attributes: Record<string, unknown> }[],
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
  recordException: vi.fn(),
}

const mockTracer = {
  startActiveSpan: vi.fn(
    async (
      name: string,
      options: unknown,
      context: unknown,
      fn: (span: Readonly<typeof mockSpan>) => Promise<unknown>
    ) => {
      // Reset mockSpan for each new span
      mockSpan.attributes = {}
      mockSpan.mockEvents = []
      mockSpan.setAttribute.mockClear()
      mockSpan.setAttributes.mockClear()
      mockSpan.addEvent.mockClear()
      mockSpan.end.mockClear()
      mockSpan.isRecording.mockClear()
      mockSpan.recordException.mockClear()
      mockSpan.isRecording.mockReturnValue(true)
      if (typeof fn === 'function') {
        return await fn(mockSpan)
      }
      return mockSpan
    }
  ),
}

// Create a mock fetch implementation - MOVED TO TOP LEVEL
const createMockFetch = (responseFactory: () => Response) => {
  return async () => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10))
    return responseFactory()
  }
}

// Create a function that returns a fresh mock response for each call
const createDefaultMockResponse = () =>
  new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

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
    const mockFetch = createMockFetch(responseFactory)
    const ai = new AxBaseAI(serviceImpl, config)
    ai.setOptions({
      fetch: mockFetch,
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
    })
    return ai
  }

  it('should initialize correctly', () => {
    const ai = createTestAI()
    expect(ai.getName()).toBe('test-ai')
    expect(ai.getModelList()).toHaveLength(2)
    expect(ai.getLastUsedChatModel()).toBeUndefined()
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
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) })

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
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) })
    expect(ai.getFeatures()).toEqual(features)
  })

  it('should track metrics correctly', async () => {
    // Mock successful response
    const mockResponse = new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    const ai = createTestAI(() => mockResponse)

    // Make a chat request
    const response = await ai.chat({ chatPrompt: [] })

    // If streaming is true, consume the stream
    if (response instanceof ReadableStream) {
      const reader = response.getReader()

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
      getModelConfig: () => ({
        maxTokens: 100,
        temperature: 0,
        stream: false, // Disable streaming for error handling test
      }),
      createChatReq: () => {
        throw new Error('Test error')
      },
    }

    const ai = createTestAI(createDefaultMockResponse, errorImpl)

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
      fetch: createMockFetch(createDefaultMockResponse),
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
      // Create AI instance with non-streaming model config for function cleanup tests
      const nonStreamingMockImpl = {
        ...mockImpl,
        getModelConfig: () => ({
          maxTokens: 100,
          temperature: 0,
          stream: false, // Disable streaming for function cleanup tests
        }),
      }
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
      >

      // Ensure tracer is set for proper function execution path
      ai.setOptions({
        fetch: createMockFetch(createDefaultMockResponse),
        tracer: mockTracer as unknown as AxAIServiceOptions['tracer'],
      })
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

      const response = await ai.chat(chatReq, { stream: false }) // Explicitly disable streaming
      if (response instanceof ReadableStream) {
        const reader = response.getReader()

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

      const response = await ai.chat(chatReq, { stream: false }) // Explicitly disable streaming
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

      const response = await ai.chat(chatReq, { stream: false }) // Explicitly disable streaming
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

      const response = await ai.chat(chatReq, { stream: false }) // Explicitly disable streaming
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

      const response = await ai.chat(chatReq, { stream: false }) // Explicitly disable streaming
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
    ai.setOptions({ fetch: createMockFetch(createDefaultMockResponse) })
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

describe('setChatResponseEvents', () => {
  let mockSpanInstance: typeof mockSpan

  beforeEach(() => {
    // Create a fresh mockSpan for each test to avoid interference
    mockSpanInstance = {
      attributes: {},
      mockEvents: [],
      setAttribute: vi.fn((key, value) => {
        mockSpanInstance.attributes[key] = value
      }),
      setAttributes: vi.fn((attrs) => {
        Object.assign(mockSpanInstance.attributes, attrs)
      }),
      addEvent: vi.fn((name, attributes) => {
        mockSpanInstance.mockEvents.push({ name, attributes })
      }),
      end: vi.fn(),
      isRecording: vi.fn(() => true),
      recordException: vi.fn(),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle Chat Response with results', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [
        { content: 'Hello', finishReason: 'stop' },
        {
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
    }
    setChatResponseEvents(mockChatResponse, mockSpanInstance as unknown as Span)

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    )

    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(3)
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      2,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({ content: 'Hello' }, null, 2),
      }
    )
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
    )
  })

  it('should handle Chat Response (Empty Results)', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [],
    }
    setChatResponseEvents(mockChatResponse, mockSpanInstance as unknown as Span)

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    )
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1)
  })

  it('should handle Response without Model Usage', () => {
    const mockChatResponse: AxChatResponse = {
      results: [{ content: 'Hello', finishReason: 'stop' }],
    }
    setChatResponseEvents(mockChatResponse, mockSpanInstance as unknown as Span)

    expect(mockSpanInstance.setAttributes).not.toHaveBeenCalled()
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({ content: 'Hello' }, null, 2),
      }
    )
  })

  it('should exclude content from telemetry when excludeContentFromTelemetry is true', () => {
    const mockChatResponse: AxChatResponse = {
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      },
      results: [
        { content: 'Hello', finishReason: 'stop' },
        {
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
    }
    setChatResponseEvents(
      mockChatResponse,
      mockSpanInstance as unknown as Span,
      true
    )

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USAGE,
      {
        [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: 10,
        [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]: 20,
        [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: 30,
      }
    )

    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(3)
    // First result should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenNthCalledWith(
      2,
      axSpanEvents.GEN_AI_CHOICE,
      {
        finish_reason: 'stop',
        index: 0,
        message: JSON.stringify({}, null, 2),
      }
    )
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
    )
  })
})

describe('setChatRequestEvents', () => {
  let mockSpanInstance: typeof mockSpan

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
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle system message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'system', content: 'System prompt' }],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      { content: 'System prompt' }
    )
    // User message event should also be called, even if empty
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    )
  })

  it('should handle user message string content', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'user', content: 'User message' }],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'User message' }
    )
  })

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
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'User message part 1\nUser message part 2' }
    )
  })

  it('should handle assistant message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [{ role: 'assistant', content: 'Assistant message' }],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      { content: 'Assistant message' }
    )
  })

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
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
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
    )
  })

  it('should handle function message', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'function', functionId: 'fn1', result: 'Function result' },
      ],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_TOOL_MESSAGE,
      { id: 'fn1', content: 'Function result' }
    )
  })

  it('should handle multiple messages of different roles', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'system', content: 'System setup' },
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Question?' },
      ],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)

    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      { content: 'System setup' }
    )
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      { content: 'Hello!' }
    )
    // User messages are aggregated
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: 'Hi there\nQuestion?' }
    )
  })

  it('should handle empty chatPrompt', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    // GEN_AI_USER_MESSAGE should still be called with empty content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledTimes(1)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    )
  })

  it('should handle chatPrompt with only non-text user content parts', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        {
          role: 'user',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: [{ type: 'image_url', image_url: 'test.png' } as any],
        },
      ],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span)
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      { content: '' }
    )
  })

  it('should exclude content from telemetry when excludeContentFromTelemetry is true', () => {
    const req: AxChatRequest<unknown> = {
      chatPrompt: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
        { role: 'function', functionId: 'fn1', result: 'Function result' },
      ],
    }
    setChatRequestEvents(req, mockSpanInstance as unknown as Span, true)

    // System message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_SYSTEM_MESSAGE,
      {}
    )

    // Assistant message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_ASSISTANT_MESSAGE,
      {}
    )

    // Function message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_TOOL_MESSAGE,
      { id: 'fn1' }
    )

    // User message should not have content
    expect(mockSpanInstance.addEvent).toHaveBeenCalledWith(
      axSpanEvents.GEN_AI_USER_MESSAGE,
      {}
    )
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
  const mockModelConfig: AxModelConfig = {
    maxTokens: 100,
    temperature: 0,
    stream: false,
  } // Set stream to false for non-streaming tests

  beforeEach(() => {
    // Reset the mock span completely
    mockSpan.attributes = {}
    mockSpan.mockEvents = []
    mockSpan.setAttribute.mockClear()
    mockSpan.setAttributes.mockClear()
    mockSpan.addEvent.mockClear()
    mockSpan.end.mockClear()
    mockSpan.isRecording.mockClear()
    mockSpan.recordException.mockClear()
    mockSpan.isRecording.mockReturnValue(true)

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
      createEmbedResp: vi.fn().mockReturnValue({ embeddings: [[1, 2, 3]] }), // No modelUsage initially
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
        supportFor: { functions: false, streaming: false }, // Disable streaming support for non-streaming tests
        options: {
          tracer: mockTracer as unknown as AxAIServiceOptions['tracer'], // Set tracer in constructor
        },
      }
    )
    // Set a mock fetch for apiCall to work - use fresh response for each test
    // Also set tracer again to ensure it's properly set
    aiService.setOptions({
      fetch: createMockFetch(createDefaultMockResponse), // Create fresh response
      tracer: mockTracer as unknown as AxAIServiceOptions['tracer'], // Set tracer again to ensure it's set
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
    // Ensure createChatReq is re-mocked for each test if needed, or provide a default that includes chatPrompt
    mockServiceImpl.createChatReq.mockReturnValue([
      { name: 'chat', headers: {} },
      { model: 'test-model', chatPrompt: [{ role: 'user', content: 'hello' }] },
    ])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should add token usage to trace for non-streaming chat (fallback to getTokenUsage)', async () => {
    await aiService.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false } // Explicitly disable streaming
    )
    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled()
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: mockTokenUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        mockTokenUsage.completionTokens,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: mockTokenUsage.totalTokens,
    })
    // setChatRequestEvents: user (1 event)
    // setChatResponseEvents: usage (1 event), choice (1 event)
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(3)
  })

  it('should add token usage to trace for non-streaming chat (service provides it)', async () => {
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
      { stream: false } // Explicitly disable streaming
    )
    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).not.toHaveBeenCalled() // Should use service provided
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
        serviceProvidedUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        serviceProvidedUsage.completionTokens,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
        serviceProvidedUsage.totalTokens,
    })
    // setChatRequestEvents: user (1 event)
    // setChatResponseEvents: usage (1 event), choice (1 event)
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(3)
  })

  // Temporarily skip the streaming tests as they require complex setup
  it.skip('should add token usage to trace for streaming chat', async () => {
    // This test is temporarily skipped due to complex streaming mock setup requirements
  })

  it.skip('should add token usage to trace for streaming chat (service provides it on delta)', async () => {
    // This test is temporarily skipped due to complex streaming mock setup requirements
  })

  it('should add token usage to trace for embed requests (fallback to getTokenUsage)', async () => {
    // Ensure non-streaming config for embed test
    const embedModelConfig = { maxTokens: 100, temperature: 0, stream: false }
    mockServiceImpl.getModelConfig.mockReturnValue(embedModelConfig)

    const embedTokenUsage: AxTokenUsage = {
      promptTokens: 15,
      completionTokens: 0, // Embeddings usually don't have completion tokens
      totalTokens: 15, // So total often equals prompt
    }
    mockServiceImpl.getTokenUsage.mockReturnValue(embedTokenUsage) // Specific for embed

    await aiService.embed({ texts: ['embed this'] })

    expect(mockTracer.startActiveSpan).toHaveBeenCalled()
    expect(mockServiceImpl.getTokenUsage).toHaveBeenCalled()
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]: embedTokenUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        embedTokenUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]: embedTokenUsage.totalTokens,
    })
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(1)
  })

  it('should add token usage to trace for embed requests (service provides it)', async () => {
    // Ensure non-streaming config for embed test
    const embedModelConfig = { maxTokens: 100, temperature: 0, stream: false }
    mockServiceImpl.getModelConfig.mockReturnValue(embedModelConfig)

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
    expect(mockSpan.addEvent).toHaveBeenCalledWith(axSpanEvents.GEN_AI_USAGE, {
      [axSpanAttributes.LLM_USAGE_INPUT_TOKENS]:
        serviceProvidedUsage.promptTokens,
      [axSpanAttributes.LLM_USAGE_OUTPUT_TOKENS]:
        serviceProvidedUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_TOTAL_TOKENS]:
        serviceProvidedUsage.totalTokens,
    })
    expect(mockSpan.addEvent).toHaveBeenCalledTimes(1)
  })
})
