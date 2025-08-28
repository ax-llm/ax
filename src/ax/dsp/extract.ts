/* eslint-disable @typescript-eslint/naming-convention */

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js';
import {
  createExpectedRequiredFieldNotFoundError,
  createInvalidArrayError,
  createInvalidJsonError,
  createMissingRequiredFieldsError,
  createRequiredFieldMissingError,
  createTypeValidationError,
} from './errors.js';
import type { AxField, AxSignature } from './sig.js';
import type { AxGenOut, GenDeltaOut } from './types.js';
import { matchesContent, parseMarkdownList } from './util.js';

export const extractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string,
  options?: { strictMode?: boolean; treatAllFieldsOptional?: boolean }
) => {
  const strictMode = options?.strictMode ?? false;
  const treatAllFieldsOptional = options?.treatAllFieldsOptional ?? false;
  const skipEarlyFail = options?.treatAllFieldsOptional ?? false;

  const xstate: extractionState = {
    extractedFields: [],
    streamedIndex: {},
    s: -1,
  };

  streamingExtractValues(sig, values, xstate, content, {
    strictMode,
    skipEarlyFail,
    treatAllFieldsOptional,
  });

  streamingExtractFinalValue(sig, values, xstate, content, {
    strictMode,
    treatAllFieldsOptional,
    forceFinalize: true,
  });

  // Filter out internal fields
  for (const field of sig.getOutputFields()) {
    if (field.isInternal) {
      delete values[field.name];
    }
  }
};

export interface extractionState {
  prevFields?: { field: AxField; s: number; e: number }[];
  currField?: AxField;
  currFieldIndex?: number;
  inAssumedField?: boolean;
  extractedFields: AxField[];
  streamedIndex: Record<string, number>;
  s: number;
  inBlock?: boolean;
}

// Helper function to check for missing required fields
const checkMissingRequiredFields = (
  _xstate: Readonly<extractionState>,
  values: Record<string, unknown>,
  outputFields: Readonly<AxField[]>
) => {
  const missingFields: AxField[] = [];

  for (const field of outputFields) {
    if (field && !field.isOptional && values[field.name] === undefined) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw createMissingRequiredFieldsError(missingFields);
  }
};

export interface StreamingExtractValuesOptions {
  strictMode?: boolean;
  skipEarlyFail?: boolean;
  treatAllFieldsOptional?: boolean;
}

