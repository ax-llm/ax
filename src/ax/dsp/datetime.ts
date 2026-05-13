import {
  createInvalidDateError,
  createInvalidDateRangeError,
  createInvalidDateTimeError,
  createInvalidDateTimeRangeError,
} from './errors.js';
import type { AxField } from './sig.js';

const dateFormatError =
  'Invalid date format. Please provide the date in "YYYY-MM-DD" format.';
const dateTimeFormatError =
  'Invalid date and time format. Use ISO 8601 like "YYYY-MM-DDTHH:mm:ssZ" or "YYYY-MM-DDTHH:mm:ss+05:30". Legacy "YYYY-MM-DD HH:mm Timezone" values are also accepted.';
const rangeFormatError =
  'Invalid range format. Provide a JSON object with "start" and "end", a two-item array, or an interval using start/end.';

export type AxDateRange = {
  start: Date;
  end: Date;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type DateTimeParts = DateParts & {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

type TemporalInstantLike = {
  epochMilliseconds: number;
  toString?: (options?: { smallestUnit?: 'second' | 'millisecond' }) => string;
};

type TemporalLike = {
  Instant?: {
    from: (value: string) => TemporalInstantLike;
    fromEpochMilliseconds?: (value: number) => TemporalInstantLike;
  };
  PlainDate?: {
    from: (value: string, options?: { overflow: 'reject' }) => DateParts;
  };
  ZonedDateTime?: {
    from: (
      value: string,
      options?: { overflow: 'reject'; disambiguation: 'compatible' }
    ) => DateTimeParts & { epochMilliseconds: number };
  };
};

const getTemporal = () =>
  (globalThis as typeof globalThis & { Temporal?: TemporalLike }).Temporal;

const getUtcTimestamp = ({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
}: DateParts &
  Partial<
    Pick<DateTimeParts, 'hour' | 'minute' | 'second' | 'millisecond'>
  >) => {
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  );
  date.setUTCFullYear(year);
  return date.getTime();
};

const isSameUtcDateTime = (date: Date, parts: DateTimeParts) =>
  date.getUTCFullYear() === parts.year &&
  date.getUTCMonth() + 1 === parts.month &&
  date.getUTCDate() === parts.day &&
  date.getUTCHours() === parts.hour &&
  date.getUTCMinutes() === parts.minute &&
  date.getUTCSeconds() === parts.second &&
  date.getUTCMilliseconds() === parts.millisecond;

const parseDateParts = (dateStr: string): DateParts => {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(dateFormatError);
  }

  const temporal = getTemporal();
  if (temporal?.PlainDate) {
    try {
      const date = temporal.PlainDate.from(dateStr, { overflow: 'reject' });
      return {
        year: date.year,
        month: date.month,
        day: date.day,
      };
    } catch {
      throw new Error(dateFormatError);
    }
  }

  const [, yearStr, monthStr, dayStr] = match;
  const parts = {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };

  const date = new Date(getUtcTimestamp(parts));
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day
  ) {
    throw new Error(dateFormatError);
  }

  return parts;
};

const parseMilliseconds = (fractionalSecond: string | undefined) =>
  Number((fractionalSecond ?? '').padEnd(3, '0').slice(0, 3));

const parseDateTimeParts = (dateTime: string): DateTimeParts => {
  const match = dateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/
  );
  if (!match) {
    throw new Error(dateTimeFormatError);
  }

  const [
    ,
    yearStr,
    monthStr,
    dayStr,
    hourStr,
    minuteStr,
    secondStr,
    fractionalSecond,
  ] = match;
  const parts = {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: secondStr ? Number(secondStr) : 0,
    millisecond: parseMilliseconds(fractionalSecond),
  };

  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    );
  }

  const date = new Date(getUtcTimestamp(parts));
  if (!isSameUtcDateTime(date, parts)) {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    );
  }

  return parts;
};

const parseOffsetMinutes = (timeZone: string) => {
  if (/^(?:UTC|GMT|Z)$/i.test(timeZone)) {
    return 0;
  }

  const match = timeZone.match(
    /^(?:(?:UTC|GMT))?([+-])(\d{2})(?::?(\d{2}))?$/i
  );
  if (!match) {
    return;
  }

  const [, sign, hourStr, minuteStr] = match;
  const hours = Number(hourStr);
  const minutes = minuteStr ? Number(minuteStr) : 0;

  if (hours > 23 || minutes > 59) {
    return;
  }

  const offset = hours * 60 + minutes;
  return sign === '-' ? -offset : offset;
};

const formatOffsetMinutes = (offsetMinutes: number) => {
  if (offsetMinutes === 0) {
    return 'Z';
  }

  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (abs % 60).toString().padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
};

const normalizeDateTimeSeparator = (dateTime: string) =>
  dateTime.replace(/^(\d{4}-\d{2}-\d{2})[Tt ]/, '$1T');

const timeZonePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getTimeZonePartsFormatter = (timeZone: string) => {
  const cached = timeZonePartsFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  });
  timeZonePartsFormatterCache.set(timeZone, formatter);
  return formatter;
};

