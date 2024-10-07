/* eslint-disable @typescript-eslint/naming-convention */
import JSON5 from 'json5';

import { parseLLMFriendlyDate, parseLLMFriendlyDateTime } from './datetime.js';
import type { AxField, AxSignature } from './sig.js';

export const extractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  content: string
) => {
  const xstate = { s: -1 };
  streamingExtractValues(sig, values, xstate, content);
  streamingExtractFinalValue(values, xstate, content);
};

export interface extractionState {
  currField?: AxField;
  s: number;
}

export const streamingExtractValues = (
  sig: Readonly<AxSignature>,
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  state: extractionState,
  content: string
) => {
  const fields = sig.getOutputFields();

  for (const field of fields) {
    if (field.name in values) {
      continue;
    }

    const prefix = field.title + ':';
    const e = content.indexOf(prefix, state.s + 1);

    if (e === -1) {
      continue;
    }

    if (state.currField) {
      const val = content
        .substring(state.s, e)
        .trim()
        .replace(/---+$/, '')
        .trim();

      if (state.currField.type?.name === 'json') {
        values[state.currField.name] = validateAndParseJson(
          state.currField,
          val
        );
      } else {
        values[state.currField.name] = val;
      }
    }

    state.s = e + prefix.length + 1;
    state.currField = field;
  }
};

export const streamingExtractFinalValue = (
  values: Record<string, unknown>,
  // eslint-disable-next-line functional/prefer-immutable-types
  state: extractionState,
  content: string
) => {
  if (!state.currField) {
    return;
  }
  const val = content.substring(state.s).trim().replace(/---+$/, '').trim();

  if (state.currField.type?.name === 'json') {
    values[state.currField.name] = validateAndParseJson(state.currField, val);
  } else {
    values[state.currField.name] = convertValueToType(
      state.currField.type?.name ?? 'string',
      val
    );
  }
};

const validateAndParseSingleValue = (
  expectedType: string,
  val: unknown
): boolean | Date => {
  switch (expectedType) {
    case 'string':
      return typeof val === 'string';
    case 'number':
      return typeof val === 'number';
    case 'boolean':
      return typeof val === 'boolean';
    case 'date':
      return typeof val === 'string' ? parseLLMFriendlyDate(val) : false;
    case 'datetime':
      return typeof val === 'string' ? parseLLMFriendlyDateTime(val) : false;
    case 'json':
      return typeof val === 'object' || Array.isArray(val);
    default:
      return false; // Unknown type
  }
};

const convertValueToType = (
  expectedType: string,
  val: unknown
): string | number | boolean | Date => {
  switch (expectedType) {
    case 'string':
      return val as string;
    case 'number':
      return Number(val);
    case 'boolean':
      return Boolean(val);
    case 'date':
      return parseLLMFriendlyDate(val as string);
    case 'datetime':
      return parseLLMFriendlyDateTime(val as string);
    default:
      return val as string; // Unknown type
  }
};

function validateAndParseJson(
  field: Readonly<NonNullable<AxField>>,
  jsonString: string
): unknown {
  const typeObj = field.type;

  if (!typeObj) {
    return jsonString;
  }

  const text = extractBlock(jsonString);

  // Attempt to parse the JSON string based on the expected type, if not a string
  let value: unknown;
  if (typeObj.name !== 'string' || typeObj.isArray) {
    try {
      value = JSON5.parse(text);
    } catch (e) {
      const exp = typeObj.isArray ? `array of ${typeObj.name}` : typeObj.name;
      const message = `Error '${(e as Error).message}', expected '${exp}' got '${text}'`;
      throw new ValidationError({ message, field, value: text });
    }
  } else {
    // If the expected type is a string and not an array, use the jsonString directly
    value = text;
  }

  // Now, validate the parsed value or direct string
  if (typeObj.isArray) {
    if (!Array.isArray(value)) {
      const message = `Expected an array, but got '${typeof value}'.`;
      throw new ValidationError({ message, field, value: jsonString });
    }
    for (const [index, item] of value.entries()) {
      const val = validateAndParseSingleValue(typeObj.name, item);
      if (typeof val === 'boolean' && !val) {
        const message = `Expected all items in array to be of type '${
          typeObj.name
        }', but found an item of type '${typeof item}'.`;
        throw new ValidationError({ message, field, value: jsonString });
      } else if (val instanceof Date) {
        value[index] = val;
      }
    }
  } else {
    const val = validateAndParseSingleValue(typeObj.name, value);
    if (typeof val === 'boolean' && !val) {
      const message = `Expected value of type '${
        typeObj.name
      }', but got '${typeof value}'.`;
      throw new ValidationError({ message, field, value: jsonString });
    } else if (val instanceof Date) {
      return val;
    }
  }

  // If validation passes, return null to indicate no error
  return value;
}

export class ValidationError extends Error {
  private field: AxField;
  private value: string;

  constructor({
    message,
    field,
    value
  }: Readonly<{
    message: string;
    field: AxField;
    value: string;
  }>) {
    super(message);
    this.field = field;
    this.value = value;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  public getField = () => this.field;
  public getValue = () => this.value;

  public getFixingInstructions = () => {
    const f = this.field;

    const extraFields = [
      {
        name: `past_${f.name}`,
        title: `Past ${f.title}`,
        description: this.value
      },
      {
        name: 'instructions',
        title: 'Instructions',
        description: this.message
      }
    ];

    return extraFields;
  };
}

export const extractBlock = (input: string): string => {
  const jsonBlockPattern = /```([A-Za-z]+)?\s*([\s\S]*?)\s*```/g;
  const match = jsonBlockPattern.exec(input);
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
