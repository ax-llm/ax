import { describe, expect, it } from 'vitest'

import { parseMarkdownList } from './util.js'

// Tests for parseMarkdownList
describe('parseMarkdownList', () => {
  it('parses a simple markdown list', () => {
    const content = `Output 1:
    - value1
    - value2
    - value3`

    const result = parseMarkdownList(content)

    expect(result).toEqual(['value1', 'value2', 'value3'])
  })

  it('parses a simple markdown list 2', () => {
    const content = `
      * value1
      * value2
      * value3`

    const result = parseMarkdownList(content)
    expect(result).toEqual(['value1', 'value2', 'value3'])
  })

  it('parses a numbered markdown list', () => {
    const content = `Output 1:
    1. value1
    2. value2
    3. value3`

    const result = parseMarkdownList(content)
    expect(result).toEqual(['value1', 'value2', 'value3'])
  })

  it('fails on non-list content', () => {
    const content = 'not a list'

    expect(() => parseMarkdownList(content)).toThrow()
  })

  it('fails on mixed content', () => {
    const content = `
    - value1
    Header
    - value3`

    expect(() => parseMarkdownList(content)).toThrow()
  })
})
