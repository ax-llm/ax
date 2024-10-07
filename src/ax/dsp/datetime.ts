import moment from 'moment-timezone';

// eslint-disable-next-line @typescript-eslint/naming-convention
export function parseLLMFriendlyDate(dateStr: string) {
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
export function parseLLMFriendlyDateTime(dateTimeStr: string) {
  // Validate the date and time string format
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([A-Z]{1,5})$/;
  const match = dateTimeStr.match(dateTimeRegex);
  if (!match) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm:ss TZ" format.'
    );
  }

  const [, dateTime, timeZoneAbbr] = match;

  if (!dateTime || !timeZoneAbbr) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm:ss TZ" format.'
    );
  }

  if (!moment.tz.zone(timeZoneAbbr)) {
    throw new Error(
      'Unrecognized time zone abbreviation. Please provide a valid time zone abbreviation.'
    );
  }

  // Parse the date and time in the specified time zone
  const date = moment.tz(dateTime, 'YYYY-MM-DD HH:mm:ss', timeZoneAbbr);

  // Check if the date and time are valid
  if (!date.isValid()) {
    throw new Error(
      'Invalid date and time values or unrecognized time zone abbreviation. Please ensure all components are correct.'
    );
  }

  // Convert to UTC
  return date.utc().toDate();
}