export const streamingExtractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string,
  { strictMode, skipEarlyFail }: StreamingExtractValuesOptions = {}
) => {
  const fields = sig.getOutputFields();
  let expectedField: AxField | undefined;

  // Keep scanning and extracting until we run out of matches
  while (true) {
    // Build list of candidate fields to try next
    const doNotTry = new Set<number>();
    if (xstate.currFieldIndex !== undefined && !xstate.inAssumedField) {
      doNotTry.add(xstate.currFieldIndex);
    }

    // for (const [i, f] of fields.entries()) {
    //   if (
    //     f.name in values &&
    //     !(i === xstate.currFieldIndex && xstate.inAssumedField)
    //   ) {
    //     doNotTry.add(i);
    //   }
    // }

    const candidates = fields
      .map((f, i) => ({ field: f, index: i }))
      .filter(({ index }) => !doNotTry.has(index));

    // Find earliest matching candidate (supports out-of-order fields)
    let chosenIndex: number | undefined;
    let chosenField: AxField | undefined;
    let e = -1;
    let prefixLen = 0;

    for (const { index, field } of candidates) {
      const isFirst = xstate.extractedFields.length === 0;
      const prefix = `${(isFirst ? '' : '\n') + field.title}:`;
      const match = matchesContent(content, prefix, xstate.s);

      if (match === -2) {
        return true; // Partial match at end, skip and gather more content
      }
      if (match === -3) {
        return true; // String is only whitespace, skip and gather more content
      }
      if (match === -4) {
        xstate.inBlock = true;
        return true; // String is only backticks, skip and gather more content
      }
      if (match >= 0 && (e === -1 || match < e)) {
        e = match;
        prefixLen = prefix.length;
        chosenIndex = index;
        chosenField = field;
      }
    }

    if (e === -1) {
      // Nothing matched this iteration
      if (skipEarlyFail) {
        return;
      }
      if (
        !strictMode &&
        xstate.currField === undefined &&
        xstate.extractedFields.length === 0 &&
        fields.length === 1
      ) {
        // Assume single field
        xstate.inAssumedField = true;
        xstate.currField = fields[0];
        xstate.currFieldIndex = 0;
        if (!xstate.extractedFields.includes(fields[0])) {
          xstate.extractedFields.push(fields[0]);
        }
        if (xstate.streamedIndex[fields[0].name] === undefined) {
          xstate.streamedIndex[fields[0].name] = 0;
        }
        return;
      }

      if (
        strictMode &&
        xstate.currField === undefined &&
        xstate.extractedFields.length === 0
      ) {
        const firstRequiredField = fields.find((f) => !f.isOptional);
        if (firstRequiredField) {
          throw createExpectedRequiredFieldNotFoundError(firstRequiredField);
        }
      }
      break;
    }

    // We found a field!!!
    if (
      expectedField &&
      chosenField &&
      expectedField.name !== chosenField.name
    ) {
      throw createExpectedRequiredFieldNotFoundError(expectedField);
    }

    if (xstate.currField !== undefined && xstate.inAssumedField) {
      // Preserve content assigned to the assumed field
      const assumedFieldContent = content.substring(0, e).trim();
      if (
        assumedFieldContent &&
        chosenField &&
        xstate.currField.name === chosenField.name
      ) {
        const parsedValue = validateAndParseFieldValue(
          xstate.currField,
          assumedFieldContent
        );
        if (parsedValue !== undefined) {
          values[xstate.currField.name] = parsedValue;
        }
      } else if (assumedFieldContent) {
        const parsedValue = validateAndParseFieldValue(
          xstate.currField,
          assumedFieldContent
        );
        if (parsedValue !== undefined) {
          values[xstate.currField.name] = parsedValue;
        }
      }

      xstate.inAssumedField = false;
      xstate.streamedIndex[xstate.currField.name] = 0;
      xstate.currField = undefined;
    }

    // Wrap previous field content
    if (xstate.currField) {
      const val = content.substring(xstate.s, e).trim();
      const parsedValue = validateAndParseFieldValue(xstate.currField, val);
      if (parsedValue !== undefined) {
        values[xstate.currField.name] = parsedValue;
      }
      if (xstate.prevFields) {
        xstate.prevFields?.push({ field: xstate.currField, s: xstate.s, e });
      } else {
        xstate.prevFields = [{ field: xstate.currField, s: xstate.s, e }];
      }
    }

    // Move to new current field
    xstate.s = e + prefixLen;
    if (chosenField !== undefined && chosenIndex !== undefined) {
      xstate.currField = chosenField;
      xstate.currFieldIndex = chosenIndex;
    }
    if (chosenField && !xstate.extractedFields.includes(chosenField)) {
      xstate.extractedFields.push(chosenField);
    }
    if (chosenField && xstate.streamedIndex[chosenField.name] === undefined) {
      xstate.streamedIndex[chosenField.name] = 0;
    }
  }
};

