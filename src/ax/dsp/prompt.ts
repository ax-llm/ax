import {
  renderPromptTemplate,
  renderTemplateContent,
} from '../agent/templateEngine.js';
import {
  type AxPromptMetrics,
  buildPromptMetrics,
  countChatPromptContentChars,
} from '../ai/promptMetrics.js';
import type { AxChatRequest, AxContextCacheOptions } from '../ai/types.js';
import {
  formatDateRange,
  formatDateTimeRange,
  formatDateWithTimezone,
} from './datetime.js';
import type { AxInputFunctionType } from './functions.js';
import type { AxField, AxFieldType, AxIField, AxSignature } from './sig.js';
import type { AxFieldValue } from './types.js';
import { validateValue } from './util.js';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

// Define options type for AxPromptTemplate constructor
export interface AxPromptTemplateOptions {
  functions?: Readonly<AxInputFunctionType>;
  thoughtFieldName?: string;
  contextCache?: AxContextCacheOptions;
  /** When true, examples/demos are embedded in system prompt (legacy). When false (default), they are rendered as alternating user/assistant message pairs. */
  examplesInSystem?: boolean;
  /** When true, cacheBreakpoint is ignored and cache is applied to all positions (for providers with auto-lookback like Anthropic) */
  ignoreBreakpoints?: boolean;
  /** When set, indicates structured output should be delivered via a function call with this name */
  structuredOutputFunctionName?: string;
  /** Custom Ax template-engine string to use instead of the built-in dspy.md.
   * Uses Mustache-style syntax with `{{ var }}`, `{{ if cond }}` / `{{ else }}` / `{{ /if }}`.
   * Receives the same variables as the default template (identityText, taskDefinitionText, etc.).
   * Useful for reordering prompt sections to enable cross-signature prompt caching. */
  customTemplate?: string;
}
type AxChatRequestChatPrompt = Writeable<AxChatRequest['chatPrompt'][0]>;

type ChatRequestUserMessage = Exclude<
  Extract<AxChatRequestChatPrompt, { role: 'user' }>['content'],
  string
>;

type DemoMessagePair = {
  userMessage: {
    role: 'user';
    content: string | ChatRequestUserMessage;
  };
  assistantMessage: {
    role: 'assistant';
    content?: string;
    functionCalls?: {
      id: string;
      type: 'function';
      function: { name: string; params?: string | object };
    }[];
  };
  functionResultMessage?: {
    role: 'function';
    result: string;
    functionId: string;
  };
};

export type AxRenderedPrompt = {
  chatPrompt: Extract<
    AxChatRequest['chatPrompt'][number],
    { role: 'user' | 'system' | 'assistant' | 'function' }
  >[];
  promptMetrics: AxPromptMetrics;
};

const exampleSeparator = renderPromptTemplate('dsp/example-separator.md');
const exampleDisclaimer = '## Example Demonstrations';

export type AxFieldTemplateFn = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
) => ChatRequestUserMessage;

function countUserContentChars(
  content: string | ChatRequestUserMessage
): number {
  if (typeof content === 'string') {
    return content.length;
  }

  let total = 0;
  for (const part of content) {
    if (part.type === 'text') {
      total += part.text.length;
    }
  }

  return total;
}

function countPromptPartsChars(
  parts: Readonly<ChatRequestUserMessage>
): number {
  let total = 0;
  for (const part of parts) {
    if (part.type === 'text') {
      total += part.text.length;
    }
  }

  return total;
}

export class AxPromptTemplate {
  private sig: Readonly<AxSignature>;
  private fieldTemplates?: Record<string, AxFieldTemplateFn>;
  private task!: { type: 'text'; text: string };
  private customInstruction?: string;

  private rebuildTask(): void {
    this.task = this.buildStructuredPrompt();
  }

  public setInstruction(instruction: string): void {
    this.customInstruction = instruction;
    this.task = { type: 'text', text: instruction };
  }

  public getInstruction(): string | undefined {
    return this.customInstruction;
  }

  public clearInstruction(): void {
    this.customInstruction = undefined;
    this.rebuildTask();
  }
  private readonly thoughtFieldName: string;
  private readonly functions?: Readonly<AxInputFunctionType>;
  private readonly contextCache?: AxContextCacheOptions;
  private readonly examplesInSystem: boolean;
  private readonly ignoreBreakpoints: boolean;
  private readonly structuredOutputFunctionName?: string;
  private readonly customTemplate?: string;

  constructor(
    sig: Readonly<AxSignature>,
    options?: Readonly<AxPromptTemplateOptions>,
    fieldTemplates?: Record<string, AxFieldTemplateFn>
  ) {
    this.sig = sig;
    this.fieldTemplates = fieldTemplates;
    this.thoughtFieldName = options?.thoughtFieldName ?? 'thought';
    this.functions = options?.functions;
    this.contextCache = options?.contextCache;
    this.examplesInSystem = options?.examplesInSystem ?? false;
    this.ignoreBreakpoints = options?.ignoreBreakpoints ?? false;
    this.structuredOutputFunctionName = options?.structuredOutputFunctionName;
    this.customTemplate = options?.customTemplate;

    this.rebuildTask();
  }

