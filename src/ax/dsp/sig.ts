import type { AxFunctionJSONSchema } from '../ai/types.js';
import { createHash } from '../util/crypto.js';

import { axGlobals } from './globals.js';
import { toJsonSchema } from './jsonSchema.js';
import {
  type InputParsedField,
  type OutputParsedField,
  type ParsedSignature,
  parseSignature,
} from './parser.js';
import type { ParseSignature } from './types.js';
// Interface for programmatically defining field types
export interface AxFieldType {
  readonly type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'json'
    | 'image'
    | 'audio'
    | 'file'
    | 'url'
    | 'date'
    | 'datetime'
    | 'class'
    | 'code'
    | 'object';
  readonly isArray?: boolean;
  readonly options?: readonly string[];
  readonly fields?: Record<string, AxFieldType>;
  readonly description?: string;
  readonly isOptional?: boolean;
  readonly isInternal?: boolean;
  // Validation constraints
  readonly minLength?: number; // String minimum length
  readonly maxLength?: number; // String maximum length
  readonly minimum?: number; // Number minimum value
  readonly maximum?: number; // Number maximum value
  readonly pattern?: string; // String regex pattern
  readonly patternDescription?: string; // Human-readable description of the pattern
  readonly format?: string; // String format (email, uri, uuid, etc.)
}

// Improved SignatureBuilder class for fluent API with better type inference
export class AxSignatureBuilder<
  _TInput extends Record<string, any> = {},
  _TOutput extends Record<string, any> = {},
> {
  private inputFields: AxField[] = [];
  private outputFields: AxField[] = [];
  private desc?: string;

  /**
   * Add an input field to the signature
   * @param name - Field name
   * @param fieldInfo - Field type created with f.string(), f.number(), etc.
   * @param prepend - If true, adds field to the beginning of input fields
   */
  public input<
    K extends string,
    T extends
      | AxFluentFieldInfo<any, any, any, any, any, any>
      | AxFluentFieldType<any, any, any, any, any, any>,
  >(
    name: K,
    fieldInfo: T,
    prepend = false
  ): AxSignatureBuilder<AddFieldToShape<_TInput, K, T>, _TOutput> {
    const field: AxField = {
      name,
      type: {
        name: fieldInfo.type,
        isArray: fieldInfo.isArray || undefined,
        options: fieldInfo.options ? [...fieldInfo.options] : undefined,
        minLength: fieldInfo.minLength,
        maxLength: fieldInfo.maxLength,
        minimum: fieldInfo.minimum,
        maximum: fieldInfo.maximum,
        pattern: fieldInfo.pattern,
        patternDescription: fieldInfo.patternDescription,
        format: fieldInfo.format,
        description: fieldInfo.itemDescription,
        fields: fieldInfo.fields
          ? Object.fromEntries(
              Object.entries(fieldInfo.fields).map(([k, v]) => [
                k,
                convertFluentToAxFieldType(
                  v as AxFluentFieldInfo | AxFluentFieldType
                ),
              ])
            )
          : undefined,
      },
      description: fieldInfo.description,
      isOptional: fieldInfo.isOptional || undefined,
      isInternal: fieldInfo.isInternal || undefined,
    };

    if (prepend) {
      this.inputFields.unshift(field);
    } else {
      this.inputFields.push(field);
    }

    return this as any;
  }

  /**
   * Add an output field to the signature
   * @param name - Field name
   * @param fieldInfo - Field type created with f.string(), f.number(), etc.
   * @param prepend - If true, adds field to the beginning of output fields
   */
  public output<
    K extends string,
    T extends
      | AxFluentFieldInfo<any, any, any, any, any, any>
      | AxFluentFieldType<any, any, any, any, any, any>,
  >(
    name: K,
    fieldInfo: T,
    prepend = false
  ): AxSignatureBuilder<_TInput, AddFieldToShape<_TOutput, K, T>> {
    const field: AxField = {
      name,
      type: {
        name: fieldInfo.type,
        isArray: fieldInfo.isArray || undefined,
        options: fieldInfo.options ? [...fieldInfo.options] : undefined,
        minLength: fieldInfo.minLength,
        maxLength: fieldInfo.maxLength,
        minimum: fieldInfo.minimum,
        maximum: fieldInfo.maximum,
        pattern: fieldInfo.pattern,
        patternDescription: fieldInfo.patternDescription,
        format: fieldInfo.format,
        description: fieldInfo.itemDescription,
        fields: fieldInfo.fields
          ? Object.fromEntries(
              Object.entries(fieldInfo.fields).map(([k, v]) => [
                k,
                convertFluentToAxFieldType(
                  v as AxFluentFieldInfo | AxFluentFieldType
                ),
              ])
            )
          : undefined,
      },
      description: fieldInfo.description,
      isOptional: fieldInfo.isOptional || undefined,
      isInternal: fieldInfo.isInternal || undefined,
    };

    if (prepend) {
      this.outputFields.unshift(field);
    } else {
      this.outputFields.push(field);
    }

    return this as any;
  }

  /**
   * Set the description for the signature
   * @param description - Description text
   */
  public description(
    description: string
  ): AxSignatureBuilder<_TInput, _TOutput> {
    this.desc = description;
    return this;
  }

  /**
   * Enforce structured outputs (JSON) for this signature, even if fields are simple.
   */
  public useStructured(): AxSignatureBuilder<_TInput, _TOutput> {
    // We'll store this in a private property.
    // Since we can't easily add a property to the class without redefining it,
    // we'll assume there's a way to pass it to config.
    // Let's add a private property `_useStructuredOutputs` to the class.
    (this as any)._useStructuredOutputs = true;
    return this;
  }

  /**
   * Build the final AxSignature instance
   */
  public build(): AxSignature<_TInput, _TOutput> {
    const config: AxSignatureConfig = {
      description: this.desc,
      inputs: this.inputFields,
      outputs: this.outputFields,
    };

    const sig = new AxSignature(config) as AxSignature<_TInput, _TOutput>;
    if ((this as any)._useStructuredOutputs) {
      (sig as any)._forceComplexFields = true;
      // Invalidate the cached _hasComplexFields so it will be recomputed
      (sig as any)._hasComplexFields = undefined;
    }
    return sig;
  }
}

