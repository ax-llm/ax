import type { ZodTypeAny } from 'zod';

const hasInternals = (value: Record<string, unknown>, key: string): boolean => {
  const internals = value[key];
  return Boolean(internals && typeof internals === 'object');
};

export const isZodSchema = (value: unknown): value is ZodTypeAny => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const hasDef = hasInternals(record, '_def') || hasInternals(record, 'def');
  const hasZod =
    hasInternals(record, '_zod') &&
    hasInternals((record._zod as Record<string, unknown>) ?? {}, 'def');

  return (
    (hasDef || hasZod) &&
    Boolean(value.constructor) &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
};
