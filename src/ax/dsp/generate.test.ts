import { ReadableStream } from 'stream/web'

import { describe, expect, it } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxChatResponse } from '../ai/types.js'

import { AxGen } from './generate.js'
import type { AxProgramForwardOptions } from './program.js'
import type { AxSignature } from './sig.js'

function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream({
    start(controller) {
      let count = 0

      const processChunks = async () => {
        if (count >= chunks.length) {
          controller.close()
          return
        }

        const chunk = chunks[count]
        if (chunk) {
          try {
            controller.enqueue({
              results: [
                {
                  content: chunk.content,
                  thought: chunk.thought,
                  finishReason: chunk.finishReason,
                },
              ],
              modelUsage: {
                ai: 'test-ai',
                model: 'test-model',
                tokens: {
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: 0,
                },
              },
            })
            count++

            // Use Promise-based delay instead of setTimeout
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 100 + 10)
            )
            processChunks() // Process next chunk immediately after delay
          } catch (error) {
            controller.error(error)
          }
        }
      }

      // Start processing chunks
      processChunks().catch((error) => {
        controller.error(error)
      })
    },

    cancel() {},
  })
}

describe('AxGen forward and streamingForward', () => {
  const signature = 'input:string -> output:string'

  it('should return non-streaming output from forward when stream option is false', async () => {
    // Prepare a non-streaming (plain) response.
    const nonStreamingResponse: AxChatResponse = {
      results: [
        { content: 'Output: Non-stream response', finishReason: 'stop' },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    }
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: nonStreamingResponse,
    })

    const gen = new AxGen<{ input: string }, { output: string }>(signature)
    // Call forward with stream disabled.
    const response = await gen.forward(ai, { input: 'test' }, { stream: false })
    expect(response).toEqual({ output: 'Non-stream response' })
  })

  it('should return aggregated output from forward when stream option is true', async () => {
    // Prepare a streaming response that enqueues three chunks with a timer.
    const chunks: AxChatResponse['results'] = [
      { content: 'Output: chunk 1 ' },
      { content: 'chunk 2 ' },
      { content: 'chunk 3', finishReason: 'stop' },
    ]
    const streamingResponse = createStreamingResponse(chunks)
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      // Provide chatResponse as a function that accepts request params and returns the stream
      chatResponse: streamingResponse,
    })

    const gen = new AxGen<{ input: string }, { output: string }>(signature)
    // Call forward with stream enabled.
    // Even though the underlying AI service streams, forward() aggregates
    // the chunks and returns an object.
    const response = await gen.forward(ai, { input: 'test' }, { stream: true })
    expect(response).toBeDefined()
    expect(response.output).toContain('chunk 1')
    expect(response.output).toContain('chunk 2')
    expect(response.output).toContain('chunk 3')
  })
})

describe('AxProgramForwardOptions types', () => {
  it('should allow "disable" as a value for thinkingTokenBudget', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      thinkingTokenBudget: 'none',
    }
    // If this compiles, the type test passes implicitly.
    // We can add a simple assertion to make the test explicit.
    expect(options.thinkingTokenBudget).toBe('none')
  })

  it('should allow other valid values for thinkingTokenBudget', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      thinkingTokenBudget: 'minimal',
    }
    expect(options.thinkingTokenBudget).toBe('minimal')
  })

  it('should allow showThoughts option', () => {
    const options: AxProgramForwardOptions = {
      ai: new AxMockAIService({
        features: { functions: false, streaming: false },
      }), // Mock AI service
      showThoughts: true,
    }
    expect(options.showThoughts).toBe(true)
  })
})

