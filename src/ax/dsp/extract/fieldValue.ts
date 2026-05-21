/* eslint-disable @typescript-eslint/naming-convention */

import {
  parseLLMFriendlyDate,
  parseLLMFriendlyDateRange,
  parseLLMFriendlyDateTime,
  parseLLMFriendlyDateTimeRange,
} from '../datetime.js';
import {
  createInvalidArrayError,
  createInvalidJsonError,
  createRequiredFieldMissingError,
  createTypeValidationError,
} from '../errors.js';
import type { AxField } from '../sig.js';
import { validateWithStandardSchema } from '../standardSchema.js';
import { parseMarkdownList } from '../util.js';
import {
  validateNumberConstraints,
  validateStringConstraints,
  validateURL,
} from '../validators.js';

const convertValueToType = (
  field: Readonly<AxField>,
  val: unknown,
  required = false
) => {
  switch (field.type?.name) {
    case 'code':
      return extractBlock(String(val));

    case 'string':
      return typeof val === 'string' ? val : String(val);

    case 'number': {
      const v = Number(val);
      if (Number.isNaN(v)) {
        if (field.isOptional && !required) {
          return;
        }
        throw new Error('Invalid number');
      }
      return v;
    }

    case 'boolean': {
      if (typeof val === 'boolean') {
        return val;
      }
      const v = String(val).toLowerCase();
      if (v === 'true') {
        return true;
      }
      if (v === 'false') {
        return false;
      }
      if (field.isOptional && !required) {
        return;
      }
      throw new Error('Invalid boolean');
    }

    case 'date':
      return parseLLMFriendlyDate(field, String(val), required);

    case 'dateRange':
      return parseLLMFriendlyDateRange(field, val, required);

    case 'datetime':
      return parseLLMFriendlyDateTime(field, String(val), required);

    case 'datetimeRange':
      return parseLLMFriendlyDateTimeRange(field, val, required);

    case 'class': {
      const className = String(val);
      if (field.type.options && !field.type.options.includes(className)) {
        if (field.isOptional) {
          return;
        }
        throw new Error(
          `Invalid class '${val}', expected one of the following: ${field.type.options.join(', ')}`
        );
      }
      return className as string;
    }

    default:
      return val as string;
  }
};

export function validateAndParseFieldValue(
  field: Readonly<AxField>,
  fieldValue: string | undefined
): unknown {
  if (
    !fieldValue ||
    fieldValue === '' ||
    /^(null|undefined)\s*$/i.test(fieldValue)
  ) {
    if (field.isOptional) {
      return;
    }
    throw createRequiredFieldMissingError(field);
  }

  let value: unknown | undefined;

  if (field.type?.name === 'json' && !field.type?.isArray) {
    try {
      const text = extractBlock(fieldValue);
      value = JSON.parse(text);
      return value;
    } catch (e) {
      if (field.schema) {
        return validateWithStandardSchema(field.schema, field.name, fieldValue);
      }
      throw createInvalidJsonError(field, (e as Error).message);
    }
  }

  if (field.type?.isArray) {
    try {
      try {
        value = JSON.parse(fieldValue);
      } catch {
        value = parseMarkdownList(fieldValue);
      }
      if (!Array.isArray(value)) {
        throw new Error('Expected an array');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (
        msg.includes('no valid list items found') ||
        msg === 'Expected an array'
      ) {
        value = [fieldValue];
      } else {
        throw createInvalidArrayError(field, msg);
      }
    }
  }

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (item !== undefined) {
          let v = typeof item === 'string' ? item.trim() : item;

          if (
            typeof v === 'string' &&
            (field.type?.name === 'object' ||
              (field.type?.name as string) === 'json')
          ) {
            try {
              const jsonText = extractBlock(v);
              v = JSON.parse(jsonText);
            } catch {}
          }

          value[index] = convertValueToType(field, v, true);
        }
      }
    } else {
      value = convertValueToType(field, fieldValue);
    }
  } catch (e) {
    throw createTypeValidationError(field, fieldValue, (e as Error).message);
  }

  if (typeof value === 'string' && value === '') {
    return undefined;
  }

  const type = field.type;
  if (type && value !== undefined) {
    if (type.name === 'url') {
      validateURL(value, field);
    }

    if (type.name === 'string' || type.name === 'code') {
      validateStringConstraints(value, field);
    }

    if (type.name === 'number') {
      validateNumberConstraints(value, field);
    }

    if (type.isArray && Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          if (type.name === 'string' || type.name === 'code') {
            validateStringConstraints(item, field);
          } else if (type.name === 'number') {
            validateNumberConstraints(item, field);
          }
        }
      }
    }
  }

  if (field.schema && value !== undefined) {
    value = validateWithStandardSchema(field.schema, field.name, value);
  }

  return value;
}

export const extractBlock = (input: string): string => {
  const markdownBlockPattern = /```([A-Za-z]*)\s*([\s\S]*?)\s*```/g;
  const match = markdownBlockPattern.exec(input);
  if (!match) {
    return input;
  }
  if (match.length === 3) {
    return match[2] as string;
  }
  if (match.length === 2) {
    return match[1] as string;
  }
  return input;
};
