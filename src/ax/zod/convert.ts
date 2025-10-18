import {
  ZodArray,
  ZodCatch,
  ZodDefault,
  ZodEffects,
  ZodNullable,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodUnion,
  z,
} from 'zod';
import type { ZodRawShape, ZodTypeAny } from 'zod';

import type { AxField, AxSignatureConfig } from '../dsp/sig.js';

import type { AxZodConversionIssue } from './types.js';

interface UnwrappedSchema {
  readonly schema: ZodTypeAny;
  readonly optional: boolean;
  readonly notes: AxZodConversionIssue[];
}

const unsupported = (path: string, message: string): AxZodConversionIssue => ({
  path,
  message,
  severity: 'warning',
  kind: 'unsupported',
});

const downgrade = (path: string, message: string): AxZodConversionIssue => ({
  path,
  message,
  severity: 'info',
  kind: 'downgrade',
});

const validationIssue = (
  path: string,
  message: string
): AxZodConversionIssue => ({
  path,
  message,
  severity: 'info',
  kind: 'validation',
});

const isInstanceOf = <Ctor extends new (...args: any[]) => any>(
  value: unknown,
  ctor: Ctor | undefined
): value is InstanceType<Ctor> =>
  typeof ctor === 'function' && value instanceof ctor;

const getSchemaInternals = (
  schema: ZodTypeAny
): Record<string, unknown> | undefined => {
  const candidate = (schema as { _def?: unknown })._def;
  if (candidate && typeof candidate === 'object') {
    return candidate as Record<string, unknown>;
  }

  const def = (schema as { def?: unknown }).def;
  if (def && typeof def === 'object') {
    return def as Record<string, unknown>;
  }

  const zodInternals = (schema as { _zod?: { def?: unknown } })._zod;
  if (zodInternals && typeof zodInternals === 'object') {
    const nested = (zodInternals as { def?: unknown }).def;
    if (nested && typeof nested === 'object') {
      return nested as Record<string, unknown>;
    }
  }

  return undefined;
};

const unwrapInnerSchema = (schema: ZodTypeAny): ZodTypeAny | undefined => {
  const candidate =
    'unwrap' in schema &&
    typeof (schema as { unwrap?: unknown }).unwrap === 'function'
      ? (schema as { unwrap: () => ZodTypeAny }).unwrap()
      : undefined;
  if (candidate) {
    return candidate;
  }

  const internals = getSchemaInternals(schema);
  if (!internals) {
    return undefined;
  }

  if ('innerType' in internals && internals.innerType) {
    return internals.innerType as ZodTypeAny;
  }

  if ('schema' in internals && internals.schema) {
    return internals.schema as ZodTypeAny;
  }

  return undefined;
};

const unwrapSchema = (schema: ZodTypeAny, path: string): UnwrappedSchema => {
  const notes: AxZodConversionIssue[] = [];
  let current = schema;
  let optional = false;

  while (true) {
    if (current instanceof ZodOptional || current instanceof ZodNullable) {
      optional = true;
      const inner = unwrapInnerSchema(current);
      if (!inner || inner === current) {
        break;
      }
      current = inner;
      continue;
    }

    if (current instanceof ZodDefault) {
      optional = true;
      const inner = unwrapInnerSchema(current);
      if (!inner || inner === current) {
        break;
      }
      notes.push(
        validationIssue(path, 'default value will be applied at runtime')
      );
      current = inner;
      continue;
    }

    if (current instanceof ZodCatch) {
      optional = true;
      const inner = unwrapInnerSchema(current);
      if (!inner || inner === current) {
        break;
      }
      notes.push(
        validationIssue(
          path,
          'fallback value via .catch() will be used when parsing fails'
        )
      );
      current = inner;
      continue;
    }

    const internals = getSchemaInternals(current);
    const isTransform = internals?.type === 'transform';
    if (current instanceof ZodEffects || isTransform) {
      notes.push(
        downgrade(
          path,
          'effects/transform pipelines execute after validation and may not fully map to signature types'
        )
      );
      const inner = unwrapInnerSchema(current);
      if (!inner || inner === current) {
        break;
      }
      current = inner;
      continue;
    }

    break;
  }

  return { schema: current, optional, notes };
};

