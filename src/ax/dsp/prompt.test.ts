import { describe, expect, it } from 'vitest'

import { AxPromptTemplate, type AxPromptTemplateOptions } from './prompt.js'
import { AxSignature } from './sig.js'
import type { AxMessage } from './types.js'

// Helper to create a basic signature
const createSignature = (desc: string) => {
  return new AxSignature(desc)
}

const defaultSig = createSignature('input:string -> output:string')

const multiFieldSig = createSignature(
  'question:string, context:string -> answer:string'
)

// Signature for testing assistant message rendering logic
const assistantTestSig = createSignature(
  'input:string -> thought:string "Thought process", output:string "Main output", optional_output?:string "Optional output", internal_output!:string "Internal output"'
)

// Signature for testing custom thought field name
const customThoughtSig = createSignature(
  'input:string -> custom_thought:string "Custom thought", output:string "Main output"'
)

describe('AxPromptTemplate.render', () => {
  type TestExpectedMessage = { role: 'user' | 'assistant'; content: string }

  describe('Single AxGenIn input (existing behavior)', () => {
    it('should render a basic prompt with single AxGenIn', () => {
      const signature = new AxSignature(
        'input:string -> output:string "the result"'
      )
      const template = new AxPromptTemplate(signature)

      const result = template.render({ input: 'test' }, {})

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('system')
      expect(result[1]?.role).toBe('user')
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.content).toContain('Input: test')
    })

    it('should render with examples', () => {
      const signature = new AxSignature(
        'input:string -> output:string "the result"'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ input: 'hello', output: 'world' }]
      const result = template.render({ input: 'test' }, { examples })

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('system')
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined
      expect(systemMessage?.content).toContain('Input: hello')
      expect(systemMessage?.content).toContain('Output: world')
    })
  })

  describe('examples with missing fields', () => {
    it('should allow missing input fields in examples', () => {
      const signature = new AxSignature(
        'input:string, isUserMessage:boolean -> output:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ input: 'hello', output: 'world' }] // missing isUserMessage

      expect(() => {
        template.render({ input: 'test', isUserMessage: true }, { examples })
      }).not.toThrow()
    })

    it('should handle false boolean values correctly in examples', () => {
      const signature = new AxSignature(
        'input:string, isUserMessage:boolean -> output:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [
        { input: 'hello', isUserMessage: false, output: 'world' },
      ]

      const result = template.render(
        { input: 'test', isUserMessage: true },
        { examples }
      )

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('system')
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined
      expect(systemMessage?.content).toContain('Is User Message: false')
    })

    it('should allow missing output fields in examples', () => {
      const signature = new AxSignature(
        'input:string -> output:string, category:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ input: 'hello', output: 'world' }] // missing category output field

      expect(() => {
        template.render({ input: 'test' }, { examples })
      }).not.toThrow()
    })
  })

  describe('ReadonlyArray<AxMessage> input (new behavior)', () => {
    it('should render with a single user message in history', () => {
      const pt = new AxPromptTemplate(defaultSig)
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { input: 'first message' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(2)
      expect(result[0]?.role).toBe('system')
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.role).toBe('user')
      expect(userMessage?.content).toBe('Input: first message')
    })

    it('should combine consecutive user messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1', context: 'c1' } },
        { role: 'user', values: { question: 'q2', context: 'c2' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(2)
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.role).toBe('user')
      expect(userMessage?.content).toBe(
        'Question: q1\nContext: c1\nQuestion: q2\nContext: c2'
      )
    })

    it('should handle alternating user and assistant messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1', context: 'c1' } },
        { role: 'assistant', values: { answer: 'a1' } },
        { role: 'user', values: { question: 'q2', context: 'c2' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(4)
      expect(result[0]?.role).toBe('system')
      const userMessage1 = result[1] as TestExpectedMessage | undefined
      expect(userMessage1?.role).toBe('user')
      expect(userMessage1?.content).toBe('Question: q1\nContext: c1')
      const assistantMessage = result[2] as TestExpectedMessage | undefined
      expect(assistantMessage?.role).toBe('assistant')
      expect(assistantMessage?.content).toBe('answer: a1')
      const userMessage2 = result[3] as TestExpectedMessage | undefined
      expect(userMessage2?.role).toBe('user')
      expect(userMessage2?.content).toBe('Question: q2\nContext: c2')
    })

    // This test confirms user messages need all required fields
    it('should throw if required field missing in user message history', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<AxMessage> = [
        { role: 'user', values: { question: 'q1' } }, // context is missing
      ]
      expect(() => pt.render(history, {})).toThrowError(
        "Value for input field 'context' is required."
      )
    })

    it('should handle empty history array', () => {
      const pt = new AxPromptTemplate(defaultSig)
      const history: ReadonlyArray<AxMessage> = []
      const result = pt.render(history, {})

      expect(result.length).toBe(1) // Only system prompt for empty array
      expect(result[0]?.role).toBe('system')
      // If an empty history array resulted in an empty user message, this would be:
      // expect(result.length).toBe(2);
      // const userMessage = result[1] as TestExpectedMessage | undefined;
      // expect(userMessage?.role).toBe('user');
      // expect(userMessage?.content).toBe('');
    })

    describe('Assistant Messages in History', () => {
      it('should render assistant message with all fields present', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              thought: 't',
              output: 'o',
              optional_output: 'opt',
              internal_output: 'i',
            },
          },
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'thought: t\noutput: o\noptional_output: opt\ninternal_output: i'
        )
      })

      it('should render assistant message missing optional_output', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              thought: 't',
              output: 'o',
              internal_output: 'i',
            },
          }, // optional_output is missing
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'thought: t\noutput: o\ninternal_output: i'
        )
      })

      it('should render assistant message missing internal_output', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              thought: 't',
              output: 'o',
              optional_output: 'opt',
            },
          }, // internal_output is missing
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'thought: t\noutput: o\noptional_output: opt'
        )
      })

      it('should render assistant message missing thought (default thoughtFieldName)', () => {
        const pt = new AxPromptTemplate(assistantTestSig) // uses default thoughtFieldName='thought'
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              output: 'o',
              optional_output: 'opt',
              internal_output: 'i',
            },
          }, // thought is missing
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'output: o\noptional_output: opt\ninternal_output: i'
        )
      })

      it('should render assistant message missing custom_thought (custom thoughtFieldName)', () => {
        const templateOptions: AxPromptTemplateOptions = {
          thoughtFieldName: 'custom_thought',
        }
        const pt = new AxPromptTemplate(customThoughtSig, templateOptions)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              output: 'o',
            },
          }, // custom_thought is missing
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe('output: o')
      })

      it('should throw error if required output field is missing in assistant message', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              thought: 't',
              optional_output: 'opt',
            },
          }, // 'output' is missing
        ]
        expect(() => pt.render(history, {})).toThrowError(
          "Value for output field 'output' ('Output') is required in assistant message history but was not found or was empty."
        )
      })

      it('should throw error if required output field (not thought) is missing, even with custom thoughtFieldName', () => {
        const templateOptions: AxPromptTemplateOptions = {
          thoughtFieldName: 'custom_thought',
        }
        // Use a signature that has 'output' as required and 'custom_thought'
        const sig = createSignature(
          'input:string -> output:string, custom_thought:string'
        )
        const pt = new AxPromptTemplate(sig, templateOptions)
        const history: ReadonlyArray<AxMessage> = [
          {
            role: 'assistant',
            values: {
              custom_thought: 'ct',
            },
          }, // 'output' is missing
        ]
        expect(() => pt.render(history, {})).toThrowError(
          "Value for output field 'output' ('Output') is required in assistant message history but was not found or was empty."
        )
      })
    })
  })
})
