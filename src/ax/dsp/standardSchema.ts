import type { AxFunctionJSONSchema } from '../ai/types.js';

import { ValidationError } from './errors.js';
import { toJsonSchema } from './jsonSchema.js';
import type { AxField, AxFieldType } from './sig.js';

// ---------------------------------------------------------------------------
// Inlined Standard Schema v1 spec
// ---------------------------------------------------------------------------
// The spec is a structural interface (zero runtime code). We mirror it here
// so users can pass zod / valibot / arktype schemas into ax without ax
// dragging in the @standard-schema/spec package. Any library that satisfies
// this shape works — that is the whole point of the spec.

/** The Standard Schema v1 interface. Structurally compatible with `@standard-schema/spec`. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input'];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}

/**
 * Per-field companion options for Standard Schema (zod/valibot/arktype) inputs
 * and outputs. These encode ax-specific hints that schema libraries don't
 * represent natively.
 */
export interface AxFieldOptions {
  /** Mark this input field as a prefix-cache breakpoint (Anthropic-style). */
  cache?: boolean;
  /** Mark this output field as internal scratchpad (stripped from the final result). */
  internal?: boolean;
}

/** Mutable AxFieldType used for incremental construction. */
type MutableAxFieldType = {
  -readonly [K in keyof AxFieldType]?: AxFieldType[K];
};

/** Type-guard for Standard Schema values. */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof (value as { '~standard'?: unknown })['~standard'] === 'object'
  );
}

/** Vendor identifier for ax's own native fluent fields. */
export const AX_VENDOR = 'ax';

/**
 * True when a Standard Schema value comes from an external library (not ax's
 * own `f.*` fluent fields). Used by the builders to route args to the right
 * decomposition path.
 */
export function isExternalStandardSchema(
  value: unknown
): value is StandardSchemaV1 {
  return isStandardSchema(value) && value['~standard'].vendor !== AX_VENDOR;
}

// --- zod v3 / v4 introspection --------------------------------------------

// Zod doesn't export its internal shape in a typed way. We poke at _def with
// unknown-cast narrowing. Supports v3 (`_def.typeName`) and v4-core (`_zod.def.type`).

type ZodLike = StandardSchemaV1 & {
  _def?: Record<string, any>;
  _zod?: { def?: Record<string, any> };
  description?: string;
};

function unwrapZod(schema: ZodLike): ZodLike {
  let cur = schema;
  while (cur) {
    const def = getZodDef(cur);
    const typeName = def?.typeName ?? def?.type;
    if (
      typeName === 'ZodOptional' ||
      typeName === 'ZodNullable' ||
      typeName === 'ZodDefault' ||
      typeName === 'optional' ||
      typeName === 'nullable' ||
      typeName === 'default'
    ) {
      const inner = def?.innerType ?? def?.schema;
      if (!inner) return cur;
      cur = inner;
      continue;
    }
    return cur;
  }
  return cur;
}

function getZodDef(schema: ZodLike): Record<string, any> | undefined {
  return schema._def ?? schema._zod?.def;
}

function zodIsOptional(schema: ZodLike): boolean {
  const def = getZodDef(schema);
  const typeName = def?.typeName ?? def?.type;
  if (
    typeName === 'ZodOptional' ||
    typeName === 'ZodDefault' ||
    typeName === 'optional' ||
    typeName === 'default'
  ) {
    return true;
  }
  const isOpt = (schema as unknown as { isOptional?: () => boolean })
    .isOptional;
  if (typeof isOpt === 'function') {
    try {
      return isOpt.call(schema);
    } catch {
      /* ignore */
    }
  }
  return false;
}

function zodDescription(schema: ZodLike): string | undefined {
  const def = getZodDef(schema);
  return schema.description ?? def?.description;
}