// Fluent field type builder for method chaining
export class AxFluentFieldType<
  TType extends AxFieldType['type'] = AxFieldType['type'],
  TIsArray extends boolean = false,
  TOptions extends readonly string[] | undefined = undefined,
  TIsOptional extends boolean = false,
  TIsInternal extends boolean = false,
  TFields extends
    | Record<string, AxFluentFieldInfo | AxFluentFieldType>
    | undefined = undefined,
> implements AxFieldType
{
  readonly type: TType;
  readonly isArray: TIsArray;
  readonly options?: TOptions;
  readonly description?: string;
  readonly isOptional: TIsOptional;
  readonly isInternal: TIsInternal;
  readonly fields?: any;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly patternDescription?: string;
  readonly format?: string;
  readonly itemDescription?: string;

  constructor(fieldType: {
    type: TType;
    isArray: TIsArray;
    options?: TOptions;
    description?: string;
    itemDescription?: string;
    isOptional: TIsOptional;
    isInternal: TIsInternal;
    fields?: TFields;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    patternDescription?: string;
    format?: string;
  }) {
    this.type = fieldType.type;
    this.isArray = fieldType.isArray;
    this.options = fieldType.options;
    this.description = fieldType.description;
    this.itemDescription = fieldType.itemDescription;
    this.isOptional = fieldType.isOptional;
    this.isInternal = fieldType.isInternal;
    this.fields = fieldType.fields;
    this.minLength = fieldType.minLength;
    this.maxLength = fieldType.maxLength;
    this.minimum = fieldType.minimum;
    this.maximum = fieldType.maximum;
    this.pattern = fieldType.pattern;
    this.patternDescription = fieldType.patternDescription;
    this.format = fieldType.format;
  }

  optional(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    true,
    TIsInternal,
    TFields
  > {
    return new AxFluentFieldType({
      ...this,
      isOptional: true as const,
    });
  }

  array(
    desc?: string
  ): AxFluentFieldType<
    TType,
    true,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    return new AxFluentFieldType({
      ...this,
      isArray: true as const,
      description: desc || this.description,
      itemDescription: desc ? this.description : undefined,
    });
  }

  internal(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    true,
    TFields
  > {
    return new AxFluentFieldType({
      ...this,
      isInternal: true as const,
    });
  }

  /**
   * Set minimum value for numbers or minimum length for strings
   */
  min(
    value: number
  ): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        minLength: value,
      });
    } else if (this.type === 'number') {
      return new AxFluentFieldType({
        ...this,
        minimum: value,
      });
    }
    return this;
  }

  /**
   * Set maximum value for numbers or maximum length for strings
   */
  max(
    value: number
  ): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        maxLength: value,
      });
    } else if (this.type === 'number') {
      return new AxFluentFieldType({
        ...this,
        maximum: value,
      });
    }
    return this;
  }

  /**
   * Set email format validation for strings
   */
  email(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        format: 'email',
      });
    }
    return this;
  }

  /**
   * Set URL/URI format validation for strings
   */
  url(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        format: 'uri',
      });
    }
    return this;
  }

  /**
   * Set regex pattern validation for strings
   * @param pattern - Regular expression pattern to match
   * @param description - Human-readable description of what the pattern validates (e.g., "Must be a valid username with only lowercase letters, numbers, and underscores")
   */
  regex(
    pattern: string,
    description: string
  ): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        pattern,
        patternDescription: description,
      });
    }
    return this;
  }

  /**
   * Set date format validation for strings
   */
  date(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        format: 'date',
      });
    }
    return this;
  }

  /**
   * Set datetime format validation for strings
   */
  datetime(): AxFluentFieldType<
    TType,
    TIsArray,
    TOptions,
    TIsOptional,
    TIsInternal,
    TFields
  > {
    if (this.type === 'string') {
      return new AxFluentFieldType({
        ...this,
        format: 'date-time',
      });
    }
    return this;
  }
}

// Helper type to validate that no media types (image, audio, file) are used in nested objects
type ValidateNoMediaTypes<TFields> = {
  [K in keyof TFields]: TFields[K] extends { type: infer T }
    ? T extends 'image' | 'audio' | 'file'
      ? {
          __error: `Type '${T extends string ? T : never}' cannot be used in f.object(). Media types (image, audio, file) are only allowed as top-level input fields, not within nested objects.`;
          __suggestion: 'Use string, number, boolean, or nested f.object() instead.';
        }
      : TFields[K] extends { fields: infer TNestedFields }
        ? TNestedFields extends Record<string, any>
          ? TFields[K] & { fields: ValidateNoMediaTypes<TNestedFields> }
          : TFields[K]
        : TFields[K]
    : TFields[K];
};

