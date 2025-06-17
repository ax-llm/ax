import { describe, expect, it } from 'vitest'

import { AxGen } from './generate.js'
import { AxSignature } from './sig.js'
import { ax, f, s } from './template.js'

describe('AxSignature Tagged Templates', () => {
  it('should create basic signature from template', () => {
    const sig = s`question:string -> answer:string`

    expect(sig.getInputFields()).toHaveLength(1)
    expect(sig.getOutputFields()).toHaveLength(1)
    expect(sig.getInputFields()[0]?.name).toBe('question')
    expect(sig.getOutputFields()[0]?.name).toBe('answer')
  })

  it('should handle simple string interpolation', () => {
    const inputType = 'string'
    const outputType = 'number'
    const sig = s`input:${inputType} -> output:${outputType}`

    expect(sig.getInputFields()[0]?.type?.name).toBe('string')
    expect(sig.getOutputFields()[0]?.type?.name).toBe('number')
  })

  it('should handle field type interpolation', () => {
    const inputType = f.string('User question')
    const outputType = f.class(
      ['positive', 'negative'],
      'Sentiment classification'
    )

    const sig = s`question:${inputType} -> sentiment:${outputType}`

    const inputField = sig.getInputFields()[0]
    const outputField = sig.getOutputFields()[0]

    expect(inputField?.name).toBe('question')
    expect(inputField?.type?.name).toBe('string')
    expect(inputField?.description).toBe('User question')

    expect(outputField?.name).toBe('sentiment')
    expect(outputField?.type?.name).toBe('class')
    expect(outputField?.type?.options).toEqual(['positive', 'negative'])
    expect(outputField?.description).toBe('Sentiment classification')
  })

  it('should handle description interpolation', () => {
    const description = 'Analyze customer feedback'
    const sig = s`"${description}" feedback:string -> sentiment:string`

    expect(sig.getDescription()).toBe(description)
  })

  it('should handle complex multi-field signatures', () => {
    const sig = s`
      inputText:${f.string('Input text')} -> 
      category:${f.class(['tech', 'business', 'sports'])},
      confidence:${f.number('Confidence score 0-1')},
      tags:${f.array(f.string())}
    `

    expect(sig.getInputFields()).toHaveLength(1)
    expect(sig.getOutputFields()).toHaveLength(3)

    const categoryField = sig.getOutputFields()[0]
    const confidenceField = sig.getOutputFields()[1]
    const tagsField = sig.getOutputFields()[2]

    expect(categoryField?.name).toBe('category')
    expect(categoryField?.type?.name).toBe('class')
    expect(categoryField?.type?.options).toEqual(['tech', 'business', 'sports'])

    expect(confidenceField?.name).toBe('confidence')
    expect(confidenceField?.type?.name).toBe('number')
    expect(confidenceField?.description).toBe('Confidence score 0-1')

    expect(tagsField?.name).toBe('tags')
    expect(tagsField?.type?.name).toBe('string')
    expect(tagsField?.type?.isArray).toBe(true)
  })

  it('should handle optional and internal fields', () => {
    const sig = s`
      input:string -> 
      output:${f.optional(f.string())},
      reasoning:${f.internal(f.string('Internal reasoning'))}
    `

    const outputField = sig.getOutputFields()[0]
    const reasoningField = sig.getOutputFields()[1]

    expect(outputField?.isOptional).toBe(true)
    expect(reasoningField?.isInternal).toBe(true)
    expect(reasoningField?.description).toBe('Internal reasoning')
  })

  it('should handle code fields', () => {
    const sig = s`
      problem:string -> 
      solution:${f.code('python', 'Python code solution')}
    `

    const solutionField = sig.getOutputFields()[0]
    expect(solutionField?.type?.name).toBe('code')
    expect(solutionField?.type?.options).toBeUndefined()
    expect(solutionField?.description).toBe('Python code solution')
  })

  it('should handle date and datetime fields', () => {
    const sig = s`
      event:string -> 
      startDate:${f.date('Event start date')},
      createdAt:${f.datetime('Creation timestamp')}
    `

    const startDateField = sig.getOutputFields()[0]
    const createdAtField = sig.getOutputFields()[1]

    expect(startDateField?.type?.name).toBe('date')
    expect(startDateField?.description).toBe('Event start date')

    expect(createdAtField?.type?.name).toBe('datetime')
    expect(createdAtField?.description).toBe('Creation timestamp')
  })

  it('should handle json and boolean fields', () => {
    const sig = s`
      data:${f.json('Input JSON data')} -> 
      isValid:${f.boolean('Validation result')},
      metadata:${f.json()}
    `

    const inputField = sig.getInputFields()[0]
    const isValidField = sig.getOutputFields()[0]
    const metadataField = sig.getOutputFields()[1]

    expect(inputField?.type?.name).toBe('json')
    expect(inputField?.description).toBe('Input JSON data')

    expect(isValidField?.type?.name).toBe('boolean')
    expect(isValidField?.description).toBe('Validation result')

    expect(metadataField?.type?.name).toBe('json')
  })

  it('should handle array fields of different types', () => {
    const sig = s`
      input:string -> 
      tags:${f.array(f.string())},
      scores:${f.array(f.number())},
      flags:${f.array(f.boolean())},
      categories:${f.array(f.class(['a', 'b', 'c']))}
    `

    const fields = sig.getOutputFields()

    expect(fields[0]?.type?.name).toBe('string')
    expect(fields[0]?.type?.isArray).toBe(true)

    expect(fields[1]?.type?.name).toBe('number')
    expect(fields[1]?.type?.isArray).toBe(true)

    expect(fields[2]?.type?.name).toBe('boolean')
    expect(fields[2]?.type?.isArray).toBe(true)

    expect(fields[3]?.type?.name).toBe('class')
    expect(fields[3]?.type?.isArray).toBe(true)
    expect(fields[3]?.type?.options).toEqual(['a', 'b', 'c'])
  })

  it('should handle combined modifiers', () => {
    const sig = s`
      input:string -> 
      optionalArray:${f.optional(f.array(f.string()))},
      internalClass:${f.internal(f.class(['x', 'y']))},
      complexField:${f.optional(f.internal(f.array(f.number('Scores'))))}
    `

    const fields = sig.getOutputFields()

    expect(fields[0]?.isOptional).toBe(true)
    expect(fields[0]?.type?.isArray).toBe(true)
    expect(fields[0]?.type?.name).toBe('string')

    expect(fields[1]?.isInternal).toBe(true)
    expect(fields[1]?.type?.name).toBe('class')
    expect(fields[1]?.type?.options).toEqual(['x', 'y'])

    expect(fields[2]?.isOptional).toBe(true)
    expect(fields[2]?.isInternal).toBe(true)
    expect(fields[2]?.type?.isArray).toBe(true)
    expect(fields[2]?.type?.name).toBe('number')
    expect(fields[2]?.description).toBe('Scores')
  })

  it('should be equivalent to string-based signatures', () => {
    const stringSig = new AxSignature(
      'question:string -> answer:string, confidence:number'
    )
    const templateSig = s`question:string -> answer:string, confidence:number`

    expect(templateSig.getInputFields()).toHaveLength(
      stringSig.getInputFields().length
    )
    expect(templateSig.getOutputFields()).toHaveLength(
      stringSig.getOutputFields().length
    )

    expect(templateSig.getInputFields()[0]?.name).toBe(
      stringSig.getInputFields()[0]?.name
    )
    expect(templateSig.getOutputFields()[0]?.name).toBe(
      stringSig.getOutputFields()[0]?.name
    )
    expect(templateSig.getOutputFields()[1]?.name).toBe(
      stringSig.getOutputFields()[1]?.name
    )
  })
})