export const streamingExtractFinalValue = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  content: string,
  options?: {
    strictMode?: boolean;
    treatAllFieldsOptional?: boolean;
    deferRequiredCheckForStreaming?: boolean;
    forceFinalize?: boolean;
  }
) => {
  const strictMode = options?.strictMode ?? false;
  const treatAllFieldsOptional = options?.treatAllFieldsOptional ?? false;
  const deferRequiredCheckForStreaming =
    options?.deferRequiredCheckForStreaming ?? false;
  const forceFinalize = options?.forceFinalize ?? false;

  if (xstate.currField) {
    let endIndex = content.length;

    // Look for the next field boundary to avoid including content from other fields
    const outputFields = sig.getOutputFields();
    for (const otherField of outputFields) {
      if (otherField.name === xstate.currField.name) {
        continue;
      }

      // Look for the next field title after current position
      const nextFieldPattern = `\n${otherField.title}:`;
      const nextFieldIndex = content.indexOf(nextFieldPattern, xstate.s);

      if (nextFieldIndex !== -1 && nextFieldIndex < endIndex) {
        endIndex = nextFieldIndex;
      }
    }

    const val = content.substring(xstate.s, endIndex).trim();
    const parsedValue = validateAndParseFieldValue(xstate.currField, val);
    if (parsedValue !== undefined) {
      values[xstate.currField.name] = parsedValue;
    }
  }

  // In strict mode, if we have content but no fields were extracted and no current field,
  // this means field prefixes were missing when they should have been present
  if (strictMode && !xstate.currField && xstate.extractedFields.length === 0) {
    const trimmedContent = content.trim();
    if (trimmedContent) {
      // Find the first required field to report in the error
      const outputFields = sig.getOutputFields();
      const firstRequiredField = outputFields.find(
        (field) => !field.isOptional
      );
      if (firstRequiredField) {
        throw createExpectedRequiredFieldNotFoundError(firstRequiredField);
      }
      // If only optional fields exist, ignore unprefixed content in strict mode
    }
  }

  // Check for optional fields that might have been missed by streaming parser
  parseMissedFieldsFromFullContent(sig, values, content);

  // Check all previous required fields before processing current field
  // In streaming scenarios (non-strict), defer missing-required enforcement until end
  if (!treatAllFieldsOptional) {
    const streamingInProgress =
      xstate.currField !== undefined ||
      (xstate.extractedFields?.length ?? 0) > 0;

    if (strictMode || forceFinalize) {
      checkMissingRequiredFields(xstate, values, sig.getOutputFields());
    } else if (deferRequiredCheckForStreaming) {
      if (!streamingInProgress) {
        checkMissingRequiredFields(xstate, values, sig.getOutputFields());
      }
    } else {
      // Default behavior: if streaming is still in progress (mid-stream),
      // defer required checks until end of stream.
      if (!streamingInProgress) {
        checkMissingRequiredFields(xstate, values, sig.getOutputFields());
      }
    }
  }
};

// Helper function to parse missed fields from full content that streaming parser might have missed
const parseMissedFieldsFromFullContent = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string
) => {
  const outputFields = sig.getOutputFields();

  // Process content line by line for more precise field extraction
  const lines = content.split('\n');

  for (const field of outputFields) {
    // Skip if field is already found
    if (field.name in values) {
      continue;
    }

    // Look for field.title pattern in each line
    const prefix = `${field.title}:`;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith(prefix)) {
        // Extract the value after the colon
        const fieldValue = trimmedLine.substring(prefix.length).trim();

        if (fieldValue) {
          try {
            const parsedValue = validateAndParseFieldValue(field, fieldValue);
            if (parsedValue !== undefined) {
              values[field.name] = parsedValue;
              break; // Found the field, stop looking
            }
          } catch (e) {
            // Only ignore validation errors for optional fields
            if (!field.isOptional) {
              throw e;
            }
            // Ignore validation errors for optional fields in this fallback parser
          }
        }
        break; // Found the field marker, stop looking even if value was empty
      }
    }
  }
};

