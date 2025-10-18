import type { ZodError, ZodTypeAny } from 'zod';

import type { AxAssertion } from '../dsp/asserts.js';

import type { AxZodMetadata } from './types.js';

const formatError = (error: ZodError): string => {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  return `Zod validation failed: ${issues.join('; ')}`;
};

const applyParsedData = (
  values: Record<string, unknown>,
  parsed: Record<string, unknown>,
  fieldNames: readonly string[]
) => {
  for (const key of fieldNames) {
    if (key in parsed) {
      (values as any)[key] = (parsed as any)[key];
    } else {
      delete (values as any)[key];
    }
  }
};

const runParser = (
  schema: ZodTypeAny,
  mode: AxZodMetadata['options']['mode'],
  values: Record<string, unknown>
):
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: ZodError } => {
  if (mode === 'parse') {
    const data = schema.parse(values);
    return { success: true, data };
  }

  const result = schema.safeParse(values);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: result.data as Record<string, unknown> };
};

export const createFinalZodAssertion = (
  meta: AxZodMetadata
): AxAssertion<Record<string, unknown>> => ({
  message: 'Zod validation failed',
  fn: async (values) => {
    const output = runParser(meta.schema, meta.options.mode, values);
    if (!output.success) {
      return formatError(output.error);
    }

    applyParsedData(values, output.data, meta.fieldNames);
    return true;
  },
});
