import { describe, expect, it } from 'vitest'

import { AxAIRefusalError } from '../util/apicall.js'

describe('AxAIRefusalError', () => {
  it('should create refusal error with message only', () => {
    const error = new AxAIRefusalError('Content was refused')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AxAIRefusalError)
    expect(error.name).toBe('AxAIRefusalError')
    expect(error.message).toBe(
      'Model refused to fulfill request: Content was refused'
    )
    expect(error.refusalMessage).toBe('Content was refused')
    expect(error.model).toBeUndefined()
    expect(error.requestId).toBeUndefined()
    expect(error.timestamp).toBeDefined()
    expect(error.errorId).toBeDefined()
  })

  it('should create refusal error with all parameters', () => {
    const error = new AxAIRefusalError(
      'Safety violation detected',
      'gpt-4',
      'req-123'
    )

    expect(error.refusalMessage).toBe('Safety violation detected')
    expect(error.model).toBe('gpt-4')
    expect(error.requestId).toBe('req-123')
    expect(error.message).toContain('Safety violation detected')
    expect(error.toString()).toContain('gpt-4')
    expect(error.toString()).toContain('req-123')
  })

  it('should have proper error properties', () => {
    const error = new AxAIRefusalError('Test refusal')

    expect(typeof error.timestamp).toBe('string')
    expect(typeof error.errorId).toBe('string')
    expect(error.errorId.length).toBeGreaterThan(0)
    expect(error.stack).toBeDefined()
  })

  it('should be serializable to JSON', () => {
    const error = new AxAIRefusalError('Test refusal', 'model-1', 'req-456')
    const serialized = JSON.stringify(error)
    const parsed = JSON.parse(serialized)

    expect(parsed.name).toBe('AxAIRefusalError')
    expect(parsed.refusalMessage).toBe('Test refusal')
    expect(parsed.model).toBe('model-1')
    expect(parsed.requestId).toBe('req-456')
  })

  it('should format toString() with all information', () => {
    const error = new AxAIRefusalError('Content blocked', 'claude-3', 'req-789')
    const str = error.toString()

    expect(str).toContain('AxAIRefusalError')
    expect(str).toContain('Content blocked')
    expect(str).toContain('claude-3')
    expect(str).toContain('req-789')
    expect(str).toContain('Timestamp:')
    expect(str).toContain('Error ID:')
  })

  it('should handle minimal information gracefully', () => {
    const error = new AxAIRefusalError('Basic refusal')
    const str = error.toString()

    expect(str).toContain('AxAIRefusalError')
    expect(str).toContain('Basic refusal')
    expect(str).not.toContain('Model:')
    expect(str).not.toContain('Request ID:')
    expect(str).toContain('Timestamp:')
    expect(str).toContain('Error ID:')
  })
})