// Improved helper functions for creating strongly-typed field info
export const f = Object.assign(
  (): AxSignatureBuilder => new AxSignatureBuilder(),
  {
    string: (
      desc?: string
    ): AxFluentFieldType<'string', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'string' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    number: (
      desc?: string
    ): AxFluentFieldType<'number', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'number' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    boolean: (
      desc?: string
    ): AxFluentFieldType<
      'boolean',
      false,
      undefined,
      false,
      false,
      undefined
    > =>
      new AxFluentFieldType({
        type: 'boolean' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    json: (
      desc?: string
    ): AxFluentFieldType<'json', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'json' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    datetime: (
      desc?: string
    ): AxFluentFieldType<
      'datetime',
      false,
      undefined,
      false,
      false,
      undefined
    > =>
      new AxFluentFieldType({
        type: 'datetime' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    date: (
      desc?: string
    ): AxFluentFieldType<'date', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'date' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    class: <const TOptions extends readonly string[]>(
      options: TOptions,
      desc?: string
    ): AxFluentFieldType<'class', false, TOptions, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'class' as const,
        isArray: false as const,
        options,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    image: (
      desc?: string
    ): AxFluentFieldType<'image', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'image' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    audio: (
      desc?: string
    ): AxFluentFieldType<'audio', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'audio' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    file: (
      desc?: string
    ): AxFluentFieldType<'file', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'file' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    url: (
      desc?: string
    ): AxFluentFieldType<'url', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'url' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),

    email: (
      desc?: string
    ): AxFluentFieldType<'string', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'string' as const,
        isArray: false as const,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
        format: 'email',
      }),

    code: (
      language?: string,
      desc?: string
    ): AxFluentFieldType<'code', false, undefined, false, false, undefined> =>
      new AxFluentFieldType({
        type: 'code' as const,
        isArray: false as const,
        description: desc || language,
        isOptional: false as const,
        isInternal: false as const,
      }),

    object: <
      TFields extends Record<
        string,
        | AxFluentFieldInfo<any, any, any, any, any, any>
        | AxFluentFieldType<any, any, any, any, any, any>
      >,
    >(
      fields: TFields & ValidateNoMediaTypes<TFields>,
      desc?: string
    ): AxFluentFieldType<'object', false, undefined, false, false, TFields> =>
      new AxFluentFieldType({
        type: 'object' as const,
        isArray: false as const,
        fields,
        description: desc,
        isOptional: false as const,
        isInternal: false as const,
      }),
  }
);

// Backward compatibility alias (legacy API)
export const createFieldType = f;

export interface AxField {
  name: string;
  title?: string;
  description?: string;
  type?: {
    name:
      | 'string'
      | 'number'
      | 'boolean'
      | 'json'
      | 'image'
      | 'audio'
      | 'file'
      | 'url'
      | 'date'
      | 'datetime'
      | 'class'
      | 'code'
      | 'object';
    isArray?: boolean;
    options?: string[];
    fields?: Record<string, AxFieldType>;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    patternDescription?: string;
    format?: string;
    description?: string;
  };
  isOptional?: boolean;
  isInternal?: boolean;
}

export type AxIField = Omit<AxField, 'title'> & { title: string };

// Helper type to map AxFieldType or AxFluentFieldType to TypeScript types for type-safe field additions
type InferFieldValueType<T> = T extends AxFieldType | AxFluentFieldType
  ? T['type'] extends 'string'
    ? T['isArray'] extends true
      ? string[]
      : string
    : T['type'] extends 'number'
      ? T['isArray'] extends true
        ? number[]
        : number
      : T['type'] extends 'boolean'
        ? T['isArray'] extends true
          ? boolean[]
          : boolean
        : T['type'] extends 'json'
          ? T['isArray'] extends true
            ? any[]
            : any
          : T['type'] extends 'date'
            ? T['isArray'] extends true
              ? Date[]
              : Date
            : T['type'] extends 'datetime'
              ? T['isArray'] extends true
                ? Date[]
                : Date
              : T['type'] extends 'image'
                ? T['isArray'] extends true
                  ? { mimeType: string; data: string }[]
                  : { mimeType: string; data: string }
                : T['type'] extends 'audio'
                  ? T['isArray'] extends true
                    ? { format?: 'wav'; data: string }[]
                    : { format?: 'wav'; data: string }
                  : T['type'] extends 'file'
                    ? T['isArray'] extends true
                      ? (
                          | { mimeType: string; data: string }
                          | { mimeType: string; fileUri: string }
                        )[]
                      :
                          | { mimeType: string; data: string }
                          | { mimeType: string; fileUri: string }
                    : T['type'] extends 'url'
                      ? T['isArray'] extends true
                        ? string[]
                        : string
                      : T['type'] extends 'code'
                        ? T['isArray'] extends true
                          ? string[]
                          : string
                        : T['type'] extends 'class'
                          ? T['options'] extends readonly (infer U)[]
                            ? T['isArray'] extends true
                              ? U[]
                              : U
                            : T['isArray'] extends true
                              ? string[]
                              : string
                          : T['type'] extends 'object'
                            ? T extends { fields: infer F }
                              ? F extends Record<string, any>
                                ? T['isArray'] extends true
                                  ? { [K in keyof F]: InferFluentType<F[K]> }[]
                                  : { [K in keyof F]: InferFluentType<F[K]> }
                                : any
                              : any
                            : any
  : any;

// Improved fluent field type that preserves exact type information for better inference
export interface AxFluentFieldInfo<
  TType extends AxFieldType['type'] = AxFieldType['type'],
  TIsArray extends boolean = false,
  TOptions extends readonly string[] = readonly string[],
  TIsOptional extends boolean = false,
  _TIsInternal extends boolean = false,
  TFields extends
    | Record<string, AxFluentFieldInfo | AxFluentFieldType>
    | undefined = undefined,
> {
  readonly type: TType;
  readonly isArray?: TIsArray;
  readonly options?: TOptions;
  readonly fields?: TFields;
  readonly description?: string;
  readonly itemDescription?: string;
  readonly isOptional?: TIsOptional;
  readonly isInternal?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
  readonly patternDescription?: string;
  readonly format?: string;
}

// Helper function to convert AxFluentFieldInfo to AxFieldType
function convertFluentToAxFieldType(
  fluent: AxFluentFieldInfo<any, any, any, any, any, any> | AxFluentFieldType
): AxFieldType {
  return {
    type: fluent.type,
    isArray: fluent.isArray,
    options: fluent.options,
    description: fluent.description,
    isOptional: fluent.isOptional,
    isInternal: fluent.isInternal,
    minLength: fluent.minLength,
    maxLength: fluent.maxLength,
    minimum: fluent.minimum,
    maximum: fluent.maximum,
    pattern: fluent.pattern,
    patternDescription: fluent.patternDescription,
    format: fluent.format,
    fields: fluent.fields
      ? Object.fromEntries(
          Object.entries(fluent.fields).map(([k, v]) => [
            k,
            convertFluentToAxFieldType(
              v as AxFluentFieldInfo | AxFluentFieldType
            ),
          ])
        )
      : undefined,
  };
}

// Helper type to infer TypeScript type from fluent field info
type InferFluentType<
  T extends AxFluentFieldInfo<any, any, any, any> | AxFluentFieldType,
> = T['type'] extends 'string'
  ? T['isArray'] extends true
    ? string[]
    : string
  : T['type'] extends 'number'
    ? T['isArray'] extends true
      ? number[]
      : number
    : T['type'] extends 'boolean'
      ? T['isArray'] extends true
        ? boolean[]
        : boolean
      : T['type'] extends 'json'
        ? T['isArray'] extends true
          ? any[]
          : any
        : T['type'] extends 'date'
          ? T['isArray'] extends true
            ? Date[]
            : Date
          : T['type'] extends 'datetime'
            ? T['isArray'] extends true
              ? Date[]
              : Date
            : T['type'] extends 'image'
              ? T['isArray'] extends true
                ? { mimeType: string; data: string }[]
                : { mimeType: string; data: string }
              : T['type'] extends 'audio'
                ? T['isArray'] extends true
                  ? { format?: 'wav'; data: string }[]
                  : { format?: 'wav'; data: string }
                : T['type'] extends 'file'
                  ? T['isArray'] extends true
                    ? (
                        | { mimeType: string; data: string }
                        | { mimeType: string; fileUri: string }
                      )[]
                    :
                        | { mimeType: string; data: string }
                        | { mimeType: string; fileUri: string }
                  : T['type'] extends 'url'
                    ? T['isArray'] extends true
                      ? string[]
                      : string
                    : T['type'] extends 'code'
                      ? T['isArray'] extends true
                        ? string[]
                        : string
                      : T['type'] extends 'class'
                        ? T['options'] extends readonly (infer U)[]
                          ? T['isArray'] extends true
                            ? U[]
                            : U
                          : T['isArray'] extends true
                            ? string[]
                            : string
                        : T['type'] extends 'object'
                          ? T extends { fields: infer F }
                            ? F extends Record<string, any>
                              ? T['isArray'] extends true
                                ? { [K in keyof F]: InferFluentType<F[K]> }[]
                                : { [K in keyof F]: InferFluentType<F[K]> }
                              : any
                            : any
                          : any;

// Helper flags for fluent type modifiers
type _IsInternal<T> = T extends { readonly isInternal: true } ? true : false;
type _IsOptional<T> = T extends { readonly isOptional: true } ? true : false;

// Add field K to shape S, respecting optional() and internal() modifiers
type AddFieldToShape<
  S extends Record<string, any>,
  K extends string,
  T extends AxFluentFieldInfo<any, any, any, any> | AxFluentFieldType,
> = _IsInternal<T> extends true
  ? S
  : _IsOptional<T> extends true
    ? S & { readonly [P in K]?: InferFluentType<T> }
    : S & { readonly [P in K]: InferFluentType<T> };

// Helper function to convert AxFieldType to AxField
function convertFieldTypeToAxField(
  fieldType: AxFieldType
): Omit<AxField, 'name'> {
  return {
    type: {
      name: fieldType.type,
      isArray: fieldType.isArray,
      options: fieldType.options ? [...fieldType.options] : undefined,
      fields: fieldType.fields,
    },
    description: fieldType.description,
    isOptional: fieldType.isOptional,
    isInternal: fieldType.isInternal,
  };
}

class AxSignatureValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldName?: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'AxSignatureValidationError';
  }
}

