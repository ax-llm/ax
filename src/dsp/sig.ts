import { createHash } from 'crypto';

import JSON5 from 'json5';

import { type FunctionJSONSchema } from '../text/functions.js';

import { parse, type ParsedField } from './parser.js';

export interface Field {
  name: string;
  title?: string;
  description?: string;
  type?: {
    name: 'string' | 'number' | 'boolean' | 'json'; // extend this as needed
    isArray: boolean;
  };
  isOptional?: boolean;
}

export type IField = Omit<Field, 'title'> & { title: string };

export class Signature {
  private description?: string;
  private inputFields: IField[];
  private outputFields: IField[];

  private sigHash: string;
  private sigString: string;

  constructor(signature: Readonly<Signature | string>) {
    if (typeof signature === 'string') {
      const sig = parse(signature);
      this.description = sig.desc;
      this.inputFields = sig.inputs.map((v) => this.parseParsedField(v));
      this.outputFields = sig.outputs.map((v) => this.parseParsedField(v));
      [this.sigHash, this.sigString] = this.updateHash();
    } else if (signature instanceof Signature) {
      this.description = signature.getDescription();
      this.inputFields = structuredClone(
        signature.getInputFields()
      ) as IField[];
      this.outputFields = structuredClone(
        signature.getOutputFields()
      ) as IField[];
      this.sigHash = signature.hash();
      this.sigString = signature.toString();
    } else {
      throw new Error('invalid signature argument');
    }
  }

  private parseParsedField = (field: Readonly<ParsedField>): IField => {
    if (!field.name || field.name.length === 0) {
      throw new Error('Field name is required.');
    }

    const title = this.toTitle(field.name);
    return {
      name: field.name,
      title,
      description: field.desc,
      isOptional: field.isOptional,
      type: field.type ?? { name: 'string', isArray: false }
    };
  };

  private parseField = (field: Readonly<Field>): IField => {
    if (!field.name || field.name.length === 0) {
      throw new Error('Field name is required.');
    }

    const title =
      !field.title || field.title.length === 0
        ? this.toTitle(field.name)
        : field.title;

    if (field.type && (!field.type.name || field.type.name.length === 0)) {
      throw new Error('Field type name is required: ' + field.name);
    }

    return { ...field, title };
  };

  public setDescription = (desc: string) => {
    this.description = desc;
    this.updateHash();
  };

  public addInputField = (field: Readonly<Field>) => {
    this.inputFields.push(this.parseField(field));
    this.updateHash();
  };

  public addOutputField = (field: Readonly<Field>) => {
    this.outputFields.push(this.parseField(field));
    this.updateHash();
  };

  public setInputFields = (fields: readonly Field[]) => {
    this.inputFields = fields.map((v) => this.parseField(v));
    this.updateHash();
  };

  public setOutputFields = (fields: readonly Field[]) => {
    this.outputFields = fields.map((v) => this.parseField(v));
    this.updateHash();
  };

  public getInputFields = (): Readonly<IField[]> => this.inputFields;
  public getOutputFields = (): Readonly<IField[]> => this.outputFields;
  public getDescription = () => this.description;

  private toTitle = (name: string) => {
    let result = name.replaceAll('_', ' ');
    result = result.replace(/([A-Z])/g, ' $1').trim();
    return result.charAt(0).toUpperCase() + result.slice(1);
  };

  public toJSONSchema = (): FunctionJSONSchema => {
    const properties: Record<string, unknown> = {};
    const required: Array<string> = [];

    for (const f of this.inputFields) {
      const type = f.type ? f.type.name : 'string';
      if (f.type?.isArray) {
        properties[f.name] = {
          title: f.title,
          description: f.description,
          type: 'array' as const,
          items: {
            type: type,
            description: f.description
          }
        };
      } else {
        properties[f.name] = {
          description: f.description,
          type: type
        };
      }

      if (!f.isOptional) {
        required.push(f.name);
      }
    }

    const schema = {
      type: 'object',
      properties: properties,
      required: required
    };

    return schema as FunctionJSONSchema;
  };