  /**
   * Build a map from field names to their formatted titles.
   * Used for formatting field name references within descriptions.
   */
  private getFieldNameToTitleMap = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const field of this.sig.getInputFields()) {
      map.set(field.name, field.title);
    }
    for (const field of this.sig.getOutputFields()) {
      map.set(field.name, field.title);
    }
    return map;
  };

  /**
   * Sort fields so that cached fields come first.
   * Uses stable sort to preserve relative order among cached and non-cached fields.
   */
  private sortFieldsCachedFirst = (
    fields: readonly AxIField[]
  ): readonly AxIField[] => {
    return [...fields].sort((a, b) => {
      if (a.isCached && !b.isCached) return -1;
      if (!a.isCached && b.isCached) return 1;
      return 0;
    });
  };

  private getFunctions = (): readonly {
    name: string;
    description?: string;
  }[] =>
    this.functions?.flatMap((f) => ('toFunction' in f ? f.toFunction() : f)) ??
    [];

  /**
   * Build XML-structured prompt with format protection
   */
  private buildStructuredPrompt(
    hasExampleDemonstrations = false,
    values?: unknown
  ): {
    type: 'text';
    text: string;
  } {
    const hasComplexFields = this.sig.hasComplexFields();
    const taskDefinition = this.buildTaskDefinitionSection();
    const funcs = this.getFunctions();
    const hasFunctions = funcs.length > 0;

    const templateVars = {
      hasFunctions,
      hasTaskDefinition: Boolean(taskDefinition),
      hasExampleDemonstrations,
      hasOutputFields: !hasComplexFields,
      hasComplexFields,
      hasStructuredOutputFunction: Boolean(
        hasComplexFields && this.structuredOutputFunctionName
      ),
      identityText: this.buildIdentitySection(values),
      taskDefinitionText: taskDefinition,
      functionsList: hasFunctions ? this.buildFunctionsSection(funcs) : '',
      inputFieldsSection: this.buildInputFieldsSection(values),
      outputFieldsSection: !hasComplexFields
        ? this.buildOutputFieldsSection()
        : '',
      structuredOutputFunctionName: this.structuredOutputFunctionName ?? '',
    };

    const rendered =
      this.customTemplate !== undefined
        ? renderTemplateContent(this.customTemplate, templateVars)
        : renderPromptTemplate('dsp/dspy.md', templateVars);

    return { type: 'text' as const, text: rendered.trim() };
  }

  /**
   * Build identity section: stable agent role (input/output field summary only).
   */
  private buildIdentitySection(values?: unknown): string {
    const inArgs = renderDescFields(this.getInputFieldsForValues(values));
    const outArgs = renderDescFields(this.sig.getOutputFields());
    return `You will be provided with the following fields: ${inArgs}. Your task is to generate new fields: ${outArgs}.`;
  }

  /**
   * Build task definition section from the signature description.
   * Returns empty string if no description is set.
   */
  private buildTaskDefinitionSection(): string {
    const desc = this.sig.getDescription();
    if (!desc) return '';
    const fieldMap = this.getFieldNameToTitleMap();
    let text = formatDescription(desc);
    text = formatFieldReferences(text, fieldMap);
    return text;
  }

  /**
   * Build functions section with available functions
   */
  private buildFunctionsSection(
    funcs: readonly { name: string; description?: string }[]
  ): string {
    return funcs
      .map(
        (fn) => `- \`${fn.name}\`: ${formatDescription(fn.description ?? '')}`
      )
      .join('\n');
  }

  /**
   * Build input fields section
   */
  private buildInputFieldsSection(values?: unknown): string {
    const fieldMap = this.getFieldNameToTitleMap();
    const inputFields = renderInputFields(
      this.getInputFieldsForValues(values),
      fieldMap
    );
    return `**Input Fields**: The following fields will be provided to you:\n\n${inputFields}`;
  }

  private getInputFieldsForValues(values?: unknown): readonly AxField[] {
    const inputFields = this.sig.getInputFields();
    const records = getInputValueRecords(values);
    if (!records) {
      return inputFields;
    }

    return inputFields.filter((field) => {
      if (!field.isOptional) {
        return true;
      }
      return records.some((record) =>
        isProvidedValue(record[field.name] as AxFieldValue | undefined)
      );
    });
  }

  /**
   * Build output fields section
   */
  private buildOutputFieldsSection(): string {
    const fieldMap = this.getFieldNameToTitleMap();
    const outputFields = renderOutputFields(
      this.sig.getOutputFields(),
      fieldMap
    );
    return `**Output Fields**: You must generate the following fields:\n\n${outputFields}`;
  }

  private renderSingleValueUserContent = <T = any>(
    values: T,
    renderedExamples: ChatRequestUserMessage,
    renderedDemos: ChatRequestUserMessage,
    examplesInSystemPrompt: boolean
  ): string | ChatRequestUserMessage => {
    const completion = this.renderInputFields(values);

    let promptList: ChatRequestUserMessage;

    if (examplesInSystemPrompt) {
      promptList = completion;
    } else {
      // Combine examples and demos
      const examplesAndDemos = [...renderedExamples, ...renderedDemos];

      // When caching is enabled and examples are in user message,
      // mark the last item before completion with cache: true
      // This creates a cache breakpoint after static examples
      if (this.contextCache && examplesAndDemos.length > 0) {
        const lastIdx = examplesAndDemos.length - 1;
        const lastItem = examplesAndDemos[lastIdx];
        if (lastItem) {
          examplesAndDemos[lastIdx] = { ...lastItem, cache: true };
        }
      }

      promptList = [...examplesAndDemos, ...completion];
    }

    const prompt = promptList.filter((v) => v !== undefined);

    return this.formatUserContent(prompt);
  };

  private formatUserContent = (
    prompt: ChatRequestUserMessage
  ): string | ChatRequestUserMessage =>
    prompt.every((v) => v.type === 'text')
      ? prompt.map((v) => v.text).join('\n')
      : prompt.reduce(combineConsecutiveStrings('\n'), []);

  private buildLegacyMultimodalExampleMessage = (
    renderedExamples: ChatRequestUserMessage,
    renderedDemos: ChatRequestUserMessage
  ):
    | {
        role: 'user';
        content: string | ChatRequestUserMessage;
        cache?: boolean;
      }
    | undefined => {
    const examplesAndDemos = [...renderedExamples, ...renderedDemos].filter(
      (v) => v !== undefined
    );

    if (examplesAndDemos.length === 0) {
      return undefined;
    }

    const cacheBreakpoint =
      this.contextCache?.cacheBreakpoint ?? 'after-examples';
    const shouldCacheExamples =
      !!this.contextCache &&
      (this.ignoreBreakpoints || cacheBreakpoint === 'after-examples');

    return {
      role: 'user' as const,
      content: this.formatUserContent(examplesAndDemos),
      ...(shouldCacheExamples ? { cache: true } : {}),
    };
  };

  private renderInternal = <T = any>(
    values: T,
    {
      examples,
      demos,
    }: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): AxRenderedPrompt => {
    // New behavior: render examples/demos as alternating user/assistant message pairs
    if (!this.examplesInSystem) {
      return this.renderWithMessagePairs(values, { examples, demos });
    }

    // Legacy behavior: examples/demos in system prompt or user message
    const renderedExamples = examples
      ? [
          { type: 'text' as const, text: '\n\n## Examples\n' },
          ...this.renderExamples(examples),
        ]
      : [];

    const renderedDemos = demos ? this.renderDemos(demos) : [];
    const exampleChatContextCharacters =
      countPromptPartsChars(renderedExamples) +
      countPromptPartsChars(renderedDemos);

    // Check if demos and examples are all text type
    const allTextExamples = renderedExamples.every((v) => v.type === 'text');
    const allTextDemos = renderedDemos.every((v) => v.type === 'text');
    const examplesInSystemPrompt = allTextExamples && allTextDemos;

    const baseSystemContent = this.customInstruction
      ? this.task.text
      : this.buildStructuredPrompt(false, values).text;
    let systemContent = baseSystemContent;

    if (examplesInSystemPrompt) {
      const combinedItems = [
        { type: 'text' as const, text: systemContent },
        ...renderedExamples,
        ...renderedDemos,
      ];
      combinedItems.reduce(combineConsecutiveStrings(''), []);

      if (combinedItems[0]) {
        systemContent = combinedItems[0].text;
      }
    }

    const systemPrompt = {
      role: 'system' as const,
      content: systemContent,
      cache: !!this.contextCache,
    };
    const systemPromptCharacters = baseSystemContent.length;
    // In the legacy multimodal fallback, cached examples must be their own
    // top-level message so provider adapters can cache them without pulling
    // live input into the same boundary.
    const useLegacyMultimodalCacheBoundary =
      !examplesInSystemPrompt &&
      !!this.contextCache &&
      (renderedExamples.length > 0 || renderedDemos.length > 0);
    const legacyExampleMessage = useLegacyMultimodalCacheBoundary
      ? this.buildLegacyMultimodalExampleMessage(
          renderedExamples,
          renderedDemos
        )
      : undefined;

    const userContent = useLegacyMultimodalCacheBoundary
      ? this.renderSingleValueUserContent(values as T, [], [], false)
      : this.renderSingleValueUserContent(
          values as T,
          renderedExamples,
          renderedDemos,
          examplesInSystemPrompt
        );
    const renderedMutableChars = countUserContentChars(userContent);
    const mutableChatContextCharacters = examplesInSystemPrompt
      ? renderedMutableChars
      : Math.max(0, renderedMutableChars - exampleChatContextCharacters);

    return {
      chatPrompt: [
        systemPrompt,
        ...(legacyExampleMessage ? [legacyExampleMessage] : []),
        { role: 'user' as const, content: userContent },
      ],
      promptMetrics: buildPromptMetrics(
        systemPromptCharacters,
        exampleChatContextCharacters,
        legacyExampleMessage
          ? renderedMutableChars
          : mutableChatContextCharacters
      ),
    };
  };

  public render = <T = any>(
    values: T,
    options: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): Extract<
    AxChatRequest['chatPrompt'][number],
    { role: 'user' | 'system' | 'assistant' | 'function' }
  >[] => this.renderInternal(values, options).chatPrompt;

  public renderWithMetrics = <T = any>(
    values: T,
    options: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): AxRenderedPrompt => this.renderInternal(values, options);

  /**
   * Render prompt with examples/demos as alternating user/assistant message pairs.
   * This follows the best practices for few-shot prompting in modern LLMs.
   */
  private renderWithMessagePairs = <T = any>(
    values: T,
    {
      examples,
      demos,
    }: Readonly<{
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): AxRenderedPrompt => {
    // Check if we have examples or demos
    const hasExamplesOrDemos =
      (examples && examples.length > 0) || (demos && demos.length > 0);

    // System prompt contains only instructions (no examples)
    // Add disclaimer if examples/demos will follow
    const systemContent = this.customInstruction
      ? hasExamplesOrDemos
        ? `${this.task.text}\n${exampleDisclaimer}`
        : this.task.text
      : this.buildStructuredPrompt(hasExamplesOrDemos, values).text;

    const systemPrompt = {
      role: 'system' as const,
      content: systemContent,
      cache: !!this.contextCache,
    };

    // Render examples and demos as message pairs
    const examplePairs = examples
      ? this.renderExamplesAsMessages(examples)
      : [];
    const demoPairs = demos ? this.renderDemosAsMessages(demos) : [];

    // Flatten pairs into message array
    const fewShotMessages: Extract<
      AxChatRequest['chatPrompt'][number],
      { role: 'user' | 'assistant' | 'function' }
    >[] = [];

    for (const pair of [...examplePairs, ...demoPairs]) {
      fewShotMessages.push(pair.userMessage);
      fewShotMessages.push(pair.assistantMessage);
      if (pair.functionResultMessage) {
        fewShotMessages.push(pair.functionResultMessage);
      }
    }

    // Apply cache to the tail of the few-shot block (creates breakpoint after demos)
    // Cache if cacheBreakpoint is 'after-examples' (default) or ignoreBreakpoints is true
    const cacheBreakpoint =
      this.contextCache?.cacheBreakpoint ?? 'after-examples';
    const shouldCacheExamples =
      this.ignoreBreakpoints || cacheBreakpoint === 'after-examples';
    if (
      this.contextCache &&
      fewShotMessages.length > 0 &&
      shouldCacheExamples
    ) {
      const lastIdx = fewShotMessages.length - 1;
      const lastMsg = fewShotMessages[lastIdx];
      if (lastMsg) {
        fewShotMessages[lastIdx] = { ...lastMsg, cache: true };
      }
    }

    // Single-turn: separate cached and non-cached fields
    const inputFields = this.sig.getInputFields();
    const cachedFields = inputFields.filter((f) => f.isCached);
    const nonCachedFields = inputFields.filter((f) => !f.isCached);

    // Check if we should split into separate messages for cached fields
    const hasCachedFields = cachedFields.length > 0;
    const shouldSplitCachedFields =
      this.contextCache &&
      hasCachedFields &&
      (this.ignoreBreakpoints ||
        (cacheBreakpoint !== 'system' &&
          cacheBreakpoint !== 'after-functions'));

    // If we have both cached and non-cached fields, render them in separate messages
    if (shouldSplitCachedFields && nonCachedFields.length > 0) {
      // Render cached fields
      const cachedContent = cachedFields
        .map((field) => this.renderInField(field, values as any, undefined))
        .filter((v) => v !== undefined)
        .flat();
      cachedContent
        .filter((v) => v.type === 'text')
        .forEach((v) => {
          v.text = `${v.text}\n`;
        });

      let formattedCachedContent: string | ChatRequestUserMessage =
        cachedContent.every((v) => v.type === 'text')
          ? cachedContent.map((v) => v.text).join('\n')
          : cachedContent.reduce(combineConsecutiveStrings('\n'), []);

      // Prepend separator if we had examples/demos
      if (hasExamplesOrDemos) {
        if (typeof formattedCachedContent === 'string') {
          formattedCachedContent = exampleSeparator + formattedCachedContent;
        } else {
          formattedCachedContent = [
            { type: 'text' as const, text: exampleSeparator },
            ...formattedCachedContent,
          ];
        }
      }

      // Render non-cached fields
      const nonCachedContent = nonCachedFields
        .map((field) => this.renderInField(field, values as any, undefined))
        .filter((v) => v !== undefined)
        .flat();
      nonCachedContent
        .filter((v) => v.type === 'text')
        .forEach((v) => {
          v.text = `${v.text}\n`;
        });

      const formattedNonCachedContent: string | ChatRequestUserMessage =
        nonCachedContent.every((v) => v.type === 'text')
          ? nonCachedContent.map((v) => v.text).join('\n')
          : nonCachedContent.reduce(combineConsecutiveStrings('\n'), []);

      const mutableMessages = [
        {
          role: 'user' as const,
          content: formattedCachedContent,
          cache: true,
        },
        { role: 'user' as const, content: formattedNonCachedContent },
      ];

      return {
        chatPrompt: [systemPrompt, ...fewShotMessages, ...mutableMessages],
        promptMetrics: buildPromptMetrics(
          countChatPromptContentChars([systemPrompt] as any),
          countChatPromptContentChars(fewShotMessages as any),
          countChatPromptContentChars(mutableMessages as any)
        ),
      };
    }

    // Handle case: all fields cached, only cached fields, or no caching - render together
    // Sort cached fields first if any exist
    const sortedFields = this.sortFieldsCachedFirst(inputFields);
    const userContent = sortedFields
      .map((field) => this.renderInField(field, values as any, undefined))
      .filter((v) => v !== undefined)
      .flat();
    userContent
      .filter((v) => v.type === 'text')
      .forEach((v) => {
        v.text = `${v.text}\n`;
      });

    let formattedUserContent: string | ChatRequestUserMessage =
      userContent.every((v) => v.type === 'text')
        ? userContent.map((v) => v.text).join('\n')
        : userContent.reduce(combineConsecutiveStrings('\n'), []);

    // Prepend separator if we had examples/demos
    if (hasExamplesOrDemos) {
      if (typeof formattedUserContent === 'string') {
        formattedUserContent = exampleSeparator + formattedUserContent;
      } else {
        formattedUserContent = [
          { type: 'text' as const, text: exampleSeparator },
          ...formattedUserContent,
        ];
      }
    }

    // Set cache: true if all fields are cached and caching is enabled
    const allFieldsCached =
      hasCachedFields && nonCachedFields.length === 0 && this.contextCache;

    const mutableMessages = [
      {
        role: 'user' as const,
        content: formattedUserContent,
        ...(allFieldsCached ? { cache: true } : {}),
      },
    ];

    return {
      chatPrompt: [systemPrompt, ...fewShotMessages, ...mutableMessages],
      promptMetrics: buildPromptMetrics(
        countChatPromptContentChars([systemPrompt] as any),
        countChatPromptContentChars(fewShotMessages as any),
        countChatPromptContentChars(mutableMessages as any)
      ),
    };
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    const prompt: ChatRequestUserMessage = [];

    if (!extraFields || extraFields.length === 0) {
      return prompt;
    }

    const groupedFields = extraFields.reduce(
      (acc, field) => {
        const title = field.title;
        if (!acc[title]) {
          acc[title] = [];
        }
        acc[title].push(field);
        return acc;
      },
      {} as Record<string, AxIField[]>
    );

    // When hasComplexFields is true, the entire output is JSON, so we should not add
    // field-specific instructions to return only error-corrected fields
    const _hasComplexFields = this.sig.hasComplexFields();

    const formattedGroupedFields = Object.entries(groupedFields)
      .map(([title, fields]) => {
        if (fields.length === 1) {
          const field = fields[0]!;

          // Add special instructions for complex fields to ensure full object is returned
          // This is helpful for both plain text and structured output modes
          if (
            field.type?.name === 'object' ||
            (field.type?.isArray && field.type.fields)
          ) {
            return {
              title,
              name: field.name,
              description: `${field.description}\nIMPORTANT: Provide the FULL JSON object for this field, matching the schema exactly.`,
            };
          }

          return {
            title,
            name: field.name,
            description: field.description,
          };
        }
        if (fields.length > 1) {
          const valuesList = fields
            .map((field) => `- ${field.description}`)
            .join('\n');
          return {
            title,
            name: fields[0]!.name,
            description: valuesList,
          };
        }
      })
      .filter(Boolean) as AxIField[];

    formattedGroupedFields.forEach((field) => {
      const fn = this.fieldTemplates?.[field.name] ?? this.defaultRenderInField;
      prompt.push(...fn(field, field.description));
    });

    return prompt;
  };

  private renderExamples = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = [];
    const exampleContext = {
      isExample: true,
    };

    const hasComplexFields = this.sig.hasComplexFields();

    for (const [index, item] of data.entries()) {
      if (hasComplexFields) {
        // For structured outputs:
        // - Render input fields as key-value
        // - Render output fields as JSON

        const renderedInputItem = this.sig
          .getInputFields()
          .map((field) =>
            this.renderInField(field, item, {
              ...exampleContext,
              isInputField: true,
            })
          )
          .filter((v) => v !== undefined)
          .flat();

        // Extract only output values for JSON rendering
        const outputFields = this.sig.getOutputFields();
        const outputValues: Record<string, any> = {};
        for (const field of outputFields) {
          if (field.name in item) {
            outputValues[field.name] = (item as any)[field.name];
          }
        }

        // Render output as JSON
        const jsonStr = JSON.stringify(outputValues, null, 2);

        const renderedItem = [
          ...renderedInputItem,
          { type: 'text' as const, text: `\`\`\`json\n${jsonStr}\n\`\`\`\n` },
        ];

        if (
          index > 0 &&
          renderedItem.length > 0 &&
          renderedItem[0]?.type === 'text'
        ) {
          list.push({ type: 'text' as const, text: '---\n\n' });
        }

        renderedItem.forEach((v) => {
          if (v) {
            if ('text' in v) {
              v.text = `${v.text}\n`;
            }
            list.push(v);
          }
        });
        continue;
      }

      const renderedInputItem = this.sig
        .getInputFields()
        .map((field) =>
          this.renderInField(field, item, {
            ...exampleContext,
            isInputField: true,
          })
        )
        .filter((v) => v !== undefined)
        .flat();

      const renderedOutputItem = this.sig
        .getOutputFields()
        .map((field) =>
          this.renderInField(field, item, {
            ...exampleContext,
            isInputField: false,
          })
        )
        .filter((v) => v !== undefined)
        .flat();

      const renderedItem = [...renderedInputItem, ...renderedOutputItem];

      if (
        index > 0 &&
        renderedItem.length > 0 &&
        renderedItem[0]?.type === 'text'
      ) {
        list.push({ type: 'text' as const, text: '---\n\n' });
      }

      renderedItem.forEach((v) => {
        if ('text' in v) {
          v.text = `${v.text}\n`;
        }
        list.push(v);
      });
    }

    return list;
  };

  private renderDemos = (data: Readonly<Record<string, AxFieldValue>[]>) => {
    const list: ChatRequestUserMessage = [];
    const inputFields = this.sig.getInputFields();
    const outputFields = this.sig.getOutputFields();
    const demoContext = {
      isExample: true,
    };

    const hasComplexFields = this.sig.hasComplexFields();

    for (const item of data) {
      if (hasComplexFields) {
        // For structured outputs:
        // - Render input fields as key-value
        // - Render output fields as JSON

        const inputRenderedItems = inputFields
          .map((field) =>
            this.renderInField(field, item, {
              ...demoContext,
              isInputField: true,
            })
          )
          .filter((v) => v !== undefined)
          .flat();

        // Extract only output values for JSON rendering
        const outputValues: Record<string, any> = {};
        for (const field of outputFields) {
          if (field.name in item) {
            outputValues[field.name] = (item as any)[field.name];
          }
        }

        // Render output as JSON
        const jsonStr = JSON.stringify(outputValues, null, 2);

        const renderedItem = [
          ...inputRenderedItems,
          { type: 'text' as const, text: `\`\`\`json\n${jsonStr}\n\`\`\`\n` },
        ];

        renderedItem.slice(0, -1).forEach((v) => {
          if ('text' in v) {
            v.text = `${v.text}\n`;
          }
          list.push(v);
        });
        continue;
      }

      const inputRenderedItems = inputFields
        .map((field) =>
          this.renderInField(field, item, {
            ...demoContext,
            isInputField: true,
          })
        )
        .filter((v) => v !== undefined)
        .flat();

      const outputRenderedItems = outputFields
        .map((field) =>
          this.renderInField(field, item, {
            ...demoContext,
            isInputField: false,
          })
        )
        .filter((v) => v !== undefined)
        .flat();

      const renderedItem = [...inputRenderedItems, ...outputRenderedItems];

      renderedItem.slice(0, -1).forEach((v) => {
        if ('text' in v) {
          v.text = `${v.text}\n`;
        }
        list.push(v);
      });
    }

    return list;
  };

  /**
   * Render examples as alternating user/assistant message pairs.
   * This follows the best practices for few-shot prompting in modern LLMs.
   */
  private renderExamplesAsMessages = (
    data: Readonly<Record<string, AxFieldValue>[]>
  ): DemoMessagePair[] => {
    const pairs: DemoMessagePair[] = [];
    const exampleContext = { isExample: true };
    const hasComplexFields = this.sig.hasComplexFields();

    for (const item of data) {
      // Render INPUT fields as user message content (cached fields first for cache efficiency)
      const sortedInputFields = this.sortFieldsCachedFirst(
        this.sig.getInputFields()
      );
      const inputContent = sortedInputFields
        .map((field) =>
          this.renderInField(field, item, {
            ...exampleContext,
            isInputField: true,
          })
        )
        .filter((v) => v !== undefined)
        .flat();

      // Format user content - string if all text, array if multimodal
      const userContent: string | ChatRequestUserMessage = inputContent.every(
        (v) => v.type === 'text'
      )
        ? inputContent.map((v) => v.text).join('\n')
        : inputContent.reduce(combineConsecutiveStrings('\n'), []);

      // Render OUTPUT fields as assistant message content
      // When using function-call fallback, render as a function call instead of text
      if (hasComplexFields && this.structuredOutputFunctionName) {
        const outputValues: Record<string, any> = {};
        for (const field of this.sig.getOutputFields()) {
          if (field.name in item) {
            outputValues[field.name] = (item as any)[field.name];
          }
        }

        const isUserContentEmpty =
          (typeof userContent === 'string' && userContent.trim() === '') ||
          (Array.isArray(userContent) && userContent.length === 0);

        if (isUserContentEmpty || Object.keys(outputValues).length === 0) {
          continue;
        }

        const functionCallId = `example-${pairs.length}`;
        pairs.push({
          userMessage: {
            role: 'user',
            content: userContent,
          },
          assistantMessage: {
            role: 'assistant',
            functionCalls: [
              {
                id: functionCallId,
                type: 'function',
                function: {
                  name: this.structuredOutputFunctionName,
                  params: outputValues,
                },
              },
            ],
          },
          functionResultMessage: {
            role: 'function',
            result: 'done',
            functionId: functionCallId,
          },
        });
        continue;
      }

      let outputContent: string;
      if (hasComplexFields) {
        // For structured outputs, render as JSON
        const outputValues: Record<string, any> = {};
        for (const field of this.sig.getOutputFields()) {
          if (field.name in item) {
            outputValues[field.name] = (item as any)[field.name];
          }
        }
        outputContent = JSON.stringify(outputValues, null, 2);
      } else {
        // For plain text outputs, render as field: value pairs
        const outputItems = this.sig
          .getOutputFields()
          .map((field) =>
            this.renderInField(field, item, {
              ...exampleContext,
              isInputField: false,
            })
          )
          .filter((v) => v !== undefined)
          .flat();

        outputContent = outputItems
          .filter((v): v is { type: 'text'; text: string } => v.type === 'text')
          .map((v) => v.text)
          .join('\n');
      }

      const isOutputContentEmpty = outputContent.trim() === '';
      const isUserContentEmpty =
        (typeof userContent === 'string' && userContent.trim() === '') ||
        (Array.isArray(userContent) && userContent.length === 0);

      if (isUserContentEmpty || isOutputContentEmpty) {
        continue;
      }

      pairs.push({
        userMessage: {
          role: 'user',
          content: userContent,
        },
        assistantMessage: { role: 'assistant', content: outputContent },
      });
    }

    return pairs;
  };

  /**
   * Render demos as alternating user/assistant message pairs.
   * This follows the best practices for few-shot prompting in modern LLMs.
   */
  private renderDemosAsMessages = (
    data: Readonly<Record<string, AxFieldValue>[]>
  ): DemoMessagePair[] => {
    return this.renderExamplesAsMessages(data);
  };

  private renderInputFields = <T = any>(values: T) => {
    // Sort cached fields first for cache efficiency
    const sortedFields = this.sortFieldsCachedFirst(this.sig.getInputFields());
    const renderedItems = sortedFields
      .map((field) => this.renderInField(field, values as any, undefined))
      .filter((v) => v !== undefined)
      .flat();

    renderedItems
      .filter((v) => v.type === 'text')
      .forEach((v) => {
        v.text = `${v.text}\n`;
      });

    return renderedItems;
  };

  private renderInField = (
    field: Readonly<AxField>,
    values: Readonly<Record<string, AxFieldValue>>,
    context?: {
      isExample?: boolean;
      strictExamples?: boolean;
      optionalOutputFields?: string[];
      isInputField?: boolean;
    }
  ) => {
    const value = values[field.name];

    if (isEmptyValue(field, value, context)) {
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
        return value as { mimeType: string; data: string };
      };

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ];

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Image field value must be an array.');
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            // Cast to unknown[] before map
            const validated = validateImage(v as AxFieldValue);
            return {
              type: 'image',
              mimeType: validated.mimeType,
              image: validated.data,
            };
          })
        );
      } else {
        const validated = validateImage(value);
        result.push({
          type: 'image',
          mimeType: validated.mimeType,
          image: validated.data,
        });
      }
      return result;
    }

    if (field.type?.name === 'audio') {
      const validateAudio = (
        value: Readonly<AxFieldValue>
      ): { format?: 'wav'; data: string } => {
        if (!value) {
          throw new Error('Audio field value is required.');
        }

        if (typeof value !== 'object') {
          throw new Error('Audio field value must be an object.');
        }
        if (!('data' in value)) {
          throw new Error('Audio field must have data');
        }
        return value as { format?: 'wav'; data: string };
      };

      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ];

      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('Audio field value must be an array.');
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            // Cast to unknown[] before map
            const validated = validateAudio(v as AxFieldValue);
            return {
              type: 'audio',
              format: validated.format ?? 'wav',
              data: validated.data,
            };
          })
        );
      } else {
        const validated = validateAudio(value);
        result.push({
          type: 'audio',
          format: validated.format ?? 'wav',
          data: validated.data,
        });
      }
      return result;
    }

    if (field.type?.name === 'file') {
      const validateFile = (
        value: Readonly<AxFieldValue>
      ):
        | { mimeType: string; data: string }
        | { mimeType: string; fileUri: string } => {
        if (!value) {
          throw new Error('File field value is required.');
        }
        if (typeof value !== 'object') {
          throw new Error('File field value must be an object.');
        }
        if (!('mimeType' in value)) {
          throw new Error('File field must have mimeType');
        }

        // Support both data and fileUri formats
        const hasData = 'data' in value;
        const hasFileUri = 'fileUri' in value;

        if (!hasData && !hasFileUri) {
          throw new Error('File field must have either data or fileUri');
        }
        if (hasData && hasFileUri) {
          throw new Error('File field cannot have both data and fileUri');
        }

        return value as
          | { mimeType: string; data: string }
          | { mimeType: string; fileUri: string };
      };
      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ];
      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('File field value must be an array.');
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            const validated = validateFile(v as AxFieldValue);
            return 'fileUri' in validated
              ? {
                  type: 'file',
                  mimeType: validated.mimeType,
                  fileUri: validated.fileUri,
                }
              : {
                  type: 'file',
                  mimeType: validated.mimeType,
                  data: validated.data,
                };
          })
        );
      } else {
        const validated = validateFile(value);
        result.push(
          'fileUri' in validated
            ? {
                type: 'file',
                mimeType: validated.mimeType,
                fileUri: validated.fileUri,
              }
            : {
                type: 'file',
                mimeType: validated.mimeType,
                data: validated.data,
              }
        );
      }
      return result;
    }

    if (field.type?.name === 'url') {
      const validateUrl = (
        value: Readonly<AxFieldValue>
      ): { url: string; title?: string; description?: string } => {
        if (!value) {
          throw new Error('URL field value is required.');
        }
        if (typeof value === 'string') {
          return { url: value };
        }
        if (typeof value !== 'object') {
          throw new Error('URL field value must be a string or object.');
        }
        if (!('url' in value)) {
          throw new Error('URL field must have url property');
        }
        return value as { url: string; title?: string; description?: string };
      };
      let result: ChatRequestUserMessage = [
        { type: 'text', text: `${field.title}: ` as string },
      ];
      if (field.type.isArray) {
        if (!Array.isArray(value)) {
          throw new Error('URL field value must be an array.');
        }
        result = result.concat(
          (value as unknown[]).map((v) => {
            const validated = validateUrl(v as AxFieldValue);
            return {
              type: 'url',
              url: validated.url,
              ...(validated.title ? { title: validated.title } : {}),
              ...(validated.description
                ? { description: validated.description }
                : {}),
            };
          })
        );
      } else {
        const validated = validateUrl(value);
        result.push({
          type: 'url',
          url: validated.url,
          ...(validated.title ? { title: validated.title } : {}),
          ...(validated.description
            ? { description: validated.description }
            : {}),
        });
      }
      return result;
    }

    const text = [field.title, ': '];

    if (Array.isArray(value)) {
      text.push('\n');
      text.push(value.map((v) => `- ${v}`).join('\n'));
    } else {
      text.push(value as string);
    }
    return [{ type: 'text', text: text.join('') }];
  };
}

