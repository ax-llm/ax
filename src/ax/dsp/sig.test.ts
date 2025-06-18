import { describe, expect, it } from 'vitest'

import { extractValues } from './extract.js'
import { parseSignature } from './parser.js'
import { type AxField, AxSignature } from './sig.js'

describe('signature parsing', () => {
  it('parses signature correctly', () => {
    const sig = parseSignature(
      `"hello world" contextInfo?:string "some context", queryText:string 'some query' -> reasoningSteps!?:string, answerList:string[], messageType:class "reminder, follow-up"`
    )

    expect(sig.desc).toBe('hello world')

    expect(sig.inputs[0]).toEqual({
      desc: 'some context',
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
      isOptional: true,
    })

    expect(sig.inputs[1]).toEqual({
      desc: 'some query',
      name: 'queryText',
      type: { name: 'string', isArray: false },
      isOptional: undefined,
    })

    expect(sig.outputs[0]).toEqual({
      desc: undefined,
      name: 'reasoningSteps',
      type: { name: 'string', isArray: false },
      isOptional: true,
      isInternal: true,
    })

    expect(sig.outputs[1]).toEqual({
      desc: undefined,
      name: 'answerList',
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
        options: ['reminder', 'follow-up'],
      },
    })
  })

  it('throws descriptive error for invalid signature', () => {
    expect(() =>
      parseSignature(
        `contextInfo?:string, queryText:boom -> testField:image, answerList:string[]`
      )
    ).toThrow('Invalid type "boom"')
  })

  it('throws error for empty signature', () => {
    expect(() => parseSignature('')).toThrow('Empty signature provided')
  })

  it('throws error for missing arrow', () => {
    expect(() => parseSignature('userInput:string')).toThrow(
      'Missing output section'
    )
  })

  it('throws error for missing output fields', () => {
    expect(() => parseSignature('userInput:string ->')).toThrow(
      'No output fields specified after "->"'
    )
  })

  it('throws error for generic field names', () => {
    expect(() => parseSignature('text:string -> response:string')).toThrow(
      'too generic'
    )
  })

  it('throws error for duplicate field names', () => {
    expect(() =>
      parseSignature(
        'userInput:string, userInput:number -> responseText:string'
      )
    ).toThrow('Duplicate input field name')
  })

  it('throws error for field names in both input and output', () => {
    expect(() =>
      parseSignature('userInput:string -> userInput:string')
    ).toThrow('appears in both inputs and outputs')
  })

  it('throws error for class type in input', () => {
    expect(() =>
      parseSignature('categoryType:class "a, b" -> responseText:string')
    ).toThrow('cannot use the "class" type')
  })

  it('throws error for internal marker in input', () => {
    expect(() =>
      parseSignature('userInput!:string -> responseText:string')
    ).toThrow('cannot use the internal marker')
  })

  it('throws error for image type in output', () => {
    expect(() =>
      parseSignature('userInput:string -> outputImage:image')
    ).toThrow('Image type is not supported in output fields')
  })

  it('throws error for single class option', () => {
    expect(() =>
      parseSignature('userInput:string -> categoryType:class "only-one"')
    ).toThrow('needs at least 2 options')
  })

  it('throws error for empty class options', () => {
    expect(() =>
      parseSignature('userInput:string -> categoryType:class ""')
    ).toThrow('Missing class options after "class" type')
  })

  it('throws error for invalid class option names', () => {
    expect(() =>
      parseSignature(
        'userInput:string -> categoryType:class "valid, 123invalid"'
      )
    ).toThrow('Invalid class option "123invalid"')
  })

  it('throws error for field names that are too short', () => {
    expect(() => parseSignature('a:string -> b:string')).toThrow('too short')
  })

  it('throws error for field names starting with numbers', () => {
    expect(() =>
      parseSignature('1invalid:string -> responseText:string')
    ).toThrow('cannot start with a number')
  })

  it('throws error for invalid field name characters', () => {
    expect(() =>
      parseSignature('user-input:string -> responseText:string')
    ).toThrow('Expected "->"')
  })

  it('provides type suggestions for common mistakes', () => {
    expect(() =>
      parseSignature('userInput:str -> responseText:string')
    ).toThrow('Did you mean "string"?')
    expect(() =>
      parseSignature('userInput:int -> responseText:string')
    ).toThrow('Did you mean "number"?')
    expect(() =>
      parseSignature('userInput:bool -> responseText:string')
    ).toThrow('Did you mean "boolean"?')
  })

  it('throws error for unterminated strings', () => {
    expect(() =>
      parseSignature('userInput:string "unterminated -> responseText:string')
    ).toThrow('Unterminated string')
  })

  it('throws error for unexpected content after signature', () => {
    expect(() =>
      parseSignature('userInput:string -> responseText:string extra content')
    ).toThrow('Unexpected content after signature')
  })

  it('validates array constraints for media types', () => {
    expect(() =>
      parseSignature('userImage:image[] -> responseText:string')
    ).toThrow('Arrays of image are not supported')
    expect(() =>
      parseSignature('userAudio:audio[] -> responseText:string')
    ).toThrow('Arrays of audio are not supported')
  })

  it('allows valid descriptive field names', () => {
    expect(() =>
      parseSignature('userQuestion:string -> analysisResult:string')
    ).not.toThrow()
    expect(() =>
      parseSignature('documentContent:string -> summaryText:string')
    ).not.toThrow()
    expect(() =>
      parseSignature(
        'customer_feedback:string -> sentiment_category:class "positive, negative, neutral"'
      )
    ).not.toThrow()
  })
})

