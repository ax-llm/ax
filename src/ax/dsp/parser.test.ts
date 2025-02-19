import { describe, expect, it } from 'vitest'

import { parseSignature } from './parser.js'

describe('SignatureParser', () => {
  describe('basic parsing', () => {
    it('parses a simple signature without description', () => {
      const sig = parseSignature('input:string -> output:number')

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
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0).toEqual({
        name: 'input',
        type: { name: 'string', isArray: false },
        isOptional: undefined,
        desc: undefined,
      })

      expect(output0).toEqual({
        name: 'output',
        type: { name: 'number', isArray: false },
        isOptional: false,
        isInternal: false,
        desc: undefined,
      })
    })

    it('parses a signature with description', () => {
      const sig = parseSignature(
        '"This is a test" input:string -> output:number'
      )

      expect(sig.desc).toBe('This is a test')
      expect(sig.inputs).toHaveLength(1)
      expect(sig.outputs).toHaveLength(1)
    })
  })

  describe('field descriptions', () => {
    it('parses fields with descriptions', () => {
      const sig = parseSignature(
        'input:string "input description" -> output:number "output description"'
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
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.desc).toBe('input description')
      expect(output0.desc).toBe('output description')
    })

    it('handles both single and double quoted descriptions', () => {
      const sig = parseSignature(
        'input:string "double quotes", param:number \'single quotes\' -> output:string "result"'
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
          | { name: 'class'; isArray: boolean; classes: string[] }
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
        'required:string, optional?:number -> output:string'
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
        'input:string -> required:string, optional?:number'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      const output1 = sig.outputs[1] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; classes: string[] }
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
      const sig = parseSignature('input:string -> output!:number')
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      expect(output0.isInternal).toBe(true)
    })

    it('parses output field with both optional and internal markers', () => {
      const sig = parseSignature('input:string -> output?!:number')
      const output0 = sig.outputs[0] as {
        name: string
        type:
          | { name: string; isArray: boolean }
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }
      expect(output0.isOptional).toBe(true)
      expect(output0.isInternal).toBe(true)
    })

    it('throws error for input field with internal marker', () => {
      expect(() => parseSignature('input!:string -> output:number')).toThrow(
        /does not support the internal marker/
      )
    })
  })

  describe('array types', () => {
    it('parses array types', () => {
      const sig = parseSignature('inputs:string[] -> outputs:number[]')

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
          | { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(input0.type?.isArray).toBe(true)
      expect(output0.type?.isArray).toBe(true)
    })

    it('handles mix of array and non-array types', () => {
      const sig = parseSignature(
        'single:string, multiple:number[] -> result:boolean[]'
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
          | { name: 'class'; isArray: boolean; classes: string[] }
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
      const sig = parseSignature('input:string -> type:class "UserProfile"')

      const output0 = sig.outputs[0] as {
        name: string
        type: { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type).toEqual({
        name: 'class',
        isArray: false,
        classes: ['UserProfile'],
      })
    })

    it('parses class types with multiple classes', () => {
      const sig = parseSignature(
        'input:string -> type:class "Error, Success, Pending"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type: { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type).toEqual({
        name: 'class',
        isArray: false,
        classes: ['Error', 'Success', 'Pending'],
      })
    })

    it('handles array of classes', () => {
      const sig = parseSignature(
        'input:string -> types:class[] "Error, Success"'
      )

      const output0 = sig.outputs[0] as {
        name: string
        type: { name: 'class'; isArray: boolean; classes: string[] }
        isOptional: boolean
        isInternal: boolean
        desc?: string
      }

      expect(output0.type).toEqual({
        name: 'class',
        isArray: true,
        classes: ['Error', 'Success'],
      })
    })
  })

  describe('complex signatures', () => {
    it('parses complex signature with all features', () => {
      const sig = parseSignature(
        `"API Documentation" 
         context?:string "Request context",
         query:string 'Search query',
         options:json "Configuration options"
         ->
         results:string[] "Search results",
         metadata : json "Response metadata",
         status:class "success, error, pending"`
      )

      expect(sig).toEqual({
        desc: 'API Documentation',
        inputs: [
          {
            name: 'context',
            type: { name: 'string', isArray: false },
            isOptional: true,
            desc: 'Request context',
          },
          {
            name: 'query',
            type: { name: 'string', isArray: false },
            isOptional: undefined,
            desc: 'Search query',
          },
          {
            name: 'options',
            type: { name: 'json', isArray: false },
            isOptional: undefined,
            desc: 'Configuration options',
          },
        ],
        outputs: [
          {
            name: 'results',
            type: { name: 'string', isArray: true },
            isOptional: false,
            isInternal: false,
            desc: 'Search results',
          },
          {
            name: 'metadata',
            type: { name: 'json', isArray: false },
            isOptional: false,
            isInternal: false,
            desc: 'Response metadata',
          },
          {
            name: 'status',
            type: {
              name: 'class',
              isArray: false,
              classes: ['success', 'error', 'pending'],
            },
            isOptional: false,
            isInternal: false,
            desc: undefined,
          },
        ],
      })
    })
  })

  describe('error cases', () => {
    it('throws on invalid identifier', () => {
      expect(() =>
        parseSignature('123invalid:string -> output:string')
      ).throws()
    })

    it('throws on missing arrow', () => {
      expect(() => parseSignature('input:string output:string')).toThrow(
        'Expected "->"'
      )
    })

    it('throws on invalid type', () => {
      expect(() => parseSignature('input:invalid -> output:string')).toThrow(
        'Expected one of'
      )
    })

    it('throws on unterminated string', () => {
      expect(() =>
        parseSignature('"unclosed input:string -> output:string')
      ).toThrow('Unterminated string')
    })

    it('throws on missing class description', () => {
      expect(() => parseSignature('input:string -> output:class')).throws()
    })
  })

  describe('whitespace handling', () => {
    it('handles various whitespace patterns', () => {
      const signatures = [
        'input:string->output:number',
        'input:string   ->   output:number',
        'input:string\n->\noutput:number',
        'input:string\t->\toutput:number',
        ' input:string -> output:number ',
      ]

      const expectedInput = [
        {
          name: 'input',
          type: { name: 'string', isArray: false },
          isOptional: undefined,
          desc: undefined,
        },
      ]
      const expectedOutput = [
        {
          name: 'output',
          type: { name: 'number', isArray: false },
          isOptional: false,
          isInternal: false,
          desc: undefined,
        },
      ]

      signatures.forEach((sig) => {
        const parsed = parseSignature(sig)

        expect(parsed.inputs).toEqual(expectedInput)
        expect(parsed.outputs).toEqual(expectedOutput)
      })
    })
  })
})
