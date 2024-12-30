import type { AxChatRequest } from '../ai/types.js';

import { formatDateWithTimezone } from './datetime.js';
import type { InputFunctionType } from './functions.js';
import { type AxFieldValue } from './program.js';
import type { AxField, AxIField, AxSignature } from './sig.js';
import { validateValue } from './util.js';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>;

type ChatRequestUserMessage = Exclude<
  Extract<AxChatRequestChatPrompt, { role: 'user' }>['content'],
  string
>;

export type AxFieldTemplateFn = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
) => ChatRequestUserMessage;

export class AxPromptTemplate {
  private sig: Readonly<AxSignature>;
  private fieldTemplates?: Record<string, AxFieldTemplateFn>;
  private task: { type: 'text'; text: string };

  constructor(
    sig: Readonly<AxSignature>,
    functions?: Readonly<InputFunctionType>,
    fieldTemplates?: Record<string, AxFieldTemplateFn>
  ) {
    this.sig = sig;
    this.fieldTemplates = fieldTemplates;

    const inArgs = this.renderDescFields(this.sig.getInputFields());
    const outArgs = this.renderDescFields(this.sig.getOutputFields());
    const task = [
      `#Task\nGiven the fields ${inArgs}, produce the fields ${outArgs}.`
    ];

    const fnNames = functions?.map((f) => {
      if ('toFunction' in f) {
        return f.toFunction().name;
      }
      return f.name;
    });

    const funcList = fnNames?.map((fname) => `'${fname}'`).join(', ');

    if (funcList && funcList.length > 0) {
      task.push(
        `Use the following functions ${funcList} to complete the task. The functions must be used to resolve the output field values.`
      );
    }

    const desc = this.sig.getDescription();
    if (desc) {
      task.push(desc.endsWith('.') ? desc : desc + '.');
    }

    task.push(
      'Ensure the output strictly follows a plain text format, `key: value` separated by a new line.'
    );

    const inputFields = this.renderFields(this.sig.getInputFields());
    const outputFields = this.renderFields(this.sig.getOutputFields());

    task.push(
      [
        '\n',
        '## Input Fields',
        inputFields,
        '\n',
        '## Output Fields',
        outputFields
      ].join('\n')
    );

    this.task = {
      type: 'text' as const,
      text: task.join(' ')
    };
  }

  public render = <T extends Record<string, AxFieldValue>>(
    values: T,
    {
      examples,
      demos
    }: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): AxChatRequest['chatPrompt'] => {
    const renderedExamples = examples
      ? [
          { type: 'text' as const, text: 'Examples:\n' },
          ...this.renderExamples(examples)
        ]
      : [];

    const renderedDemos = demos ? this.renderDemos(demos) : [];

    const completion = this.renderInputFields(values);

    const promptList: ChatRequestUserMessage = [
      ...renderedExamples,
      ...renderedDemos,
      ...completion
    ];

    const prompt = promptList.filter((v) => v !== undefined);

    const systemPrompt = {
      role: 'system' as const,
      content: this.task.text
    };

    const userContent = prompt.every((v) => v.type === 'text')
      ? prompt.map((v) => v.text).join('\n')
      : prompt.reduce(combineConsecutiveStrings('\n'), []);

    const userPrompt = {
      role: 'user' as const,
      content: userContent
    };

    return [systemPrompt, userPrompt];
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    const prompt: ChatRequestUserMessage = [];

    if (extraFields && extraFields.length > 0) {
      extraFields.forEach((field) => {
        // if (!field.isOptional && !field.value) {
        //   throw new Error(`Value for field '${field.name}' is required.`);
        // }
        const fn =
          this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
        // if (!field.description || field.description.length === 0) {
        //   throw new Error(`Description for field '${field.name}' is required`);
        // }
        prompt.push(...fn(field, field.description));
      });
    }
    if (prompt.every((v) => v.type === 'text')) {
      return prompt.map((v) => v.text).join('\n\n');
    }

    return prompt.reduce(combineConsecutiveStrings('\n'), []);
  };

