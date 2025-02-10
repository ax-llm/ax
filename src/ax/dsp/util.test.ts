/* spell-checker: disable */
import { describe, expect, it, test } from 'vitest'

import { LRUCache, matchesContent, parseMarkdownList } from './util.js'

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

describe('matchesContent', () => {
  describe('exact matches', () => {
    test('should find exact match at the end', () => {
      expect(matchesContent('hello world how are you', 'are you')).toBe(16)
    })

    test('should find exact match with content after it', () => {
      expect(matchesContent('hello world how are you doing', 'are you')).toBe(
        16
      )
    })

    test('should find exact match from startIndex', () => {
      expect(matchesContent('are you hello are you there', 'are you', 10)).toBe(
        14
      )
    })

    test('should not find exact match before startIndex', () => {
      const result = matchesContent('are you hello world', 'are you', 5)
      expect(result).toBe(-1)
    })

    test('should find match within other text', () => {
      expect(matchesContent('howareyouthere', 'are you')).toBe(-1)
    })
  })

  describe('partial matches', () => {
    test('should find single character partial match', () => {
      expect(matchesContent('hello world how a', 'are you')).toBe(-2)
    })

    test('should find two character partial match', () => {
      expect(matchesContent('hello world how ar', 'are you')).toBe(-2)
    })

    test('should find partial word match', () => {
      expect(matchesContent('hello world how are', 'are you')).toBe(-2)
    })

    test('should find partial match within word', () => {
      expect(matchesContent('howare', 'are you')).toBe(-2)
    })
  })

  describe('no matches', () => {
    test('should return -1 for no match at all', () => {
      expect(matchesContent('hello world', 'are you')).toBe(-1)
    })

    test('should return -1 when content is shorter than prefix', () => {
      expect(matchesContent('hi', 'hello')).toBe(-1)
    })

    test('should return -1 when partial match is followed by wrong character', () => {
      expect(matchesContent('hello world how are w', 'are you')).toBe(-1)
    })
  })

  describe('edge cases', () => {
    test('should handle empty content', () => {
      expect(matchesContent('', 'are you')).toBe(-3)
    })

    test('should handle whitespace-only content', () => {
      expect(matchesContent('   ', 'are you')).toBe(-3)
      expect(matchesContent('\t\n  ', 'are you')).toBe(-3)
      expect(matchesContent('\n\n', 'are you')).toBe(-3)
    })

    test('should handle empty prefix', () => {
      expect(matchesContent('hello world', '')).toBe(0)
    })

    test('should handle multi-character matches at the end', () => {
      expect(matchesContent('hello worlare', 'are you')).toBe(-2)
    })
  })

  describe('prefix cache', () => {
    test('should reuse cached prefixes', () => {
      let prefixCache = new LRUCache<string, string[]>(500)

      // First call creates cache
      matchesContent('hello a', 'are you', 0, prefixCache)

      // Get the cached prefixes
      const cachedPrefixes = prefixCache.get('are you')
      expect(cachedPrefixes).toBeDefined()
      expect(cachedPrefixes).toEqual([
        'a',
        'ar',
        'are',
        'are ',
        'are y',
        'are yo',
        'are you',
      ])

      // Second call should use cache
      matchesContent('hello ar', 'are you')
      const cachedPrefixesAfterSecondCall = prefixCache.get('are you')
      expect(cachedPrefixesAfterSecondCall).toBe(cachedPrefixes)
    })
  })
})
