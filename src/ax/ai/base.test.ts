import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AxBaseAI } from './base.js'
import type { AxAIFeatures, AxBaseAIArgs } from './base.js'
import type { AxAIServiceImpl } from './types.js'
import type {} from './types.js'

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
      },
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
  const createTestAI = (response = defaultMockResponse) => {
    const mockFetch = createMockFetch(response)
    const ai = new AxBaseAI(mockImpl, baseConfig)
    ai.setOptions({ fetch: mockFetch })
    return ai
  }

  it('should initialize correctly', () => {
    const ai = createTestAI()
    expect(ai.getName()).toBe('test-ai')
    expect(ai.getModelList()).toHaveLength(2)
  })

  it('should handle model info correctly', () => {
    const ai = createTestAI()
    const modelInfo = ai.getModelInfo()

    expect(modelInfo.name).toBe('test-model')
    expect(modelInfo.provider).toBe('test-ai')
    expect(modelInfo.promptTokenCostPer1M).toBe(100)
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

    const mockFetch = createMockFetch(mockResponse)
    const ai = new AxBaseAI(mockImpl, baseConfig)
    ai.setOptions({ fetch: mockFetch })

    // Make a chat request
    const response = await ai.chat({ chatPrompt: [] })

    // If streaming is true, consume the stream
    if (response instanceof ReadableStream) {
      const reader = response.getReader()
      let attempts = 0
      const maxAttempts = 10

      while (attempts < maxAttempts) {
        const { done } = await reader.read()
        if (done) break
        attempts++
      }
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

    const mockFetch = createMockFetch(mockErrorResponse)
    const ai = new AxBaseAI(errorImpl, baseConfig)
    ai.setOptions({ fetch: mockFetch })

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
    const invalidConfig = {
      ...baseConfig,
      defaults: {
        model: '',
      },
    }

    expect(() => {
      const ai = new AxBaseAI(mockImpl, invalidConfig)
      ai.setOptions({ fetch: createMockFetch(defaultMockResponse) })
    }).toThrow('No model defined')
  })

  it('should handle API URL and headers updates', async () => {
    const ai = createTestAI()

    const newUrl = 'http://new-test.com'
    const newHeaders = async () => ({ 'X-Test': 'test' })

    ai.setAPIURL(newUrl)
    ai.setHeaders(newHeaders)

    expect(ai.getName()).toBe('test-ai')
  })

  describe('function schema cleanup', () => {
    let ai: AxBaseAI<
      string,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
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

      const cleanupSpy = vi.spyOn(
        ai as unknown,
        'cleanupFunctionSchema' as never
      )

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        let attempts = 0
        const maxAttempts = 10

        while (attempts < maxAttempts) {
          const { done } = await reader.read()
          if (done) break
          attempts++
        }
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters).toBeUndefined()
    }, 10000)

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

      const cleanupSpy = vi.spyOn(
        ai as unknown,
        'cleanupFunctionSchema' as never
      )

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
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

      const cleanupSpy = vi.spyOn(
        ai as unknown,
        'cleanupFunctionSchema' as never
      )

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
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

      const cleanupSpy = vi.spyOn(
        ai as unknown,
        'cleanupFunctionSchema' as never
      )

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
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

      const cleanupSpy = vi.spyOn(
        ai as unknown,
        'cleanupFunctionSchema' as never
      )

      const response = await ai.chat(chatReq)
      if (response instanceof ReadableStream) {
        const reader = response.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }

      expect(cleanupSpy).toHaveBeenCalled()
      const cleanedFunction = cleanupSpy.mock.results?.[0]?.value
      expect(cleanedFunction.parameters).toBeUndefined()
    })

    afterEach(() => {
      vi.clearAllMocks()
    })
  })
})
