import { describe, expect, it } from 'vitest'

import { parseSignature } from './parser.js'

describe('signature parsing', () => {
  it('parses signature correctly', () => {
    const sig = parseSignature(
      `"hello world" context?:string "some context", query:string 'some query' -> answers:string[], messageType:class "reminder, follow-up"`
    )

    expect(sig.desc).toBe('hello world')

    expect(sig.inputs[0]).toEqual({
      desc: 'some context',
      name: 'context',
      type: { name: 'string', isArray: false },
      isOptional: true,
    })

    expect(sig.inputs[1]).toEqual({
      desc: 'some query',
      name: 'query',
      type: { name: 'string', isArray: false },
      isOptional: false,
    })

    expect(sig.outputs[0]).toEqual({
      desc: undefined,
      name: 'answers',
      type: { name: 'string', isArray: true },
      isOptional: false,
    })

    expect(sig.outputs[1]).toEqual({
      isOptional: false,
      name: 'messageType',
      type: {
        name: 'class',
        isArray: false,
        classes: ['reminder', 'follow-up'],
      },
    })
  })

  it('throws error for invalid signature', () => {
    expect(() =>
      parseSignature(
        `context?:string, query:boom -> test:image, answers:string[]`
      )
    ).toThrow()
  })
})
