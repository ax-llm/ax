/* eslint-disable @typescript-eslint/no-unused-vars */
// Added to allow the standard tagged template rest parameters usage.

import { AxGen, type AxGenerateResult } from './generate.js';
import { AxSignature } from './sig.js';
import type { AxGenIn, AxGenOut } from './types.js';

// Type for template interpolation values
export type AxSignatureTemplateValue =
  | string
  | AxFieldType
  | AxFieldDescriptor
  | AxSignature;

export interface AxFieldType {
  readonly type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'json'
    | 'image'
    | 'audio'
    | 'date'
    | 'datetime'
    | 'class'
    | 'code';
  readonly isArray?: boolean;
  readonly options?: readonly string[];
  readonly description?: string;
  readonly isOptional?: boolean;
  readonly isInternal?: boolean;
}

export interface AxFieldDescriptor {
  readonly name: string;
  readonly type?: AxFieldType;
  readonly description?: string;
  readonly isOptional?: boolean;
  readonly isInternal?: boolean;
}

/**
 * A tagged template function for creating `AxSignature` instances.
 *
 * @param {TemplateStringsArray} strings - The template strings.
 * @param {readonly AxSignatureTemplateValue[]} values - The template values.
 * @returns {AxSignature} A new `AxSignature` instance.
 *
 * @example
 * ```typescript
 * import { s, f } from './ax';
 *
 * const signature = s`
 *   input: ${f.string("The input text")}
 *   ->
 *   output: ${f.string("The output text")}
 * `;
 * ```
 */
export function s(
  strings: TemplateStringsArray,
  // eslint-disable-next-line functional/functional-parameters
  ...values: readonly AxSignatureTemplateValue[]
): AxSignature {
  let result = '';

  for (let i = 0; i < strings.length; i++) {
    // Add the literal part first
    result += strings[i] ?? '';

    // Then process the value (if any)
    if (i < values.length) {
      const val = values[i];

      // When the value is a field type with optional/internal flags we need to add
      // the markers (?) / (!) on the FIELD NAME (the part just written in result).
      if (isAxFieldType(val)) {
        // Detect the last field name before the ':' we just wrote in the literal.
        // Look for pattern like "fieldName:" at the end of result
        const fieldNameMatch = result.match(/(\w+)\s*:\s*$/);
        if (fieldNameMatch && (val.isOptional || val.isInternal)) {
          const fieldName = fieldNameMatch[1];
          let modifiedFieldName = fieldName;

          // Add markers in the correct order: fieldName?! (optional first, then internal)
          if (val.isOptional) modifiedFieldName += '?';
          if (val.isInternal) modifiedFieldName += '!';

          // Replace the field name in the result
          result = result.replace(/(\w+)(\s*:\s*)$/, `${modifiedFieldName}$2`);
        }

        // Now append the converted type string (without optional/internal markers)

        const { isOptional: _o, isInternal: _i, ...typeNoFlags } = val;
        result += convertFieldTypeToString(typeNoFlags);
      } else if (isAxFieldDescriptor(val)) {
        result += convertFieldDescriptorToString(val);
      } else if (typeof val === 'string' || val instanceof AxSignature) {
        result += convertValueToSignatureString(val);
      } else {
        throw new Error('Unsupported template interpolation value');
      }
    }
  }

  return new AxSignature(result);
}

/**
 * A tagged template function for creating `AxGen` instances.
 *
 * @template IN - The input type of the `AxGen` instance.
 * @template OUT - The output type of the `AxGen` instance.
 * @param {TemplateStringsArray} strings - The template strings.
 * @param {readonly AxSignatureTemplateValue[]} values - The template values.
 * @returns {AxGen<IN, OUT>} A new `AxGen` instance.
 *
 * @example
 * ```typescript
 * import { ax, f } from './ax';
 *
 * const program = ax`
 *   input: ${f.string("The input text")}
 *   ->
 *   output: ${f.string("The output text")}
 * `;
 * ```
 */
export function ax<
  IN extends AxGenIn = AxGenIn,
  OUT extends AxGenerateResult<AxGenOut> = AxGenerateResult<AxGenOut>,
>(
  strings: TemplateStringsArray,
  // eslint-disable-next-line functional/functional-parameters
  ...values: readonly AxSignatureTemplateValue[]
): AxGen<IN, OUT> {
  let result = '';

  for (let i = 0; i < strings.length; i++) {
    // Add the literal part first
    result += strings[i] ?? '';

    // Then process the value (if any)
    if (i < values.length) {
      const val = values[i];

      // When the value is a field type with optional/internal flags we need to add
      // the markers (?) / (!) on the FIELD NAME (the part just written in result).
      if (isAxFieldType(val)) {
        // Detect the last field name before the ':' we just wrote in the literal.
        // Look for pattern like "fieldName:" at the end of result
        const fieldNameMatch = result.match(/(\w+)\s*:\s*$/);
        if (fieldNameMatch && (val.isOptional || val.isInternal)) {
          const fieldName = fieldNameMatch[1];
          let modifiedFieldName = fieldName;

          // Add markers in the correct order: fieldName?! (optional first, then internal)
          if (val.isOptional) modifiedFieldName += '?';
          if (val.isInternal) modifiedFieldName += '!';

          // Replace the field name in the result
          result = result.replace(/(\w+)(\s*:\s*)$/, `${modifiedFieldName}$2`);
        }

        // Now append the converted type string (without optional/internal markers)

        const { isOptional: _o, isInternal: _i, ...typeNoFlags } = val;
        result += convertFieldTypeToString(typeNoFlags);
      } else if (isAxFieldDescriptor(val)) {
        result += convertFieldDescriptorToString(val);
      } else if (typeof val === 'string' || val instanceof AxSignature) {
        result += convertValueToSignatureString(val);
      } else {
        throw new Error('Unsupported template interpolation value');
      }
    }
  }

  return new AxGen<IN, OUT>(result);
}