const renderDescFields = (list: readonly AxField[]) =>
  list.map((v) => `\`${v.title}\``).join(', ');

const renderInputFields = (
  fields: readonly AxField[],
  fieldNameToTitle?: Map<string, string>
) => {
  const rows = fields.map((field) => {
    const name = field.title;

    let description = '';
    if (field.description) {
      let formatted = formatDescription(field.description);
      if (fieldNameToTitle) {
        formatted = formatFieldReferences(formatted, fieldNameToTitle);
      }
      description = ` ${formatted}`;
    }

    return `${name}:${description}`.trim();
  });

  return rows.join('\n');
};

const renderOutputFields = (
  fields: readonly AxField[],
  fieldNameToTitle?: Map<string, string>
) => {
  const rows = fields.map((field) => {
    const name = field.title;
    const type = field.type?.name ? toFieldType(field.type) : 'string';

    const requiredMsg = field.isOptional
      ? `Only include this ${type} field if its value is available`
      : `This ${type} field must be included`;

    let description = '';

    if (field.description && field.description.length > 0) {
      let value =
        field.type?.name === 'class'
          ? field.description
          : formatDescription(field.description);
      if (fieldNameToTitle) {
        value = formatFieldReferences(value, fieldNameToTitle);
      }
      description = ` ${value}`;
    }

    if (field.type?.options && field.type.options.length > 0) {
      if (description.length > 0) {
        description += '. ';
      }
      description += `Allowed values: ${field.type.options.join(', ')}`;
    }

    return `${name}: (${requiredMsg})${description}`.trim();
  });

  return rows.join('\n');
};

