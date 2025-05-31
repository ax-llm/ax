import { describe, expect, it } from 'vitest'

import { getModelInfo } from './modelinfo.js'

const models = [
  {
    key: 'claude-3',
    model: 'claude-3-5-sonnet',
    description: 'Claude 3.5 Sonnet',
  },
]

const modelInfo = [
  {
    name: 'claude-3-5-sonnet',
    currency: 'usd',
    promptTokenCostPer1M: 15000,
    completionTokenCostPer1M: 75000,
  },
  {
    name: 'gpt-4o-mini',
    currency: 'usd',
    promptTokenCostPer1M: 10000,
    completionTokenCostPer1M: 30000,
  },
]

describe('getModelInfo', () => {
  it('should return correct model info for exact match', () => {
    const result = getModelInfo({ model: 'claude-3-5-sonnet', modelInfo })
    expect(result).not.toBeNull()
    expect(result?.name).toBe('claude-3-5-sonnet')
    expect(result?.promptTokenCostPer1M).toBe(15000)
  })

  it('should handle model mapping', () => {
    const result = getModelInfo({ model: 'claude-3', modelInfo, models })
    expect(result).not.toBeNull()
    expect(result?.name).toBe('claude-3-5-sonnet')
    expect(result?.promptTokenCostPer1M).toBe(15000)
  })

  it('should handle vendor prefixes', () => {
    const result = getModelInfo({
      model: 'anthropic.claude-3-5-sonnet',
      modelInfo,
    })
    expect(result).not.toBeNull()
    expect(result?.name).toBe('claude-3-5-sonnet')
    expect(result?.promptTokenCostPer1M).toBe(15000)
  })

  describe('model name variations', () => {
    it('should handle date postfix', () => {
      const result = getModelInfo({
        model: 'claude-3-5-sonnet-20241022',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })

    it('should handle version postfix', () => {
      const result = getModelInfo({
        model: 'claude-3-5-sonnet-v2:0',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })

    it('should handle alternative date format', () => {
      const result = getModelInfo({
        model: 'claude-3-5-sonnet@20241022',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })

    it('should handle latest postfix', () => {
      const result = getModelInfo({
        model: 'claude-3-5-sonnet-latest',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })

    it('should handle numeric id postfix', () => {
      const result = getModelInfo({ model: 'gpt-4o-mini-8388383', modelInfo })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('gpt-4o-mini')
    })

    it('should handle complex version with date', () => {
      const result = getModelInfo({
        model: 'claude-3-5-sonnet-v2@20241022',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })

    it('should handle vendor prefix with version', () => {
      const result = getModelInfo({
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        modelInfo,
      })
      expect(result).not.toBeNull()
      expect(result?.name).toBe('claude-3-5-sonnet')
    })
  })

  it('should handle unknown model', () => {
    const result = getModelInfo({ model: 'unknown-model', modelInfo })
    expect(result).toBeNull()
  })
})
