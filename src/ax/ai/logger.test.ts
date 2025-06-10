import { describe, expect, it, vi } from 'vitest'

import { AxMockAIService } from './mock/api.js'

describe('Logger functionality', () => {
  it('should use custom logger in AI service', () => {
    const mockLogger = vi.fn()
    const ai = new AxMockAIService({
      options: {
        debug: true,
        logger: mockLogger,
      },
    })

    const logger = ai.getLogger()
    logger('test message')

    expect(mockLogger).toHaveBeenCalledWith('test message')
  })

  it('should use default logger when none provided', () => {
    const ai = new AxMockAIService()
    const logger = ai.getLogger()

    // Should not throw and should be a function
    expect(typeof logger).toBe('function')
  })

  it('should pass logger through options', () => {
    const mockLogger = vi.fn()
    const ai = new AxMockAIService()

    ai.setOptions({ logger: mockLogger })
    const logger = ai.getLogger()
    logger('test message')

    expect(mockLogger).toHaveBeenCalledWith('test message')
  })
})
