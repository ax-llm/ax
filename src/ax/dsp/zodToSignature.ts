import type { ZodTypeAny } from 'zod';

import type { AxField } from './sig.js';

type FieldTypeName =
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
  | 'code';

type FieldTypeResult = {
  type: {
    name: FieldTypeName;
    isArray?: boolean;
    options?: string[];
  };
  forceOptional?: boolean;
};

export type ZodConversionSeverity = 'downgraded' | 'unsupported';

export type ZodConversionIssue = {
  readonly path: readonly string[];
  readonly context: 'input' | 'output';
  readonly schemaType?: string;
  readonly fallbackType: FieldTypeName;
  readonly reason: string;
  readonly severity: ZodConversionSeverity;
};

type UnwrappedSchema = {
  schema: ZodTypeAny;
  optional: boolean;
  description?: string;
};

type ZodDef = {
  typeName?: string;
  type?: string;
  innerType?: ZodTypeAny;
  schema?: ZodTypeAny;
  out?: ZodTypeAny;
  element?: ZodTypeAny;
  typeOutputs?: ZodTypeAny;
  value?: unknown;
  values?: readonly string[] | Record<string, string | number>;
  options?: ZodTypeAny[];
  entries?: Record<string, string | number>;
  checks?: unknown[];
};

function getDef(schema: ZodTypeAny): ZodDef {
  return ((schema as unknown as { _def?: ZodDef })._def ??
    (schema as unknown as { def?: ZodDef }).def ??
    {}) as ZodDef;
}

const TYPE_TOKEN_MAP: Record<string, string> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBigInt: 'bigint',
  ZodNaN: 'nan',
  ZodBoolean: 'boolean',
  ZodDate: 'date',
  ZodLiteral: 'literal',
  ZodEnum: 'enum',
  ZodNativeEnum: 'nativeEnum',
  ZodUnion: 'union',
  ZodDiscriminatedUnion: 'discriminatedUnion',
  ZodIntersection: 'intersection',
  ZodArray: 'array',
  ZodTuple: 'tuple',
  ZodRecord: 'record',
  ZodMap: 'map',
  ZodSet: 'set',
  ZodObject: 'object',
  ZodFunction: 'function',
  ZodLazy: 'lazy',
  ZodPromise: 'promise',
  ZodOptional: 'optional',
  ZodNullable: 'nullable',
  ZodDefault: 'default',
  ZodCatch: 'catch',
  ZodEffects: 'effects',
  ZodPipeline: 'pipeline',
  ZodBranded: 'branded',
  ZodReadonly: 'readonly',
  ZodAny: 'any',
  ZodUnknown: 'unknown',
  ZodNever: 'never',
  ZodVoid: 'void',
  ZodUndefined: 'undefined',
  ZodNull: 'null',
  ZodSymbol: 'symbol',
};

function getTypeToken(schema: ZodTypeAny): string | undefined {
  const def = getDef(schema);
  const raw = def.typeName ?? def.type;
  if (!raw) {
    return raw;
  }
  return TYPE_TOKEN_MAP[raw] ?? raw;
}

function getLiteralValue(schema: ZodTypeAny): unknown {
  const def = getDef(schema);
  if (Object.hasOwn(def, 'value')) {
    return def.value;
  }
  const values = def.values;
  if (Array.isArray(values) && values.length > 0) {
    return values[0];
  }
  return undefined;
}

function unwrapSchema(schema: ZodTypeAny): UnwrappedSchema {
  let current = schema;
  let optional = false;
  let description = schema.description;

  // Loop through wrappers until we reach a concrete schema
  for (;;) {
    const typeToken = getTypeToken(current);
    if (!typeToken) {
      break;
    }

    if (typeToken === 'optional' || typeToken === 'nullable') {
      optional = true;
      const next = getDef(current).innerType;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
    }

    if (typeToken === 'default' || typeToken === 'catch') {
      optional = true;
      const next = getDef(current).innerType;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
    }

    if (
      typeToken === 'effects' ||
      typeToken === 'pipeline' ||
      typeToken === 'pipe'
    ) {
      // Zod effects/pipeline nodes wrap transformations/refinements that can
      // change runtime data. We keep the wrapper intact so the caller can
      // detect the downgrade (handled in getFieldType).
      break;
    }

    if (typeToken === 'branded') {
      const next = getDef(current).type;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
    }

    if (typeToken === 'readonly') {
      const next = getDef(current).innerType;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
    }

    break;
  }

  return {
    schema: current,
    optional,
    description,
  };
}

function toUniqueStrings(
  values: Iterable<string | number | boolean>
): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    seen.add(String(value));
  }
  return [...seen];
}