const getPartsInTimeZone = (date: Date, timeZone: string): DateTimeParts => {
  const formatter = getTimeZonePartsFormatter(timeZone);
  const entries = formatter
    .formatToParts(date)
    .map((part) => [part.type, part.value]);
  const parts = Object.fromEntries(entries) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: Number(parts.fractionalSecond ?? 0),
  };
};

const getNamedTimeZoneOffsetMs = (timeZone: string, timestamp: number) => {
  const parts = getPartsInTimeZone(new Date(timestamp), timeZone);
  return getUtcTimestamp(parts) - timestamp;
};

const isSameDateTimeParts = (left: DateTimeParts, right: DateTimeParts) =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second &&
  left.millisecond === right.millisecond;

const parseTemporalOffsetDateTime = (dateTime: string, timeZone: string) => {
  const temporal = getTemporal();
  if (!temporal?.Instant) {
    return;
  }

  const offsetMinutes = parseOffsetMinutes(timeZone);
  if (offsetMinutes === undefined) {
    throw new Error(dateTimeFormatError);
  }

  const temporalDateTime = normalizeDateTimeSeparator(dateTime);
  const temporalOffset = formatOffsetMinutes(offsetMinutes);

  try {
    const instant = temporal.Instant.from(
      `${temporalDateTime}${temporalOffset}`
    );
    return new Date(instant.epochMilliseconds);
  } catch {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    );
  }
};

const parseTemporalNamedTimeZoneDateTime = (
  dateTime: string,
  timeZone: string,
  parts: DateTimeParts
) => {
  const temporal = getTemporal();
  if (!temporal?.ZonedDateTime) {
    return;
  }

  const temporalDateTime = normalizeDateTimeSeparator(dateTime);

  try {
    const zonedDateTime = temporal.ZonedDateTime.from(
      `${temporalDateTime}[${timeZone}]`,
      { overflow: 'reject', disambiguation: 'compatible' }
    );

    if (!isSameDateTimeParts(zonedDateTime, parts)) {
      throw new Error(
        'Invalid date and time values. Please ensure all components are correct.'
      );
    }

    return new Date(zonedDateTime.epochMilliseconds);
  } catch (err) {
    if (err instanceof RangeError) {
      return;
    }

    throw err;
  }
};

const parseOffsetDateTime = (dateTimeStr: string) => {
  const match = dateTimeStr.match(
    /^(\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?)\s*(Z|(?:UTC|GMT)?[+-]\d{2}(?::?\d{2})?)$/i
  );
  if (!match) {
    return;
  }

  const [, dateTime, timeZone] = match;
  if (!dateTime || !timeZone) {
    throw new Error(dateTimeFormatError);
  }

  const temporalDate = parseTemporalOffsetDateTime(dateTime, timeZone);
  if (temporalDate) {
    return temporalDate;
  }

  const offsetMinutes = parseOffsetMinutes(timeZone);
  if (offsetMinutes === undefined) {
    throw new Error(dateTimeFormatError);
  }

  const parts = parseDateTimeParts(dateTime);
  return new Date(getUtcTimestamp(parts) - offsetMinutes * 60_000);
};

const parseNamedTimeZoneDateTime = (dateTimeStr: string) => {
  const match = dateTimeStr.match(
    /^(\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?)\s+(.+)$/
  );
  if (!match) {
    throw new Error(dateTimeFormatError);
  }

  const [, dateTime, timeZone] = match;
  if (!dateTime || !timeZone) {
    throw new Error(dateTimeFormatError);
  }

  const offsetMinutes = parseOffsetMinutes(timeZone);
  const parts = parseDateTimeParts(dateTime);

  if (offsetMinutes !== undefined) {
    return new Date(getUtcTimestamp(parts) - offsetMinutes * 60_000);
  }

  const temporalDate = parseTemporalNamedTimeZoneDateTime(
    dateTime,
    timeZone,
    parts
  );
  if (temporalDate) {
    return temporalDate;
  }

  try {
    return new Date(getTimestampForNamedTimeZone(parts, timeZone));
  } catch (err) {
    if (!(err instanceof RangeError)) {
      throw err;
    }

    throw new Error(
      `Unrecognized time zone ${timeZone}. Please provide a valid time zone name, abbreviation, or offset. For example, "America/New_York", "EST", or "+05:30".`
    );
  }
};

const getTimestampForNamedTimeZone = (
  parts: DateTimeParts,
  timeZone: string
) => {
  const utcTimestamp = getUtcTimestamp(parts);
  const offset = getNamedTimeZoneOffsetMs(timeZone, utcTimestamp);
  let timestamp = utcTimestamp - offset;
  const adjustedOffset = getNamedTimeZoneOffsetMs(timeZone, timestamp);

  if (adjustedOffset !== offset) {
    timestamp = utcTimestamp - adjustedOffset;
  }

  const actualParts = getPartsInTimeZone(new Date(timestamp), timeZone);
  if (!isSameDateTimeParts(actualParts, parts)) {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    );
  }

  return timestamp;
};

