import { describe, expect, it } from 'vitest'

import { extractValues } from './extract.js'
import { parseSignature } from './parser.js'
import { AxSignature } from './sig.js'

describe('signature parsing', () => {
  it('parses signature correctly', () => {
    const sig = parseSignature(
      `"hello world" context?:string "some context", query:string 'some query' -> reason!?:string, answers:string[], messageType:class "reminder, follow-up"`
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
      isOptional: undefined,
    })

    expect(sig.outputs[0]).toEqual({
      desc: undefined,
      name: 'reason',
      type: { name: 'string', isArray: false },
      isOptional: true,
      isInternal: true,
    })

    expect(sig.outputs[1]).toEqual({
      desc: undefined,
      name: 'answers',
      type: { name: 'string', isArray: true },
      isOptional: false,
      isInternal: false,
    })

    expect(sig.outputs[2]).toEqual({
      desc: undefined,
      isInternal: false,
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

describe('extract values with signatures', () => {
  it('should extract simple answer value', () => {
    const sig = new AxSignature(`question -> answer`)
    const v1 = {}
    extractValues(sig, v1, `Answer: "hello world"`)

    expect(v1).toEqual({ answer: '"hello world"' })
  })

  it('should not extract value with no prefix and single output', () => {
    const sig = new AxSignature(`question -> answer`)
    const v1 = {}
    extractValues(sig, v1, `"hello world"`)

    expect(v1).toEqual({})
  })

  it('should extract and parse JSON values', () => {
    const sig = new AxSignature(`question -> answer : json`)

    const v1 = {}
    extractValues(sig, v1, 'Answer: ```json\n{"hello": "world"}\n```')

    expect(v1).toEqual({ answer: { hello: 'world' } })
  })

  it('should extract multiple text values', () => {
    const sig = new AxSignature(`someText -> title, keyPoints, description`)
    const v1 = {}
    extractValues(
      sig,
      v1,
      `Title: Coastal Ecosystem Restoration\nKey Points: Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands\nDescription: The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.`
    )

    expect(v1).toEqual({
      title: 'Coastal Ecosystem Restoration',
      keyPoints:
        'Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands',
      description:
        'The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.',
    })
  })
})