function recordIssue(
  issues: ZodConversionIssue[] | undefined,
  context: 'input' | 'output',
  path: readonly string[],
  schemaType: string | undefined,
  fallbackType: FieldTypeName,
  reason: string,
  severity: ZodConversionSeverity = 'unsupported'
): void {
  if (!issues) return;
  issues.push({
    context,
    fallbackType,
    path: [...path],
    reason,
    schemaType,
    severity,
  });
}

export type ZodObjectToSignatureOptions = {
  readonly issues?: ZodConversionIssue[];
  readonly basePath?: readonly string[];
};

function extractEnumValues(def: ZodDef): Array<string | number> | undefined {
  const values = def.values;
  if (Array.isArray(values)) {
    return [...values];
  }
  if (values && typeof values === 'object') {
    return Object.values(values as Record<string, string | number>);
  }
  if (def.entries && typeof def.entries === 'object') {
    return Object.values(def.entries);
  }
  return undefined;
}

function hasStringCheck(def: ZodDef, keyword: string): boolean {
  if (!Array.isArray(def.checks)) {
    return false;
  }
  const lowerKeyword = keyword.toLowerCase();
  return def.checks.some((rawCheck) => {
    if (!rawCheck || typeof rawCheck !== 'object') {
      return false;
    }

    const check = rawCheck as Record<string, unknown>;
    const candidates = [
      check.kind,
      check.format,
      check.type,
      check.name,
      (rawCheck as { constructor?: { name?: string } }).constructor?.name,
    ];
    return candidates.some(
      (value) =>
        typeof value === 'string' && value.toLowerCase().includes(lowerKeyword)
    );
  });
}

function mapLiteralUnion(
  values: (string | number | boolean)[]
): FieldTypeResult {
  if (!values.length) {
    return { type: { name: 'json' } };
  }

  if (values.every((value) => typeof value === 'boolean')) {
    return { type: { name: 'boolean' } };
  }

  return {
    type: {
      name: 'class',
      options: toUniqueStrings(values),
    },
  };
}