const processValue = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
): AxFieldValue => {
  const isDateRangeValue = (
    v: Readonly<AxFieldValue>
  ): v is { start: Date; end: Date } =>
    !!v &&
    typeof v === 'object' &&
    'start' in v &&
    'end' in v &&
    v.start instanceof Date &&
    v.end instanceof Date;

  if (field.type?.name === 'date' && value instanceof Date) {
    const v = value.toISOString();
    return v.slice(0, v.indexOf('T'));
  }
  if (field.type?.name === 'datetime' && value instanceof Date) {
    return formatDateWithTimezone(value);
  }
  if (field.type?.name === 'dateRange' && isDateRangeValue(value)) {
    return JSON.stringify(formatDateRange(value), null, 2);
  }
  if (field.type?.name === 'datetimeRange' && isDateRangeValue(value)) {
    return JSON.stringify(formatDateTimeRange(value), null, 2);
  }
  if (field.type?.name === 'image' && typeof value === 'object') {
    return value;
  }
  if (field.type?.name === 'audio' && value && typeof value === 'object') {
    if ('transcript' in value && typeof value.transcript === 'string') {
      return value.transcript;
    }
    return value;
  }
  if (field.type?.name === 'file' && typeof value === 'object') {
    return value;
  }
  if (
    field.type?.name === 'url' &&
    (typeof value === 'string' || typeof value === 'object')
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

function formatObjectStructure(
  fields: Readonly<Record<string, AxFieldType>>
): string {
  const entries = Object.entries(fields).map(([key, ft]) => {
    const opt = ft.isOptional ? '?' : '';
    const typeStr = toFieldType({
      name: ft.type,
      isArray: ft.isArray,
      fields: ft.fields,
      options: ft.options as string[] | undefined,
    });
    return `${key}${opt}: ${typeStr}`;
  });
  return `{ ${entries.join(', ')} }`;
}

export const toFieldType = (type: Readonly<AxField['type']>) => {
  const baseType = (() => {
    switch (type?.name) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean (true or false)';
      case 'date':
        return 'date (YYYY-MM-DD, e.g. 2024-05-09)';
      case 'dateRange':
        return 'date range ({ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, e.g. {"start":"2024-05-09","end":"2024-05-12"})';
      case 'datetime':
        return 'datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)';
      case 'datetimeRange':
        return 'datetime range ({ "start": ISO datetime, "end": ISO datetime }, e.g. {"start":"2024-05-09T14:30:00Z","end":"2024-05-09T15:30:00Z"})';
      case 'json':
        return 'JSON object';
      case 'class':
        return 'classification class';
      case 'code':
        return 'code';
      case 'file':
        return 'file (with filename, mimeType, and data)';
      case 'audio':
        return 'speech script (plain text to synthesize as audio)';
      case 'url':
        return 'URL (string or object with url, title, description)';
      case 'object':
        return type?.fields
          ? `object ${formatObjectStructure(type.fields)}`
          : 'object';
      default:
        return 'string';
    }
  })();

  return type?.isArray ? `json array of ${baseType} items` : baseType;
};

function combineConsecutiveStrings(separator: string) {
  return (acc: ChatRequestUserMessage, current: ChatRequestUserMessage[0]) => {
    if (current.type === 'text') {
      const previous = acc.length > 0 ? acc[acc.length - 1] : null;
      if (previous && previous.type === 'text') {
        previous.text += separator + current.text;
        if (current.cache) {
          previous.cache = true;
        }
      } else {
        acc.push(current);
      }
    } else {
      acc.push(current);
    }
    return acc;
  };
}

const isRecordValue = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getInputValueRecords = (
  values?: unknown
): readonly Readonly<Record<string, unknown>>[] | undefined => {
  if (values === undefined) {
    return undefined;
  }
  return isRecordValue(values) ? [values] : [];
};

const isProvidedValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return false;
  }

  if (
    (Array.isArray(value) || typeof value === 'string') &&
    value.length === 0
  ) {
    return false;
  }

  return true;
};

