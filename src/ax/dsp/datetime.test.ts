import { describe, expect, it } from 'vitest'

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js'
import type { AxField } from './sig.js'

const field: AxField = {
  name: 'date',
  type: { name: 'date', isArray: false },
}

describe('datetime parsing', () => {
  it('should parse datetime with timezone abbreviation', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 EST')
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT')
  })

  it('should parse datetime with seconds and timezone abbreviation', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00:10 EST')
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:10 GMT')
  })

  it('should parse datetime with full timezone', () => {
    const dt = parseLLMFriendlyDateTime(
      field,
      '2022-01-01 12:00 America/New_York'
    )
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT')
  })

  it('should parse datetime with another full timezone', () => {
    const dt = parseLLMFriendlyDateTime(
      field,
      '2022-01-01 12:00 America/Los_Angeles'
    )
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 20:00:00 GMT')
  })

  it('should parse datetime across DST boundary', () => {
    const summerDt = parseLLMFriendlyDateTime(field, '2022-07-01 12:00 EST')
    const winterDt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 EST')
    expect(summerDt?.getUTCHours()).toBe(winterDt?.getUTCHours())
  })

  it('should throw error for invalid datetime value', () => {
    expect(() => parseLLMFriendlyDateTime(field, '2022-01-01 12:00')).toThrow()
  })

  it('should throw error for invalid timezone', () => {
    expect(() =>
      parseLLMFriendlyDateTime(field, '2022-01-01 12:00 INVALID')
    ).toThrow()
  })
})

describe('date parsing', () => {
  it('should parse valid date', () => {
    const dt = parseLLMFriendlyDate(field, '2022-01-01')
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 00:00:00 GMT')
  })

  it('should parse date with leading zeros', () => {
    const dt = parseLLMFriendlyDate(field, '2022-02-05')
    expect(dt?.toUTCString()).toBe('Sat, 05 Feb 2022 00:00:00 GMT')
  })

  it('should parse date at year boundary', () => {
    const dt = parseLLMFriendlyDate(field, '2022-12-31')
    expect(dt?.toUTCString()).toBe('Sat, 31 Dec 2022 00:00:00 GMT')
  })

  it('should parse date in leap year', () => {
    const dt = parseLLMFriendlyDate(field, '2024-02-29')
    expect(dt?.toUTCString()).toBe('Thu, 29 Feb 2024 00:00:00 GMT')
  })

  it('should throw error for invalid date value', () => {
    expect(() => parseLLMFriendlyDate(field, '2022-01-32')).toThrow()
  })

  it('should throw error for invalid month', () => {
    expect(() => parseLLMFriendlyDate(field, '2022-13-01')).toThrow()
  })

  it('should throw error for invalid format', () => {
    expect(() => parseLLMFriendlyDate(field, '01-01-2022')).toThrow()
  })
})
