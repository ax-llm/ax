import moment from 'moment-timezone'

import type { AxField } from './sig.js'
import { ValidationError } from './validate.js'

export function parseLLMFriendlyDate(
  field: Readonly<AxField>,
  dateStr: string,
  required: boolean = false
) {
  try {
    return _parseLLMFriendlyDate(dateStr)
  } catch (err) {
    if (field.isOptional && !required) {
      return
    }
    const message = (err as Error).message
    throw new ValidationError({ fields: [field], message, value: dateStr })
  }
}

function _parseLLMFriendlyDate(dateStr: string) {
  // Validate the date string format
  if (!moment(dateStr, 'YYYY-MM-DD', true).isValid()) {
    throw new Error(
      'Invalid date format. Please provide the date in "YYYY-MM-DD" format.'
    )
  }

  // Parse the date and create a UTC moment object at midnight
  const date = moment.utc(dateStr, 'YYYY-MM-DD').startOf('day')

  return date.toDate()
}

export function parseLLMFriendlyDateTime(
  field: Readonly<AxField>,
  dateStr: string,
  required: boolean = false
) {
  try {
    return _parseLLMFriendlyDateTime(dateStr)
  } catch (err) {
    if (field.isOptional && !required) {
      return
    }
    const message = (err as Error).message
    throw new ValidationError({ fields: [field], message, value: dateStr })
  }
}

function _parseLLMFriendlyDateTime(dateTimeStr: string) {
  // Validate the date and time string format
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?) (.+)$/
  const match = dateTimeStr.match(dateTimeRegex)
  if (!match) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" format, followed by the timezone.'
    )
  }

  const [, dateTime, timeZone] = match

  if (!dateTime || !timeZone) {
    throw new Error(
      'Invalid date and time format. Please provide the date and time in "YYYY-MM-DD HH:mm" or "YYYY-MM-DD HH:mm:ss" format, followed by the timezone.'
    )
  }

  // Try to parse the timezone
  const zone = moment.tz.zone(timeZone)

  // If still not found, throw an error
  if (!zone) {
    throw new Error(
      `Unrecognized time zone ${timeZone}. Please provide a valid time zone name, abbreviation, or offset. For example, "America/New_York", or "EST".`
    )
  }

  // Parse the date and time in the specified time zone
  const date = moment.tz(
    dateTime,
    ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss'],
    zone.name
  )

  // Check if the date and time are valid
  if (!date.isValid()) {
    throw new Error(
      'Invalid date and time values. Please ensure all components are correct.'
    )
  }

  // Convert to UTC
  return date.utc().toDate()
}

export const formatDateWithTimezone = (date: Readonly<Date>) => {
  const momentDate = moment(date).utc()
  return momentDate.format(`YYYY-MM-DD HH:mm:ss UTC`)
}
