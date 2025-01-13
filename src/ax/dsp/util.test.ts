import test from 'ava'

import { parseMarkdownList } from './util.js'

// Tests for parseMarkdownList
test('parseMarkdownList: parses a simple markdown list', (t) => {
  const content = `Output 1:
  - value1
  - value2
  - value3`

  const result = parseMarkdownList(content)

  t.deepEqual(result, ['value1', 'value2', 'value3'])
})

test('parseMarkdownList: parses a simple markdown list 2', (t) => {
  const content = `
    * value1
    * value2
    * value3`

  const result = parseMarkdownList(content)
  t.deepEqual(result, ['value1', 'value2', 'value3'])
})

test('parseMarkdownList: parses a numbered markdown list', (t) => {
  const content = `Output 1:
  1. value1
  2. value2
  3. value3`

  const result = parseMarkdownList(content)
  t.deepEqual(result, ['value1', 'value2', 'value3'])
})

test('parseMarkdownList: fails on non-list content', (t) => {
  const content = 'not a list'

  t.throws(() => parseMarkdownList(content))
})

test('parseMarkdownList: fails on mixed content', (t) => {
  const content = `
  - value1
  Header
  - value3`

  t.throws(() => parseMarkdownList(content))
})
