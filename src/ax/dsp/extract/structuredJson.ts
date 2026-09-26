import {
  createInvalidJsonError,
  createRequiredFieldMissingError,
  createTypeValidationError,
  ValidationError,
} from '../errors.js';
import type { AxField, AxSignature } from '../sig.js';
import { validateWithStandardSchema } from '../standardSchema.js';
import {
  validateNumberConstraints,
  validateStringConstraints,
  validateURL,
} from '../validators.js';

function nestedFieldFromType(
  name: string,
  fieldType: AxField['type']
): AxField {
  return {
    name,
    title: name,
    description: fieldType?.description,
    type: fieldType
      ? {
          name: fieldType.name,
          isArray: fieldType.isArray,
          options: fieldType.options,
          fields: fieldType.fields,
          minLength: fieldType.minLength,
          maxLength: fieldType.maxLength,
          minimum: fieldType.minimum,
          maximum: fieldType.maximum,
          pattern: fieldType.pattern,
          patternDescription: fieldType.patternDescription,
          format: fieldType.format,
          description: fieldType.description,
        }
      : undefined,
  };
}

function parseJsonStringFieldValue(
  field: Readonly<AxField>,
  value: unknown
): unknown {
  if (value === null || value === undefined || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (e) {
    if (field.schema) {
      return value;
    }
    throw createInvalidJsonError(field, (e as Error).message);
  }
}

export function isFlexibleJsonField(field: Readonly<AxField>): boolean {
  const type = field.type;
  if (!type) return false;
  return type.name === 'json' || (type.name === 'object' && !type.fields);
}

function parseJsonStringValuesForField(
  field: Readonly<AxField>,
  value: unknown
): unknown {
  const type = field.type;
  if (!type || value === undefined || value === null) {
    return value;
  }

  if (type.isArray) {
    if (!Array.isArray(value)) {
      return value;
    }

    if (isFlexibleJsonField(field)) {
      return value.map((item) => parseJsonStringFieldValue(field, item));
    }

    if (type.fields) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          parseJsonStringValuesForFields(
            type.fields,
            item as Record<string, unknown>
          );
        }
      }
    }

    return value;
  }

  if (isFlexibleJsonField(field)) {
    return parseJsonStringFieldValue(field, value);
  }

  if (
    type.name === 'object' &&
    type.fields &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    parseJsonStringValuesForFields(
      type.fields,
      value as Record<string, unknown>
    );
  }

  return value;
}

function parseJsonStringValuesForFields(
  fields: NonNullable<AxField['type']>['fields'],
  values: Record<string, unknown>
): void {
  if (!fields) return;

  for (const [name, fieldType] of Object.entries(fields)) {
    if (!(name in values)) {
      continue;
    }

    const field = nestedFieldFromType(name, {
      name: fieldType.type,
      isArray: fieldType.isArray,
      options: fieldType.options as string[] | undefined,
      fields: fieldType.fields,
      minLength: fieldType.minLength,
      maxLength: fieldType.maxLength,
      minimum: fieldType.minimum,
      maximum: fieldType.maximum,
      pattern: fieldType.pattern,
      patternDescription: fieldType.patternDescription,
      format: fieldType.format,
      description: fieldType.description,
    });
    values[name] = parseJsonStringValuesForField(field, values[name]);
  }
}

export function parseStructuredJsonFieldValues(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>
): void {
  for (const field of signature.getOutputFields()) {
    if (!(field.name in values)) {
      continue;
    }
    values[field.name] = parseJsonStringValuesForField(
      field,
      values[field.name]
    );
  }
}

export function parseStructuredJsonFieldValuesPartial(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>
): void {
  for (const field of signature.getOutputFields()) {
    if (!(field.name in values)) {
      continue;
    }

    try {
      values[field.name] = parseJsonStringValuesForField(
        field,
        values[field.name]
      );
    } catch (e) {
      if (
        e instanceof ValidationError &&
        isFlexibleJsonField(field) &&
        typeof values[field.name] === 'string'
      ) {
        delete values[field.name];
        continue;
      }
      throw e;
    }
  }
}

export function validateStructuredOutputValues(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>,
  options?: { allowMissingRequired?: boolean; rejectUnknownFields?: boolean }
): void {
  const declaredOutputFields = signature.getOutputFields();
  const outputFields = declaredOutputFields.filter(
    (field) => !field.isInternal
  );
  if (options?.rejectUnknownFields) {
    rejectUnknownStructuredFields(values, declaredOutputFields, 'output');
  }

  for (const field of outputFields) {
    const value = values[field.name];

    if (value === undefined || value === null) {
      if (!field.isOptional && !options?.allowMissingRequired) {
        throw createRequiredFieldMissingError(field);
      }
      continue;
    }

    const typedValue = validateStructuredFieldValue(field, value, options);
    values[field.name] = typedValue;

    if (field.schema) {
      values[field.name] = validateWithStandardSchema(
        field.schema,
        field.name,
        typedValue
      );
    }
  }
}

