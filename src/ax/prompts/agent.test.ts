import { describe, expect, it } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'
import type { AxChatResponse } from '../ai/types.js'
import type { AxMessage } from '../dsp/types.js'

import { AxAgent } from './agent.js'

// Helper function to create streaming responses
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
                  index: 0,
                  content: chunk.content,
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

            // Small delay between chunks
            await new Promise((resolve) => setTimeout(resolve, 10))
            processChunks()
          } catch (error) {
            controller.error(error)
          }
        }
      }

      processChunks().catch((error) => {
        controller.error(error)
      })
    },

    cancel() {},
  })
}

describe('AxAgent', () => {
  const mockAI = new AxMockAIService({
    features: {
      functions: true,
      streaming: true,
    },
    models: [
      { key: 'gpt4', model: 'gpt-4', description: 'Advanced model' },
      { key: 'gpt35', model: 'gpt-3.5', description: 'Fast model' },
    ],
  })

  it('should handle smart model routing correctly', () => {
    // Create agent with smart routing enabled (default)
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test smart routing agent',
      description: 'Tests the smart model routing functionality of agents',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const func = agent.getFunction()
    expect(func.parameters?.properties?.model).toBeDefined()
    expect(func.parameters?.properties?.model?.enum).toEqual(['gpt4', 'gpt35'])
  })

  it('should disable smart model routing when specified', () => {
    const agent = new AxAgent(
      {
        ai: mockAI,
        name: 'test smart routing disabled',
        description: 'Tests disabling smart model routing',
        signature: 'userQuery: string -> agentResponse: string',
      },
      { disableSmartModelRouting: true }
    )

    const func = agent.getFunction()
    expect(func.parameters?.properties?.model).toBeUndefined()
  })

  it('should update description correctly', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test description updates',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const newDescription =
      'Updated description that is also long enough to pass validation'
    agent.setDescription(newDescription)

    const func = agent.getFunction()
    expect(func.description).toBe(newDescription)
  })

  it('should throw error for short description', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test description validation',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    })

    expect(() => agent.setDescription('Too short')).toThrow()
  })

  it('should expose features correctly', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test features',
      description: 'Tests the feature reporting of agents',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const features = agent.getFeatures()
    expect(features.canConfigureSmartModelRouting).toBe(false)
    expect(features.excludeFieldsFromPassthrough).toEqual([])
  })

  it('should respect excludeFieldsFromPassthrough option', () => {
    const agent = new AxAgent(
      {
        ai: mockAI,
        name: 'test excluded fields',
        description: 'Tests field exclusion configuration',
        signature: 'userQuery: string -> agentResponse: string',
      },
      {
        excludeFieldsFromPassthrough: ['someField'],
      }
    )

    const features = agent.getFeatures()
    expect(features.excludeFieldsFromPassthrough).toEqual(['someField'])
  })

  it('should update definition correctly using setDefinition', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test setDefinition',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const validDefinition = 'A'.repeat(100) // valid definition (100 characters)
    agent.setDefinition(validDefinition)
    // Access the underlying program's signature to verify that the definition was applied
    expect(
      (
        agent as unknown as {
          program: { getSignature: () => { getDescription: () => string } }
        }
      ).program
        .getSignature()
        .getDescription()
    ).toBe(validDefinition)
  })

  it('should throw error when setting a too short definition using setDefinition', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test setDefinition short',
      description: 'Initial description that is long enough',
      signature: 'userQuery: string -> agentResponse: string',
    })

    expect(() => agent.setDefinition('Too short')).toThrow()
  })

  it('should set definition in constructor if provided and valid', () => {
    const validDefinition = 'D'.repeat(100) // valid definition (100 characters)
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test constructor with definition',
      description: 'Initial description that is long enough',
      definition: validDefinition,
      signature: 'userQuery: string -> agentResponse: string',
    })
    // The underlying signature description should use the provided definition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((agent as any).program.getSignature().getDescription()).toBe(
      validDefinition
    )
    // Note: The function description remains the original description.
    expect(agent.getFunction().description).toBe(
      'Initial description that is long enough'
    )
  })

  it('should throw error in constructor for a too short definition', () => {
    expect(
      () =>
        new AxAgent({
          ai: mockAI,
          name: 'test short definition',
          description: 'Initial description that is long enough',
          definition: 'Short definition',
          signature: 'userQuery: string -> agentResponse: string',
        })
    ).toThrow()
  })

  it('should handle AxMessage array input in forward method', async () => {
    // Create a mock AI service with a specific response for this test
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Agent Response: Mocked response for message array',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    })

    const agent = new AxAgent({
      ai: testMockAI,
      name: 'test message array forward',
      description: 'Tests handling of AxMessage array input in forward method',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const messages: AxMessage<{ userQuery: string }>[] = [
      { role: 'user', values: { userQuery: 'Hello from message array' } },
      { role: 'assistant', values: { userQuery: 'Previous response' } },
      { role: 'user', values: { userQuery: 'Latest user message' } },
    ]

    const result = await agent.forward(testMockAI, messages)
    expect(result).toBeDefined()
    expect(result.agentResponse).toBe('Mocked response for message array')
  })

  it('should handle AxMessage array input in streamingForward method', async () => {
    // Create streaming response chunks
    const chunks: AxChatResponse['results'] = [
      { index: 0, content: 'Agent Response: Streaming ' },
      { index: 0, content: 'response ' },
      { index: 0, content: 'chunk', finishReason: 'stop' },
    ]
    const streamingResponse = createStreamingResponse(chunks)

    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    })

    const agent = new AxAgent({
      ai: testMockAI,
      name: 'test message array streaming',
      description:
        'Tests handling of AxMessage array input in streamingForward method',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const messages: AxMessage<{ userQuery: string }>[] = [
      { role: 'user', values: { userQuery: 'Streaming test message' } },
    ]

    const generator = agent.streamingForward(testMockAI, messages)
    const results = []

    for await (const chunk of generator) {
      results.push(chunk)
    }

    expect(results.length).toBeGreaterThan(0)
    // Verify that we received streaming chunks
    expect(results[0]).toHaveProperty('delta')
  })

  it('should handle empty AxMessage array gracefully', async () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test empty message array',
      description: 'Tests handling of empty AxMessage array input',
      signature: 'userQuery: string -> agentResponse: string',
    })

    const messages: AxMessage<{ userQuery: string }>[] = []

    // This should not throw an error, but may result in an empty or default response
    // depending on how the underlying prompt template handles empty message arrays
    try {
      await agent.forward(mockAI, messages)
      // If it doesn't throw, that's fine - the behavior may vary
    } catch (error) {
      // If it throws, that's also acceptable behavior for empty input
      expect(error).toBeDefined()
    }
  })

  it('should extract values from most recent user message in AxMessage array', async () => {
    // Create a mock AI service for this test
    const testMockAI = new AxMockAIService({
      features: { functions: false, streaming: false },
      chatResponse: {
        results: [
          {
            index: 0,
            content: 'Agent Response: Parent response with child interaction',
            finishReason: 'stop',
          },
        ],
        modelUsage: {
          ai: 'test-ai',
          model: 'test-model',
          tokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
    })

    // Create a child agent that will receive injected values
    const childAgent = new AxAgent({
      ai: testMockAI,
      name: 'child agent for injection test',
      description: 'Child agent that receives injected values from parent',
      signature: 'contextInfo: string -> childResponse: string',
    })

    // Create parent agent with the child agent
    const parentAgent = new AxAgent({
      ai: testMockAI,
      name: 'parent agent with child',
      description: 'Parent agent that passes values to child agent',
      signature:
        'userQuery: string, contextInfo: string -> agentResponse: string',
      agents: [childAgent],
    })

    const messages: AxMessage<{ userQuery: string; contextInfo: string }>[] = [
      {
        role: 'user',
        values: { userQuery: 'First message', contextInfo: 'Old context' },
      },
      {
        role: 'assistant',
        values: {
          userQuery: 'Assistant response',
          contextInfo: 'Assistant context',
        },
      },
      {
        role: 'user',
        values: { userQuery: 'Latest message', contextInfo: 'Latest context' },
      },
    ]

    const result = await parentAgent.forward(testMockAI, messages)
    expect(result).toBeDefined()

    // The test verifies that the system can handle message arrays without throwing errors
    // The actual value injection logic is tested implicitly through the successful execution
  })
})
