import { describe, expect, it } from 'vitest';

import {
  formatDateWithTimezone,
  parseLLMFriendlyDate,
  parseLLMFriendlyDateRange,
  parseLLMFriendlyDateTime,
  parseLLMFriendlyDateTimeRange,
} from './datetime.js';
import type { AxField } from './sig.js';

const field: AxField = {
  name: 'date',
  type: { name: 'date', isArray: false },
};

const withTemporal = (temporal: unknown, test: () => void) => {
  const globalWithTemporal = globalThis as typeof globalThis & {
    Temporal?: unknown;
  };
  const original = globalWithTemporal.Temporal;
  globalWithTemporal.Temporal = temporal;

  try {
    test();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(globalWithTemporal, 'Temporal');
    } else {
      globalWithTemporal.Temporal = original;
    }
  }
};

describe('datetime parsing', () => {
  it('should parse ISO datetime with UTC timezone', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01T12:00:10Z');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 12:00:10 GMT');
  });

  it('should parse trimmed ISO datetime with lowercase z', () => {
    const dt = parseLLMFriendlyDateTime(field, ' 2022-01-01T12:00:10z ');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 12:00:10 GMT');
  });

  it('should parse ISO datetime with offset timezone', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01T12:00:10-05:00');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:10 GMT');
  });

  it('should parse ISO datetime with fractional seconds', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01T12:00:10.250Z');
    expect(dt?.toISOString()).toBe('2022-01-01T12:00:10.250Z');
  });

  it('should parse datetime with timezone abbreviation', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 EST');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT');
  });

  it('should parse datetime with seconds and timezone abbreviation', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00:10 EST');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:10 GMT');
  });

  it('should parse datetime with full timezone', () => {
    const dt = parseLLMFriendlyDateTime(
      field,
      '2022-01-01 12:00 America/New_York'
    );
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT');
  });

  it('should parse datetime with another full timezone', () => {
    const dt = parseLLMFriendlyDateTime(
      field,
      '2022-01-01 12:00 America/Los_Angeles'
    );
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 20:00:00 GMT');
  });

  it('should parse datetime with numeric offset', () => {
    const dt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 +05:30');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 06:30:00 GMT');
  });

  it('should parse datetime across DST boundary', () => {
    const summerDt = parseLLMFriendlyDateTime(field, '2022-07-01 12:00 EST');
    const winterDt = parseLLMFriendlyDateTime(field, '2022-01-01 12:00 EST');
    expect(summerDt?.getUTCHours()).toBe(winterDt?.getUTCHours());
  });

  it('should throw error for invalid datetime format', () => {
    expect(() => parseLLMFriendlyDateTime(field, '2022-01-01 12:00')).toThrow();
  });

  it('should throw error for invalid timezone', () => {
    expect(() =>
      parseLLMFriendlyDateTime(field, '2022-01-01 12:00 INVALID')
    ).toThrow();
  });

  it('should throw error for invalid datetime value', () => {
    expect(() =>
      parseLLMFriendlyDateTime(field, '2022-02-29 12:00 EST')
    ).toThrow();
  });
});

describe('Temporal integration', () => {
  it('should use Temporal.Instant for ISO datetime when available', () => {
    let input = '';

    withTemporal(
      {
        Instant: {
          from: (value: string) => {
            input = value;
            return {
              epochMilliseconds: Date.UTC(2022, 0, 1, 12, 0, 10),
            };
          },
        },
      },
      () => {
        const dt = parseLLMFriendlyDateTime(field, '2022-01-01t12:00:10z');
        expect(input).toBe('2022-01-01T12:00:10Z');
        expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 12:00:10 GMT');
      }
    );
  });

  it('should use Temporal.ZonedDateTime for named time zones when available', () => {
    let input = '';
    let options: unknown;

    withTemporal(
      {
        ZonedDateTime: {
          from: (value: string, opts: unknown) => {
            input = value;
            options = opts;
            return {
              year: 2022,
              month: 1,
              day: 1,
              hour: 12,
              minute: 0,
              second: 0,
              millisecond: 0,
              epochMilliseconds: Date.UTC(2022, 0, 1, 17, 0, 0),
            };
          },
        },
      },
      () => {
        const dt = parseLLMFriendlyDateTime(
          field,
          '2022-01-01 12:00 America/New_York'
        );
        expect(input).toBe('2022-01-01T12:00[America/New_York]');
        expect(options).toEqual({
          overflow: 'reject',
          disambiguation: 'compatible',
        });
        expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT');
      }
    );
  });

  it('should use Temporal.Instant for UTC formatting when available', () => {
    let epochMilliseconds = 0;
    let options: unknown;

    withTemporal(
      {
        Instant: {
          fromEpochMilliseconds: (value: number) => {
            epochMilliseconds = value;
            return {
              epochMilliseconds: value,
              toString: (opts: unknown) => {
                options = opts;
                return '2022-01-01T12:00:10Z';
              },
            };
          },
        },
      },
      () => {
        expect(
          formatDateWithTimezone(new Date(Date.UTC(2022, 0, 1, 12, 0, 10)))
        ).toBe('2022-01-01T12:00:10Z');
        expect(epochMilliseconds).toBe(Date.UTC(2022, 0, 1, 12, 0, 10));
        expect(options).toEqual({ smallestUnit: 'second' });
      }
    );
  });
});

