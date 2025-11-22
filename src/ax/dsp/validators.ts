import type { AxField } from './sig.js';
import {
  createInvalidURLError,
  createStringConstraintError,
  createNumberConstraintError,
} from './errors.js';

/**
 * Validate URL format
 * @throws ValidationError if URL is invalid
 */
export function validateURL(value: unknown, field: Readonly<AxField>): void {
  if (typeof value !== 'string') {
    throw createInvalidURLError(field, String(value), 'URL must be a string');
  }

  try {
    new URL(value);
  } catch (_err) {
    throw createInvalidURLError(
      field,
      value,
      'Invalid URL format. Expected a valid URL like https://example.com'
    );
  }
}

/**
 * Validate string constraints (minLength, maxLength, pattern)
 * @throws ValidationError if constraints are violated
 */
export function validateStringConstraints(
  value: unknown,
  field: Readonly<AxField>
): void {
  if (typeof value !== 'string') {
    return; // Type validation is handled elsewhere
  }

  const type = field.type;
  if (!type) return;

  // Validate minLength
  if (type.minLength !== undefined && value.length < type.minLength) {
    throw createStringConstraintError(
      field,
      value,
      'minLength',
      type.minLength
    );
  }

  // Validate maxLength
  if (type.maxLength !== undefined && value.length > type.maxLength) {
    throw createStringConstraintError(
      field,
      value,
      'maxLength',
      type.maxLength
    );
  }

  // Validate pattern
  if (type.pattern !== undefined) {
    const regex = new RegExp(type.pattern);
    if (!regex.test(value)) {
      throw createStringConstraintError(field, value, 'pattern', type.pattern);
    }
  }

  // Validate format
  if (type.format === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw createStringConstraintError(
        field,
        value,
        'format',
        'valid email address'
      );
    }
  }

  if (type.format === 'uri' || type.format === 'url') {
    try {
      new URL(value);
    } catch (_err) {
      throw createStringConstraintError(field, value, 'format', 'valid URL');
    }
  }
}

/**
 * Validate number constraints (minimum, maximum)
 * @throws ValidationError if constraints are violated
 */
export function validateNumberConstraints(
  value: unknown,
  field: Readonly<AxField>
): void {
  if (typeof value !== 'number') {
    return; // Type validation is handled elsewhere
  }

  const type = field.type;
  if (!type) return;

  // Validate minimum
  if (type.minimum !== undefined && value < type.minimum) {
    throw createNumberConstraintError(field, value, 'minimum', type.minimum);
  }

  // Validate maximum
  if (type.maximum !== undefined && value > type.maximum) {
    throw createNumberConstraintError(field, value, 'maximum', type.maximum);
  }
}