// A structured JSON value must have its field's declared type. As in the text
// contract, a numeric string becomes a number (through Number()) and
// "true"/"false" a boolean; any other mismatch is a validation error, which
// the model gets as a correction. JSON, media, URL and date values keep their
// own validation.
function coerceStructuredValue(
  field: Readonly<AxField>,
  value: unknown
): unknown {
  const invalid = (detail: string) =>
    createTypeValidationError(
      field,
      typeof value === 'string' ? value : JSON.stringify(value),
      detail
    );

  switch (field.type?.name) {
    case 'number': {
      if (typeof value === 'number') return value;
      const number =
        typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN;
      if (Number.isNaN(number)) throw invalid('Invalid number');
      return number;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const text = typeof value === 'string' ? value.toLowerCase() : '';
      if (text === 'true') return true;
      if (text === 'false') return false;
      throw invalid('Invalid boolean');
    }
    case 'string':
    case 'code':
      if (typeof value !== 'string') throw invalid('Expected a string');
      return value;
    case 'class': {
      const classOptions = field.type.options;
      if (typeof value !== 'string') throw invalid('Expected a string');
      if (classOptions && !classOptions.includes(value)) {
        throw invalid(
          `Invalid class '${value}', expected one of the following: ${classOptions.join(', ')}`
        );
      }
      return value;
    }
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw invalid('Expected an object');
      }
      return value;
    default:
      return value;
  }
}

function validateStructuredFieldValue(
  field: Readonly<AxField>,
  rawValue: unknown,
  options?: { allowMissingRequired?: boolean }
): unknown {
  const type = field.type;
  if (!type) return rawValue;

  let value = rawValue;
  if (type.isArray) {
    if (!Array.isArray(value)) {
      throw createTypeValidationError(
        field,
        typeof value === 'string' ? value : JSON.stringify(value),
        'Expected an array'
      );
    }
    const itemField: AxField = { ...field, type: { ...type, isArray: false } };
    value = value.map((item) =>
      item === undefined || item === null
        ? item
        : coerceStructuredValue(itemField, item)
    );
  } else {
    value = coerceStructuredValue(field, value);
  }

  // validateURL throws on non-strings, so only run it on the whole value for
  // scalar fields; array fields are validated per-item in the loop below.
  if (type.name === 'url' && !type.isArray) {
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
      if (item !== undefined && item !== null) {
        if (type.name === 'url') {
          validateURL(item, field);
        } else if (type.name === 'string' || type.name === 'code') {
          validateStringConstraints(item, field);
        } else if (type.name === 'number') {
          validateNumberConstraints(item, field);
        }
      }
    }
  }

  if (
    type.name === 'object' &&
    type.fields &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    validateNestedObjectFields(
      field,
      value as Record<string, unknown>,
      options
    );
  }

  if (
    type.isArray &&
    type.fields &&
    Array.isArray(value) &&
    type.name === 'object'
  ) {
    for (const item of value) {
      if (item && typeof item === 'object') {
        validateNestedObjectFields(
          field,
          item as Record<string, unknown>,
          options
        );
      }
    }
  }

  return value;
}

function validateNestedObjectFields(
  parentField: Readonly<AxField>,
  obj: Record<string, unknown>,
  options?: { allowMissingRequired?: boolean }
): void {
  const fields = parentField.type?.fields;
  if (!fields || typeof fields !== 'object') return;

  const visibleFieldNames = new Set(
    Object.entries(fields)
      .filter(([, fieldType]) => !fieldType.isInternal)
      .map(([fieldName]) => fieldName)
  );
  for (const key of Object.keys(obj)) {
    if (!visibleFieldNames.has(key)) {
      throw new ValidationError(
        `Unexpected field '${key}' in '${parentField.name}'. Use only the exact declared wire keys.`
      );
    }
  }

  for (const [fieldName, fieldType] of Object.entries(fields)) {
    if (fieldType.isInternal) continue;
    const nestedField: AxField = {
      name: fieldName,
      title: fieldName,
      description: fieldType.description,
      type: {
        name: fieldType.type,
        isArray: fieldType.isArray,
        options: fieldType.options as string[] | undefined,
        fields: fieldType.fields,
        minLength: fieldType.minLength,
        maxLength: fieldType.maxLength,
        minimum: fieldType.minimum,
        maximum: fieldType.maximum,
        pattern: fieldType.pattern,
        patternDescription: fieldType.patternDescription,
        format: fieldType.format,
      },
      isOptional: fieldType.isOptional ?? false,
      isInternal: fieldType.isInternal ?? false,
    };

    const value = obj[nestedField.name];

    if (value === undefined || value === null) {
      if (!nestedField.isOptional && !options?.allowMissingRequired) {
        throw createRequiredFieldMissingError(nestedField);
      }
      continue;
    }

    obj[nestedField.name] = validateStructuredFieldValue(
      nestedField,
      value,
      options
    );
  }
}

function rejectUnknownStructuredFields(
  values: Readonly<Record<string, unknown>>,
  fields: readonly Readonly<AxField>[],
  context: string
): void {
  const expected = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(values)) {
    if (!expected.has(key)) {
      throw new ValidationError(
        `Unexpected field '${key}' in ${context}. Use only the exact declared wire keys.`
      );
    }
  }
}