describe('datetime formatting', () => {
  it('should format date in UTC', () => {
    expect(
      formatDateWithTimezone(new Date(Date.UTC(2022, 0, 1, 12, 0, 10)))
    ).toBe('2022-01-01T12:00:10Z');
  });
});

describe('range parsing', () => {
  it('should parse date range interval', () => {
    const range = parseLLMFriendlyDateRange(field, '2022-01-01/2022-01-05');
    expect(range?.start.toUTCString()).toBe('Sat, 01 Jan 2022 00:00:00 GMT');
    expect(range?.end.toUTCString()).toBe('Wed, 05 Jan 2022 00:00:00 GMT');
  });

  it('should parse date range JSON object', () => {
    const range = parseLLMFriendlyDateRange(
      field,
      '{"start":"2022-01-01","end":"2022-01-05"}'
    );
    expect(range?.start.toUTCString()).toBe('Sat, 01 Jan 2022 00:00:00 GMT');
    expect(range?.end.toUTCString()).toBe('Wed, 05 Jan 2022 00:00:00 GMT');
  });

  it('should parse datetime range interval', () => {
    const range = parseLLMFriendlyDateTimeRange(
      field,
      '2022-01-01T12:00:00Z/2022-01-01T13:30:00Z'
    );
    expect(range?.start.toUTCString()).toBe('Sat, 01 Jan 2022 12:00:00 GMT');
    expect(range?.end.toUTCString()).toBe('Sat, 01 Jan 2022 13:30:00 GMT');
  });

  it('should parse datetime range object with named time zones', () => {
    const range = parseLLMFriendlyDateTimeRange(field, {
      start: '2022-01-01 12:00 America/New_York',
      end: '2022-01-01 13:30 America/New_York',
    });
    expect(range?.start.toUTCString()).toBe('Sat, 01 Jan 2022 17:00:00 GMT');
    expect(range?.end.toUTCString()).toBe('Sat, 01 Jan 2022 18:30:00 GMT');
  });

  it('should throw for reversed ranges', () => {
    expect(() =>
      parseLLMFriendlyDateRange(field, '2022-01-05/2022-01-01')
    ).toThrow();
  });
});

describe('date parsing', () => {
  it('should parse valid date', () => {
    const dt = parseLLMFriendlyDate(field, '2022-01-01');
    expect(dt?.toUTCString()).toBe('Sat, 01 Jan 2022 00:00:00 GMT');
  });

  it('should parse date with leading zeros', () => {
    const dt = parseLLMFriendlyDate(field, '2022-02-05');
    expect(dt?.toUTCString()).toBe('Sat, 05 Feb 2022 00:00:00 GMT');
  });

  it('should parse date at year boundary', () => {
    const dt = parseLLMFriendlyDate(field, '2022-12-31');
    expect(dt?.toUTCString()).toBe('Sat, 31 Dec 2022 00:00:00 GMT');
  });

  it('should parse date in leap year', () => {
    const dt = parseLLMFriendlyDate(field, '2024-02-29');
    expect(dt?.toUTCString()).toBe('Thu, 29 Feb 2024 00:00:00 GMT');
  });

  it('should throw error for invalid date value', () => {
    expect(() => parseLLMFriendlyDate(field, '2022-01-32')).toThrow();
  });

  it('should throw error for invalid month', () => {
    expect(() => parseLLMFriendlyDate(field, '2022-13-01')).toThrow();
  });

  it('should throw error for invalid format', () => {
    expect(() => parseLLMFriendlyDate(field, '01-01-2022')).toThrow();
  });
});
