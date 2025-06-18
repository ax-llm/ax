import { describe, expect, it } from 'vitest'

import { AxPromptTemplate } from './prompt.js'
import { AxSignature } from './sig.js'
import type { AxMessage } from './types.js'

// Helper to create a basic signature
const createSignature = (desc: string) => {
  return new AxSignature(desc)
}

const defaultSig = createSignature('userQuery:string -> aiResponse:string')

const multiFieldSig = createSignature(
  'userQuestion:string, contextInfo:string -> assistantAnswer:string'
)

// Signature for testing assistant message rendering logic
const assistantTestSig = createSignature(
  'userMessage:string -> thoughtProcess:string "Thought process", mainResponse:string "Main output", optionalResponse?:string "Optional output", internalThoughts!:string "Internal output"'
)

describe('AxPromptTemplate.render', () => {
  type TestExpectedMessage = { role: 'user' | 'assistant'; content: string }

  describe('Single AxGenIn input (existing behavior)', () => {
    it('should render a basic prompt with single AxGenIn', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      )
      const template = new AxPromptTemplate(signature)

      const result = template.render({ userQuery: 'test' }, {})

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('system')
      expect(result[1]?.role).toBe('user')
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.content).toContain('User Query: test')
    })

    it('should render with examples', () => {
      const signature = new AxSignature(
        'userQuery:string -> aiResponse:string "the result"'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }]
      const result = template.render({ userQuery: 'test' }, { examples })

      expect(result).toHaveLength(2)
      expect(result[0]?.role).toBe('system')
      const systemMessage = result[0] as
        | { role: 'system'; content: string }
        | undefined
      expect(systemMessage?.content).toContain('User Query: hello')
      expect(systemMessage?.content).toContain('Ai Response: world')
    })
  })

  describe('examples with missing fields', () => {
    it('should allow missing input fields in examples', () => {
      const signature = new AxSignature(
        'userQuery:string, isUserMessage:boolean -> aiResponse:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }] // missing isUserMessage

      expect(() => {
        template.render(
          { userQuery: 'test', isUserMessage: true },
          { examples }
        )
      }).not.toThrow()
    })

    it('should handle false boolean values correctly in examples', () => {
      const signature = new AxSignature(
        'userQuery:string, isUserMessage:boolean -> aiResponse:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [
        { userQuery: 'hello', isUserMessage: false, aiResponse: 'world' },
      ]

      const result = template.render(
        { userQuery: 'test', isUserMessage: true },
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
        'userQuery:string -> aiResponse:string, categoryType:string'
      )
      const template = new AxPromptTemplate(signature)

      const examples = [{ userQuery: 'hello', aiResponse: 'world' }] // missing category output field

      expect(() => {
        template.render({ userQuery: 'test' }, { examples })
      }).not.toThrow()
    })
  })

  describe('ReadonlyArray<AxMessage> input (new behavior)', () => {
    it('should render with a single user message in history', () => {
      const pt = new AxPromptTemplate(defaultSig)
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = [
        { role: 'user', values: { userQuery: 'first message' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(2)
      expect(result[0]?.role).toBe('system')
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.role).toBe('user')
      expect(userMessage?.content).toBe('User Query: first message')
    })

    it('should combine consecutive user messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1', contextInfo: 'c1' } },
        { role: 'user', values: { userQuestion: 'q2', contextInfo: 'c2' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(2)
      const userMessage = result[1] as TestExpectedMessage | undefined
      expect(userMessage?.role).toBe('user')
      expect(userMessage?.content).toBe(
        'User Question: q1\nContext Info: c1\nUser Question: q2\nContext Info: c2'
      )
    })

    it('should handle alternating user and assistant messages', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1', contextInfo: 'c1' } },
        {
          role: 'assistant',
          values: { userQuestion: 'q1-followup', contextInfo: 'c1-response' },
        },
        { role: 'user', values: { userQuestion: 'q2', contextInfo: 'c2' } },
      ]
      const result = pt.render(history, {})

      expect(result.length).toBe(4)
      expect(result[0]?.role).toBe('system')
      const userMessage1 = result[1] as TestExpectedMessage | undefined
      expect(userMessage1?.role).toBe('user')
      expect(userMessage1?.content).toBe('User Question: q1\nContext Info: c1')
      const assistantMessage = result[2] as TestExpectedMessage | undefined
      expect(assistantMessage?.role).toBe('assistant')
      expect(assistantMessage?.content).toBe(
        'User Question: q1-followup\nContext Info: c1-response'
      )
      const userMessage2 = result[3] as TestExpectedMessage | undefined
      expect(userMessage2?.role).toBe('user')
      expect(userMessage2?.content).toBe('User Question: q2\nContext Info: c2')
    })

    // This test confirms user messages need all required fields
    it('should throw if required field missing in user message history', () => {
      const pt = new AxPromptTemplate(multiFieldSig)
      const history: ReadonlyArray<
        AxMessage<{ userQuestion: string; contextInfo?: string }>
      > = [
        { role: 'user', values: { userQuestion: 'q1' } }, // contextInfo is missing
      ]
      expect(() => pt.render(history, {})).toThrowError(
        "Value for input field 'contextInfo' is required."
      )
    })

    it('should handle empty history array', () => {
      const pt = new AxPromptTemplate(defaultSig)
      const history: ReadonlyArray<AxMessage<{ userQuery: string }>> = []
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
      it('should render assistant message with input fields', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage<{ userMessage: string }>> = [
          {
            role: 'assistant',
            values: {
              userMessage: 'assistant input value',
            },
          },
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'User Message: assistant input value'
        )
      })

      it('should throw error if required input field is missing in assistant message', () => {
        const pt = new AxPromptTemplate(assistantTestSig)
        const history: ReadonlyArray<AxMessage<{ userMessage?: string }>> = [
          {
            role: 'assistant',
            values: {}, // 'userMessage' is missing
          },
        ]
        expect(() => pt.render(history, {})).toThrowError(
          "Value for input field 'userMessage' is required."
        )
      })

      it('should render assistant message with multiple input fields', () => {
        const pt = new AxPromptTemplate(multiFieldSig)
        const history: ReadonlyArray<
          AxMessage<{ userQuestion: string; contextInfo: string }>
        > = [
          {
            role: 'assistant',
            values: {
              userQuestion: 'What is the answer?',
              contextInfo: 'This is the context',
            },
          },
        ]
        const result = pt.render(history, {})
        expect(result.length).toBe(2)
        const assistantMsg = result[1] as TestExpectedMessage | undefined
        expect(assistantMsg?.role).toBe('assistant')
        expect(assistantMsg?.content).toBe(
          'User Question: What is the answer?\nContext Info: This is the context'
        )
      })

      it('should throw error if required input field is missing in multi-field assistant message', () => {
        const pt = new AxPromptTemplate(multiFieldSig)
        const history: ReadonlyArray<
          AxMessage<{ userQuestion: string; contextInfo?: string }>
        > = [
          {
            role: 'assistant',
            values: {
              userQuestion: 'What is the answer?',
              // contextInfo is missing
            },
          },
        ]
        expect(() => pt.render(history, {})).toThrowError(
          "Value for input field 'contextInfo' is required."
        )
      })
    })
  })
})
