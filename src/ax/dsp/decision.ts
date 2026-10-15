import { type AxBox, boxSchema, validateBox } from './box.js';
import { ValidationError } from './errors.js';
import type { AxField, AxFieldType } from './sig.js';

/** Local interpretation policy for an evidence-bearing signature field. */
export type AxEvidenceOptions = {
  readonly threshold?: number;
  readonly onRefusal?: 'throw' | 'return';
};
export type AxDecisionProvenance = {
  readonly source: 'native' | 'elicited';
  readonly provider: string;
  readonly model?: string;
};
export type AxBooleanEvidence = {
  readonly value: boolean;
  readonly probability: number;
  readonly threshold: number;
  readonly provenance: AxDecisionProvenance;
};
export type AxClassEvidence<L extends string = string> = {
  readonly value: L;
  readonly probabilities: Readonly<Record<L, number>>;
  readonly confidence?: number;
  readonly provenance: AxDecisionProvenance;
};
export type AxBoxEvidence = {
  readonly value: AxBox;
  readonly confidence?: number;
  readonly provenance: AxDecisionProvenance;
};
export type AxScoreEvidence = {
  readonly value: number;
  readonly levels: readonly string[];
  readonly probabilities: readonly number[];
  readonly confidence?: number;
  readonly provenance: AxDecisionProvenance;
};
export type AxDecisionRefusal = {
  readonly status: 'refused';
  readonly provenance: AxDecisionProvenance;
};
export type AxDecisionResult<T> =
  | (T & { readonly status: 'answered' })
  | AxDecisionRefusal;