function convertValueToSignatureString(
  value: AxSignatureTemplateValue
): string {
  if (typeof value === 'string') {
    return value;
  }

  if (isAxFieldType(value)) {
    return convertFieldTypeToString(value);
  }

  if (isAxFieldDescriptor(value)) {
    return convertFieldDescriptorToString(value);
  }

  if (value instanceof AxSignature) {
    // Extract the signature string without description
    const sigString = value.toString();
    const arrowIndex = sigString.indexOf(' -> ');
    if (arrowIndex !== -1) {
      return sigString.substring(arrowIndex + 4); // Return just the output part
    }
    return sigString;
  }

  throw new Error(`Unsupported template value type: ${typeof value}`);
}

function convertFieldTypeToString(fieldType: Readonly<AxFieldType>): string {
  let result = fieldType.type;

  // Add array notation
  if (fieldType.isArray) {
    result += '[]';
  }

  // Add options only for class types
  if (
    fieldType.options &&
    fieldType.options.length > 0 &&
    fieldType.type === 'class'
  ) {
    result += ` "${fieldType.options.join(', ')}"`;
  }

  // Add description
  if (fieldType.description) {
    result += ` "${fieldType.description}"`;
  }

  return result;
}

function convertFieldDescriptorToString(
  descriptor: Readonly<AxFieldDescriptor>
): string {
  let result = descriptor.name;

  if (descriptor.isOptional) {
    result += '?';
  }

  if (descriptor.isInternal) {
    result += '!';
  }

  if (descriptor.type) {
    result += `:${convertFieldTypeToString(descriptor.type)}`;
  }

  if (descriptor.description && !descriptor.type?.description) {
    result += ` "${descriptor.description}"`;
  }

  return result;
}

function isAxFieldType(value: unknown): value is AxFieldType {
  return (
    value !== null &&
    typeof value === 'object' &&
    value !== undefined &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}

function isAxFieldDescriptor(value: unknown): value is AxFieldDescriptor {
  return (
    value !== null &&
    typeof value === 'object' &&
    value !== undefined &&
    'name' in value &&
    typeof (value as Record<string, unknown>).name === 'string'
  );
}

/**
 * A collection of helper functions for creating `AxFieldType` instances.
 */
export const f = {
  /**
   * Creates a string field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A string field type.
   */
  string: (desc?: string): AxFieldType => ({
    type: 'string',
    description: desc,
  }),

  /**
   * Creates a number field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A number field type.
   */
  number: (desc?: string): AxFieldType => ({
    type: 'number',
    description: desc,
  }),

  /**
   * Creates a boolean field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A boolean field type.
   */
  boolean: (desc?: string): AxFieldType => ({
    type: 'boolean',
    description: desc,
  }),

  /**
   * Creates a date field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A date field type.
   */
  date: (desc?: string): AxFieldType => ({
    type: 'date',
    description: desc,
  }),

  /**
   * Creates a datetime field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A datetime field type.
   */
  datetime: (desc?: string): AxFieldType => ({
    type: 'datetime',
    description: desc,
  }),

  /**
   * Creates a json field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A json field type.
   */
  json: (desc?: string): AxFieldType => ({
    type: 'json',
    description: desc,
  }),

  /**
   * Creates an image field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} An image field type.
   */
  image: (desc?: string): AxFieldType => ({
    type: 'image',
    description: desc,
  }),

  /**
   * Creates an audio field type.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} An audio field type.
   */
  audio: (desc?: string): AxFieldType => ({
    type: 'audio',
    description: desc,
  }),

  /**
   * Creates a class field type.
   * @param {readonly string[]} options - The options for the class.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A class field type.
   */
  class: (options: readonly string[], desc?: string): AxFieldType => ({
    type: 'class',
    options,
    description: desc,
  }),

  /**
   * Creates a code field type.
   * @param {string} language - The language of the code.
   * @param {string} [desc] - The description of the field.
   * @returns {AxFieldType} A code field type.
   */
  code: (language: string, desc?: string): AxFieldType => ({
    type: 'code',
    options: [language],
    description: desc,
  }),

  /**
   * Creates an array field type.
   * @template T - The base type of the array.
   * @param {T} baseType - The base type of the array.
   * @returns {T & { readonly isArray: true }} An array field type.
   */
  array: <T extends AxFieldType>(
    baseType: T
  ): T & { readonly isArray: true } => ({
    ...baseType,
    isArray: true,
  }),

  /**
   * Creates an optional field type.
   * @template T - The base type of the field.
   * @param {T} baseType - The base type of the field.
   * @returns {T & { readonly isOptional: true }} An optional field type.
   */
  optional: <T extends AxFieldType>(
    baseType: T
  ): T & { readonly isOptional: true } => ({
    ...baseType,
    isOptional: true,
  }),

  /**
   * Creates an internal field type.
   * @template T - The base type of the field.
   * @param {T} baseType - The base type of the field.
   * @returns {T & { readonly isInternal: true }} An internal field type.
   */
  internal: <T extends AxFieldType>(
    baseType: T
  ): T & { readonly isInternal: true } => ({
    ...baseType,
    isInternal: true,
  }),
};

// Utility function to create field descriptors
export function createField(
  name: string,
  type?: AxFieldType,
  options?: Readonly<{
    description?: string;
    isOptional?: boolean;
    isInternal?: boolean;
  }>
): AxFieldDescriptor {
  return {
    name,
    type,
    description: options?.description,
    isOptional: options?.isOptional,
    isInternal: options?.isInternal,
  };
}
