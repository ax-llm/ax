import test from 'ava'

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
  s: -1,
})

// Tests for extractValues
test('extractValues: extracts single output field', (t) => {
  const sig = new AxSignature('inputField1 -> outputField1')
  const values: Record<string, unknown> = {}
  const content = 'Output Field 1:This is the output content!'

  extractValues(sig, values, content)

  t.deepEqual(values, { outputField1: 'This is the output content!' })
})

test('extractValues: extracts multiple output fields', (t) => {
  const sig = new AxSignature('input1, input2 -> output1, output2')
  const values: Record<string, unknown> = {}
  const content = `Output 1: First output content
Output 2: Second\noutput\ncontent`

  extractValues(sig, values, content)

  t.deepEqual(values, {
    output1: 'First output content',
    output2: 'Second\noutput\ncontent',
  })
})

test('extractValues: preserves existing values', (t) => {
  const sig = new AxSignature('input1, input2 -> output1, output2')
  const values: Record<string, unknown> = {
    output1: 'existing content',
  }
  const content = 'Output 2: New content'

  extractValues(sig, values, content)

  t.deepEqual(values, {
    output1: 'existing content',
    output2: 'New content',
  })
})

test('extractValues: handles multiline output content', (t) => {
  const sig = new AxSignature('input -> output1, output2')
  const values: Record<string, unknown> = {}
  const content = `Output 1: This is a multi-line
output content for field 1
Output 2:And this is the
multi-line content for field 2`

  extractValues(sig, values, content)

  t.deepEqual(values, {
    output1: 'This is a multi-line\noutput content for field 1',
    output2: 'And this is the\nmulti-line content for field 2',
  })
})

// Tests for streamingExtractValues
test('streamingExtractValues: handles streaming output fields', (t) => {
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
  streamingExtractFinalValue(values, state, content)

  t.deepEqual(values, {
    output1: 'First output content',
    outputField2: 'Second output content',
  })
})

test('streamingExtractValues: handles partial output label', (t) => {
  const sig = new AxSignature('input -> output1')
  const values: Record<string, unknown> = {}
  const state = createInitialState()

  // Split in middle of "Output" label
  let content = 'Out'
  streamingExtractValues(sig, values, state, content)
  content += 'put 1: Content here'
  streamingExtractValues(sig, values, state, content)
  streamingExtractFinalValue(values, state, content)

  t.deepEqual(values, {
    output1: 'Content here',
  })
})

test('handles multiple output occurrences', (t) => {
  const sig = new AxSignature('input -> output1, output2')
  const values: Record<string, unknown> = {}
  const content = `Output: First content
Output: Updated content
Output 1: Final content`

  extractValues(sig, values, content)

  // Should use the last occurrence
  t.deepEqual(values, {
    output1: 'Final content',
  })
})

test('extracts content with various output field formats', (t) => {
  const sig = new AxSignature('input -> custom1, custom2, custom3')
  const values: Record<string, unknown> = {}
  const content = `Custom 1: Generic output
Custom 2: First custom output
Custom 3: Another output`

  extractValues(sig, values, content)

  t.deepEqual(values, {
    custom1: 'Generic output',
    custom2: 'First custom output',
    custom3: 'Another output',
  })
})

test('streamingExtractValues: handles incremental content with multiple fields', (t) => {
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
  streamingExtractFinalValue(values, state, content)

  t.deepEqual(values, {
    outputField1: 'First content here',
    outputField2: 'Second content',
    outputField3: 'Third content',
  })
})

test('handles empty and whitespace content', (t) => {
  const sig = new AxSignature('input -> output1?, output2?')
  const values: Record<string, unknown> = {}
  const content = `Output 1: 
Output 2:    
Output:    `

  extractValues(sig, values, content)

  t.deepEqual(values, {
    output1: undefined,
    output2: 'Output:',
  })
})

test('error handling for malformed content', (t) => {
  const sig = new AxSignature('input -> output1, output2')
  const values: Record<string, unknown> = {}

  // Content without proper Output: prefix
  const malformedContent = 'Some random content without output prefix'

  extractValues(sig, values, malformedContent)

  // Should not extract any values
  t.deepEqual(values, {})
})

test('extractValues: handles array output JSON', (t) => {
  const sig = new AxSignature('input -> output1:string[]')
  const values: Record<string, unknown> = {}

  const content = 'Output 1: ["test", "test2"]'

  extractValues(sig, values, content)

  t.deepEqual(values, { output1: ['test', 'test2'] })
})

test('extractValues: handles array output markdown', (t) => {
  const sig = new AxSignature('input -> output1:string[]')
  const values: Record<string, unknown> = {}

  const content = `Output 1:
  - test
  - test2`

  extractValues(sig, values, content)

  t.deepEqual(values, { output1: ['test', 'test2'] })
})
