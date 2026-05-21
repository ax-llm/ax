import {
  createInvalidJsonError,
  createRequiredFieldMissingError,
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
  options?: { allowMissingRequired?: boolean }
): void {
  const outputFields = signature.getOutputFields();

  for (const field of outputFields) {
    const value = values[field.name];

    if (value === undefined || value === null) {
      if (!field.isOptional && !options?.allowMissingRequired) {
        throw createRequiredFieldMissingError(field);
      }
      continue;
    }

    validateStructuredFieldValue(field, value, options);

    if (field.schema) {
      values[field.name] = validateWithStandardSchema(
        field.schema,
        field.name,
        value
      );
    }
  }
}

function validateStructuredFieldValue(
  field: Readonly<AxField>,
  value: unknown,
  options?: { allowMissingRequired?: boolean }
): void {
  const type = field.type;
  if (!type) return;

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
}

function validateNestedObjectFields(
  parentField: Readonly<AxField>,
  obj: Record<string, unknown>,
  options?: { allowMissingRequired?: boolean }
): void {
  const fields = parentField.type?.fields;
  if (!fields || typeof fields !== 'object') return;

  for (const [fieldName, fieldType] of Object.entries(fields)) {
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

    validateStructuredFieldValue(nestedField, value, options);
  }
}
