import moment from 'moment-timezone';

import { ValidationError } from './extract.js';
import type { AxField } from './sig.js';

// eslint-disable-next-line @typescript-eslint/naming-convention
export function parseLLMFriendlyDate(
  field: Readonly<AxField>,
  dateStr: string
) {
  try {
    return _parseLLMFriendlyDate(dateStr);
  } catch (err) {
    const message = (err as Error).message;
    throw new ValidationError({ field, message, value: dateStr });
  }
}

function _parseLLMFriendlyDate(dateStr: string) {
  // Validate the date string format
  if (!moment(dateStr, 'YYYY-MM-DD', true).isValid()) {
    throw new Error(
      'Invalid date format. Please provide the date in "YYYY-MM-DD" format.'
    );
  }

  // Parse the date and create a UTC moment object at midnight
  const date = moment.utc(dateStr, 'YYYY-MM-DD').startOf('day');

  return date.toDate();
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export function parseLLMFriendlyDateTime(
  field: Readonly<AxField>,
  dateStr: string
) {
  try {
    return _parseLLMFriendlyDateTime(dateStr);
  } catch (err) {
    const message = (err as Error).message;
    throw new ValidationError({ field, message, value: dateStr });
  }
}

function _parseLLMFriendlyDateTime(dateTimeStr: string) {
  // Validate the date and time string format
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.+)$/;
  const match = dateTimeStr.match(dateTimeRegex);
  if (!match) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm Timezone" format.'
    );
  }

  const [, dateTime, timeZone] = match;

  if (!dateTime || !timeZone) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm Timezone" format.'
    );
  }

  // Try to parse the timezone
  const zone = moment.tz.zone(timeZone);

  // If still not found, throw an error
  if (!zone) {
    throw new Error(
      `Unrecognized time zone ${timeZone}. Please provide a valid time zone name, abbreviation, or offset. For example, "America/New_York", or "EST".`
    );
  }

  // Parse the date and time in the specified time zone
  const date = moment.tz(dateTime, 'YYYY-MM-DD HH:mm', zone.name);

  // Check if the date and time are valid
  if (!date.isValid()) {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    );
  }

  // Convert to UTC
  return date.utc().toDate();
}