  private renderExamples = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = [];

    for (const [index, item] of data.entries()) {
      const renderedInputItem = this.sig
        .getInputFields()
        .map((field) => this.renderInField(field, item, true))
        .filter((v) => v !== undefined)
        .flat();

      const renderedOutputItem = this.sig
        .getOutputFields()
        .map((field) => this.renderInField(field, item, true))
        .filter((v) => v !== undefined)
        .flat();

      if (renderedOutputItem.length === 0) {
        throw new Error(
          `Output fields are required in examples: index: ${index}, data: ${JSON.stringify(item)}`
        );
      }

      const renderedItem = [...renderedInputItem, ...renderedOutputItem];

      renderedItem.forEach((v) => {
        if ('text' in v) {
          v.text = v.text + '\n';
        }
        if ('image' in v) {
          v.image = v.image + '\n';
        }
        list.push(v);
      });

      if (renderedItem.length > 0) {
        list.push({ type: 'text', text: '\n' });
      }
    }

    return list;
  };

  private renderDemos = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = [];

    const fields = [
      ...this.sig.getInputFields(),
      ...this.sig.getOutputFields()
    ];

    for (const item of data) {
      const renderedItem = fields
        .map((field) => this.renderInField(field, item, true))
        .filter((v) => v !== undefined)
        .flat();

      renderedItem.slice(0, -1).forEach((v) => {
        if ('text' in v) {
          v.text = v.text + '\n';
        }
        if ('image' in v) {
          v.image = v.image + '\n';
        }
        list.push(v);
      });

      if (renderedItem.length > 0) {
        list.push({ type: 'text', text: '\n\n---\n\n' });
      }
    }

    return list;
  };

  private renderInputFields = <T extends Record<string, AxFieldValue>>(
    values: T
  ) => {
    const renderedItems = this.sig
      .getInputFields()
      .map((field) => this.renderInField(field, values))
      .filter((v) => v !== undefined)
      .flat();

    renderedItems
      .filter((v) => v.type === 'text')
      .forEach((v) => {
        v.text = v.text + '\n\n';
      });

    return renderedItems;
  };

  private renderInField = (
    field: Readonly<AxField>,
    values: Readonly<Record<string, AxFieldValue>>,
    skipMissing?: boolean
  ) => {
    const value = values[field.name];

    if (skipMissing && !value) {
      return;
    }

    if (isEmptyValue(field, value)) {
      return;
    }

    if (field.type) {
      validateValue(field, value!);
    }

    const processedValue = processValue(field, value!);

    const textFieldFn: AxFieldTemplateFn =
      this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;

    return textFieldFn(field, processedValue);
  };

  private defaultRenderInField = (
    field: Readonly<AxField>,
    value: Readonly<AxFieldValue>
  ): ChatRequestUserMessage => {
    if (field.type?.name === 'image') {
      const validateImage = (
        value: Readonly<AxFieldValue>
      ): { mimeType: string; data: string } => {
        if (!value) {
          throw new Error('Image field value is required.');
        }

        if (typeof value !== 'object') {
          throw new Error('Image field value must be an object.');
        }
        if (!('mimeType' in value)) {
          throw new Error('Image field must have mimeType');
        }
        if (!('data' in value)) {
          throw new Error('Image field must have data');
        }
        return value;
      };

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string }
      ];

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Image field value must be an array.');
        }
        result = result.concat(
          value.map((v) => {
            v = validateImage(v);
            return {
              type: 'image',
              mimeType: v.mimeType,
              image: v.data
            };
          })
        );
      } else {
        const v = validateImage(value);
        result.push({
          type: 'image',
          mimeType: v.mimeType,
          image: v.data
        });
      }
      return result;
    }

    if (field.type?.name === 'audio') {
      const validateAudio = (
        value: Readonly<AxFieldValue>
      ): { mimeType: string; data: string } => {
        if (!value) {
          throw new Error('Audio field value is required.');
        }

        if (typeof value !== 'object') {
          throw new Error('Audio field value must be an object.');
        }
        if (!('data' in value)) {
          throw new Error('Audio field must have data');
        }
        return value;
      };

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string }
      ];

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Image field value must be an array.');
        }
        result = result.concat(
          value.map((v) => {
            v = validateAudio(v);
            return {
              type: 'audio',
              format: v.format ?? 'wav',
              data: v.data
            };
          })
        );
      } else {
        const v = validateAudio(value);
        result.push({
          type: 'audio',
          format: v.format ?? 'wav',
          data: v.data
        });
      }
      return result;
    }

    const text = [field.title, ': '];

    if (Array.isArray(value)) {
      text.push('\n');
      text.push(value.map((v, i) => `[${i + 1}] ${v}`).join('\n'));
    } else {
      text.push(value as string);
    }
    return [{ type: 'text', text: text.join('') }];
  };

  private renderDescFields = (list: readonly AxField[]) =>
    list.map((v) => `\`${v.title}\``).join(', ');

  private renderFields = (fields: readonly AxField[]) => {
    // Header
    const header =
      'Field Name | Type | Required/Optional | Format | Description';
    const separator = '|';

    // Transform each field into table row
    const rows = fields.map((field) => {
      const name = field.title;
      const type = field.type?.name ? toFieldType(field.type) : 'string';
      const required = field.isOptional ? 'optional' : 'required';
      const format = field.type?.isArray ? 'array' : 'single';
      const description = field.description ?? '';

      return [name, type, required, format, description]
        .join(` ${separator} `)
        .trim();
    });

    // Combine header and rows
    return [header, ...rows].join('\n');
  };
}

const processValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): AxFieldValue => {
  if (field.type?.name === 'date' && value instanceof Date) {
    const v = value.toISOString();
    return v.slice(0, v.indexOf('T'));
  }
  if (field.type?.name === 'datetime' && value instanceof Date) {
    return formatDateWithTimezone(value);
  }
  if (field.type?.name === 'image' && typeof value === 'object') {
    return value;
  }
  if (field.type?.name === 'audio' && typeof value === 'object') {
    return value;
  }
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

// eslint-disable-next-line @typescript-eslint/naming-convention
export const toFieldType = (type: Readonly<AxField['type']>) => {
  switch (type?.name) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date ("YYYY-MM-DD" format)';
    case 'datetime':
      return 'date time ("YYYY-MM-DD HH:mm Timezone" format)';
    case 'json':
      return 'JSON object';
    case 'class':
      return `classification class (allowed classes: ${type.classes?.join(', ')})`;
    default:
      return 'string';
  }
};

function combineConsecutiveStrings(separator: string) {
  return (
    // eslint-disable-next-line functional/prefer-immutable-types
    acc: ChatRequestUserMessage,
    // eslint-disable-next-line functional/prefer-immutable-types
    current: ChatRequestUserMessage[0]
  ) => {
    if (current.type === 'text') {
      const previous = acc.length > 0 ? acc[acc.length - 1] : null;
      if (previous && previous.type === 'text') {
        // If the last item in the accumulator is a string, append the current string to it with the separator
        previous.text += separator + current.text;
      } else {
        // Otherwise, push the current string into the accumulator
        acc.push(current);
      }
    } else {
      // If current is not of type 'text', just add it to the accumulator
      acc.push(current);
    }
    return acc;
  };
}

const isEmptyValue = (
  field: Readonly<AxField>,
  value?: Readonly<AxFieldValue>
) => {
  // Boolean type can't be empty
  if (typeof value === 'boolean') {
    return false;
  }

  if (
    !value ||
    ((Array.isArray(value) || typeof value === 'string') && value.length === 0)
  ) {
    if (field.isOptional) {
      return true;
    }
    throw new Error(`Value for input field '${field.name}' is required.`);
  }
  return false;
};