const mapLiteralOptions = (values: readonly unknown[]): string[] => {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      result.push(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result.push(String(value));
    }
  }
  return result;
};

const mapZodToAxFieldType = (
  schema: ZodTypeAny,
  path: string,
  issues: AxZodConversionIssue[]
): Omit<AxField, 'name'> => {
  if (schema instanceof ZodArray) {
    const innerIssues: AxZodConversionIssue[] = [];
    const inner = mapZodToAxFieldType(schema.element, `${path}[]`, innerIssues);
    issues.push(...innerIssues);
    return {
      ...inner,
      type: inner.type
        ? {
            ...inner.type,
            isArray: true,
          }
        : undefined,
    };
  }

  if (schema instanceof ZodObject) {
    issues.push(
      downgrade(
        path,
        'nested object coerced to json field; use toZod() for runtime validation'
      )
    );
    return {
      type: {
        name: 'json',
      },
    };
  }

  if (schema instanceof ZodRecord) {
    issues.push(
      downgrade(
        path,
        'record/map schemas downgraded to json field in signature'
      )
    );
    return {
      type: {
        name: 'json',
      },
    };
  }

  const discriminatedUnionCtor = z.ZodDiscriminatedUnion as unknown as
    | (new (
        ...args: any[]
      ) => z.ZodDiscriminatedUnion<any, any>)
    | undefined;
  if (
    schema instanceof ZodUnion ||
    isInstanceOf(schema, discriminatedUnionCtor)
  ) {
    issues.push(
      downgrade(
        path,
        'union schema flattened to json field; runtime validator retains union semantics'
      )
    );
    return {
      type: {
        name: 'json',
      },
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: { name: 'string' } };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: { name: 'number' } };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: { name: 'boolean' } };
  }

  if (schema instanceof z.ZodDate) {
    issues.push(
      downgrade(
        path,
        'date mapped to string field; prefer ISO string outputs for fidelity'
      )
    );
    return { type: { name: 'string' } };
  }

  if (schema instanceof z.ZodBigInt) {
    issues.push(downgrade(path, 'bigint coerced to string field'));
    return { type: { name: 'string' } };
  }

  if (schema instanceof z.ZodLiteral) {
    const internals = getSchemaInternals(schema) ?? {};
    const literalValues = Array.isArray(
      (internals as { values?: unknown }).values
    )
      ? ((internals as { values: readonly unknown[] }).values ?? [])
      : 'value' in internals
        ? [(internals as { value?: unknown }).value].filter(
            (value): value is unknown => value !== undefined
          )
        : [];

    const candidate = literalValues[0];
    if (typeof candidate === 'string') {
      return {
        type: {
          name: 'string',
          options: [candidate],
        },
      };
    }
    if (typeof candidate === 'number') {
      return {
        type: {
          name: 'number',
        },
      };
    }
    if (typeof candidate === 'boolean') {
      return {
        type: {
          name: 'boolean',
        },
      };
    }
  }

  if (schema instanceof z.ZodEnum) {
    const internals = getSchemaInternals(schema);
    const rawValues =
      (internals?.values as readonly unknown[] | undefined) ?? [];
    const options = mapLiteralOptions(rawValues);
    return {
      type: {
        name: 'string',
        options,
      },
    };
  }

  if (schema instanceof z.ZodNativeEnum) {
    const internals = getSchemaInternals(schema);
    const rawValues = internals?.values;
    const options = mapLiteralOptions(
      rawValues && typeof rawValues === 'object'
        ? Object.values(rawValues as Record<string, unknown>)
        : []
    );
    return {
      type: {
        name: 'string',
        options,
      },
    };
  }

  if (
    schema instanceof z.ZodAny ||
    schema instanceof z.ZodUnknown ||
    schema instanceof z.ZodVoid
  ) {
    return {
      type: {
        name: 'json',
      },
    };
  }

  const internals = getSchemaInternals(schema);
  const typeName =
    (internals?.typeName as string | undefined) ??
    (internals?.type as string | undefined) ??
    schema.constructor?.name ??
    'unknown';

  issues.push(
    unsupported(
      path,
      `schema kind "${typeName}" downgraded to json in Ax signature`
    )
  );
  return {
    type: {
      name: 'json',
    },
  };
};