function zodToAxFieldType(schema: ZodLike): AxFieldType {
  const unwrapped = unwrapZod(schema);
  const def = getZodDef(unwrapped);
  const typeName: string | undefined = def?.typeName ?? def?.type;
  const description = zodDescription(schema) ?? zodDescription(unwrapped);
  const isOptional = zodIsOptional(schema);

  const base = (
    name: AxFieldType['type'],
    extra: MutableAxFieldType = {}
  ): AxFieldType => ({
    type: name,
    isArray: false,
    description,
    isOptional,
    ...extra,
  });

  switch (typeName) {
    case 'ZodString':
    case 'string': {
      // Keep v4 checks in its Standard Schema validator: copying them into
      // Ax constraints loses regex flags and can run checks before transforms.
      const checks: Array<{ kind: string; value?: any; regex?: RegExp }> =
        def?.checks ?? [];
      const extra: MutableAxFieldType = {};
      for (const c of checks) {
        if (c.kind === 'min' || c.kind === 'min_length')
          extra.minLength = c.value ?? (c as any).minimum;
        if (c.kind === 'max' || c.kind === 'max_length')
          extra.maxLength = c.value ?? (c as any).maximum;
        if (c.kind === 'email') extra.format = 'email';
        if (c.kind === 'url' || c.kind === 'uri') extra.format = 'uri';
        if (c.kind === 'regex') {
          extra.pattern = c.regex?.source ?? String(c.regex);
          extra.patternDescription = description ?? 'match the regex pattern';
        }
      }
      return base('string', extra);
    }
    case 'ZodNumber':
    case 'number': {
      const checks: Array<{ kind: string; value?: any }> = def?.checks ?? [];
      const extra: MutableAxFieldType = {};
      for (const c of checks) {
        if (c.kind === 'min' || c.kind === 'greater_than')
          extra.minimum = c.value ?? (c as any).minimum;
        if (c.kind === 'max' || c.kind === 'less_than')
          extra.maximum = c.value ?? (c as any).maximum;
      }
      return base('number', extra);
    }
    case 'ZodBoolean':
    case 'boolean':
      return base('boolean');
    case 'ZodDate':
    case 'date':
      return base('datetime');
    case 'ZodEnum':
    case 'ZodNativeEnum':
    case 'enum': {
      // v3 stores allowed values in `def.values`; v4 in `def.entries`.
      const values: string[] = Array.isArray(def?.values)
        ? def.values
        : def?.entries && typeof def.entries === 'object'
          ? Object.values(def.entries)
          : Object.values(def?.values ?? {});
      return base('class', { options: values });
    }
    case 'ZodLiteral':
    case 'literal': {
      const value = def?.value ?? def?.values?.[0];
      return base('class', {
        options: value !== undefined ? [String(value)] : [],
      });
    }
    case 'ZodArray':
    case 'array': {
      // v3 keeps the inner schema at `def.type`; v4 at `def.element` (its
      // `def.type` is the literal string 'array').
      const inner =
        def?.element ?? (typeof def?.type === 'object' ? def?.type : undefined);
      const innerType = inner ? zodToAxFieldType(inner) : base('string');
      return {
        ...innerType,
        isArray: true,
        description: description ?? innerType.description,
        isOptional,
      };
    }
    case 'ZodObject':
    case 'object': {
      const shape: Record<string, ZodLike> =
        typeof def?.shape === 'function' ? def.shape() : (def?.shape ?? {});
      const fields: Record<string, AxFieldType> = {};
      for (const [k, v] of Object.entries(shape)) {
        fields[k] = zodToAxFieldType(v);
      }
      return base('object', { fields });
    }
    case 'ZodRecord':
    case 'record':
    case 'ZodAny':
    case 'any':
    case 'ZodUnknown':
    case 'unknown':
      return base('json');
    default:
      return base('json');
  }
}

// --- Public conversion ----------------------------------------------------

/** True when the schema is a top-level zod object (decomposable into fields). */
export function isStandardObjectSchema(schema: StandardSchemaV1): boolean {
  const vendor = schema['~standard']?.vendor;
  if (vendor !== 'zod') return false;
  const def = getZodDef(schema as ZodLike);
  const typeName: string | undefined = def?.typeName ?? def?.type;
  return typeName === 'ZodObject' || typeName === 'object';
}

/**
 * Convert a Standard Schema value to `AxFunctionJSONSchema`.
 *
 * Dispatches on `schema['~standard'].vendor`. Currently handles `zod`; throws
 * a `ValidationError` with actionable guidance for other vendors.
 */
export function standardSchemaToJsonSchema(
  schema: StandardSchemaV1,
  title = 'Schema'
): AxFunctionJSONSchema {
  const vendor = schema['~standard']?.vendor;
  if (vendor === 'zod') {
    const fields = standardSchemaToAxFields(schema);
    return toJsonSchema(fields, title);
  }
  if (vendor === AX_VENDOR) {
    throw new ValidationError(
      'Use toJsonSchema(fields) directly for native ax fields — standardSchemaToJsonSchema expects an object schema from an external validator.'
    );
  }
  throw new ValidationError(
    `Unsupported Standard Schema vendor: '${vendor ?? 'unknown'}'. ax currently accepts zod schemas and its native f.* fields. For other validators, define fields with f.*() or request vendor support.`
  );
}