describe('AxSignature class validation', () => {
  it('throws error when adding invalid input field', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.addInputField({
        name: 'text',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic')
  })

  it('throws error when adding invalid output field', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.addOutputField({
        name: 'outputImage',
        type: { name: 'image', isArray: false },
      })
    ).toThrow('image type is not supported in output fields')
  })

  it('throws error when setting non-array input fields', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.setInputFields('not an array' as unknown as readonly AxField[])
    ).toThrow('Input fields must be an array')
  })

  it('throws error when setting non-array output fields', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.setOutputFields('not an array' as unknown as readonly AxField[])
    ).toThrow('Output fields must be an array')
  })

  it('throws error when setting non-string description', () => {
    const sig = new AxSignature()
    expect(() => sig.setDescription(123 as unknown as string)).toThrow(
      'Description must be a string'
    )
  })

  it('validates class options for duplicates', () => {
    expect(
      () =>
        new AxSignature(
          'userInput:string -> categoryType:class "positive, negative, positive"'
        )
    ).toThrow('Duplicate class options found')
  })

  it('validates minimum signature requirements', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.setOutputFields([
        { name: 'responseText', type: { name: 'string', isArray: false } },
      ])
    ).toThrow('must have at least one input field')

    sig.setInputFields([
      { name: 'userInput', type: { name: 'string', isArray: false } },
    ])
    expect(() => sig.setOutputFields([])).toThrow(
      'must have at least one output field'
    )
  })

  it('provides helpful suggestions in error messages', () => {
    try {
      new AxSignature('text:string -> response:string')
    } catch (error) {
      expect((error as Error).message).toContain('too generic')
      // The error should have some suggestion, let's check it's informative
      expect(error).toHaveProperty('suggestion')
    }
  })
})

describe('extract values with signatures', () => {
  it('should extract simple answer value', () => {
    const sig = new AxSignature(`userQuestion:string -> responseText:string`)
    const v1 = {}
    extractValues(sig, v1, `Response Text: "hello world"`)

    expect(v1).toEqual({ responseText: '"hello world"' })
  })

  it('should not extract value with no prefix and single output', () => {
    const sig = new AxSignature(`userQuestion:string -> responseText:string`)
    const v1 = {}
    extractValues(sig, v1, `"hello world"`)

    expect(v1).toEqual({})
  })

  it('should extract and parse JSON values', () => {
    const sig = new AxSignature(`userQuestion:string -> analysisResult:json`)

    const v1 = {}
    extractValues(sig, v1, 'Analysis Result: ```json\n{"hello": "world"}\n```')

    expect(v1).toEqual({ analysisResult: { hello: 'world' } })
  })

  it('should extract multiple text values', () => {
    const sig = new AxSignature(
      `documentText:string -> titleText:string, keyPoints:string, descriptionText:string`
    )
    const v1 = {}
    extractValues(
      sig,
      v1,
      `Title Text: Coastal Ecosystem Restoration\nKey Points: Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands\nDescription Text: The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.`
    )

    expect(v1).toEqual({
      titleText: 'Coastal Ecosystem Restoration',
      keyPoints:
        'Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands',
      descriptionText:
        'The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.',
    })
  })
})

