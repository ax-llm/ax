import type { AxChatRequest } from '../ai/types.js';

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
  private outputFormat: { type: 'text'; text: string };

  constructor(
    sig: Readonly<AxSignature>,
    fieldTemplates?: Record<string, AxFieldTemplateFn>
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

    this.task = {
      type: 'text' as const,
      text: task.join('\n')
    };

    this.outputFormat = {
      type: 'text' as const,
      text: [
        'Follow the following format.',
        ...this.renderOutFields(this.sig.getOutputFields()),
        '---\n\n'
      ].join('\n\n')
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
  ) => {
    const renderedExamples = examples
      ? [
          { type: 'text' as const, text: 'Examples:\n' },
          ...this.renderExamples(examples)
        ]
      : [];

    const renderedDemos = demos ? this.renderDemos(demos) : [];

    const completion = this.renderInputFields(values);

    const promptList: ChatRequestUserMessage = [
      this.task,
      ...renderedExamples,
      this.outputFormat,
      ...renderedDemos,
      ...completion
    ];

    const prompt = promptList.filter((v) => v !== undefined);

    if (prompt.every((v) => v.type === 'text')) {
      return prompt.map((v) => v.text).join('\n');
    }

    return prompt.reduce(combineConsecutiveStrings('\n'), []);
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    const prompt: ChatRequestUserMessage = [];

    if (extraFields && extraFields.length > 0) {
      extraFields.forEach((field) => {
        const fn =
          this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
        if (!field.description || field.description.length === 0) {
          throw new Error(`Description for field '${field.name}' is required`);
        }
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

    const fields = [
      ...this.sig.getInputFields(),
      ...this.sig.getOutputFields()
    ];

    for (const item of data) {
      const renderedItem = fields
        .map((field) => this.renderInField(field, item, true))
        .filter((v) => v !== undefined)
        .flat();

      renderedItem
        .filter((v) => v.type === 'text')
        .slice(0, -1)
        .forEach((v) => {
          v.text = v.text + '\n';
        });

      list.push(...renderedItem);
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

      renderedItem
        .filter((v) => v.type === 'text')
        .slice(0, -1)
        .forEach((v) => {
          v.text = v.text + '\n';
        });

      list.push(...renderedItem);
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
    const textFieldFn: AxFieldTemplateFn =
      this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
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
    const processedValue = processValue(field, value);
    return textFieldFn(field, processedValue);
  };

  private defaultRenderInField = (
    field: Readonly<AxField>,
    value: Readonly<AxFieldValue>
  ): ChatRequestUserMessage => {
    if (field.type?.name === 'image') {
      if (typeof value !== 'object') {
        throw new Error('Image field value must be an object.');
      }
      if (!('mimeType' in value)) {
        throw new Error('Image field must have a mimeType');
      }
      return [
        { type: 'text', text: `${field.title}: ` as string },
        { type: 'image', mimeType: value.mimeType, image: value.data as string }
      ];
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

  //   private renderInFields = (list: readonly Field[]) =>
  //     list.map((v) => v.title + ': ' + (v.description ?? toVar(v.name)));

  private renderOutFields = (list: readonly AxField[]) =>
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

const processValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): AxFieldValue => {
  if (field.type?.name === 'image' && typeof value === 'object') {
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

const toVarDesc = (type?: Readonly<AxField['type']>) => {
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
    return `${description}${type.isArray ? ' array in json notation' : ''}`;
  }
  return '';
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
