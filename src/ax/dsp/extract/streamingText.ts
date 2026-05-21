import {
  createExpectedRequiredFieldNotFoundError,
  createMissingRequiredFieldsError,
} from '../errors.js';
import type { AxField, AxSignature } from '../sig.js';
import { matchesContent } from '../util.js';
import { validateAndParseFieldValue } from './fieldValue.js';

export interface extractionState {
  prevFields?: { field: AxField; s: number; e: number }[];
  currField?: AxField;
  currFieldIndex?: number;
  inAssumedField?: boolean;
  extractedFields: AxField[];
  streamedIndex: Record<string, number>;
  s: number;
}

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

  for (const field of sig.getOutputFields()) {
    if (field.isInternal) {
      delete values[field.name];
    }
  }
};

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
  xstate: extractionState,
  content: string,
  { strictMode, skipEarlyFail }: StreamingExtractValuesOptions = {}
) => {
  const fields = sig.getOutputFields();
  let expectedField: AxField | undefined;

  while (true) {
    const doNotTry = new Set<number>();
    if (xstate.currFieldIndex !== undefined && !xstate.inAssumedField) {
      doNotTry.add(xstate.currFieldIndex);
    }

    const candidates = fields
      .map((f, i) => ({ field: f, index: i }))
      .filter(({ index }) => !doNotTry.has(index));

    let chosenIndex: number | undefined;
    let chosenField: AxField | undefined;
    let e = -1;
    let prefixLen = 0;

    for (const { index, field } of candidates) {
      const isFirst = xstate.extractedFields.length === 0;
      const prefix = `${(isFirst ? '' : '\n') + field.title}:`;
      const match = matchesContent(content, prefix, xstate.s);

      if (match === -2 || match === -3 || match === -4) {
        return true;
      }
      if (match >= 0 && (e === -1 || match < e)) {
        e = match;
        prefixLen = prefix.length;
        chosenIndex = index;
        chosenField = field;
      }
    }

    if (e === -1) {
      if (skipEarlyFail) {
        return;
      }
      if (
        !strictMode &&
        xstate.currField === undefined &&
        xstate.extractedFields.length === 0 &&
        fields.length === 1
      ) {
        xstate.inAssumedField = true;
        xstate.currField = fields[0];
        xstate.currFieldIndex = 0;
        xstate.s = 0;
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

    if (
      expectedField &&
      chosenField &&
      expectedField.name !== chosenField.name
    ) {
      throw createExpectedRequiredFieldNotFoundError(expectedField);
    }

    if (xstate.currField !== undefined && xstate.inAssumedField) {
      xstate.inAssumedField = false;
      xstate.streamedIndex[xstate.currField.name] = 0;
      xstate.currField = undefined;
    }

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
    const outputFields = sig.getOutputFields();
    for (const otherField of outputFields) {
      if (otherField.name === xstate.currField.name) continue;
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

  if (strictMode && !xstate.currField && xstate.extractedFields.length === 0) {
    const trimmedContent = content.trim();
    if (trimmedContent) {
      const firstRequiredField = sig
        .getOutputFields()
        .find((field) => !field.isOptional);
      if (firstRequiredField) {
        throw createExpectedRequiredFieldNotFoundError(firstRequiredField);
      }
    }
  }

  parseMissedFieldsFromFullContent(sig, values, content);

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
    } else if (!streamingInProgress) {
      checkMissingRequiredFields(xstate, values, sig.getOutputFields());
    }
  }
};

const parseMissedFieldsFromFullContent = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string
) => {
  const outputFields = sig.getOutputFields();

  if (outputFields.length === 1) {
    const field = outputFields[0];
    if (field) {
      const prefix = `${field.title}:`;
      const start = content.indexOf(prefix);
      if (start !== -1) {
        const valueStart = start + prefix.length;
        const boundary = `\n${field.title}:`;
        const valueEnd = content.indexOf(boundary, valueStart);
        const rawValue = content
          .substring(valueStart, valueEnd === -1 ? content.length : valueEnd)
          .trim();
        if (rawValue) {
          try {
            const parsedValue = validateAndParseFieldValue(field, rawValue);
            if (parsedValue !== undefined) {
              values[field.name] = parsedValue;
              return;
            }
          } catch {}
        }
      }
    }
  }

  const lines = content.split('\n');

  for (const field of outputFields) {
    if (field.name in values) {
      continue;
    }

    const prefix = `${field.title}:`;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith(prefix)) {
        const fieldValue = trimmedLine.substring(prefix.length).trim();

        if (fieldValue) {
          try {
            const parsedValue = validateAndParseFieldValue(field, fieldValue);
            if (parsedValue !== undefined) {
              values[field.name] = parsedValue;
              break;
            }
          } catch (e) {
            if (!field.isOptional) {
              throw e;
            }
          }
        }
        break;
      }
    }
  }
};