export function parseLLMFriendlyDate(
  field: Readonly<AxField>,
  dateStr: string,
  required = false
) {
  try {
    return ParseLlmFriendlyDate(dateStr);
  } catch (err) {
    if (field.isOptional && !required) {
      return;
    }
    const message = (err as Error).message;
    throw createInvalidDateError(field, dateStr, message);
  }
}

function ParseLlmFriendlyDate(dateStr: string) {
  const parts = parseDateParts(dateStr.trim());
  return new Date(getUtcTimestamp(parts));
}

const stringifyRangeValue = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value);

const stripCodeFence = (value: string) => {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value.trim();
};

const parseRangeString = (value: string): { start: unknown; end: unknown } => {
  const text = stripCodeFence(value);

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return getRangeEndpoints(JSON.parse(text));
    } catch {
      throw new Error(rangeFormatError);
    }
  }

  const slashParts = text.split('/');
  if (slashParts.length === 2) {
    return {
      start: slashParts[0]?.trim(),
      end: slashParts[1]?.trim(),
    };
  }

  const delimiterMatch = text.match(
    /^(.+?)\s+(?:to|through|until|-|–|—)\s+(.+)$/i
  );
  if (delimiterMatch) {
    return {
      start: delimiterMatch[1]?.trim(),
      end: delimiterMatch[2]?.trim(),
    };
  }

  throw new Error(rangeFormatError);
};

const getRangeEndpoints = (
  value: unknown
): { start: unknown; end: unknown } => {
  if (typeof value === 'string') {
    return parseRangeString(value);
  }

  if (Array.isArray(value) && value.length === 2) {
    return {
      start: value[0],
      end: value[1],
    };
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const start = record.start ?? record.from;
    const end = record.end ?? record.to;

    if (start !== undefined && end !== undefined) {
      return { start, end };
    }
  }

  throw new Error(rangeFormatError);
};

const parseRangeValue = (
  value: unknown,
  parseEndpoint: (value: string) => Date
): AxDateRange => {
  const { start, end } = getRangeEndpoints(value);
  const parseRangeEndpoint = (endpoint: unknown) => {
    if (endpoint instanceof Date) {
      return endpoint;
    }
    if (typeof endpoint === 'string') {
      return parseEndpoint(endpoint);
    }
    throw new Error(rangeFormatError);
  };

  const startDate = parseRangeEndpoint(start);
  const endDate = parseRangeEndpoint(end);

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error(
      'Invalid range. End must be greater than or equal to start.'
    );
  }

  return {
    start: startDate,
    end: endDate,
  };
};

export function parseLLMFriendlyDateRange(
  field: Readonly<AxField>,
  value: unknown,
  required = false
) {
  try {
    return parseRangeValue(value, ParseLlmFriendlyDate);
  } catch (err) {
    if (field.isOptional && !required) {
      return;
    }
    const message = (err as Error).message;
    throw createInvalidDateRangeError(
      field,
      stringifyRangeValue(value),
      message
    );
  }
}

export function parseLLMFriendlyDateTime(
  field: Readonly<AxField>,
  dateStr: string,
  required = false
) {
  try {
    return ParseLlmFriendlyDateTime(dateStr);
  } catch (err) {
    if (field.isOptional && !required) {
      return;
    }
    const message = (err as Error).message;
    throw createInvalidDateTimeError(field, dateStr, message);
  }
}

function ParseLlmFriendlyDateTime(dateTimeStr: string) {
  const value = dateTimeStr.trim();
  const offsetDateTime = parseOffsetDateTime(value);
  if (offsetDateTime) {
    return offsetDateTime;
  }

  return parseNamedTimeZoneDateTime(value);
}

export function parseLLMFriendlyDateTimeRange(
  field: Readonly<AxField>,
  value: unknown,
  required = false
) {
  try {
    return parseRangeValue(value, ParseLlmFriendlyDateTime);
  } catch (err) {
    if (field.isOptional && !required) {
      return;
    }
    const message = (err as Error).message;
    throw createInvalidDateTimeRangeError(
      field,
      stringifyRangeValue(value),
      message
    );
  }
}

export const formatDateOnly = (date: Readonly<Date>) =>
  date.toISOString().slice(0, 10);

export const formatDateRange = (range: Readonly<AxDateRange>) => ({
  start: formatDateOnly(range.start),
  end: formatDateOnly(range.end),
});

export const formatDateWithTimezone = (date: Readonly<Date>) => {
  const temporal = getTemporal();
  if (temporal?.Instant?.fromEpochMilliseconds) {
    const instant = temporal.Instant.fromEpochMilliseconds(date.getTime());
    if (instant.toString) {
      const smallestUnit =
        date.getUTCMilliseconds() === 0 ? 'second' : 'millisecond';
      return instant.toString({ smallestUnit });
    }
  }

  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export const formatDateTimeRange = (range: Readonly<AxDateRange>) => ({
  start: formatDateWithTimezone(range.start),
  end: formatDateWithTimezone(range.end),
});
