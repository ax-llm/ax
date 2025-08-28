import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

import {
  createInvalidDateError,
  createInvalidDateTimeError,
} from './errors.js';
import type { AxField } from './sig.js';

// Extend Day.js with required plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

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
  // Validate the date string format
  if (!dayjs(dateStr, 'YYYY-MM-DD', true).isValid()) {
    throw new Error(
      'Invalid date format. Please provide the date in "YYYY-MM-DD" format.'
    );
  }

  // Parse the date and create a UTC dayjs object at midnight
  // @ts-ignore - utc method exists after plugin extension
  const date = dayjs.utc(dateStr, 'YYYY-MM-DD').startOf('day');

  return date.toDate();
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
  // Validate the date and time string format
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) (.+)$/;
  const match = dateTimeStr.match(dateTimeRegex);
  if (!match) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" format, followed by the timezone.'
    );
  }

  const [, dateTime, timeZone] = match;

  if (!dateTime || !timeZone) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" format, followed by the timezone.'
    );
  }

  // Day.js doesn't have a direct equivalent to moment.tz.zone, so we attempt to parse and validate the timezone
  try {
    // Determine the format based on whether seconds are included
    const format =
      dateTime.includes(':') && dateTime.split(':').length === 3
        ? 'YYYY-MM-DD HH:mm:ss'
        : 'YYYY-MM-DD HH:mm';

    // Parse the date and time in the specified time zone
    // @ts-ignore - tz method exists after plugin extension
    const date = dayjs.tz(dateTime, format, timeZone);

    // Check if the date and time are valid
    if (!date.isValid()) {
      throw new Error(
        'Invalid date and time values. Please ensure all components are correct.'
      );
    }

    // Convert to UTC
    // @ts-ignore - utc method exists after plugin extension
    return date.utc().toDate();
  } catch (_err) {
    throw new Error(
      `Unrecognized time zone ${timeZone}. Please provide a valid time zone name, abbreviation, or offset. For example, "America/New_York", or "EST".`
    );
  }
}

export const formatDateWithTimezone = (date: Readonly<Date>) => {
  // @ts-ignore - utc method exists after plugin extension
  const dayjsDate = dayjs(date).utc();
  return dayjsDate.format('YYYY-MM-DD HH:mm:ss [UTC]');
};