describe('AxGen thoughtFieldName', () => {
  const signature = 'input:string -> output:string'

  it('should return thought with custom field name when thoughtFieldName is provided', async () => {
    // Mock AI service to return a response with a thought
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            thought: 'This is a custom thought.',
            content: 'Output: Test output',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    })

    const gen = new AxGen<
      { input: string },
      { output: string; customThought?: string }
    >(signature, { thoughtFieldName: 'customThought' })
    const response = await gen.forward(ai, { input: 'test' })
    expect(response).toEqual({
      output: 'Test output',
      customThought: 'This is a custom thought.',
    })
  })

  it('should return thought with default field name "thought" when thoughtFieldName is not provided', async () => {
    // Mock AI service
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            thought: 'This is a default thought.',
            content: 'Output: Test output',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        },
      },
    })

    const gen = new AxGen<
      { input: string },
      { output: string; thought?: string }
    >(signature)
    const response = await gen.forward(ai, { input: 'test' })
    expect(response).toEqual({
      output: 'Test output',
      thought: 'This is a default thought.',
    })
  })

  it('should stream thought with custom field name when thoughtFieldName is provided', async () => {
    const chunks: AxChatResponse['results'] = [
      { thought: 'Thinking...' },
      { content: 'Output: chunk 1 ' },
      { thought: 'Still thinking...' },
      { content: 'chunk 2 ' },
      { content: 'chunk 3', finishReason: 'stop' },
    ]
    const streamingResponse = createStreamingResponse(chunks)
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    const gen = new AxGen<
      { input: string },
      { output: string; customThought?: string }
    >(signature, { thoughtFieldName: 'customThought' })

    const results: Array<Record<string, string>> = []
    const stream = gen.streamingForward(ai, { input: 'test' })

    for await (const res of stream) {
      results.push(res.delta)
    }

    expect(results).toContainEqual({ customThought: 'Thinking...' })
    expect(results).toContainEqual({ output: 'chunk 1' })
    expect(results).toContainEqual({ customThought: 'Still thinking...' })
    expect(results).toContainEqual({ output: ' chunk 2' })
    expect(results).toContainEqual({ output: ' chunk 3' })
  })

  it('should stream thought with default field name "thought" when thoughtFieldName is not provided', async () => {
    const chunks: AxChatResponse['results'] = [
      { thought: 'Thinking...' },
      { content: 'Output: chunk 1 ' },
      { thought: 'Still thinking...' },
      { content: 'chunk 2 ' },
      { content: 'chunk 3', finishReason: 'stop' },
    ]
    const streamingResponse = createStreamingResponse(chunks)
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    const gen = new AxGen<
      { input: string },
      { output: string; thought?: string }
    >(signature)

    const results: Array<Record<string, string>> = []
    const stream = gen.streamingForward(ai, { input: 'test' })

    for await (const res of stream) {
      results.push(res.delta)
    }

    expect(results).toContainEqual({ thought: 'Thinking...' })
    expect(results).toContainEqual({ output: 'chunk 1' })
    expect(results).toContainEqual({ thought: 'Still thinking...' })
    expect(results).toContainEqual({ output: ' chunk 2' })
    expect(results).toContainEqual({ output: ' chunk 3' })
  })
})

describe('AxGen forward and streamingForward with multiple outputs', () => {
  it('should return non-streaming output for a signature with two outputs when stream option is false', async () => {
    // Prepare a non-streaming response that contains two outputs.
    const nonStreamingResponse: AxChatResponse = {
      results: [
        {
          content:
            'Output 1: Non-stream response 1\nOutput 2: Non-stream response 2',
          finishReason: 'stop',
        },
      ],
      modelUsage: {
        ai: 'test-ai',
        model: 'test-model',
        tokens: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      },
    }
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: nonStreamingResponse,
    })

    // Define a signature with two outputs.
    const signature = 'input:string -> output1:string, output2:string'
    const gen = new AxGen<
      { input: string },
      { output1: string; output2: string }
    >(signature)

    // Call forward with stream disabled.
    const response = await gen.forward(ai, { input: 'test' }, { stream: false })
    expect(response).toEqual({
      output1: 'Non-stream response 1',
      output2: 'Non-stream response 2',
    })
  })

  it('should return aggregated output from forward for a signature with three outputs when stream option is true', async () => {
    // Prepare a streaming response with three outputs.
    const chunks: AxChatResponse['results'] = [
      {
        content: 'Output 1: Streaming part 1',
      },
      {
        content: 'more details for output 1\nOutput 2: Streaming part 2',
      },
      {
        content: 'and additional info\nOutput 3: Streaming part 3',
        finishReason: 'stop',
      },
    ]
    const streamingResponse = createStreamingResponse(chunks)
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    // Define a signature with three outputs.
    const signature =
      'input:string -> output1:string, output2:string, output3:string'
    const gen = new AxGen<
      { input: string },
      { output1: string; output2: string; output3: string }
    >(signature)

    // Call forward with stream enabled.
    const response = await gen.forward(ai, { input: 'test' }, { stream: true })
    expect(response).toBeDefined()
    expect(response.output1).toContain('Streaming part 1')
    expect(response.output2).toContain('Streaming part 2')
    expect(response.output3).toContain('Streaming part 3')
  })

  it('should yield streaming multi-output fields from streamingForward for a signature with two outputs', async () => {
    // Prepare a streaming response that delivers two outputs across chunks.
    const chunks: AxChatResponse['results'] = [
      { content: 'Output 1: Stream A ' },
      {
        content: 'continuation of previous Output 1 chunk\nOutput 2: Stream B',
      },
    ]
    // Use the generator function to simulate a streaming response.
    const streamingResponse = createStreamingResponse(chunks)
    const ai = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    // Define a signature with two outputs.
    const signature = 'input:string -> output1:string, output2:string'
    const gen = new AxGen<
      { input: string },
      { output1: string; output2: string }
    >(signature)

    // Use streamingForward to iterate through the yields.
    const results: Array<Record<string, string>> = []
    const stream = gen.streamingForward(ai, { input: 'test' })

    for await (const res of stream) {
      results.push(res.delta)
    }

    expect(results).toEqual([
      { output1: 'Stream A' },
      { output1: ' continuation of previous Output 1 chunk' },
      { output2: 'Stream B' },
    ])
  })
})

