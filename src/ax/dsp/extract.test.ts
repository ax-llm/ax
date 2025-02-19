import { describe, expect, test } from 'vitest'

import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
} from './extract.js'
import { AxSignature } from './sig.js'

// Helper function to create a clean initial state
const createInitialState = (): extractionState => ({
  currField: undefined,
  extractedFields: [],
  streamedIndex: {},
  s: -1,
})

describe('extractValues', () => {
  test('extracts single output field', () => {
    const sig = new AxSignature('inputField1 -> outputField1')
    const values: Record<string, unknown> = {}
    const content = 'Output Field 1:This is the output content!'

    extractValues(sig, values, content)

    expect(values).toEqual({ outputField1: 'This is the output content!' })
  })

  test('extracts multiple output fields', () => {
    const sig = new AxSignature('input1, input2 -> output1, output2')
    const values: Record<string, unknown> = {}
    const content = `Output 1: First output content
Output 2: Second\noutput\ncontent`

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: 'First output content',
      output2: 'Second\noutput\ncontent',
    })
  })

  test('preserves existing values', () => {
    const sig = new AxSignature('input1, input2 -> output1, output2')
    const values: Record<string, unknown> = {
      output1: 'existing content',
    }
    const content = 'Output 2: New content'

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: 'existing content',
      output2: 'New content',
    })
  })

  test('handles multiline output content', () => {
    const sig = new AxSignature('input -> output1, output2')
    const values: Record<string, unknown> = {}
    const content = `Output 1: This is a multi-line
output content for field 1
Output 2:And this is the
multi-line content for field 2`

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: 'This is a multi-line\noutput content for field 1',
      output2: 'And this is the\nmulti-line content for field 2',
    })
  })

  test('handles array output JSON', () => {
    const sig = new AxSignature('input -> output1:string[]')
    const values: Record<string, unknown> = {}
    const content = 'Output 1: ["test", "test2"]'

    extractValues(sig, values, content)

    expect(values).toEqual({ output1: ['test', 'test2'] })
  })

  test('handles array output markdown', () => {
    const sig = new AxSignature('input -> output1:string[]')
    const values: Record<string, unknown> = {}
    const content = `Output 1:
  - test
  - test2`

    extractValues(sig, values, content)

    expect(values).toEqual({ output1: ['test', 'test2'] })
  })

  // New test cases
  test('handles nested JSON objects', () => {
    const sig = new AxSignature('input -> output1:json')
    const values: Record<string, unknown> = {}
    const content = 'Output 1: {"name": "test", "values": [1, 2, 3]}'

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: {
        name: 'test',
        values: [1, 2, 3],
      },
    })
  })

  test('handles boolean values', () => {
    const sig = new AxSignature('input -> output1:boolean, output2:boolean')
    const values: Record<string, unknown> = {}
    const content = `Output 1: true
Output 2: false`

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: true,
      output2: false,
    })
  })
})

describe('streamingExtractValues', () => {
  test('handles streaming output fields', () => {
    const sig = new AxSignature('input -> output1, outputField2')
    const values: Record<string, unknown> = {}
    const state = createInitialState()

    // First chunk
    let content = 'Output 1: First '
    streamingExtractValues(sig, values, state, content)
    content += 'output content\n'
    streamingExtractValues(sig, values, state, content)
    content += 'Output Field 2: Second '
    streamingExtractValues(sig, values, state, content)
    content += 'output content'
    streamingExtractFinalValue(sig, values, state, content)

    expect(values).toEqual({
      output1: 'First output content',
      outputField2: 'Second output content',
    })
  })

  test('handles partial output label', () => {
    const sig = new AxSignature('input -> output1')
    const values: Record<string, unknown> = {}
    const state = createInitialState()

    // Split in middle of "Output" label
    let content = 'Out'
    streamingExtractValues(sig, values, state, content)
    content += 'put 1: Content here'
    streamingExtractValues(sig, values, state, content)
    streamingExtractFinalValue(sig, values, state, content)

    expect(values).toEqual({
      output1: 'Content here',
    })
  })

  test('handles incremental content with multiple fields', () => {
    const sig = new AxSignature(
      'input -> outputField1, outputField2, outputField3'
    )
    const values: Record<string, unknown> = {}
    const state = createInitialState()

    // Send content in chunks
    const chunks = [
      'Output Field 1: First',
      ' content here\n',
      'Output Field 2: Sec',
      'ond content\n',
      'Output Field 3: Third content',
    ]

    let content = ''

    for (const chunk of chunks) {
      content += chunk
      streamingExtractValues(sig, values, state, content)
    }
    streamingExtractFinalValue(sig, values, state, content)

    expect(values).toEqual({
      outputField1: 'First content here',
      outputField2: 'Second content',
      outputField3: 'Third content',
    })
  })

  // New test case
  test('handles streaming JSON array content', () => {
    const sig = new AxSignature('input -> output1:string[]')
    const values: Record<string, unknown> = {}
    const state = createInitialState()

    let content = 'Output 1: ["first"'
    streamingExtractValues(sig, values, state, content)
    content += ', "second", '
    streamingExtractValues(sig, values, state, content)
    content += '"third"]'
    streamingExtractFinalValue(sig, values, state, content)

    expect(values).toEqual({
      output1: ['first', 'second', 'third'],
    })
  })
})

describe('error handling', () => {
  test('handles empty and whitespace content', () => {
    const sig = new AxSignature('input -> output1?, output2?')
    const values: Record<string, unknown> = {}
    const content = `Output 1: 
Output 2:    
Output:    `

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: undefined,
      output2: 'Output:',
    })
  })

  test('handles malformed content', () => {
    const sig = new AxSignature('input -> output1, output2')
    const values: Record<string, unknown> = {}
    const malformedContent = 'Some random content without output prefix'

    extractValues(sig, values, malformedContent)

    expect(values).toEqual({})
  })

  // New test cases
  test('throws validation error for invalid markdown list', () => {
    const sig = new AxSignature('input -> output1:string[]')
    const values: Record<string, unknown> = {}
    const content = `Output 1:
    - test
    invalid format
    - test2`

    expect(() => extractValues(sig, values, content)).toThrow(
      /Could not parse markdown list: mixed content detected/
    )
    expect(values).toEqual({}) // Values should remain unchanged
  })

  test('handles missing optional fields', () => {
    const sig = new AxSignature('input -> output1, output2?')
    const values: Record<string, unknown> = {}
    const content = 'Output 1: Some content'

    extractValues(sig, values, content)

    expect(values).toEqual({
      output1: 'Some content',
      output2: undefined,
    })
  })
})