describe('Field Builders', () => {
  it('should create string fields', () => {
    const field1 = f.string()
    const field2 = f.string('Description')

    expect(field1.type).toBe('string')
    expect(field1.description).toBeUndefined()

    expect(field2.type).toBe('string')
    expect(field2.description).toBe('Description')
  })

  it('should create class fields', () => {
    const classField = f.class(['option1', 'option2'], 'Classification')

    expect(classField.type).toBe('class')
    expect(classField.options).toEqual(['option1', 'option2'])
    expect(classField.description).toBe('Classification')
  })

  it('should create code fields', () => {
    const codeField = f.code('javascript', 'JS code')

    expect(codeField.type).toBe('code')
    expect(codeField.options).toEqual(['javascript'])
    expect(codeField.description).toBe('JS code')
  })

  it('should create array fields', () => {
    const arrayField = f.array(f.string('Item'))

    expect(arrayField.type).toBe('string')
    expect(arrayField.isArray).toBe(true)
    expect(arrayField.description).toBe('Item')
  })

  it('should create optional fields', () => {
    const optionalField = f.optional(f.number('Score'))

    expect(optionalField.type).toBe('number')
    expect(optionalField.isOptional).toBe(true)
    expect(optionalField.description).toBe('Score')
  })

  it('should create internal fields', () => {
    const internalField = f.internal(f.string('Reasoning'))

    expect(internalField.type).toBe('string')
    expect(internalField.isInternal).toBe(true)
    expect(internalField.description).toBe('Reasoning')
  })

  it('should chain modifiers', () => {
    const complexField = f.optional(f.internal(f.array(f.class(['a', 'b']))))

    expect(complexField.type).toBe('class')
    expect(complexField.isArray).toBe(true)
    expect(complexField.isOptional).toBe(true)
    expect(complexField.isInternal).toBe(true)
    expect(complexField.options).toEqual(['a', 'b'])
  })
})

