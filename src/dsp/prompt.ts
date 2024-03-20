import { Field, IField, Signature } from './sig';

export type GenIn = Record<string, unknown>;
export type GenOut = Record<string, unknown>;

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

    const inArgs = this.renderDescFields(this.sig.getInputFields());
    const outArgs = this.renderDescFields(this.sig.getOutputFields());
    const task = [`Given the fields ${inArgs}, produce the fields ${outArgs}.`];

    const desc = this.sig.getDescription();
    if (desc) {
      task.push(desc);
    }
    this.task = task.join('\n');

    const fmtHeader = 'Follow the following format.';
    const inFmt = this.renderInFields(this.sig.getInputFields());
    const outFmt = this.renderOutFields(this.sig.getOutputFields());
    this.format = [fmtHeader, ...inFmt, ...outFmt].join('\n\n');
  }

  public toString = <T extends Record<string, unknown>>(
    values: T,
    {
      skipSystemPrompt,
      extraFields
    }: Readonly<{ skipSystemPrompt?: boolean; extraFields?: readonly IField[] }>
  ) => {
    const completion = this.renderInputFields(values, extraFields);
    this.prompt = (
      skipSystemPrompt ? [completion] : [this.task, this.format, completion]
    )
      .filter(Boolean)
      .join('\n\n---\n\n');

    return this.prompt;
  };

  public renderInputFields = <T extends Record<string, unknown>>(
    values: T,
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

      if (
        !value ||
        ((Array.isArray(value) || typeof value === 'string') &&
          value.length === 0)
      ) {
        if (field.isOptional) {
          return;
        }
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
      return [
        v.title + ':',
        v.description,
        toVar(v.name, v.type),
        v.isOptional ? '[if available]' : undefined
      ]
        .filter(Boolean)
        .join(' ');
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

const convertValueToString = (value: unknown): string | string[] => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.stringify(value);
};

const toVar = (name: string, type?: Readonly<Field['type']>) => {
  const fmt = type ? type.name + (type.isArray ? '[]' : '') : undefined;

  return '${' + name + (fmt ? `:${fmt}` : '') + '}';
};