const convertObjectShape = (
  shape: ZodRawShape,
  path: string,
  issues: AxZodConversionIssue[]
): AxField[] => {
  const fields: AxField[] = [];
  for (const [name, propSchema] of Object.entries(shape)) {
    const propPath =
      path === '$' ? `$${name ? `.${name}` : ''}` : `${path}.${name}`;
    const { schema, optional, notes } = unwrapSchema(propSchema, propPath);
    issues.push(...notes);
    const field = mapZodToAxFieldType(schema, propPath, issues);
    fields.push({
      name,
      type: field.type,
      description: field.description,
      isOptional: optional || field.isOptional,
      isInternal: field.isInternal,
    });
  }
  return fields;
};

export interface ZodToSignatureResult {
  readonly config: AxSignatureConfig;
  readonly issues: readonly AxZodConversionIssue[];
  readonly fieldNames: readonly string[];
}

export const zodToSignatureConfig = (
  schema: ZodTypeAny
): ZodToSignatureResult => {
  const issues: AxZodConversionIssue[] = [];
  const unwrapped = unwrapSchema(schema, '$');
  issues.push(...unwrapped.notes);
  let outputs: AxField[] = [];
  let fieldNames: string[] = [];

  if (unwrapped.schema instanceof ZodObject) {
    outputs = convertObjectShape(unwrapped.schema.shape, '$', issues);
    fieldNames = outputs.map((f) => f.name);
  } else {
    const field = mapZodToAxFieldType(unwrapped.schema, '$', issues);
    outputs = [
      {
        name: 'result',
        type: field.type,
        description: field.description,
        isOptional: unwrapped.optional || field.isOptional,
        isInternal: field.isInternal,
      },
    ];
    fieldNames = ['result'];
  }

  const config: AxSignatureConfig = {
    inputs: [],
    outputs,
  };

  return { config, issues, fieldNames };
};

const buildEnum = (
  options: readonly string[]
): z.ZodEnum<[string, ...string[]]> => {
  if (options.length === 0) {
    return z.enum(['']);
  }
  const [first, ...rest] = options;
  return z.enum([first, ...rest]);
};

const mapFieldToZod = (field: AxField): ZodTypeAny => {
  const base = (() => {
    const type = field.type;
    if (!type) {
      return z.string();
    }

    switch (type.name) {
      case 'string': {
        if (type.options && type.options.length > 0) {
          return buildEnum(type.options as [string, ...string[]]);
        }
        return z.string();
      }
      case 'number':
        return z.number();
      case 'boolean':
        return z.boolean();
      case 'json':
        return z.any();
      case 'date':
      case 'datetime':
        return z.string();
      case 'url':
        return z.string().url();
      case 'code':
        return z.string();
      case 'file':
      case 'image':
      case 'audio':
        return z.any();
      default:
        return z.any();
    }
  })();

  const withCardinality = field.type?.isArray ? z.array(base) : base;
  return field.isOptional ? withCardinality.optional() : withCardinality;
};

export const signatureFieldsToZod = (
  fields: readonly AxField[]
): ZodTypeAny => {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = mapFieldToZod(field);
  }
  return z.object(shape);
};
