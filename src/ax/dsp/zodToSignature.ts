import type { z, ZodObject, ZodTypeAny } from 'zod';

import type { AxField } from './sig.js';

type ZodObjectLike = ZodObject<any, any>;

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
};

function getDef(schema: ZodTypeAny): ZodDef {
  return ((schema as unknown as { _def?: ZodDef })._def ??
    (schema as unknown as { def?: ZodDef }).def ??
    {}) as ZodDef;
}

function getTypeToken(schema: ZodTypeAny): string | undefined {
  const def = getDef(schema);
  return def.typeName ?? def.type;
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

    if (typeToken === 'effects') {
      const next = getDef(current).schema;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
    }

    if (typeToken === 'pipeline') {
      const next = getDef(current).out;
      if (!next || typeof next !== 'object') {
        break;
      }
      current = next as ZodTypeAny;
      description ??= current.description;
      continue;
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
  context: 'input' | 'output'
): FieldTypeResult {
  const typeToken = getTypeToken(schema);

  switch (typeToken) {
    case 'string':
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
        return { type: { name: 'json' } };
      }
      if (typeof value === 'string' || typeof value === 'number') {
        return {
          type: {
            name: 'class',
            options: [String(value)],
          },
        };
      }
      return { type: { name: 'json' } };
    }
    case 'enum': {
      const values = getDef(schema).values as readonly string[] | undefined;
      if (!values) {
        return { type: { name: 'json' } };
      }
      return {
        type: {
          name: 'class',
          options: toUniqueStrings(values),
        },
      };
    }
    case 'nativeEnum': {
      const rawValues = Object.values(
        (getDef(schema).values ?? {}) as Record<string, string | number>
      );
      const stringValues = rawValues.filter(
        (value) => typeof value === 'string'
      ) as string[];
      const numberValues = rawValues.filter(
        (value) => typeof value === 'number'
      ) as number[];
      const options = stringValues.length
        ? toUniqueStrings(stringValues)
        : toUniqueStrings(numberValues);
      if (!options.length) {
        return { type: { name: 'json' } };
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
            return { type: { name: 'json' }, forceOptional };
          }
          literalValues.push(literalValue as string | number | boolean);
          forceOptional = forceOptional || unwrapped.optional;
          continue;
        }

        return { type: { name: 'json' }, forceOptional };
      }

      const mapped = mapLiteralUnion(literalValues);
      mapped.forceOptional ||= forceOptional;
      if (context === 'input' && mapped.type.name === 'class') {
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
        return { type: { name: 'json' } };
      }

      const elementSchema = unwrapSchema(rawElement);
      const elementType = getFieldType(elementSchema.schema, context);

      if (elementType.type.isArray) {
        return {
          type: { name: 'json', isArray: true },
          forceOptional: elementType.forceOptional,
        };
      }

      const result = {
        type: {
          name: elementType.type.name,
          isArray: true,
          options: elementType.type.options,
        },
        forceOptional: elementSchema.optional || elementType.forceOptional,
      };

      if (context === 'input' && result.type.name === 'class') {
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
    case 'object':
    case 'tuple':
    case 'record':
    case 'map':
    case 'set':
    case 'function':
    case 'lazy':
    case 'promise':
    case 'discriminatedUnion':
    case 'intersection':
      return { type: { name: 'json' } };
    default:
      return { type: { name: 'json' } };
  }
}

function getObjectShape(schema: ZodObjectLike): Record<string, ZodTypeAny> {
  if (typeof (schema as { shape?: unknown }).shape === 'function') {
    return (schema as { shape: () => Record<string, ZodTypeAny> }).shape();
  }

  if ((schema as unknown as { shape?: Record<string, ZodTypeAny> }).shape) {
    return (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
  }

  return (schema as unknown as { _def: { shape: Record<string, ZodTypeAny> } })
    ._def.shape;
}

export function zodObjectToSignatureFields(
  schema: ZodObjectLike,
  context: 'input' | 'output'
): AxField[] {
  const shape = getObjectShape(schema);
  const fields: AxField[] = [];

  for (const [name, childSchema] of Object.entries(shape)) {
    const unwrapped = unwrapSchema(childSchema);
    const fieldType = getFieldType(unwrapped.schema, context);

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

export type InferZodInput<T extends ZodObjectLike | undefined> =
  T extends ZodObjectLike ? z.input<T> : Record<string, never>;

export type InferZodOutput<T extends ZodObjectLike | undefined> =
  T extends ZodObjectLike ? z.output<T> : Record<string, never>;
