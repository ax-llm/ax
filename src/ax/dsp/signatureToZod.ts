import { z, type ZodTypeAny } from 'zod';

import type { AxField } from './sig.js';

export type SignatureToZodSeverity = 'downgraded' | 'unsupported';

export type SignatureToZodIssue = {
  readonly context: 'input' | 'output';
  readonly path: readonly string[];
  readonly fieldType: string;
  readonly fallback: string;
  readonly reason: string;
  readonly severity: SignatureToZodSeverity;
};

export type SignatureFieldsToZodOptions = {
  readonly issues?: SignatureToZodIssue[];
  readonly basePath?: readonly string[];
};

const UNIQUE_URL_SCHEMA = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
});

function recordIssue(
  issues: SignatureToZodIssue[] | undefined,
  context: 'input' | 'output',
  path: readonly string[],
  fieldType: string,
  fallback: string,
  reason: string,
  severity: SignatureToZodSeverity
): void {
  if (!issues) {
    return;
  }
  issues.push({
    context,
    fallback,
    fieldType,
    path: [...path],
    reason,
    severity,
  });
}

function createEnum(options: readonly string[]) {
  const unique = Array.from(new Set(options));
  if (unique.length === 0) {
    return undefined;
  }
  const [first, ...rest] = unique;
  return z.enum([first, ...rest] as [string, ...string[]]);
}

function buildBaseSchema(
  field: Readonly<AxField>,
  context: 'input' | 'output',
  issues: SignatureToZodIssue[] | undefined,
  path: readonly string[]
): ZodTypeAny {
  const fieldType = field.type?.name ?? 'string';
  switch (fieldType) {
    case 'string': {
      if (field.type?.options?.length) {
        const enumSchema = createEnum(field.type.options);
        if (enumSchema) {
          return enumSchema;
        }
      }
      return z.string();
    }
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'json':
      return z.any();
    case 'image':
      return z.object({
        mimeType: z.string(),
        data: z.string(),
      });
    case 'file':
      return z.union([
        z.object({
          mimeType: z.string(),
          data: z.string(),
        }),
        z.object({
          mimeType: z.string(),
          fileUri: z.string(),
        }),
      ]);
    case 'url':
      return z.union([z.string().url(), UNIQUE_URL_SCHEMA]);
    case 'date':
      return z.union([z.date(), z.string()]);
    case 'datetime':
      return z.union([z.date(), z.string()]);
    case 'class': {
      if (field.type?.options?.length) {
        const enumSchema = createEnum(field.type.options);
        if (enumSchema) {
          return enumSchema;
        }
      }
      recordIssue(
        issues,
        context,
        path,
        fieldType,
        'z.string()',
        'Class field without options maps to string',
        'downgraded'
      );
      return z.string();
    }
    case 'code':
      return z.string();
    default:
      recordIssue(
        issues,
        context,
        path,
        fieldType,
        'z.any()',
        'Field type not directly representable in Zod, using z.any()',
        'unsupported'
      );
      return z.any();
  }
}

export function signatureFieldsToZodObject(
  fields: readonly AxField[],
  context: 'input' | 'output',
  options?: SignatureFieldsToZodOptions
) {
  const basePath = options?.basePath ?? [];
  const shape: Record<string, ZodTypeAny> = {};

  for (const field of fields) {
    const path = [...basePath, field.name];
    let schema = buildBaseSchema(field, context, options?.issues, path);
    if (field.type?.isArray) {
      schema = z.array(schema);
    }
    if (field.isOptional) {
      schema = schema.optional();
    }
    if (field.description) {
      schema = schema.describe(field.description);
    }
    shape[field.name] = schema;
  }

  return z.object(shape);
}
