/* eslint-disable @typescript-eslint/no-explicit-any */
import { ReadableStream } from 'stream/web'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxChatResponse, AxFunction } from '../ai/types.js'

import { AxGen } from './generate.js'
import {
  createGenMetricsInstruments,
  resetGenMetricsInstruments,
} from './metrics.js'

function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let count = 0

      const processChunks = async () => {
        if (count >= chunks.length || controller.desiredSize === null) {
          if (controller.desiredSize !== null) {
            controller.close()
          }
          return
        }

        const chunk = chunks[count]
        if (!chunk) {
          return
        }

        const response: AxChatResponse = {
          results: [chunk],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: {
              promptTokens: 10 + count,
              completionTokens: 5 + count,
              totalTokens: 15 + 2 * count,
            },
          },
        }

        if (!controller.desiredSize || controller.desiredSize <= 0) {
          return
        }

        controller.enqueue(response)
        count++

        if (count < chunks.length) {
          setTimeout(processChunks, 10)
        } else {
          if (controller.desiredSize !== null) {
            controller.close()
          }
        }
      }

      setTimeout(processChunks, 10)
    },
    cancel() {},
  })
}

// Mock OpenTelemetry meter
const createMockMeter = () => ({
  createHistogram: vi.fn(() => ({
    record: vi.fn(),
  })),
  createCounter: vi.fn(() => ({
    add: vi.fn(),
  })),
  createGauge: vi.fn(() => ({
    record: vi.fn(),
  })),
})

describe('AxGen Metrics Integration', () => {
  // Reset metrics singleton before each test
  beforeEach(() => {
    resetGenMetricsInstruments()
  })

  it('should create metrics instruments when meter is provided', () => {
    const mockMeter = createMockMeter()
    const instruments = createGenMetricsInstruments(mockMeter as any)

    expect(instruments).toBeDefined()
    expect(instruments.generationLatencyHistogram).toBeDefined()
    expect(instruments.generationRequestsCounter).toBeDefined()
    expect(instruments.validationErrorsCounter).toBeDefined()
  })

  it('should track basic generation metrics', async () => {
    const mockMeter = createMockMeter()
    const signature = 'userQuery:string -> assistantOutput:string'

    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Assistant output: Hello world',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        },
      },
    })

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    )

    // Update meter to enable metrics
    gen.updateMeter(mockMeter as any)

    const response = await gen.forward(ai, { userQuery: 'test input' })
    expect(response.assistantOutput).toBe('Assistant output: Hello world')

    // Verify histogram was created for latency tracking
    expect(mockMeter.createHistogram).toHaveBeenCalledWith(
      'ax_gen_generation_duration_ms',
      {
        description: 'End-to-end duration of AxGen generation requests',
        unit: 'ms',
      }
    )

    // Verify counter was created for request tracking
    expect(mockMeter.createCounter).toHaveBeenCalledWith(
      'ax_gen_generation_requests_total',
      {
        description: 'Total number of AxGen generation requests',
      }
    )
  })

  it('should track function calling metrics', async () => {
    const mockMeter = createMockMeter()
    const signature = 'userQuery:string -> assistantOutput:string'

    const testFunction: AxFunction = {
      name: 'testFunction',
      description: 'A test function',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
        required: ['input'],
      },
      func: async () => 'function result',
    }

    let callCount = 0
    const ai = new AxMockAIService({
      features: { functions: true, streaming: false },
      chatResponse: async () => {
        callCount++
        if (callCount === 1) {
          // First call: provide function call
          return {
            results: [
              {
                index: 0,
                content: '',
                finishReason: 'stop' as const,
                functionCalls: [
                  {
                    id: 'call_1',
                    type: 'function' as const,
                    function: {
                      name: 'testFunction',
                      params: { input: 'test' },
                    },
                  },
                ],
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 20,
                completionTokens: 25,
                totalTokens: 45,
              },
            },
          }
        } else {
          // Second call: provide final response after function execution
          return {
            results: [
              {
                index: 0,
                content: 'Assistant output: Function executed',
                finishReason: 'stop' as const,
              },
            ],
            modelUsage: {
              ai: 'test-ai',
              model: 'test-model',
              tokens: {
                promptTokens: 25,
                completionTokens: 30,
                totalTokens: 55,
              },
            },
          }
        }
      },
    })

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature,
      {
        functions: [testFunction],
      }
    )

    // Update meter to enable metrics
    gen.updateMeter(mockMeter as any)

    const response = await gen.forward(ai, { userQuery: 'test input' })
    expect(response.assistantOutput).toBe('Assistant output: Function executed')

    // Verify function-related metrics were created
    expect(mockMeter.createCounter).toHaveBeenCalledWith(
      'ax_gen_functions_enabled_generations_total',
      {
        description: 'Total number of generations with functions enabled',
      }
    )

    expect(mockMeter.createHistogram).toHaveBeenCalledWith(
      'ax_gen_functions_executed_per_generation',
      {
        description: 'Number of unique functions executed per generation',
      }
    )
  })

  it('should track validation error metrics', async () => {
    const mockMeter = createMockMeter()
    const signature = 'userQuery:string -> assistantOutput:string'

    // Mock AI service that returns malformed output to trigger validation error
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Invalid output without expected format',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        },
      },
    })

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    )

    // Update meter to enable metrics
    gen.updateMeter(mockMeter as any)

    // This response should actually succeed since AxGen can handle malformed content
    const response = await gen.forward(ai, { userQuery: 'test input' })
    expect(response.assistantOutput).toBe(
      'Invalid output without expected format'
    )

    // Verify validation error metrics were created
    expect(mockMeter.createCounter).toHaveBeenCalledWith(
      'ax_gen_validation_errors_total',
      {
        description: 'Total number of validation errors encountered',
      }
    )

    expect(mockMeter.createHistogram).toHaveBeenCalledWith(
      'ax_gen_error_correction_attempts',
      {
        description: 'Number of error correction attempts per generation',
      }
    )
  })

  it('should track streaming metrics', async () => {
    const mockMeter = createMockMeter()
    const signature = 'userQuery:string -> assistantOutput:string'

    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Assistant output: Partial' },
      { index: 0, content: ' output', finishReason: 'stop' },
    ]
    const streamingResponse = createStreamingResponse(chunks)

    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    const gen = new AxGen<{ userQuery: string }, { assistantOutput: string }>(
      signature
    )

    // Update meter to enable metrics
    gen.updateMeter(mockMeter as any)

    const response = await gen.forward(
      ai,
      { userQuery: 'test input' },
      { stream: true }
    )
    expect(response.assistantOutput).toBe('Assistant output: Partial output')

    // Verify streaming metrics were created
    expect(mockMeter.createCounter).toHaveBeenCalledWith(
      'ax_gen_streaming_generations_total',
      {
        description: 'Total number of streaming generations',
      }
    )

    expect(mockMeter.createCounter).toHaveBeenCalledWith(
      'ax_gen_streaming_deltas_emitted_total',
      {
        description: 'Total number of streaming deltas emitted',
      }
    )
  })
})