const isEmptyValue = (
  field: Readonly<AxField>,
  value?: Readonly<AxFieldValue>,
  context?: {
    isExample?: boolean;
    isInputField?: boolean;
  }
) => {
  if (!isProvidedValue(value)) {
    // Handle examples case - all fields can be missing in examples
    if (context?.isExample) {
      return true;
    }

    // Handle non-examples case (regular field validation)
    if (field.isOptional || field.isInternal) {
      return true;
    }

    const fieldType = context?.isInputField !== false ? 'input' : 'output';
    throw new Error(
      `Value for ${fieldType} field '${field.name}' is required.`
    );
  }
  return false;
};

function formatDescription(str: string) {
  const value = str.trim();
  return value.length > 0
    ? `${value.charAt(0).toUpperCase()}${value.slice(1)}${value.endsWith('.') ? '' : '.'}`
    : '';
}

/**
 * Format field name references within a description string.
 * - Plain field names get backticks added: fieldName → `Field Name`
 * - Wrapped field names get content formatted only (no added backticks):
 *   - `fieldName` → `Field Name`
 *   - "fieldName" → "Field Name"
 *   - 'fieldName' → 'Field Name'
 *   - [fieldName] → [Field Name]
 *   - (fieldName) → (Field Name)
 */
function formatFieldReferences(
  description: string,
  fieldNameToTitle: Map<string, string>
): string {
  if (fieldNameToTitle.size === 0) {
    return description;
  }

  let result = description;

  // Sort by length descending to handle longer names first (avoid partial replacements)
  const sortedNames = Array.from(fieldNameToTitle.keys()).sort(
    (a, b) => b.length - a.length
  );

  for (const fieldName of sortedNames) {
    const title = fieldNameToTitle.get(fieldName)!;

    // Pattern 1: Field name wrapped in backticks - replace content only
    // `fieldName` → `Field Name`
    const backtickPattern = new RegExp(`\`${fieldName}\``, 'g');
    result = result.replace(backtickPattern, `\`${title}\``);

    // Pattern 2: Field name wrapped in quotes - replace content only
    // "fieldName" → "Field Name", 'fieldName' → 'Field Name'
    const doubleQuotePattern = new RegExp(`"${fieldName}"`, 'g');
    result = result.replace(doubleQuotePattern, `"${title}"`);
    const singleQuotePattern = new RegExp(`'${fieldName}'`, 'g');
    result = result.replace(singleQuotePattern, `'${title}'`);

    // Pattern 3: Field name wrapped in brackets/parens - replace content only
    // [fieldName] → [Field Name], (fieldName) → (Field Name)
    const bracketPattern = new RegExp(`\\[${fieldName}\\]`, 'g');
    result = result.replace(bracketPattern, `[${title}]`);
    const parenPattern = new RegExp(`\\(${fieldName}\\)`, 'g');
    result = result.replace(parenPattern, `(${title})`);

    // Pattern 4: Dollar-prefixed field name - convert to backtick-wrapped title
    // $fieldName → `Field Name`
    const dollarPattern = new RegExp(`\\$${fieldName}\\b`, 'g');
    result = result.replace(dollarPattern, `\`${title}\``);
  }

  return result;
}