describe('AxGen Tagged Templates', () => {
  it('should create AxGen instance from template', () => {
    const gen = ax`question:string -> answer:string`

    expect(gen).toBeInstanceOf(AxGen)
    expect(gen.getSignature().getInputFields()).toHaveLength(1)
    expect(gen.getSignature().getOutputFields()).toHaveLength(1)
    expect(gen.getSignature().getInputFields()[0]?.name).toBe('question')
    expect(gen.getSignature().getOutputFields()[0]?.name).toBe('answer')
  })

  it('should handle field type interpolation with AxGen', () => {
    const inputType = f.string('User question')
    const outputType = f.class(
      ['positive', 'negative'],
      'Sentiment classification'
    )

    const gen = ax`question:${inputType} -> sentiment:${outputType}`

    const inputField = gen.getSignature().getInputFields()[0]
    const outputField = gen.getSignature().getOutputFields()[0]

    expect(inputField?.name).toBe('question')
    expect(inputField?.type?.name).toBe('string')
    expect(inputField?.description).toBe('User question')

    expect(outputField?.name).toBe('sentiment')
    expect(outputField?.type?.name).toBe('class')
    expect(outputField?.type?.options).toEqual(['positive', 'negative'])
    expect(outputField?.description).toBe('Sentiment classification')
  })

  it('should handle complex multi-field signatures with AxGen', () => {
    const gen = ax`
      inputText:${f.string('Input text')} -> 
      category:${f.class(['tech', 'business', 'sports'])},
      confidence:${f.number('Confidence score 0-1')},
      tags:${f.array(f.string())}
    `

    expect(gen.getSignature().getInputFields()).toHaveLength(1)
    expect(gen.getSignature().getOutputFields()).toHaveLength(3)

    const categoryField = gen.getSignature().getOutputFields()[0]
    const confidenceField = gen.getSignature().getOutputFields()[1]
    const tagsField = gen.getSignature().getOutputFields()[2]

    expect(categoryField?.name).toBe('category')
    expect(categoryField?.type?.name).toBe('class')
    expect(categoryField?.type?.options).toEqual(['tech', 'business', 'sports'])

    expect(confidenceField?.name).toBe('confidence')
    expect(confidenceField?.type?.name).toBe('number')
    expect(confidenceField?.description).toBe('Confidence score 0-1')

    expect(tagsField?.name).toBe('tags')
    expect(tagsField?.type?.name).toBe('string')
    expect(tagsField?.type?.isArray).toBe(true)
  })

  it('should handle optional and internal fields with AxGen', () => {
    const gen = ax`
      input:string -> 
      output:${f.optional(f.string())},
      reasoning:${f.internal(f.string('Internal reasoning'))}
    `

    const outputField = gen.getSignature().getOutputFields()[0]
    const reasoningField = gen.getSignature().getOutputFields()[1]

    expect(outputField?.isOptional).toBe(true)
    expect(reasoningField?.isInternal).toBe(true)
    expect(reasoningField?.description).toBe('Internal reasoning')
  })

  it('should be equivalent to AxGen constructor with string signature', () => {
    const stringSig = 'question:string -> answer:string, confidence:number'
    const genFromString = new AxGen(stringSig)
    const genFromTemplate = ax`question:string -> answer:string, confidence:number`

    expect(genFromTemplate.getSignature().getInputFields()).toHaveLength(
      genFromString.getSignature().getInputFields().length
    )
    expect(genFromTemplate.getSignature().getOutputFields()).toHaveLength(
      genFromString.getSignature().getOutputFields().length
    )

    expect(genFromTemplate.getSignature().getInputFields()[0]?.name).toBe(
      genFromString.getSignature().getInputFields()[0]?.name
    )
    expect(genFromTemplate.getSignature().getOutputFields()[0]?.name).toBe(
      genFromString.getSignature().getOutputFields()[0]?.name
    )
    expect(genFromTemplate.getSignature().getOutputFields()[1]?.name).toBe(
      genFromString.getSignature().getOutputFields()[1]?.name
    )
  })
})
