import type { JsonRepairMarker } from '../../util/partialJson.js';
import { parsePartialJson } from '../../util/partialJson.js';
import { ValidationError } from '../errors.js';
import {
  parseStructuredJsonFieldValues,
  parseStructuredJsonFieldValuesPartial,
  validateStructuredOutputValues,
} from '../extract.js';
import type { AxField, AxSignature } from '../sig.js';
import type { AxGenOut } from '../types.js';

const outputFieldMaps = new WeakMap<
  Readonly<AxSignature>,
  { hash: string; fieldMap: Map<string, AxField> }
>();

export class StructuredStreamAccumulator {
  private lastParseLength = 0;
  private readonly minCharsBetweenParses: number;
  private readonly minCharsBetweenStructuralParses: number;

  constructor(minCharsBetweenParses = 160) {
    this.minCharsBetweenParses = minCharsBetweenParses;
    this.minCharsBetweenStructuralParses = Math.max(
      32,
      Math.floor(minCharsBetweenParses / 2)
    );
  }

  shouldParse(content: string): boolean {
    const newChars = content.length - this.lastParseLength;
    if (newChars <= 0) return false;

    if (newChars >= this.minCharsBetweenParses) {
      this.lastParseLength = content.length;
      return true;
    }

    if (newChars < this.minCharsBetweenStructuralParses) {
      return false;
    }

    const last = lastNonWhitespaceChar(content);
    const structuralBoundary = last === '}' || last === ']' || last === ',';
    if (!structuralBoundary) {
      return false;
    }

    this.lastParseLength = content.length;
    return true;
  }
}

function lastNonWhitespaceChar(content: string): string | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const char = content[i];
    if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') {
      return char;
    }
  }
  return undefined;
}

export function getOrCreateStructuredAccumulator(state: {
  structuredAccumulator?: StructuredStreamAccumulator;
}): StructuredStreamAccumulator {
  state.structuredAccumulator ??= new StructuredStreamAccumulator();
  return state.structuredAccumulator;
}

export function parseStructuredPartial(
  content: string,
  accumulator?: StructuredStreamAccumulator
):
  | {
      values: Record<string, unknown>;
      partialMarker: JsonRepairMarker | null;
    }
  | undefined {
  if (accumulator && !accumulator.shouldParse(content)) {
    return undefined;
  }

  const { parsed, partialMarker } = parsePartialJson(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }

  return {
    values: parsed as Record<string, unknown>,
    partialMarker,
  };
}

export function parseStructuredFinal(
  signature: Readonly<AxSignature>,
  content: string,
  parseJsonStringFields: boolean
): Record<string, unknown> {
  const finalJson = JSON.parse(content) as Record<string, unknown>;
  if (!finalJson || typeof finalJson !== 'object' || Array.isArray(finalJson)) {
    throw new ValidationError(
      'Structured output must be a JSON object matching the output fields.'
    );
  }
  if (parseJsonStringFields) {
    parseStructuredJsonFieldValues(signature, finalJson);
  }
  validateStructuredOutputValues(signature, finalJson);
  return finalJson;
}

export function prepareStructuredPartialValues(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>,
  parseJsonStringFields: boolean
): Record<string, unknown> | undefined {
  const prepared = selectOutputFields(signature, values);

  if (parseJsonStringFields) {
    parseStructuredJsonFieldValuesPartial(signature, prepared);
  }

  return prepared;
}

export function validateStructuredPartialValues(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>,
  partialMarker: JsonRepairMarker | null
): void {
  try {
    validateStructuredOutputValues(signature, values, {
      allowMissingRequired: true,
    });
  } catch (e) {
    if (partialMarker && e instanceof ValidationError) {
      return;
    }
    throw e;
  }
}

export function createStructuredDelta<OUT extends AxGenOut>({
  signature,
  parsedValues,
  previousValues,
  partialMarker,
}: Readonly<{
  signature: AxSignature;
  parsedValues: Record<string, unknown>;
  previousValues: Record<string, unknown>;
  partialMarker: JsonRepairMarker | null;
}>): {
  delta: Partial<OUT>;
  fullValues: Record<string, unknown>;
} {
  const fieldMap = getOutputFieldMap(signature);
  const delta: Partial<OUT> = {};
  const fullValues: Record<string, unknown> = {};

  for (const [key, field] of fieldMap) {
    if (!(key in parsedValues) || field.isInternal) {
      continue;
    }

    let newVal = parsedValues[key];
    const oldVal = previousValues[key];

    if (
      Array.isArray(newVal) &&
      newVal.length > 0 &&
      isLastArrayItemIncomplete(partialMarker)
    ) {
      newVal = newVal.slice(0, -1);
    }

    fullValues[key] = newVal;
    const deltaValue = valueDelta(newVal, oldVal);
    if (deltaValue !== undefined) {
      (delta as Record<string, unknown>)[key] = deltaValue;
    }
  }

  return { delta, fullValues };
}

export function selectOutputFields(
  signature: Readonly<AxSignature>,
  values: Record<string, unknown>
): Record<string, unknown> {
  const fieldMap = getOutputFieldMap(signature);
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(values)) {
    if (fieldMap.has(key)) {
      out[key] = values[key];
    }
  }

  return out;
}

export function getOutputFieldMap(
  signature: Readonly<AxSignature>
): Map<string, AxField> {
  const hash = signature.hash();
  const cached = outputFieldMaps.get(signature);
  if (cached?.hash === hash) {
    return cached.fieldMap;
  }

  const fieldMap = new Map(
    signature.getOutputFields().map((field) => [field.name, field])
  );
  outputFieldMaps.set(signature, { hash, fieldMap });
  return fieldMap;
}

function valueDelta(newVal: unknown, oldVal: unknown): unknown {
  if (
    typeof newVal === 'string' &&
    typeof oldVal === 'string' &&
    newVal.startsWith(oldVal)
  ) {
    const diff = newVal.slice(oldVal.length);
    return diff || undefined;
  }

  if (Array.isArray(newVal) && Array.isArray(oldVal)) {
    if (newVal.length > oldVal.length) {
      return newVal.slice(oldVal.length);
    }
    return undefined;
  }

  if (Array.isArray(newVal)) {
    return oldVal === undefined ? newVal : undefined;
  }

  return areValuesEqual(newVal, oldVal) ? undefined : newVal;
}

export function areValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => areValuesEqual(item, b[index]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) return false;
    if (!areValuesEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function isLastArrayItemIncomplete(
  partialMarker: JsonRepairMarker | null
): boolean {
  if (!partialMarker) return false;
  return (
    partialMarker.nestingLevel > 0 ||
    partialMarker.inArray ||
    partialMarker.inObject
  );
}
