import { ReadableStream } from 'stream/web'

import { describe, expect, it } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxChatResponse } from '../ai/types.js'

import { AxGen } from './generate.js'

// Helper to simulate a streaming response with a timer.
const createStreamingResponse = (
  chunks: AxChatResponse['results'],
  delay = 20
): AxChatResponse | ReadableStream<AxChatResponse> =>
  new ReadableStream({
    start(controller) {
      let count = 0
      const interval = setInterval(() => {
        const chunk = chunks[count]
        if (chunk) {
          controller.enqueue({
            results: [
              { content: chunk.content, finishReason: chunk.finishReason },
            ],
            modelUsage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
          })
          count++
        }
        if (count >= chunks.length) {
          clearInterval(interval)
          controller.close()
        }
      }, delay)
    },
  })

describe('AxGen forward and streamingForward', () => {
  const signature = 'input:string -> output:string'

  it('should return non-streaming output from forward when stream option is false', async () => {
    // Prepare a non-streaming (plain) response.
    const nonStreamingResponse: AxChatResponse = {
      results: [
        { content: 'Output: Non-stream response', finishReason: 'stop' },
      ],
      modelUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
    const streamingResponse = createStreamingResponse(chunks, 20)
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
      modelUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
    const streamingResponse = createStreamingResponse(chunks, 20)
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
        content: 'continuation of Output 1\nOutput 2: Stream B',
        finishReason: 'stop',
      },
    ]
    const streamingResponse = createStreamingResponse(chunks, 20)
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
    for await (const res of gen.streamingForward(ai, { input: 'test' })) {
      results.push(res.delta)
    }
    expect(results).toEqual([
      { output1: 'Stream A' },
      { output2: 'Stream B' },
      { output1: 'Stream A continuation of Output 1' },
      { output2: 'Stream B' },
    ])
  })
})
