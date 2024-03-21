import { parse, type ParsedField, type ParsedSignature } from './parser.js';

export interface Field {
  name: string;
  title?: string;
  description?: string;
  type?: {
    name: 'string' | 'number' | 'boolean'; // extend this as needed
    isArray: boolean;
  };
  isOptional?: boolean;
}

export type IField = Omit<Field, 'title'> & { title: string };

export class Signature {
  private sig: ParsedSignature;
  private description?: string;
  private inputFields: IField[];
  private outputFields: IField[];

  constructor(signature: Readonly<Signature | string>) {
    if (typeof signature === 'string') {
      this.sig = parse(signature);
    } else if (signature instanceof Signature) {
      this.sig = signature.getParsedSignature();
    } else {
      throw new Error('invalid signature argument');
    }

    this.description = this.sig.desc;
    this.inputFields = this.sig.inputs.map((v) => this.parseParsedField(v));
    this.outputFields = this.sig.outputs.map((v) => this.parseParsedField(v));
  }

  private parseParsedField = (field: Readonly<ParsedField>): IField => {
    if (!field.name || field.name.length === 0) {
      throw new Error('Field name is required.');
    }

    const title = this.toTitle(field.name);
    return {
      name: field.name,
      title,
      isOptional: field.isOptional,
      type: field.type
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

  public setDescription = (desc: string) => (this.description = desc);

  public addInputField = (field: Readonly<Field>) =>
    this.inputFields.push(this.parseField(field));
  public addOutputField = (field: Readonly<Field>) =>
    this.outputFields.push(this.parseField(field));

  public setInputFields = (fields: readonly Field[]) =>
    (this.inputFields = fields.map((v) => this.parseField(v)));
  public setOutputFields = (fields: readonly Field[]) =>
    (this.outputFields = fields.map((v) => this.parseField(v)));

  public getInputFields = () => this.inputFields;
  public getOutputFields = () => this.outputFields;
  public getDescription = () => this.description;

  private toTitle = (name: string) => {
    let result = name.replaceAll('_', ' ');
    result = result.replace(/([A-Z])/g, ' $1').trim();
    return result.charAt(0).toUpperCase() + result.slice(1);
  };

  public clone = () => {
    const sig = new Signature(this);
    sig.description = this.description;
    sig.inputFields = this.inputFields.map((v) => ({ ...v }));
    sig.outputFields = this.outputFields.map((v) => ({ ...v }));
    return sig;
  };

  public getParsedSignature = () => this.sig;
}

export const extractValues = (sig: Readonly<Signature>, result: string) => {
  const fields = sig.getOutputFields();
  const values: Record<string, unknown> = {};

  let s = -1;
  let e = -1;

  fields.forEach((field, i) => {
    const prefix = field.title + ':';
    const nextPrefix = fields.at(i + 1) ? fields[i + 1].title + ':' : undefined;

    s = result.indexOf(prefix, s + 1) + prefix.length;
    e = nextPrefix ? result.indexOf(nextPrefix, s + 1) : result.length;
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

  // Attempt to parse the JSON string based on the expected type, if not a string
  let value: unknown;
  if (typeObj.name !== 'string' || typeObj.isArray) {
    try {
      value = JSON.parse(jsonString);
    } catch (e) {
      const exp = typeObj.isArray ? `array of ${typeObj.name}` : typeObj.name;
      const message = `Error, expected '${exp}' got '${jsonString}'`;
      throw new ValidationError({ message, field, value: jsonString });
    }
  } else {
    // If the expected type is a string and not an array, use the jsonString directly
    value = jsonString;
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
}
