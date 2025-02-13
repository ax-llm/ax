import { describe, expect, it } from 'vitest'

import { AxMockAIService } from '../ai/mock/api.js'

import { AxAgent } from './agent.js'

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
      signature: 'input: string -> output: string',
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
        signature: 'input: string -> output: string',
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
      signature: 'input: string -> output: string',
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
      signature: 'input: string -> output: string',
    })

    expect(() => agent.setDescription('Too short')).toThrow()
  })

  it('should expose features correctly', () => {
    const agent = new AxAgent({
      ai: mockAI,
      name: 'test features',
      description: 'Tests the feature reporting of agents',
      signature: 'input: string -> output: string',
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
        signature: 'input: string -> output: string',
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
      signature: 'input: string -> output: string',
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
      signature: 'input: string -> output: string',
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
      signature: 'input: string -> output: string',
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
          signature: 'input: string -> output: string',
        })
    ).toThrow()
  })
})