  private updateHash = (): [string, string] => {
    this.sigHash = createHash('sha256')
      .update(this.description ?? '')
      .update(JSON.stringify(this.inputFields))
      .update(JSON.stringify(this.outputFields))
      .digest('hex');

    this.sigString = renderSignature(
      this.description,
      this.inputFields,
      this.outputFields
    );

    return [this.sigHash, this.sigString];
  };

  public hash = () => this.sigHash;

  public toString = () => this.sigString;
}

function renderField(field: Readonly<Field>): string {
  let result = field.name;
  if (field.isOptional) {
    result += '?';
  }
  if (field.type) {
    result += ':' + field.type.name;
    if (field.type.isArray) {
      result += '[]';
    }
  }
  // Check if description exists and append it.
  if (field.description) {
    result += ` "${field.description}"`;
  }
  return result;
}

function renderSignature(
  description: string | undefined,
  inputFields: readonly Field[],
  outputFields: readonly Field[]
): string {
  // Prepare the description part of the signature.
  const descriptionPart = description ? `"${description}"` : '';

  // Render each input field into a comma-separated list.
  const inputFieldsRendered = inputFields.map(renderField).join(', ');

  // Render each output field into a comma-separated list.
  const outputFieldsRendered = outputFields.map(renderField).join(', ');

  // Combine all parts into the final signature.
  return `${descriptionPart} ${inputFieldsRendered} -> ${outputFieldsRendered}`;
}

export const extractValues = (sig: Readonly<Signature>, result: string) => {
  const fields = sig.getOutputFields();
  const values: Record<string, unknown> = {};

  let s = -1;
  let e = -1;

  fields.forEach((field, i) => {
    const prefix = field.title + ':';
    const nextPrefix = fields.at(i + 1)
      ? fields[i + 1]!.title + ':'
      : undefined;
    const ps = result.indexOf(prefix, s + 1);

    if (ps === -1) {
      if (fields.length > 1) {
        throw new Error(`Field not found: ${prefix}`);
      } else {
        s = 0;
        e = result.length;
      }
    } else {
      s = ps + prefix.length + 1;
      e = nextPrefix ? result.indexOf(nextPrefix, s) : result.length;
    }

    const val = result.substring(s, e).trim().replace(/---+$/, '').trim();

    if (field.type) {
      values[field.name] = validateAndParseJson(field, val);
      return;
    }
    values[field.name] = val;
  });

  return values;
};

function validateAndParseJson(
  field: Readonly<NonNullable<Field>>,
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
  const validateSingleValue = (expectedType: string, val: unknown): boolean => {
    switch (expectedType) {
      case 'string':
        return typeof val === 'string';
      case 'number':
        return typeof val === 'number';
      case 'boolean':
        return typeof val === 'boolean';
      case 'json':
        return typeof val === 'object' || Array.isArray(val);
      default:
        return false; // Unknown type
    }
  };

  if (typeObj.isArray) {
    if (!Array.isArray(value)) {
      const message = `Expected an array, but got '${typeof value}'.`;
      throw new ValidationError({ message, field, value: jsonString });
    }
    for (const item of value) {
      if (!validateSingleValue(typeObj.name, item)) {
        const message = `Expected all items in array to be of type '${
          typeObj.name
        }', but found an item of type '${typeof item}'.`;
        throw new ValidationError({ message, field, value: jsonString });
      }
    }
  } else {
    if (!validateSingleValue(typeObj.name, value)) {
      const message = `Expected value of type '${
        typeObj.name
      }', but got '${typeof value}'.`;
      throw new ValidationError({ message, field, value: jsonString });
    }
  }

  // If validation passes, return null to indicate no error
  return value;
}

export class ValidationError extends Error {
  private field: Field;
  private value: string;

  constructor({
    message,
    field,
    value
  }: Readonly<{
    message: string;
    field: Field;
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