export interface AxSignatureConfig {
  description?: string;
  inputs: readonly AxField[];
  outputs: readonly AxField[];
}

export class AxSignature<
  _TInput extends Record<string, any> = Record<string, any>,
  _TOutput extends Record<string, any> = Record<string, any>,
> {
  private description?: string;
  private inputFields: AxIField[];
  private outputFields: AxIField[];

  private sigHash: string;
  private sigString: string;

  // Validation caching - stores hash when validation last passed
  private validatedAtHash?: string;

  /**
   * @deprecated Use `AxSignature.create()` for better type safety instead of the constructor.
   * This constructor will be removed in v15.0.0.
   *
   * Migration timeline:
   * - v13.0.24+: Deprecation warnings (current)
   * - v14.0.0: Runtime console warnings
   * - v15.0.0: Complete removal
   *
   * @example
   * ```typescript
   * // Instead of: new AxSignature('userInput:string -> responseText:string')
   * // Use: AxSignature.create('userInput:string -> responseText:string')
   * ```
   */
  constructor(signature?: Readonly<AxSignature | string | AxSignatureConfig>) {
    if (!signature) {
      this.inputFields = [];
      this.outputFields = [];
      this.sigHash = '';
      this.sigString = '';
      return;
    }

    if (typeof signature === 'string') {
      let sig: ParsedSignature;
      try {
        sig = parseSignature(signature);
      } catch (e) {
        if (e instanceof Error) {
          // Preserve the suggestion if it's a SignatureValidationError
          const suggestion =
            'suggestion' in e &&
            typeof (e as { suggestion: unknown }).suggestion === 'string'
              ? (e as { suggestion: string }).suggestion
              : 'Please check the signature format. Example: "userInput:string -> responseText:string"';
          throw new AxSignatureValidationError(
            `Invalid Signature: ${e.message}`,
            undefined,
            suggestion
          );
        }
        throw new AxSignatureValidationError(
          `Invalid Signature: ${signature}`,
          undefined,
          'Please check the signature format. Example: "userInput:string -> responseText:string"'
        );
      }
      this.description = sig.desc;
      this.inputFields = sig.inputs.map((v) => this.parseParsedField(v));
      this.outputFields = sig.outputs.map((v) => this.parseParsedField(v));
      [this.sigHash, this.sigString] = this.updateHash();
    } else if (signature instanceof AxSignature) {
      this.description = signature.getDescription();
      this.inputFields = structuredClone(
        signature.getInputFields()
      ) as AxIField[];
      this.outputFields = structuredClone(
        signature.getOutputFields()
      ) as AxIField[];
      this.sigHash = signature.hash();
      this.sigString = signature.toString();
      // Copy validation state if the source signature was validated
      if (signature.validatedAtHash === this.sigHash) {
        this.validatedAtHash = this.sigHash;
      }
      // Copy complex fields state
      this._forceComplexFields = (signature as any)._forceComplexFields;
      this._hasComplexFields = (signature as any)._hasComplexFields;
    } else if (typeof signature === 'object' && signature !== null) {
      // Handle AxSignatureConfig object
      if (!('inputs' in signature) || !('outputs' in signature)) {
        throw new AxSignatureValidationError(
          'Invalid signature object: missing inputs or outputs',
          undefined,
          'Signature object must have "inputs" and "outputs" arrays. Example: { inputs: [...], outputs: [...] }'
        );
      }

      if (
        !Array.isArray(signature.inputs) ||
        !Array.isArray(signature.outputs)
      ) {
        throw new AxSignatureValidationError(
          'Invalid signature object: inputs and outputs must be arrays',
          undefined,
          'Both "inputs" and "outputs" must be arrays of AxField objects'
        );
      }

      try {
        this.description = signature.description;
        this.inputFields = signature.inputs.map((v) => this.parseField(v));
        this.outputFields = signature.outputs.map((v) => this.parseField(v));
        [this.sigHash, this.sigString] = this.updateHash();
      } catch (error) {
        if (error instanceof AxSignatureValidationError) {
          throw error;
        }
        throw new AxSignatureValidationError(
          `Failed to create signature from object: ${error instanceof Error ? error.message : 'Unknown error'}`,
          undefined,
          'Check that all fields in inputs and outputs arrays are valid AxField objects'
        );
      }
    } else {
      throw new AxSignatureValidationError(
        'Invalid signature argument type',
        undefined,
        'Signature must be a string, another AxSignature instance, or an object with inputs and outputs arrays'
      );
    }
  }

  /**
   * Static factory method for type inference.
   * Creates a typed AxSignature instance from a signature string.
   */
  public static create<const T extends string>(
    signature: T
  ): AxSignature<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']> {
    return new AxSignature(signature) as AxSignature<
      ParseSignature<T>['inputs'],
      ParseSignature<T>['outputs']
    >;
  }

  private parseParsedField = (
    field: Readonly<InputParsedField | OutputParsedField>
  ): AxIField => {
    if (!field.name || field.name.length === 0) {
      throw new AxSignatureValidationError(
        'Field name is required',
        field.name,
        'Every field must have a descriptive name. Example: "userInput", "responseText"'
      );
    }

    const title = this.toTitle(field.name);
    return {
      name: field.name,
      title,
      description: 'desc' in field ? field.desc : undefined,
      type: field.type ?? { name: 'string', isArray: false },
      ...('isInternal' in field ? { isInternal: field.isInternal } : {}),
      ...('isOptional' in field ? { isOptional: field.isOptional } : {}),
    };
  };

  private parseField = (field: Readonly<AxField>): AxIField => {
    const title =
      !field.title || field.title.length === 0
        ? this.toTitle(field.name)
        : field.title;

    if (field.type && (!field.type.name || field.type.name.length === 0)) {
      throw new AxSignatureValidationError(
        'Field type name is required',
        field.name,
        'Specify a valid type. Available types: string, number, boolean, json, image, audio, file, url, date, datetime, class, code'
      );
    }

    return { ...field, title };
  };

  public setDescription = (desc: string) => {
    if (typeof desc !== 'string') {
      throw new AxSignatureValidationError(
        'Description must be a string',
        undefined,
        'Provide a string description for the signature'
      );
    }
    this.description = desc;
    this.invalidateValidationCache();
    this.updateHashLight();
  };

  public addInputField = (field: Readonly<AxField>) => {
    try {
      const parsedField = this.parseField(field);
      validateField(parsedField, 'input');

      // Check for duplicate input field names
      for (const existingField of this.inputFields) {
        if (existingField.name === parsedField.name) {
          throw new AxSignatureValidationError(
            `Duplicate input field name: "${parsedField.name}"`,
            parsedField.name,
            'Each field name must be unique within the signature'
          );
        }
      }

      // Check if field name conflicts with existing output fields
      for (const outputField of this.outputFields) {
        if (outputField.name === parsedField.name) {
          throw new AxSignatureValidationError(
            `Field name "${parsedField.name}" appears in both inputs and outputs`,
            parsedField.name,
            'Use different names for input and output fields to avoid confusion'
          );
        }
      }

      this.inputFields.push(parsedField);
      this.invalidateValidationCache();
      this.updateHashLight();
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Failed to add input field "${field.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        field.name
      );
    }
  };

  public addOutputField = (field: Readonly<AxField>) => {
    try {
      const parsedField = this.parseField(field);
      validateField(parsedField, 'output');

      // Check for duplicate output field names
      for (const existingField of this.outputFields) {
        if (existingField.name === parsedField.name) {
          throw new AxSignatureValidationError(
            `Duplicate output field name: "${parsedField.name}"`,
            parsedField.name,
            'Each field name must be unique within the signature'
          );
        }
      }

      // Check if field name conflicts with existing input fields
      for (const inputField of this.inputFields) {
        if (inputField.name === parsedField.name) {
          throw new AxSignatureValidationError(
            `Field name "${parsedField.name}" appears in both inputs and outputs`,
            parsedField.name,
            'Use different names for input and output fields to avoid confusion'
          );
        }
      }

      this.outputFields.push(parsedField);
      this.invalidateValidationCache();
      this.updateHashLight();
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Failed to add output field "${field.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        field.name
      );
    }
  };

  public setInputFields = (fields: readonly AxField[]) => {
    if (!Array.isArray(fields)) {
      throw new AxSignatureValidationError(
        'Input fields must be an array',
        undefined,
        'Provide an array of field objects'
      );
    }

    try {
      const parsedFields = fields.map((v) => {
        const parsed = this.parseField(v);
        validateField(parsed, 'input');
        return parsed;
      });
      this.inputFields = parsedFields;
      this.invalidateValidationCache();
      this.updateHashLight();
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Failed to set input fields: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  public setOutputFields = (fields: readonly AxField[]) => {
    if (!Array.isArray(fields)) {
      throw new AxSignatureValidationError(
        'Output fields must be an array',
        undefined,
        'Provide an array of field objects'
      );
    }

    try {
      const parsedFields = fields.map((v) => {
        const parsed = this.parseField(v);
        validateField(parsed, 'output');
        return parsed;
      });
      this.outputFields = parsedFields;
      this.invalidateValidationCache();
      this.updateHashLight();
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Failed to set output fields: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  public getInputFields = (): Readonly<AxIField[]> => this.inputFields;
  public getOutputFields = (): Readonly<AxIField[]> => this.outputFields;
  public getDescription = () => this.description;

  // Type-safe field addition methods that return new signature instances
  public appendInputField = <K extends string, T extends AxFieldType>(
    name: K,
    fieldType: T
  ): AxSignature<_TInput & Record<K, InferFieldValueType<T>>, _TOutput> => {
    const newSig = new AxSignature(this);
    newSig.addInputField({
      name,
      ...convertFieldTypeToAxField(fieldType),
    });
    return newSig as AxSignature<
      _TInput & Record<K, InferFieldValueType<T>>,
      _TOutput
    >;
  };

  public prependInputField = <K extends string, T extends AxFieldType>(
    name: K,
    fieldType: T
  ): AxSignature<Record<K, InferFieldValueType<T>> & _TInput, _TOutput> => {
    const newSig = new AxSignature(this);
    const fieldToAdd = {
      name,
      ...convertFieldTypeToAxField(fieldType),
    };

    // Validate the field before adding
    const parsedField = newSig.parseField(fieldToAdd);
    validateField(parsedField, 'input');

    // Check for duplicate field names
    for (const existingField of newSig.inputFields) {
      if (existingField.name === parsedField.name) {
        throw new AxSignatureValidationError(
          `Duplicate input field name: "${parsedField.name}"`,
          parsedField.name,
          'Each field name must be unique within the signature'
        );
      }
    }

    // Check if field name conflicts with existing output fields
    for (const outputField of newSig.outputFields) {
      if (outputField.name === parsedField.name) {
        throw new AxSignatureValidationError(
          `Field name "${parsedField.name}" appears in both inputs and outputs`,
          parsedField.name,
          'Use different names for input and output fields to avoid confusion'
        );
      }
    }

    // Prepend to the beginning of input fields array
    newSig.inputFields.unshift(parsedField);
    newSig.invalidateValidationCache();
    newSig.updateHashLight();

    return newSig as AxSignature<
      Record<K, InferFieldValueType<T>> & _TInput,
      _TOutput
    >;
  };

  public appendOutputField = <K extends string, T extends AxFieldType>(
    name: K,
    fieldType: T
  ): AxSignature<_TInput, _TOutput & Record<K, InferFieldValueType<T>>> => {
    const newSig = new AxSignature(this);
    newSig.addOutputField({
      name,
      ...convertFieldTypeToAxField(fieldType),
    });
    return newSig as AxSignature<
      _TInput,
      _TOutput & Record<K, InferFieldValueType<T>>
    >;
  };

  public prependOutputField = <K extends string, T extends AxFieldType>(
    name: K,
    fieldType: T
  ): AxSignature<_TInput, Record<K, InferFieldValueType<T>> & _TOutput> => {
    const newSig = new AxSignature(this);
    const fieldToAdd = {
      name,
      ...convertFieldTypeToAxField(fieldType),
    };

    // Validate the field before adding
    const parsedField = newSig.parseField(fieldToAdd);
    validateField(parsedField, 'output');

    // Check for duplicate field names
    for (const existingField of newSig.outputFields) {
      if (existingField.name === parsedField.name) {
        throw new AxSignatureValidationError(
          `Duplicate output field name: "${parsedField.name}"`,
          parsedField.name,
          'Each field name must be unique within the signature'
        );
      }
    }

    // Check if field name conflicts with existing input fields
    for (const inputField of newSig.inputFields) {
      if (inputField.name === parsedField.name) {
        throw new AxSignatureValidationError(
          `Field name "${parsedField.name}" appears in both inputs and outputs`,
          parsedField.name,
          'Use different names for input and output fields to avoid confusion'
        );
      }
    }

    // Prepend to the beginning of output fields array
    newSig.outputFields.unshift(parsedField);
    newSig.invalidateValidationCache();
    newSig.updateHashLight();

    return newSig as AxSignature<
      _TInput,
      Record<K, InferFieldValueType<T>> & _TOutput
    >;
  };

  private invalidateValidationCache = (): void => {
    this.validatedAtHash = undefined;
    this._hasComplexFields = undefined;
  };

  private toTitle = (name: string) => {
    let result = name.replace(/_/g, ' ');
    result = result.replace(/([A-Z]|[0-9]+)/g, ' $1').trim();
    return result.charAt(0).toUpperCase() + result.slice(1);
  };

  private updateHashLight = (): [string, string] => {
    try {
      // Light validation - only validate individual fields, not full signature consistency
      this.getInputFields().forEach((field) => {
        validateField(field, 'input');
      });
      this.getOutputFields().forEach((field) => {
        validateField(field, 'output');
      });

      this.sigHash = createHash('sha256')
        .update(JSON.stringify(this.inputFields))
        .update(JSON.stringify(this.outputFields))
        .digest('hex');

      this.sigString = renderSignature(
        this.description,
        this.inputFields,
        this.outputFields
      );

      // Compute and cache hasComplexFields
      this._hasComplexFields = this.computeHasComplexFields();

      return [this.sigHash, this.sigString];
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Signature validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  private updateHash = (): [string, string] => {
    try {
      this.getInputFields().forEach((field) => {
        validateField(field, 'input');
      });
      this.getOutputFields().forEach((field) => {
        validateField(field, 'output');
      });

      this.validateSignatureConsistency();

      this.sigHash = createHash('sha256')
        .update(this.description ?? '')
        .update(JSON.stringify(this.inputFields))
        .update(JSON.stringify(this.outputFields))
        .digest('hex');

      this.sigString = renderSignature(
        this.description,
        this.inputFields,
        this.outputFields
      );

      // Compute and cache hasComplexFields
      this._hasComplexFields = this.computeHasComplexFields();

      return [this.sigHash, this.sigString];
    } catch (error) {
      if (error instanceof AxSignatureValidationError) {
        throw error;
      }
      throw new AxSignatureValidationError(
        `Signature validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  private validateSignatureConsistency(): void {
    const inputNames = new Set<string>();
    for (const field of this.inputFields) {
      if (inputNames.has(field.name)) {
        throw new AxSignatureValidationError(
          `Duplicate input field name: "${field.name}"`,
          field.name,
          'Each field name must be unique within the signature'
        );
      }
      inputNames.add(field.name);
    }

    const outputNames = new Set<string>();
    for (const field of this.outputFields) {
      if (outputNames.has(field.name)) {
        throw new AxSignatureValidationError(
          `Duplicate output field name: "${field.name}"`,
          field.name,
          'Each field name must be unique within the signature'
        );
      }
      outputNames.add(field.name);
    }

    for (const outputField of this.outputFields) {
      if (inputNames.has(outputField.name)) {
        throw new AxSignatureValidationError(
          `Field name "${outputField.name}" appears in both inputs and outputs`,
          outputField.name,
          'Use different names for input and output fields to avoid confusion'
        );
      }
    }

    if (this.inputFields.length === 0) {
      throw new AxSignatureValidationError(
        'Signature must have at least one input field',
        undefined,
        'Add an input field. Example: "userInput:string -> ..."'
      );
    }

    if (this.outputFields.length === 0) {
      throw new AxSignatureValidationError(
        'Signature must have at least one output field',
        undefined,
        'Add an output field. Example: "... -> responseText:string"'
      );
    }
  }

  private _forceComplexFields = false;
  private _hasComplexFields?: boolean;

  public hasComplexFields = (): boolean => {
    // Return cached value if available
    if (this._hasComplexFields !== undefined) {
      return this._hasComplexFields;
    }
    // Compute and cache if not yet computed
    this._hasComplexFields = this.computeHasComplexFields();
    return this._hasComplexFields;
  };

  private computeHasComplexFields = (): boolean => {
    if (this._forceComplexFields) {
      return true;
    }
    // Only check output fields, not input fields
    return this.outputFields.some(
      (f) =>
        f.type?.name === 'object' ||
        (f.type?.isArray && f.type.fields !== undefined)
    );
  };

  public validate = (): boolean => {
    // Check if already validated at current hash
    if (this.validatedAtHash === this.sigHash) {
      return true;
    }

    try {
      // Perform full validation
      this.updateHash();

      // Cache validation success
      this.validatedAtHash = this.sigHash;

      return true;
    } catch (error) {
      // Clear validation cache on failure
      this.validatedAtHash = undefined;
      throw error;
    }
  };

  public hash = () => this.sigHash;

  public toString = () => this.sigString;

  public toJSON = () => {
    return {
      id: this.hash(),
      description: this.description,
      inputFields: this.inputFields,
      outputFields: this.outputFields,
    };
  };

  public toJSONSchema = (): AxFunctionJSONSchema => {
    // Combine input and output fields for the JSON schema
    const allFields = [...this.inputFields, ...this.outputFields];
    return toJsonSchema(allFields, this.description ?? 'Schema');
  };
}

function renderField(field: Readonly<AxField>): string {
  let result = field.name;
  if (field.isOptional) {
    result += '?';
  }
  if (field.isInternal) {
    result += '!';
  }
  if (field.type) {
    result += `:${field.type.name}`;
    if (field.type.isArray) {
      result += '[]';
    }
    if (field.type.name === 'class' && field.type.options) {
      result += ` "${field.type.options.join(' | ')}"`;
    }
  }
  if (field.description && field.type?.name !== 'class') {
    result += ` "${field.description}"`;
  }
  return result;
}

function renderSignature(
  description: string | undefined,
  inputFields: readonly AxField[],
  outputFields: readonly AxField[]
): string {
  const descriptionPart = description ? `"${description}" ` : '';

  const inputFieldsRendered = inputFields.map(renderField).join(', ');

  const outputFieldsRendered = outputFields.map(renderField).join(', ');

  return `${descriptionPart}${inputFieldsRendered} -> ${outputFieldsRendered}`;
}

function isValidCase(inputString: string): boolean {
  const camelCaseRegex = /^[a-z][a-zA-Z0-9]*$/;
  const snakeCaseRegex = /^[a-z]+(_[a-z0-9]+)*$/;

  return camelCaseRegex.test(inputString) || snakeCaseRegex.test(inputString);
}

function validateField(
  field: Readonly<AxField>,
  context: 'input' | 'output'
): void {
  if (!field.name || field.name.length === 0) {
    throw new AxSignatureValidationError(
      'Field name cannot be blank',
      field.name,
      'Every field must have a descriptive name'
    );
  }

  if (!isValidCase(field.name)) {
    throw new AxSignatureValidationError(
      `Invalid field name '${field.name}' - must be camelCase or snake_case`,
      field.name,
      'Use camelCase (e.g., "userInput") or snake_case (e.g., "user_input")'
    );
  }

  if (axGlobals.signatureStrict) {
    const reservedNames = [
      'text',
      'object',
      'image',
      'string',
      'number',
      'boolean',
      'json',
      'array',
      'datetime',
      'date',
      'time',
      'type',
      'class',
      'input',
      'output',
      'data',
      'value',
      'result',
      'response',
      'request',
      'item',
      'element',
    ];

    if (reservedNames.includes(field.name.toLowerCase())) {
      const suggestions =
        context === 'input'
          ? [
              'userInput',
              'questionText',
              'documentContent',
              'messageText',
              'queryString',
            ]
          : [
              'responseText',
              'analysisResult',
              'categoryType',
              'summaryText',
              'outputData',
            ];

      throw new AxSignatureValidationError(
        `Field name '${field.name}' is too generic`,
        field.name,
        `Use a more descriptive name. Examples for ${context} fields: ${suggestions.join(', ')}`
      );
    }
  }

  if (field.name.length < 2) {
    throw new AxSignatureValidationError(
      `Field name '${field.name}' is too short`,
      field.name,
      'Field names must be at least 2 characters long'
    );
  }

  if (field.name.length > 50) {
    throw new AxSignatureValidationError(
      `Field name '${field.name}' is too long (${field.name.length} characters)`,
      field.name,
      'Field names should be 50 characters or less'
    );
  }

  if (field.type) {
    validateFieldType(field, context);
  }
}

function validateFieldType(
  field: Readonly<AxField>,
  context: 'input' | 'output'
): void {
  if (!field.type) return;

  const { type } = field;

  // Only media types (image, audio, file) are restricted to input fields
  // url, email, date, datetime can be used in both input and output
  if (type.name === 'image' || type.name === 'audio' || type.name === 'file') {
    if (context === 'output') {
      throw new AxSignatureValidationError(
        `${type.name} type is not supported in output fields`,
        field.name,
        `${type.name} types can only be used in input fields`
      );
    }
  }

  if (type.name === 'class') {
    if (context === 'input') {
      throw new AxSignatureValidationError(
        'Class type is not supported in input fields',
        field.name,
        'Class types are only allowed on output fields. Use "string" type for input classifications'
      );
    }

    if (!type.options || type.options.length === 0) {
      throw new AxSignatureValidationError(
        'Class type requires options',
        field.name,
        'Provide class options. Example: class "positive, negative, neutral"'
      );
    }

    for (const option of type.options) {
      if (!option || option.trim().length === 0) {
        throw new AxSignatureValidationError(
          'Empty class option found',
          field.name,
          'All class options must be non-empty strings'
        );
      }

      const trimmedOption = option.trim();
      if (trimmedOption.includes(',') || trimmedOption.includes('|')) {
        throw new AxSignatureValidationError(
          `Invalid class option "${trimmedOption}"`,
          field.name,
          'Class options cannot contain commas (,) or pipes (|) as they are used to separate options'
        );
      }
    }

    const uniqueOptions = new Set(
      type.options.map((opt) => opt.trim().toLowerCase())
    );
    if (uniqueOptions.size !== type.options.length) {
      throw new AxSignatureValidationError(
        'Duplicate class options found',
        field.name,
        'Each class option must be unique (case-insensitive)'
      );
    }
  }

  if (type.name === 'code' && type.isArray) {
    throw new AxSignatureValidationError(
      'Arrays of code are not commonly supported',
      field.name,
      'Consider using a single code field or an array of strings instead'
    );
  }

  if (field.isInternal && context === 'input') {
    throw new AxSignatureValidationError(
      'Internal marker (!) is not allowed on input fields',
      field.name,
      'Internal markers are only allowed on output fields'
    );
  }

  // Recursively validate nested object fields
  if (type.name === 'object' && type.fields) {
    validateNestedFields(type.fields, field.name, context);
  }
}

/**
 * Recursively validate nested object fields
 * Prevents media types (image, audio, file) from being used in nested objects
 */
function validateNestedFields(
  fields: Record<string, AxFieldType>,
  parentFieldName: string,
  context: 'input' | 'output',
  depth = 1
): void {
  for (const [fieldName, fieldType] of Object.entries(fields)) {
    const fullFieldName = `${parentFieldName}.${fieldName}`;

    // Check for forbidden media types in nested objects
    if (
      fieldType.type === 'image' ||
      fieldType.type === 'audio' ||
      fieldType.type === 'file'
    ) {
      throw new AxSignatureValidationError(
        `${fieldType.type} type is not allowed in nested object fields`,
        fullFieldName,
        `Media types (image, audio, file) can only be used as top-level input fields, not within objects. Found at depth ${depth}.`
      );
    }

    // Recursively validate nested objects
    if (fieldType.type === 'object' && fieldType.fields) {
      validateNestedFields(fieldType.fields, fullFieldName, context, depth + 1);
    }

    // Validate arrays of objects
    if (fieldType.isArray && fieldType.fields) {
      validateNestedFields(
        fieldType.fields,
        `${fullFieldName}[]`,
        context,
        depth + 1
      );
    }
  }
}