/** A question refusal is terminal and must not enter the correction loop. */
export class AxDecisionRefusalError extends Error {
  constructor(
    public readonly fieldPath: string,
    public readonly provenance: AxDecisionProvenance
  ) {
    super(
      `Decision provider ${provenance.provider} refused question "${fieldPath}"`
    );
    this.name = 'AxDecisionRefusalError';
  }
}
/** Trusted native information; never extracted from generated JSON. */
export type AxNativeDecision = {
  readonly value?: string | number;
  readonly confidence?: number;
  readonly refused?: boolean;
};
export type AxDecisionContext = {
  readonly provenance: AxDecisionProvenance;
  readonly native?: Readonly<Record<string, AxNativeDecision>>;
};
export type AxDecisionField = {
  readonly type: 'boolean' | 'class' | 'score' | 'box';
  readonly options?: readonly string[];
  readonly evidence?: AxEvidenceOptions;
  readonly isArray?: boolean;
  readonly isOptional?: boolean;
};
export function validateDecisionField(type: {
  name?: string;
  type?: string;
  options?: readonly string[];
  evidence?: AxEvidenceOptions;
}): void {
  const name = type.name ?? type.type;
  if (type.evidence !== undefined) {
    if (!['boolean', 'class', 'score', 'box'].includes(name ?? ''))
      throw new Error('Evidence requires a boolean, class, score or box field');
    if (
      Object.keys(type.evidence).some(
        (k) => k !== 'threshold' && k !== 'onRefusal'
      )
    )
      throw new Error('Unknown evidence option');
    const t = type.evidence.threshold;
    if (
      t !== undefined &&
      (name !== 'boolean' ||
        typeof t !== 'number' ||
        !Number.isFinite(t) ||
        t < 0 ||
        t > 1)
    )
      throw new Error(
        'threshold requires a boolean field and a finite value in [0, 1]'
      );
    if (
      type.evidence.onRefusal !== undefined &&
      !['throw', 'return'].includes(type.evidence.onRefusal)
    )
      throw new Error('onRefusal must be throw or return');
  }
  if (
    name === 'score' &&
    (!type.options ||
      type.options.length < 2 ||
      type.options.length > 10 ||
      type.options.some((s) => typeof s !== 'string' || !s.trim()) ||
      new Set(type.options).size !== type.options.length)
  )
    throw new Error(
      'Score requires 2–10 distinct, nonempty ordered rubric labels'
    );
}
export function isDecisionField(field: Readonly<AxField>): boolean {
  return (
    field.type?.evidence !== undefined ||
    field.type?.name === 'score' ||
    field.type?.name === 'box'
  );
}
export function hasDecisionFields(fields: readonly AxField[]): boolean {
  return fields.some(
    (f) =>
      isDecisionField(f) ||
      (f.type?.fields && hasDecisionFields(nestedFields(f.type.fields)))
  );
}
export function decisionFields(
  fields: readonly AxField[]
): Record<string, AxDecisionField> | undefined {
  const entries = fields.filter(isDecisionField).map((f) => [
    f.name,
    {
      type: f.type!.name,
      options: f.type!.options,
      evidence: f.type!.evidence,
      isArray: f.type!.isArray,
      isOptional: f.isOptional,
    },
  ]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
function nestedFields(fields: Record<string, AxFieldType>): AxField[] {
  return Object.entries(fields).map(([name, t]) => ({
    name,
    description: t.description,
    isOptional: t.isOptional,
    type: {
      ...t,
      name: t.type,
      options: t.options ? [...t.options] : undefined,
    },
  }));
}
function record(v: unknown, path: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new ValidationError(
      `Invalid decision evidence for ${path}: expected an object`
    );
  return v as Record<string, unknown>;
}
function probability(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
    throw new ValidationError(`Invalid probability for ${path}`);
  return v;
}
function distribution(
  v: unknown,
  labels: readonly string[],
  path: string
): Record<string, number> {
  const r = record(v, path);
  const keys = Object.keys(r);
  if (keys.length !== labels.length || labels.some((k) => !Object.hasOwn(r, k)))
    throw new ValidationError(
      `Decision distribution for ${path} must cover exactly its declared options`
    );
  const out = Object.fromEntries(
    labels.map((k) => [k, probability(r[k], `${path}.${k}`)])
  );
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.01 + Number.EPSILON * labels.length)
    throw new ValidationError(
      `Decision probabilities for ${path} must sum to one`
    );
  return out;
}
/** Validates inference evidence and attaches trusted provenance, recursively. */
export function decodeDecisionValues(
  fields: readonly AxField[],
  values: Record<string, unknown>,
  context: AxDecisionContext,
  prefix = ''
): void {
  for (const field of fields) {
    const t = field.type;
    const v = values[field.name];
    if (!t || v === undefined || (v === null && field.isOptional)) continue;
    const decode = (value: unknown, path: string): unknown => {
      if (!isDecisionField(field)) {
        if (
          t.fields &&
          value &&
          typeof value === 'object' &&
          !Array.isArray(value)
        )
          decodeDecisionValues(
            nestedFields(t.fields),
            value as Record<string, unknown>,
            context,
            path
          );
        return value;
      }
      if (t.name === 'box' && !t.evidence) return validateBox(value, path);
      const raw = record(value, path);
      const native = context.native?.[path];
      const expected =
        raw.status === 'refused'
          ? ['status']
          : [
              t.name === 'boolean'
                ? 'probability'
                : t.name === 'box'
                  ? 'box'
                  : 'probabilities',
              ...(t.evidence?.onRefusal === 'return' ? ['status'] : []),
            ];
      if (
        Object.keys(raw).some((key) => !expected.includes(key)) ||
        (context.provenance.source !== 'native' &&
          t.evidence?.onRefusal === 'return' &&
          raw.status !== 'answered' &&
          raw.status !== 'refused')
      )
        throw new ValidationError(
          `Invalid decision evidence shape for ${path}`
        );
      if (context.provenance.source === 'native' && !native)
        throw new ValidationError(`Missing native decision for ${path}`);
      const refused =
        context.provenance.source === 'native'
          ? native?.refused === true
          : raw.status === 'refused';
      if (refused) {
        if (t.evidence?.onRefusal !== 'return')
          throw new AxDecisionRefusalError(path, context.provenance);
        return { status: 'refused', provenance: context.provenance };
      }
      let out: Record<string, unknown>;
      if (t.name === 'box') {
        out = {
          value: validateBox(raw.box, path),
          provenance: context.provenance,
        };
        if (
          context.provenance.source === 'native' &&
          native?.confidence !== undefined
        )
          out.confidence = probability(native.confidence, path);
      } else if (t.name === 'boolean') {
        const p = probability(raw.probability, path);
        const threshold = t.evidence?.threshold ?? 0.5;
        out = {
          value: p >= threshold,
          probability: p,
          threshold,
          provenance: context.provenance,
        };
      } else {
        const labels =
          t.name === 'score' ? t.options!.map((_, i) => String(i)) : t.options!;
        const input =
          t.name === 'score' && Array.isArray(raw.probabilities)
            ? Object.fromEntries(
                raw.probabilities.map((p, i) => [String(i), p])
              )
            : raw.probabilities;
        const ps = distribution(input, labels, path);
        let selected: string | number;
        if (
          context.provenance.source === 'native' &&
          native?.value !== undefined
        )
          selected = native.value;
        else if (t.name === 'score') {
          const total = Object.values(ps).reduce((a, b) => a + b, 0);
          selected = labels.reduce((a, k, i) => a + i * ps[k]!, 0) / total;
        } else
          selected = labels.reduce(
            (a, k) => (ps[k]! > ps[a]! ? k : a),
            labels[0]!
          );
        if (t.name === 'score') {
          if (
            typeof selected !== 'number' ||
            !Number.isFinite(selected) ||
            selected < 0 ||
            selected > t.options!.length - 1
          )
            throw new ValidationError(`Invalid score for ${path}`);
          if (!t.evidence) return selected;
          out = {
            value: selected,
            levels: [...t.options!],
            probabilities: labels.map((k) => ps[k]),
            provenance: context.provenance,
          };
        } else {
          if (typeof selected !== 'string' || !labels.includes(selected))
            throw new ValidationError(`Invalid class choice for ${path}`);
          out = {
            value: selected,
            probabilities: ps,
            provenance: context.provenance,
          };
        }
        if (
          context.provenance.source === 'native' &&
          native?.confidence !== undefined
        )
          out.confidence = probability(native.confidence, path);
      }
      return t.evidence?.onRefusal === 'return'
        ? { status: 'answered', ...out }
        : out;
    };
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    if (t.isArray && !Array.isArray(v))
      throw new ValidationError(`Expected decision array for ${path}`);
    values[field.name] = t.isArray
      ? (v as unknown[]).map((value, i) => decode(value, `${path}[${i}]`))
      : decode(v, path);
  }
}
/** Schema for inference evidence. Derived values and provenance are runtime-owned. */
export function decisionEvidenceSchema(
  type: NonNullable<AxField['type']>
): Record<string, unknown> {
  if (type.name === 'box' && !type.evidence) return boxSchema();
  const p = { type: 'number', minimum: 0, maximum: 1 };
  const properties =
    type.name === 'boolean'
      ? { probability: p }
      : type.name === 'box'
        ? { box: boxSchema() }
        : {
            probabilities:
              type.name === 'score'
                ? {
                    type: 'array',
                    items: p,
                    minItems: type.options!.length,
                    maxItems: type.options!.length,
                  }
                : {
                    type: 'object',
                    properties: Object.fromEntries(
                      type.options!.map((k) => [k, p])
                    ),
                    required: [...type.options!],
                    additionalProperties: false,
                  },
          };
  const schema = {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
  if (type.evidence?.onRefusal === 'return')
    return {
      anyOf: [
        {
          ...schema,
          properties: {
            status: { type: 'string', enum: ['answered'] },
            ...properties,
          },
          required: ['status', ...schema.required],
        },
        {
          type: 'object',
          properties: { status: { type: 'string', enum: ['refused'] } },
          required: ['status'],
          additionalProperties: false,
        },
      ],
    };
  return schema;
}

/** Render known demonstration evidence without inventing probabilities for labels. */
export function decisionExampleValues(
  fields: readonly AxField[],
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const out = { ...values };
  for (const field of fields) {
    const t = field.type;
    if (!t || !(field.name in out)) continue;
    const convert = (v: unknown): unknown => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      if (!isDecisionField(field))
        return t.fields
          ? decisionExampleValues(
              nestedFields(t.fields),
              v as Record<string, unknown>
            )
          : v;
      const r = v as Record<string, unknown>;
      if (t.name === 'box') {
        if (r.status === 'refused') return { status: 'refused' };
        const box = validateBox(r.value ?? r.box ?? r, field.name);
        return t.evidence
          ? {
              box,
              ...(t.evidence.onRefusal === 'return'
                ? { status: 'answered' }
                : {}),
            }
          : box;
      }
      if (r.status === 'refused') return { status: 'refused' };
      const key = t.name === 'boolean' ? 'probability' : 'probabilities';
      return {
        [key]: r[key],
        ...(t.evidence?.onRefusal === 'return' ? { status: 'answered' } : {}),
      };
    };
    const v = out[field.name];
    out[field.name] =
      t.isArray && Array.isArray(v) ? v.map(convert) : convert(v);
  }
  return out;
}