describe('AxSignature', () => {
  it('should create from a valid signature string', () => {
    const sig = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
    expect(sig.getInputFields()).toHaveLength(1)
    expect(sig.getOutputFields()).toHaveLength(2)
    expect(sig.toString()).toBe(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
  })

  it('should create from another AxSignature instance', () => {
    const original = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
    const clone = new AxSignature(original)
    expect(clone.toString()).toBe(original.toString())
    expect(clone.hash()).toBe(original.hash())
  })

  it('should throw AxSignatureValidationError for invalid string', () => {
    expect(() => new AxSignature('invalid-signature')).toThrow(
      'Invalid Signature'
    )
  })

  it('should set and get description', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    sig.setDescription('This is a Q&A signature.')
    expect(sig.getDescription()).toBe('This is a Q&A signature.')
    expect(sig.toString()).toContain('"This is a Q&A signature."')
  })

  it('should add input and output fields', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    sig.addInputField({
      name: 'userEmail',
      type: { name: 'string', isArray: false },
      description: 'User email address',
    })
    sig.addOutputField({
      name: 'userResponse',
      type: { name: 'string', isArray: false },
      description: 'User response',
    })

    expect(sig.getInputFields().length).toBe(2)
    expect(sig.getOutputFields().length).toBe(2)
  })

  it('should prevent adding fields with reserved names', () => {
    const sig = new AxSignature()
    expect(() =>
      sig.addInputField({
        name: 'string',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic')
    expect(() =>
      sig.addOutputField({
        name: 'response',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic')
  })

  it('should set input and output fields', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    sig.setInputFields([
      {
        name: 'userEmail',
        type: { name: 'string', isArray: false },
        description: 'User email',
      },
    ])
    sig.setOutputFields([
      {
        name: 'userResponse',
        type: { name: 'string', isArray: false },
        description: 'User response',
      },
    ])

    expect(sig.getInputFields().length).toBe(1)
    expect(sig.getOutputFields().length).toBe(1)
  })

  it('should handle complex field definitions', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    sig.addInputField({
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
      description: 'Context information',
    })
    sig.addOutputField({
      name: 'confidenceScore',
      type: { name: 'number', isArray: false },
      description: 'Confidence score',
      isOptional: true,
    })

    expect(sig.getInputFields().length).toBe(2)
    expect(sig.getOutputFields().length).toBe(2)
  })

  it('should generate a consistent hash', () => {
    const sig1 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
    const sig2 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
    const sig3 = new AxSignature('userQuestion:string -> modelAnswer:string')

    expect(sig1.hash()).toBe(sig2.hash())
    expect(sig1.hash()).not.toBe(sig3.hash())
  })

  it('should update hash when modified', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    const initialHash = sig.hash()
    sig.addOutputField({
      name: 'certaintyValue',
      type: { name: 'number', isArray: false },
    })
    const modifiedHash = sig.hash()

    expect(initialHash).not.toBe(modifiedHash)
  })

  it('should return a JSON representation', () => {
    const sig = new AxSignature(
      '"Q&A" userQuestion:string -> modelAnswer:string, certaintyValue:number'
    )
    const json = sig.toJSON()

    expect(json.id).toBe(sig.hash())
    expect(json.description).toBe('Q&A')
    expect(json.inputFields).toHaveLength(1)
    expect(json.outputFields).toHaveLength(2)
  })
})

describe('extractValues with AxSignature', () => {
  it('should extract values based on a signature', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string')
    const result: Record<string, unknown> = {}
    const content = `Model Answer: The answer is 42.`

    extractValues(sig, result, content)

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' })
  })

  it('should handle missing optional fields', () => {
    const sig = new AxSignature(
      'userQuestion:string -> modelAnswer:string, memoText?:string'
    )
    const content = 'Model Answer: The answer is 42.'
    const result = {}
    extractValues(sig, result, content)

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' })
  })

  it('should not return internal fields', () => {
    const sig2 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, thoughtProcess!:string'
    )
    const result: Record<string, unknown> = {}
    const content = `Model Answer: The answer is 42.
Thought Process: I am thinking.`

    extractValues(sig2, result, content)

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' })
  })
})
