import type { AxField, AxSignature } from '../sig.js';
import type { AxGenOut, GenDeltaOut } from '../types.js';
import type { extractionState } from './streamingText.js';

const outputFieldMaps = new WeakMap<
  Readonly<AxSignature>,
  { hash: string; fieldMap: Map<string, AxField> }
>();

export function* yieldDelta<OUT extends AxGenOut>(
  content: string,
  field: Readonly<AxField>,
  s: number,
  e: number,
  xstate: extractionState,
  index: number
): GenDeltaOut<OUT> {
  const { name: fieldName, isInternal } = field;
  const { isArray: fieldIsArray, name: fieldTypeName } = field.type ?? {};

  if (
    isInternal ||
    fieldIsArray ||
    (fieldTypeName && fieldTypeName !== 'string' && fieldTypeName !== 'code')
  ) {
    return;
  }

  const pos = xstate.streamedIndex[fieldName] ?? 0;
  const isFirstChunk = pos === 0;

  const startIndex = (s < 0 ? 0 : s) + pos;
  const d1 = content.substring(startIndex, e);
  if (d1.length === 0) {
    return;
  }

  let d2 = d1.replace(/\s+$/, '');

  if (xstate.currField?.type?.name === 'code') {
    d2 = d2.replace(/\s*```\s*$/, '');
  }

  let d3 = isFirstChunk ? d2.trimStart() : d2;

  if (xstate.currField?.type?.name === 'code') {
    d3 = d3.replace(/^[ ]*```[a-zA-Z0-9]*\n\s*/, '');
  }

  if (d3.length > 0) {
    yield { index, delta: { [fieldName]: d3 } as unknown as Partial<OUT> };
    xstate.streamedIndex[fieldName] = pos + d2.length;
  }
}

export function* streamValues<OUT extends AxGenOut>(
  sig: Readonly<AxSignature>,
  content: string,
  values: Readonly<Record<string, OUT>>,
  xstate: extractionState,
  index: number
): GenDeltaOut<OUT> {
  for (const prevField of xstate.prevFields ?? []) {
    const { field, s, e } = prevField;
    yield* yieldDelta<OUT>(content, field, s, e, xstate, index);
  }
  xstate.prevFields = undefined;

  if (xstate.inAssumedField) {
    const nonInternalOutputs = sig
      .getOutputFields()
      .filter((f) => !f.isInternal);
    const isSingleFieldSignature = nonInternalOutputs.length === 1;
    if (!isSingleFieldSignature) {
      return;
    }
  }

  if (!xstate.currField || xstate.currField.isInternal) {
    return;
  }

  yield* yieldDelta<OUT>(
    content,
    xstate.currField,
    xstate.s,
    content.length,
    xstate,
    index
  );

  const outputFieldMap = getOutputFieldMap(sig);

  for (const key of Object.keys(values)) {
    const field = outputFieldMap.get(key);
    if (!field || field.isInternal) {
      continue;
    }

    const value = values[key];

    if (Array.isArray(value)) {
      const s = xstate.streamedIndex?.[key] ?? 0;
      const v = value.slice(s);
      if (v && v.length > 0) {
        yield { index, delta: { [key]: v } as unknown as Partial<OUT> };
        xstate.streamedIndex[key] = s + v.length;
      }
      continue;
    }

    const stringValue = (typeof value === 'string' ? value : undefined) as
      | string
      | undefined;

    if (!xstate.streamedIndex[key]) {
      yield { index, delta: { [key]: value } as unknown as Partial<OUT> };
      xstate.streamedIndex[key] = stringValue ? stringValue.length : 1;
    } else if (stringValue) {
      const s = xstate.streamedIndex[key] as number;
      if (stringValue.length > s) {
        const delta = stringValue.substring(s);
        yield { index, delta: { [key]: delta } as unknown as Partial<OUT> };
        xstate.streamedIndex[key] = stringValue.length;
      }
    }
  }
}

function getOutputFieldMap(
  sig: Readonly<AxSignature>
): ReadonlyMap<string, AxField> {
  const hash = sig.hash();
  const cached = outputFieldMaps.get(sig);
  if (cached?.hash === hash) {
    return cached.fieldMap;
  }

  const fieldMap = new Map(
    sig.getOutputFields().map((field) => [field.name, field])
  );
  outputFieldMaps.set(sig, { hash, fieldMap });
  return fieldMap;
}