const convertValueToType = (
  field: Readonly<AxField>,
  val: string,
  required = false
) => {
  switch (field.type?.name) {
    case 'code':
      return extractBlock(val);

    case 'string':
      return val;

    case 'number': {
      const v = Number(val);
      if (Number.isNaN(v)) {
        if (field.isOptional && !required) {
          return;
        }
        throw new Error('Invalid number');
      }
      return v;
    }

    case 'boolean': {
      if (typeof val === 'boolean') {
        return val;
      }
      const v = val.toLowerCase();
      if (v === 'true') {
        return true;
      }
      if (v === 'false') {
        return false;
      }
      if (field.isOptional && !required) {
        return;
      }
      throw new Error('Invalid boolean');
    }
    case 'date':
      return parseLLMFriendlyDate(field, val, required);

    case 'datetime':
      return parseLLMFriendlyDateTime(field, val, required);

    case 'class': {
      const className = val;
      if (field.type.options && !field.type.options.includes(className)) {
        if (field.isOptional) {
          return;
        }
        throw new Error(
          `Invalid class '${val}', expected one of the following: ${field.type.options.join(', ')}`
        );
      }
      return className as string;
    }

    default:
      return val as string; // Unknown type
  }
};

export function* yieldDelta<OUT extends AxGenOut>(
  content: string,
  field: Readonly<AxField>,
  s: number,
  e: number,
  // eslint-disable-next-line functional/prefer-immutable-types
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

  // Remove trailing whitespace, tabs, and newlines
  let d2 = d1.replace(/\s+$/, '');

  // If this field is a "code" type, remove trailing backticks
  if (xstate.currField?.type?.name === 'code') {
    d2 = d2.replace(/\s*```\s*$/, '');
  }

  // Only trim start for the first chunk
  let d3 = isFirstChunk ? d2.trimStart() : d2;

  if (xstate.currField?.type?.name === 'code') {
    // Remove any leading triple-backtick fences (with optional language specifier)
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
  // eslint-disable-next-line functional/prefer-immutable-types
  xstate: extractionState,
  index: number
): GenDeltaOut<OUT> {
  for (const prevField of xstate.prevFields ?? []) {
    const { field, s, e } = prevField;
    yield* yieldDelta<OUT>(content, field, s, e, xstate, index);
  }
  xstate.prevFields = undefined;

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

  const outputFields = sig.getOutputFields();

  for (const key of Object.keys(values)) {
    const field = outputFields.find((f) => f.name === key);
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

    if (!xstate.streamedIndex[key]) {
      yield { index, delta: { [key]: value } as unknown as Partial<OUT> };
      xstate.streamedIndex[key] = 1;
    }
  }
}

function validateAndParseFieldValue(
  field: Readonly<AxField>,
  fieldValue: string | undefined
): unknown {
  if (
    !fieldValue ||
    fieldValue === '' ||
    /^(null|undefined)\s*$/i.test(fieldValue)
  ) {
    if (field.isOptional) {
      return;
    }
    throw createRequiredFieldMissingError(field);
  }

  let value: unknown | undefined;

  if (field.type?.name === 'json') {
    try {
      const text = extractBlock(fieldValue);
      value = JSON.parse(text);
      return value;
    } catch (e) {
      throw createInvalidJsonError(field, (e as Error).message);
    }
  }

  if (field.type?.isArray) {
    try {
      try {
        value = JSON.parse(fieldValue);
      } catch {
        // If JSON parsing fails, try markdown parsing
        value = parseMarkdownList(fieldValue);
      }
      if (!Array.isArray(value)) {
        throw new Error('Expected an array');
      }
    } catch (e) {
      throw createInvalidArrayError(field, (e as Error).message);
    }
  }

  try {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (item !== undefined) {
          const v = typeof item === 'string' ? item.trim() : item;
          value[index] = convertValueToType(field, v, true);
        }
      }
    } else {
      value = convertValueToType(field, fieldValue);
    }
  } catch (e) {
    throw createTypeValidationError(field, fieldValue, (e as Error).message);
  }

  if (typeof value === 'string' && value === '') {
    return undefined;
  }

  return value;
}

export const extractBlock = (input: string): string => {
  const markdownBlockPattern = /```([A-Za-z]*)\n([\s\S]*?)\n```/g;
  const match = markdownBlockPattern.exec(input);
  if (!match) {
    return input;
  }
  if (match.length === 3) {
    return match[2] as string;
  }
  if (match.length === 2) {
    return match[1] as string;
  }
  return input;
};