function getFieldType(
  schema: ZodTypeAny,
  context: 'input' | 'output',
  path: readonly string[],
  issues?: ZodConversionIssue[]
): FieldTypeResult {
  const typeToken = getTypeToken(schema);
  const schemaDef = getDef(schema);

  switch (typeToken) {
    case 'string':
      if (hasStringCheck(schemaDef, 'datetime')) {
        return { type: { name: 'datetime' } };
      }
      if (hasStringCheck(schemaDef, 'url')) {
        return { type: { name: 'url' } };
      }
      return { type: { name: 'string' } };
    case 'number':
    case 'bigint':
    case 'nan':
      return { type: { name: 'number' } };
    case 'boolean':
      return { type: { name: 'boolean' } };
    case 'date':
      return { type: { name: 'date' } };
    case 'literal': {
      const value = getLiteralValue(schema);
      if (typeof value === 'boolean') {
        return { type: { name: 'boolean' } };
      }
      if (value === null || value === undefined) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Literal unions containing null or undefined map to json'
        );
        return { type: { name: 'json' } };
      }
      if (typeof value === 'string' || typeof value === 'number') {
        const literalOptions = [String(value)];
        if (context === 'input') {
          recordIssue(
            issues,
            context,
            path,
            typeToken,
            'string',
            'Ax inputs do not support class fields; downgraded to string',
            'downgraded'
          );
          return {
            type: {
              name: 'string',
              options: literalOptions,
            },
          };
        }
        return {
          type: {
            name: 'class',
            options: literalOptions,
          },
        };
      }
      return { type: { name: 'json' } };
    }
    case 'enum': {
      const values = extractEnumValues(schemaDef)?.filter(
        (value): value is string => typeof value === 'string'
      );
      if (!values || values.length === 0) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Enum without values falls back to json'
        );
        return { type: { name: 'json' } };
      }
      const options = toUniqueStrings(values);
      if (context === 'input') {
        return { type: { name: 'string', options } };
      }
      return {
        type: {
          name: 'class',
          options,
        },
      };
    }
    case 'nativeEnum': {
      const enumValues =
        extractEnumValues(schemaDef) ??
        Object.values(
          (schemaDef.values ?? schemaDef.entries ?? {}) as Record<
            string,
            string | number
          >
        );
      if (!enumValues || enumValues.length === 0) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Native enum with mixed or empty values falls back to json'
        );
        return { type: { name: 'json' } };
      }
      const stringValues = enumValues.filter(
        (value): value is string => typeof value === 'string'
      );
      const numberValues = enumValues.filter(
        (value): value is number => typeof value === 'number'
      );
      const options = stringValues.length
        ? toUniqueStrings(stringValues)
        : toUniqueStrings(numberValues);
      if (!options.length) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Native enum with mixed or empty values falls back to json'
        );
        return { type: { name: 'json' } };
      }
      if (context === 'input') {
        return { type: { name: 'string', options } };
      }
      return {
        type: {
          name: 'class',
          options,
        },
      };
    }
    case 'union': {
      const options = (getDef(schema).options ?? []) as ZodTypeAny[];
      const optionsMap = (schemaDef as { optionsMap?: unknown }).optionsMap;
      if (optionsMap && typeof optionsMap === 'object') {
        recordIssue(
          issues,
          context,
          path,
          'discriminatedUnion',
          'json',
          'Discriminated unions flatten to json objects in Ax signatures',
          'downgraded'
        );
        return { type: { name: 'json' } };
      }
      const literalValues: (string | number | boolean)[] = [];
      let forceOptional = false;

      for (const option of options) {
        const unwrapped = unwrapSchema(option);
        const innerType = getTypeToken(unwrapped.schema);
        if (
          innerType === 'undefined' ||
          innerType === 'null' ||
          innerType === 'void'
        ) {
          forceOptional = true;
          continue;
        }

        if (innerType === 'literal') {
          const literalValue = getLiteralValue(unwrapped.schema);
          if (literalValue === undefined) {
            forceOptional = true;
            continue;
          }
          if (
            literalValue === null ||
            literalValue === undefined ||
            (typeof literalValue !== 'string' &&
              typeof literalValue !== 'number' &&
              typeof literalValue !== 'boolean')
          ) {
            recordIssue(
              issues,
              context,
              path,
              typeToken,
              'json',
              'Union includes literal that cannot be stringified, falling back to json',
              'downgraded'
            );
            return { type: { name: 'json' }, forceOptional };
          }
          literalValues.push(literalValue as string | number | boolean);
          forceOptional = forceOptional || unwrapped.optional;
          continue;
        }

        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Union members beyond literals fall back to json',
          'downgraded'
        );
        return { type: { name: 'json' }, forceOptional };
      }

      const mapped = mapLiteralUnion(literalValues);
      mapped.forceOptional ||= forceOptional;
      if (mapped.type.name === 'json') {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Union with no literal members falls back to json',
          'downgraded'
        );
      }
      if (context === 'input' && mapped.type.name === 'class') {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'string',
          'Ax inputs do not support class fields; downgraded to string',
          'downgraded'
        );
        return {
          type: {
            name: 'string',
            options: mapped.type.options,
          },
          forceOptional: mapped.forceOptional,
        };
      }
      return mapped;
    }
    case 'array': {
      const elementDef = getDef(schema);
      const rawElement = (elementDef.element ??
        (typeof elementDef.schema === 'object'
          ? elementDef.schema
          : undefined) ??
        (typeof (elementDef as { type?: unknown }).type === 'object'
          ? (elementDef as unknown as { type: ZodTypeAny }).type
          : undefined)) as ZodTypeAny | undefined;

      if (!rawElement) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Array element type missing; falling back to json'
        );
        return { type: { name: 'json' } };
      }

      const elementSchema = unwrapSchema(rawElement);
      const elementType = getFieldType(
        elementSchema.schema,
        context,
        [...path, '*'],
        issues
      );

      if (elementType.type.isArray) {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'json',
          'Nested arrays are not supported; falling back to json',
          'downgraded'
        );
        return {
          type: { name: 'json', isArray: true },
          forceOptional: elementType.forceOptional,
        };
      }

      // Array optionality should be controlled by wrappers on the array schema
      // itself (handled via unwrapSchema). Optional element schemas must not
      // leak up and mark the entire array field as optional.
      const result: FieldTypeResult = {
        type: {
          name: elementType.type.name,
          isArray: true,
          options: elementType.type.options,
        },
      };

      if (context === 'input' && result.type.name === 'class') {
        recordIssue(
          issues,
          context,
          path,
          typeToken,
          'string',
          'Ax inputs do not support class fields; downgraded to string',
          'downgraded'
        );
        return {
          type: {
            name: 'string',
            isArray: true,
            options: result.type.options,
          },
          forceOptional: result.forceOptional,
        };
      }

      return result;
    }
    case 'record': {
      const keySchema = (schemaDef as { keyType?: ZodTypeAny }).keyType;
      const _valueSchema = (schemaDef as { valueType?: ZodTypeAny }).valueType;
      const keyToken = keySchema ? getTypeToken(keySchema) : undefined;
      const severity: ZodConversionSeverity =
        keyToken === 'string' ? 'downgraded' : 'unsupported';
      const reason =
        keyToken === 'string'
          ? 'Records with string keys remain json to preserve dynamic maps'
          : 'Records with non-string keys map to json';
      recordIssue(issues, context, path, typeToken, 'json', reason, severity);
      return { type: { name: 'json' } };
    }
    case 'map': {
      const keySchema = (schemaDef as { keyType?: ZodTypeAny }).keyType;
      const keyToken = keySchema ? getTypeToken(keySchema) : undefined;
      const severity: ZodConversionSeverity =
        keyToken && keyToken !== 'unknown' ? 'downgraded' : 'unsupported';
      const reason =
        keyToken === 'string'
          ? 'Maps convert to json objects with dynamic keys'
          : 'Maps with non-string keys map to json';
      recordIssue(issues, context, path, typeToken, 'json', reason, severity);
      return { type: { name: 'json' } };
    }
    case 'set': {
      recordIssue(
        issues,
        context,
        path,
        typeToken,
        'json',
        'Sets are serialized as arrays; using json representation',
        'downgraded'
      );
      return { type: { name: 'json' } };
    }
    case 'effects':
    case 'pipeline':
    case 'pipe': {
      recordIssue(
        issues,
        context,
        path,
        typeToken,
        'json',
        'Zod transformations (effects/pipe) may alter runtime types; falling back to json',
        'downgraded'
      );
      return { type: { name: 'json' } };
    }
    case 'discriminatedUnion': {
      recordIssue(
        issues,
        context,
        path,
        typeToken,
        'json',
        'Discriminated unions flatten to json objects in Ax signatures',
        'downgraded'
      );
      return { type: { name: 'json' } };
    }
    case 'intersection': {
      recordIssue(
        issues,
        context,
        path,
        typeToken,
        'json',
        'Intersections are merged as json objects',
        'downgraded'
      );
      return { type: { name: 'json' } };
    }
    case 'object':
    case 'tuple':
    case 'function':
    case 'lazy':
    case 'promise':
      recordIssue(
        issues,
        context,
        path,
        typeToken,
        'json',
        `${typeToken ?? 'unknown'} schemas map to json`
      );
      return { type: { name: 'json' } };
    default:
      recordIssue(
        issues,
        context,
        path,
        typeToken ?? 'unknown',
        'json',
        `${typeToken ?? 'unknown'} schemas map to json`
      );
      return { type: { name: 'json' } };
  }
}

function getObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  if (typeof (schema as { shape?: unknown }).shape === 'function') {
    return (
      schema as unknown as {
        shape: () => Record<string, ZodTypeAny>;
      }
    ).shape();
  }

  if ((schema as unknown as { shape?: Record<string, ZodTypeAny> }).shape) {
    return (
      schema as unknown as {
        shape: Record<string, ZodTypeAny>;
      }
    ).shape;
  }

  return (schema as unknown as { _def: { shape: Record<string, ZodTypeAny> } })
    ._def.shape;
}

export function zodObjectToSignatureFields(
  schema: ZodTypeAny,
  context: 'input' | 'output',
  options?: ZodObjectToSignatureOptions
): AxField[] {
  const typeToken = getTypeToken(schema);
  if (typeToken !== 'object') {
    throw new TypeError(
      `Expected a Zod object schema for ${context}, received ${typeToken ?? 'unknown'}`
    );
  }

  const shape = getObjectShape(schema);
  const fields: AxField[] = [];
  const basePath = options?.basePath ?? [];

  for (const [name, childSchema] of Object.entries(shape)) {
    const unwrapped = unwrapSchema(childSchema);
    const fieldType = getFieldType(
      unwrapped.schema,
      context,
      [...basePath, name],
      options?.issues
    );

    const description = unwrapped.description ?? childSchema.description;
    const isOptional = unwrapped.optional || fieldType.forceOptional;

    const field: AxField = {
      name,
      type: {
        name: fieldType.type.name,
      },
    };

    if (fieldType.type.isArray) {
      field.type!.isArray = true;
    }

    if (fieldType.type.options && fieldType.type.options.length > 0) {
      field.type!.options = [...fieldType.type.options];
    }

    if (description) {
      field.description = description;
    }

    if (isOptional) {
      field.isOptional = true;
    }

    fields.push(field);
  }

  return fields;
}

type ZodInputType<T> = T extends { _input: infer U } ? U : never;
type ZodOutputType<T> = T extends { _output: infer U } ? U : never;
type NormalizeSchema<T> = T extends { _input: any; _output: any } ? T : never;

export type InferZodInput<T> = NormalizeSchema<T> extends infer S
  ? S extends { _input: any; _output: any }
    ? ZodInputType<S> extends Record<string, any>
      ? ZodInputType<S>
      : Record<string, never>
    : Record<string, never>
  : never;

export type InferZodOutput<T> = NormalizeSchema<T> extends infer S
  ? S extends { _input: any; _output: any }
    ? ZodOutputType<S> extends Record<string, any>
      ? ZodOutputType<S>
      : Record<string, never>
    : Record<string, never>
  : never;
