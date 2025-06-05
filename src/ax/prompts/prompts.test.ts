import { describe, expect, it } from 'vitest'

import { AxAI } from '../ai/wrap.js'
import { AxSignature } from '../dsp/sig.js'

import { AxChainOfThought } from './cot.js'

const someText = `The technological singularity—or simply the singularity[1]—is a hypothetical future point in time at which technological growth becomes uncontrollable and irreversible.`

const examples = [
  {
    someText:
      'Mathematical platonism is a philosophical view that posits the existence of abstract mathematical objects that are independent of human thought and language. According to this view, mathematical entities such as numbers, shapes, and functions exist in a non-physical realm and can be discovered but not invented.',
    reason: 'Blah blah blah 1',
    shortSummary:
      'A philosophy that suggests mathematical objects exist independently of human thought in a non-physical realm.',
  },
  {
    someText:
      'Quantum entanglement is a physical phenomenon occurring when pairs or groups of particles are generated, interact, or share spatial proximity in ways such that the quantum state of each particle cannot be described independently of the state of the others, even when the particles are separated by large distances. This leads to correlations between observable physical properties of the particles.',
    reason: 'Blah blah blah 2',
    shortSummary:
      'A phenomenon where particles remain interconnected and the state of one affects the state of another, regardless of distance.',
  },
]

const mockFetch = async (_urlObj: unknown, req: unknown): Promise<Response> => {
  const mockRes = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Reason: Blah blah blah\nShort Summary: More blah blah blah',
        },
      },
    ],
  }

  const body = JSON.parse((req as { body: string }).body)

  if (body.stream !== undefined && body.stream !== true) {
    throw new Error('stream must be false or undefined')
  }

  return new Promise((resolve) => {
    resolve({
      ok: true,
      status: 200,
      json: async () => new Promise((resolve) => resolve(mockRes)),
    } as unknown as Response)
  })
}

describe('AxChainOfThought', () => {
  it('should generate prompt correctly', async () => {
    const ai = new AxAI({
      name: 'openai',
      apiKey: 'no-key',
      options: { fetch: mockFetch },
      config: { stream: false },
    })

    // const ai = new AxAI({ name: 'ollama', config: { model: 'nous-hermes2' } });

    const gen = new AxChainOfThought<{ someText: string }>(
      `someText -> shortSummary "summarize in 5 to 10 words"`,
      { setVisibleReasoning: true }
    )
    gen.setExamples(examples)

    const res = await gen.forward(ai, { someText })

    expect(res).toEqual({
      reason: 'Blah blah blah',
      shortSummary: 'More blah blah blah',
    })
  })
})

describe('AxSignature', () => {
  it('should throw error for invalid signature', () => {
    expect(() => new AxSignature(`someText -> output:image`)).toThrow()
  })
})