it('should yield streaming multi-output fields from streamingForward for a signature with five outputs', async () => {
  // Prepare a streaming response that delivers five outputs across many small chunks
  const chunks: AxChatResponse['results'] = [
    { content: 'Output 1: The quick ' },
    { content: 'brown fox ' },
    { content: 'jumps over ' },
    { content: 'the lazy ' },
    { content: 'dog.\nOutput 2: In a ' },
    { content: 'world full of ' },
    { content: 'endless ' },
    { content: 'possibilities, we ' },
    { content: 'must seize every ' },
    { content: 'opportunity.\nOutput 3: The ' },
    { content: 'gentle breeze ' },
    { content: 'whispers through ' },
    { content: 'the autumn ' },
    { content: 'leaves, carrying ' },
    { content: 'secrets of seasons past.\nOutput 4: ' },
    { content: 'As the sun sets ' },
    { content: 'behind distant ' },
    { content: 'mountains, painting ' },
    { content: 'the sky in ' },
    { content: 'brilliant hues of ' },
    { content: 'orange and purple, ' },
    {
      content:
        'nature reveals its timeless beauty.\nOutput 5: Through the looking ',
    },
    { content: 'glass of ' },
    { content: 'imagination, we ' },
    { content: 'discover worlds ' },
    { content: 'beyond our ' },
    { content: 'wildest dreams.' },
  ]

  // Use the generator function to simulate a streaming response
  const streamingResponse = createStreamingResponse(chunks)
  const ai = new AxMockAIService({
    features: { functions: false, streaming: true },
    chatResponse: streamingResponse,
  })

  // Define a signature with five outputs
  const signature =
    'input:string -> output1:string, output2:string, output3:string, output4:string, output5:string'
  const gen = new AxGen<
    { input: string },
    {
      output1: string
      output2: string
      output3: string
      output4: string
      output5: string
    }
  >(signature)

  // Use streamingForward to iterate through the yields
  const results: Array<Record<string, string>> = []
  const stream = gen.streamingForward(ai, { input: 'test' })

  for await (const res of stream) {
    results.push(res.delta)
  }

  expect(results).toEqual([
    { output1: 'The quick' },
    { output1: ' brown fox' },
    { output1: ' jumps over' },
    { output1: ' the lazy' },
    { output1: ' dog.' },
    { output2: 'In a' },
    { output2: ' world full of' },
    { output2: ' endless' },
    { output2: ' possibilities, we' },
    { output2: ' must seize every' },
    { output2: ' opportunity.' },
    { output3: 'The' },
    { output3: ' gentle breeze' },
    { output3: ' whispers through' },
    { output3: ' the autumn' },
    { output3: ' leaves, carrying' },
    { output3: ' secrets of seasons past.' },
    { output4: 'As the sun sets' },
    { output4: ' behind distant' },
    { output4: ' mountains, painting' },
    { output4: ' the sky in' },
    { output4: ' brilliant hues of' },
    { output4: ' orange and purple,' },
    { output4: ' nature reveals its timeless beauty.' },
    { output5: 'Through the looking' },
    { output5: ' glass of' },
    { output5: ' imagination, we' },
    { output5: ' discover worlds' },
    { output5: ' beyond our' },
    { output5: ' wildest dreams.' },
  ])
})

describe('Error handling in AxGen', () => {
  it('should properly wrap errors with cause mechanism', async () => {
    const signature = 'input:string -> output:string'

    // Create AI service that will throw a specific error
    const originalError = new Error('Original test error')

    // Create a more complete mock with required methods implemented
    const ai = new AxMockAIService({
      features: { functions: false, streaming: false },
      shouldError: true,
      errorMessage: 'Original test error',
      chatResponse: async () => {
        throw originalError
      },
    })

    // Override the unimplemented methods that enhanceError uses
    ai.getLastUsedChatModel = () => 'test-model'
    ai.getLastUsedModelConfig = () => ({
      maxTokens: 1000,
      stream: false,
    })

    const gen = new AxGen<{ input: string }, { output: string }>(signature)

    try {
      // This should fail and throw an enhanced error
      await gen.forward(ai, { input: 'test' })
      // If we reach here, the test should fail
      expect('This code should not be reached').toBe(false)
    } catch (error) {
      // Import the AxGenerateError class
      const { AxGenerateError: generateErrorClass } = await import(
        './generate.js'
      )

      // Verify error is an AxGenerateError
      expect(error).toBeInstanceOf(generateErrorClass)

      // Verify error has the correct short message
      expect((error as Error).message).toBe('Generate failed')

      // Verify error has details object with proper properties
      const generateError = error as typeof generateErrorClass & {
        details: {
          model: string
          maxTokens: number
          streaming: boolean
          signature: Readonly<AxSignature>
        }
      }
      expect(generateError.details).toBeDefined()
      expect(generateError.details.model).toBe('test-model')
      expect(generateError.details.maxTokens).toBe(1000)
      expect(generateError.details.streaming).toBe(false)
      expect(generateError.details.signature).toBeDefined()
      // Don't compare directly to the string signature
      expect(typeof generateError.details.signature.toString).toBe('function')

      // Verify error has cause property with the original error
      const enhancedError = error as Error & { cause?: unknown }
      expect(enhancedError.cause).toEqual(originalError)

      // Verify original error message is preserved in the cause
      if (enhancedError.cause instanceof Error) {
        expect(enhancedError.cause.message).toBe('Original test error')
      }
    }
  })
})