/**
 * Decompose a top-level Standard Schema **object** into an ordered `AxField[]`
 * suitable for signatures and tool argument/return shapes.
 *
 * - Property order = declaration order.
 * - Descriptions flow from `.describe()`.
 * - `cache` / `internal` flow from the companion `opts.fields` map.
 */
export function standardSchemaToAxFields(
  schema: StandardSchemaV1,
  opts?: { fields?: Record<string, AxFieldOptions> }
): AxField[] {
  const vendor = schema['~standard']?.vendor;
  if (vendor !== 'zod') {
    throw new ValidationError(
      `Unsupported Standard Schema vendor: '${vendor ?? 'unknown'}'. ax currently accepts zod schemas here. For other validators, define fields with f.*() or request vendor support.`
    );
  }

  const zschema = schema as ZodLike;
  const unwrapped = unwrapZod(zschema);
  const def = getZodDef(unwrapped);
  const typeName: string | undefined = def?.typeName ?? def?.type;
  if (typeName !== 'ZodObject' && typeName !== 'object') {
    throw new ValidationError(
      `Expected a top-level object schema (e.g. z.object({...})); received a ${typeName ?? 'non-object'} schema. Wrap fields in z.object({...}) or use the per-field form: .input('name', zSchema).`
    );
  }

  const shape: Record<string, ZodLike> =
    typeof def?.shape === 'function' ? def.shape() : (def?.shape ?? {});
  const fieldOpts = opts?.fields ?? {};
  const out: AxField[] = [];

  for (const [name, propSchema] of Object.entries(shape)) {
    const fieldType = zodToAxFieldType(propSchema);
    const meta = fieldOpts[name] ?? {};
    out.push(
      buildAxField(name, fieldType, meta, propSchema as StandardSchemaV1)
    );
  }

  return out;
}

/**
 * Build a single `AxField` from an arbitrary (non-object) Standard Schema
 * value — used for per-field zod forms like `.input('name', zodSchema)`.
 */
export function standardSchemaToAxField(
  name: string,
  schema: StandardSchemaV1,
  opts?: AxFieldOptions
): AxField {
  const vendor = schema['~standard']?.vendor;
  if (vendor !== 'zod') {
    throw new ValidationError(
      `Unsupported Standard Schema vendor: '${vendor ?? 'unknown'}'. ax currently accepts zod schemas here. For other validators, use f.*() field types.`
    );
  }
  const fieldType = zodToAxFieldType(schema as ZodLike);
  return buildAxField(name, fieldType, opts ?? {}, schema);
}

function buildAxField(
  name: string,
  fieldType: AxFieldType,
  meta: AxFieldOptions,
  schema?: StandardSchemaV1
): AxField {
  return {
    name,
    description: fieldType.description,
    type: {
      name: fieldType.type,
      isArray: fieldType.isArray,
      options: fieldType.options ? [...fieldType.options] : undefined,
      fields: fieldType.fields,
      minLength: fieldType.minLength,
      maxLength: fieldType.maxLength,
      minimum: fieldType.minimum,
      maximum: fieldType.maximum,
      pattern: fieldType.pattern,
      patternDescription: fieldType.patternDescription,
      format: fieldType.format,
    },
    isOptional: fieldType.isOptional || undefined,
    isInternal: meta.internal || undefined,
    isCached: meta.cache || undefined,
    schema,
  };
}

// --- Validation delegation -------------------------------------------------

/**
 * Run a Standard Schema validator against a value and translate issues into
 * ax's re-prompt-friendly `ValidationError`. Returns the validated (and
 * possibly transformed) value — callers should use the return value instead
 * of the original so that zod `.transform()` chains take effect.
 *
 * Synchronous only — if the validator returns a Promise, throws a clear error.
 */
export function validateWithStandardSchema(
  schema: StandardSchemaV1,
  fieldName: string,
  value: unknown
): unknown {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new ValidationError(
      `Async Standard Schema validators are not supported for field '${fieldName}'. Use a synchronous validator (e.g., avoid z.refine with async predicates).`
    );
  }
  if (result.issues && result.issues.length > 0) {
    const parts = result.issues.map((i) => {
      const path =
        i.path
          ?.map((p: any) =>
            typeof p === 'object' && p !== null && 'key' in p
              ? String(p.key)
              : String(p)
          )
          .join('.') ?? '';
      return path ? `${path}: ${i.message}` : i.message;
    });
    throw new ValidationError(
      `Field '${fieldName}' failed validation: ${parts.join('; ')}`
    );
  }
  return (result as StandardSchemaV1.SuccessResult<unknown>).value;
}
