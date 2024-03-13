import { Field, IField, Signature } from './sig';

export type PromptValues = Record<string, string | string[]>;
export type FieldTemplateFn = (
  field: Readonly<Field>,
  value: Readonly<string | string[]>
) => string;

export class PromptTemplate {
  private sig: Readonly<Signature>;
  private fieldTemplates?: Record<string, FieldTemplateFn>;
  private task: string;
  private format: string;
  private prompt?: string;

  constructor(
    sig: Readonly<Signature>,
    fieldTemplates?: Record<string, FieldTemplateFn>
  ) {
    this.sig = sig;
    this.fieldTemplates = fieldTemplates;

    let task = this.sig.getDescription();
    if (!task) {
      const inArgs = this.renderDescFields(this.sig.getInputFields());
      const outArgs = this.renderDescFields(this.sig.getOutputFields());
      task = `Given the fields ${inArgs}, produce the fields ${outArgs}.`;
    }
    this.task = task;

    const fmtHeader = 'Follow the following format.';
    const inFmt = this.renderInFields(this.sig.getInputFields());
    const outFmt = this.renderOutFields(this.sig.getOutputFields());
    this.format = [fmtHeader, ...inFmt, ...outFmt].join('\n\n');
  }

  public toString = (values: PromptValues, extraFields?: readonly IField[]) => {
    const completion = this.renderInputFields(values, extraFields);
    this.prompt = [this.task, this.format, completion]
      .filter(Boolean)
      .join('\n\n---\n\n');

    return this.prompt;
  };

  public renderInputFields = (
    values: PromptValues,
    extraFields?: readonly IField[]
  ) => {
    const text: string[] = [];

    if (extraFields && extraFields.length > 0) {
      extraFields.forEach((field) => {
        const fn =
          this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
        if (!field.description || field.description.length === 0) {
          throw new Error(`Description for field '${field.name}' is required`);
        }
        text.push(fn(field, field.description));
      });
    }

    this.sig.getInputFields().forEach((field) => {
      const fn = this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
      const value = values[field.name];
      if (!value || value.length === 0) {
        throw new Error(`Value for field '${field.name}' is required.`);
      }
      if (field.type) {
        validateValue(field.type, value);
      }
      const stringValue = convertValueToString(value);
      text.push(fn(field, stringValue));
    });

    return text.join('\n\n');
  };

  private defaultRenderInField = (
    field: Readonly<Field>,
    value: Readonly<string | string[]>
  ) => {
    const text = [field.title, ': '];
    if (Array.isArray(value)) {
      text.push('\n');
      text.push(value.map((v, i) => `[${i + 1}] ${v}`).join('\n'));
    } else {
      text.push(value as string);
    }
    return text.join('');
  };

  private renderDescFields = (list: readonly Field[]) =>
    list.map((v) => `\`${v.title}\``).join(', ');

  private renderInFields = (list: readonly Field[]) =>
    list.map((v) => v.title + ': ' + (v.description ?? toVar(v.name)));

  private renderOutFields = (list: readonly Field[]) =>
    list.map((v) => {
      const fmt = v.type
        ? v.type.name + (v.type.isArray ? '[]' : '')
        : undefined;
      if (v.description) {
        return (
          v.title + ': ' + v.description + (fmt ? ` (format: ${fmt})` : '')
        );
      }
      return v.title + ': ' + toVar(v.name + (fmt ? `:${fmt}` : ''));
    });
}

const validateValue = (
  typeObj: Readonly<NonNullable<Field['type']>>,
  value: unknown
): void => {
  const validateSingleValue = (expectedType: string, val: unknown): boolean => {
    switch (expectedType) {
      case 'string':
        return typeof val === 'string';
      case 'number':
        return typeof val === 'number';
      case 'boolean':
        return typeof val === 'boolean';
      default:
        return false; // Unknown or unsupported type
    }
  };

  let isValid = true;
  if (typeObj.isArray) {
    if (!Array.isArray(value)) {
      isValid = false;
    } else {
      for (const item of value) {
        if (!validateSingleValue(typeObj.name, item)) {
          isValid = false;
          break;
        }
      }
    }
  } else {
    isValid = validateSingleValue(typeObj.name, value);
  }

  if (!isValid) {
    throw new Error(
      `Validation failed: Expected ${typeObj.isArray ? 'an array of ' : ''}${
        typeObj.name
      }.`
    );
  }
};

const convertValueToString = (value: unknown): string => {
  if (typeof value === 'string') {
    // Keep strings as is
    return value;
  } else if (Array.isArray(value)) {
    // Convert array items to their string representations
    // This is simplified; you might need more complex logic based on item types
    return JSON.stringify(value.map((item) => item.toString()));
  } else {
    // Convert objects (and other non-string types) to JSON blobs
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new Error(`Error converting value to JSON string: ${error}`);
    }
  }
};

const toVar = (name: string) => '${' + name + '}';
