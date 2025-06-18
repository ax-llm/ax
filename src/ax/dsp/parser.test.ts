import { describe, expect, it } from 'vitest'

import { parseSignature } from './parser.js'

describe('SignatureParser', () => {
  describe('basic parsing', () => {
    it('parses a simple signature without description', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer:number')

      expect(sig.desc).toBeUndefined()
      expect(sig.inputs).toHaveLength(1)
      expect(sig.outputs).toHaveLength(1)

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0).toEqual({
        name: 'userQuestion',
        type: { name: 'string', isArray: false },
        isOptional: undefined,
        desc: undefined,
      })

      expect(output0).toEqual({
        name: 'modelAnswer',
        type: { name: 'number', isArray: false },
        isOptional: false,
        isInternal: false,
        desc: undefined,
      })
    })

    it('parses a signature with description', () => {
      const sig = parseSignature(
        '"This is a test" userQuestion:string -> modelAnswer:number'
      )

      expect(sig.desc).toBe('This is a test')
      expect(sig.inputs).toHaveLength(1)
      expect(sig.outputs).toHaveLength(1)
    })
  })

  describe('field descriptions', () => {
    it('parses fields with descriptions', () => {
      const sig = parseSignature(
        'userQuestion:string "input description" -> modelAnswer:number "output description"'
      )

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.desc).toBe('input description')
      expect(output0.desc).toBe('output description')
    })

    it('handles both single and double quoted descriptions', () => {
      const sig = parseSignature(
        'userQuestion:string "double quotes", userParam:number \'single quotes\' -> modelAnswer:string "result"'
      )

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const input1 = sig.inputs[1] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.desc).toBe('double quotes')
      expect(input1.desc).toBe('single quotes')
      expect(output0.desc).toBe('result')
    })
  })

  describe('optional fields', () => {
    it('parses optional input fields', () => {
      const sig = parseSignature(
        'requiredField:string, optionalField?:number -> modelAnswer:string'
      )

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const input1 = sig.inputs[1] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }

      expect(input0.isOptional).toBe(undefined)
      expect(input1.isOptional).toBe(true)
    })

    it('parses optional output fields', () => {
      const sig = parseSignature(
        'userQuestion:string -> requiredField:string, optionalField?:number'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      const output1 = sig.outputs[1] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.isOptional).toBe(false)
      expect(output1.isOptional).toBe(true)
    })
  })

  describe('internal marker', () => {
    it('parses output field with internal marker', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer!:number')
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      expect(output0.isInternal).toBe(true)
    })

    it('parses output field with both optional and internal markers', () => {
      const sig = parseSignature('userQuestion:string -> modelAnswer?!:number')
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      expect(output0.isOptional).toBe(true)
      expect(output0.isInternal).toBe(true)
    })

    it('throws error for input field with internal marker', () => {
      expect(() =>
        parseSignature('userQuestion!:string -> modelAnswer:number')
      ).toThrow(/cannot use the internal marker/)
    })
  })

  describe('array types', () => {
    it('parses array types', () => {
      const sig = parseSignature(
        'userQuestions:string[] -> modelAnswers:number[]'
      )

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.type?.isArray).toBe(true)
      expect(output0.type?.isArray).toBe(true)
    })

    it('handles mix of array and non-array types', () => {
      const sig = parseSignature(
        'userQuestion:string, userQuestions:number[] -> modelAnswers:boolean[]'
      )

      const input0 = sig.inputs[0] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const input1 = sig.inputs[1] as {
        name: string
        type: { name: string; isArray: boolean }
        isOptional: boolean
        desc?: string
      }
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.type?.isArray).toBe(false)
      expect(input1.type?.isArray).toBe(true)
      expect(output0.type?.isArray).toBe(true)
    })
  })

  describe('class types', () => {
    it('parses class types with single class', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1, option2"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['option1', 'option2'])
      }
    })

    it('parses class types with multiple options', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "positive, negative, neutral"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['positive', 'negative', 'neutral'])
      }
    })

    it('handles array of options', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryTypes:class[] "option1, option2"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      expect(output0.type?.isArray).toBe(true)
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['option1', 'option2'])
      }
    })

    it('throws error for input field with class type', () => {
      expect(() =>
        parseSignature('categoryType:class "a,b" -> modelAnswer:string')
      ).toThrow(/cannot use the "class" type/)
    })

    it('throws error for missing class options', () => {
      expect(() =>
        parseSignature('userQuestion:string -> categoryType:class ""')
      ).toThrow(/Missing class options/)
    })

    it('parses class types with pipe separator', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1 | option2 | option3"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['option1', 'option2', 'option3'])
      }
    })

    it('parses class types with mixed separators', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "option1, option2 | option3"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['option1', 'option2', 'option3'])
      }
    })

    it('parses class options with mixed separators and spacing', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "valid, option,with,comma"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['valid', 'option', 'with', 'comma'])
      }
    })

    it('parses class options with pipe separators and mixed spacing', () => {
      const sig = parseSignature(
        'userQuestion:string -> categoryType:class "valid | option|with|pipe"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; options: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type?.name).toBe('class')
      if (output0.type?.name === 'class') {
        const classType = output0.type as {
          name: 'class'
          isArray: boolean
          options: string[]
        }
        expect(classType.options).toEqual(['valid', 'option', 'with', 'pipe'])
      }
    })
  })

  describe('duplicate fields', () => {
    it('throws error for duplicate input fields', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string, userQuestion:number -> modelAnswer:string'
        )
      ).toThrow(/Duplicate input field name/)
    })

    it('throws error for duplicate output fields', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string -> modelAnswer:string, modelAnswer:number'
        )
      ).toThrow(/Duplicate output field name/)
    })

    it('throws error for fields in both input and output', () => {
      expect(() =>
        parseSignature('userQuestion:string -> userQuestion:string')
      ).toThrow(/appears in both inputs and outputs/)
    })
  })

  describe('error cases', () => {
    it('throws on empty signature', () => {
      expect(() => parseSignature('')).toThrow('Empty signature provided')
    })

    it('throws on missing arrow', () => {
      expect(() =>
        parseSignature('userQuestion:string modelAnswer:string')
      ).toThrow('Expected "->"')
    })

    it('throws on missing output fields', () => {
      expect(() => parseSignature('userQuestion:string ->')).toThrow(
        'No output fields specified'
      )
    })

    it('throws on invalid type', () => {
      expect(() =>
        parseSignature('userQuestion:invalid -> modelAnswer:string')
      ).toThrow('Invalid type "invalid"')
    })

    it('throws on unterminated string', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string "unterminated -> modelAnswer:string'
        )
      ).toThrow('Unterminated string')
    })

    it('throws on unexpected content after signature', () => {
      expect(() =>
        parseSignature(
          'userQuestion:string -> modelAnswer:string extra content'
        )
      ).toThrow('Unexpected content after signature')
    })

    it('throws on invalid field name characters', () => {
      expect(() =>
        parseSignature('invalid-name:string -> modelAnswer:string')
      ).toThrow('Expected "->"')
    })

    it('throws on field names starting with numbers', () => {
      expect(() =>
        parseSignature('1name:string -> modelAnswer:string')
      ).toThrow('cannot start with a number')
    })
  })

  describe('whitespace handling', () => {
    ;[
      'userQuestion:string -> modelAnswer:number',
      ' userQuestion:string -> modelAnswer:number',
      'userQuestion:string -> modelAnswer:number ',
      ' userQuestion:string  ->  modelAnswer:number ',
      '\tuserQuestion:string -> modelAnswer:number\n',
    ].forEach((sigStr) => {
      it(`handles various whitespace patterns for signature: "${sigStr}"`, () => {
        const sig = parseSignature(sigStr)
        expect(sig.inputs).toHaveLength(1)
        expect(sig.outputs).toHaveLength(1)
        expect(sig.inputs[0]?.name).toBe('userQuestion')
        expect(sig.outputs[0]?.name).toBe('modelAnswer')
      })
    })
  })
})
