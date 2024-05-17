import { validateValue, type Value } from './program.js';
import type { Field, IField, Signature } from './sig.js';

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
    // const inFmt = this.renderInFields(this.sig.getInputFields());
    const outFmt = this.renderOutFields(this.sig.getOutputFields());
    this.format = [fmtHeader, /*...inFmt,*/ ...outFmt].join('\n\n');
  }

  public toString = <T extends Record<string, Value>>(
    values: T,
    {
      skipSystemPrompt,
      extraFields,
      examples,
      demos
    }: Readonly<{
      skipSystemPrompt?: boolean;
      extraFields?: readonly IField[];
      examples?: Record<string, Value>[];
      demos?: Record<string, Value>[];
    }>
  ) => {
    const renderedExamples = examples
      ? 'Examples:\n\n' + this.renderExamples(examples)
      : null;

    const renderedDemos = demos ? this.renderDemos(demos) : [];

    const completion = this.renderInputFields(values, extraFields);

    this.prompt = (
      skipSystemPrompt
        ? [completion]
        : [
            this.task,
            renderedExamples,
            this.format,
            ...renderedDemos,
            completion
          ]
    )
      .filter(Boolean)
      .join('\n\n---\n\n');

    return this.prompt;
  };

  private renderExamples = (data: Readonly<Record<string, Value>[]>) => {
    const text: string[] = [];

    const fields = [
      ...this.sig.getInputFields(),
      ...this.sig.getOutputFields()
    ];

    for (const item of data) {
      const _item = fields
        .map((field) => this.renderInField(field, item, true))
        .filter((v): v is string => Boolean(v))
        .join('\n');
      text.push(_item);
    }

    return text.join('\n\n');
  };

  private renderDemos = (data: Readonly<Record<string, Value>[]>) => {
    const text: string[] = [];

    const fields = [
      ...this.sig.getInputFields(),
      ...this.sig.getOutputFields()
    ];

    for (const item of data) {
      const _item = fields
        .map((field) => this.renderInField(field, item, true))
        .filter((v): v is string => Boolean(v))
        .join('\n\n');
      text.push(_item);
    }

    return text;
  };

  private renderInputFields = <T extends Record<string, Value>>(
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

    this.sig
      .getInputFields()
      .map((field) => this.renderInField(field, values))
      .filter((v): v is string => Boolean(v))
      .forEach((v) => text.push(v));

    return text.join('\n\n');
  };

  private renderInField = (
    field: Readonly<Field>,
    values: Readonly<Record<string, Value>>,
    skipMissing?: boolean
  ) => {
    const fn = this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
    const value = values[field.name];

    if (skipMissing && !value) {
      return;
    }

    if (
      !value ||
      ((Array.isArray(value) || typeof value === 'string') &&
        value.length === 0)
    ) {
      if (field.isOptional) {
        return;
      }
      throw new Error(`Value for input field '${field.name}' is required.`);
    }
    if (field.type) {
      validateValue(field, value);
    }
    const stringValue = convertValueToString(value);
    return fn(field, stringValue);
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

  //   private renderInFields = (list: readonly Field[]) =>
  //     list.map((v) => v.title + ': ' + (v.description ?? toVar(v.name)));

  private renderOutFields = (list: readonly Field[]) =>
    list.map((v) => {
      return [
        v.title + ':',
        v.description ?? toVarDesc(v.type),
        v.isOptional ? '[if available]' : undefined
      ]
        .filter(Boolean)
        .join(' ');
    });
}

const convertValueToString = (value: Readonly<Value>): string | string[] => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  return JSON.stringify(value);
};

// const toVar = (name: string, type?: Readonly<Field['type']>) => {
//   const fmt = type ? type.name + (type.isArray ? '[]' : '') : undefined;

//   return '${' + name + (fmt ? `:${fmt}` : '') + '}';
// };

const toVarDesc = (type?: Readonly<Field['type']>) => {
  if (type) {
    let description;
    switch (type.name) {
      case 'string':
        description = 'a string';
        break;
      case 'number':
        description = 'a number';
        break;
      case 'boolean':
        description = 'a boolean';
        break;
      case 'json':
        description = 'a JSON object';
        break;
      default:
        description = 'an unknown type';
        break;
    }
    return `${description}${type.isArray ? ' array' : ''}`;
  }
  return '';
};
