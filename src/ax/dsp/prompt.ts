import type { AxChatRequest, AxContextCacheOptions } from '../ai/types.js';

import { renderPromptTemplate } from '../prompts/templateEngine.js';
import { formatDateWithTimezone } from './datetime.js';
import type { AxInputFunctionType } from './functions.js';
import type { AxField, AxIField, AxSignature } from './sig.js';
import type { AxFieldValue, AxMessage } from './types.js';

export interface AxPromptTemplateOptions {
  functions?: Readonly<AxInputFunctionType>;
  thoughtFieldName?: string;
  showThoughts?: boolean;
  contextCache?: AxContextCacheOptions;
  examplesInSystem?: boolean;
  ignoreBreakpoints?: boolean;
  structuredOutputFunctionName?: string;
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

const functionCallInstructions = renderPromptTemplate(
  'dsp/function-call-instructions.md'
);

const formattingRules = renderPromptTemplate(
  'dsp/strict-output-formatting-rules.md'
);

const exampleDisclaimer = renderPromptTemplate('dsp/example-disclaimer.md');

const exampleSeparator = renderPromptTemplate('dsp/example-separator.md');

export type AxFieldTemplateFn = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
) => ChatRequestUserMessage;

export class AxPromptTemplate {
  private adapter: AxPromptAdapter;

  constructor(
    sig: Readonly<AxSignature>,
    options: Readonly<
      AxPromptTemplateOptions & { adapter?: AxPromptAdapter }
    > = {},
    fieldTemplates?: Record<string, AxFieldTemplateFn>
  ) {
    this.adapter =
      options.adapter ?? new AxDefaultAdapter(sig, options, fieldTemplates);
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

  /**
   * Build legacy prompt format (backward compatible)
   */
  private buildLegacyPrompt(): { type: 'text'; text: string } {
    const task = [];
    const hasComplexFields = this.sig.hasComplexFields();

    const inArgs = renderDescFields(this.sig.getInputFields());
    const outArgs = renderDescFields(this.sig.getOutputFields());
    task.push(
      `You will be provided with the following fields: ${inArgs}. Your task is to generate new fields: ${outArgs}.`
    );

    // biome-ignore lint/complexity/useFlatMap: you cannot use flatMap here
    const funcs = this.functions
      ?.map((f) => ('toFunction' in f ? f.toFunction() : f))
      ?.flat();

    const funcList = funcs
      ?.map((fn) => `- \`${fn.name}\`: ${formatDescription(fn.description)}`)
      .join('\n');

    if (funcList && funcList.length > 0) {
      task.push(`## Available Functions\n${funcList}`);
    }

    const fieldMap = this.getFieldNameToTitleMap();
    const inputFields = renderInputFields(this.sig.getInputFields(), fieldMap);
    task.push(`## Input Fields\n${inputFields}`);

    // Output fields section - skip for complex fields with native structured output
    // since the JSON schema is already sent via responseFormat and handled by the provider's system.
    // When using function-call fallback, skip as well since the function parameters describe the schema.
    if (!hasComplexFields) {
      const outputFields = renderOutputFields(
        this.sig.getOutputFields(),
        fieldMap
      );
      task.push(`## Output Fields\n${outputFields}`);
    }

    if (funcList && funcList.length > 0) {
      task.push(functionCallInstructions.trim());
    }

    if (hasComplexFields && this.structuredOutputFunctionName) {
      task.push(
        renderPromptTemplate(
          'dsp/legacy-formatting-rules-structured-function.md',
          {
            structuredOutputFunctionName: this.structuredOutputFunctionName,
          }
        ).trim()
      );
    } else if (!hasComplexFields) {
      task.push(formattingRules.trim());
    }

    const desc = this.sig.getDescription();
    if (desc) {
      let text = formatDescription(desc);
      text = formatFieldReferences(text, fieldMap);
      task.push(text);
    }

    return {
      type: 'text' as const,
      text: task.join('\n\n'),
    };
  }

  public getInstruction(): string | undefined {
    return this.adapter.getInstruction();
  }

  /**
   * Build identity section: stable agent role (input/output field summary only).
   */
  private buildIdentitySection(): string {
    const inArgs = renderDescFields(this.sig.getInputFields());
    const outArgs = renderDescFields(this.sig.getOutputFields());
    return `You will be provided with the following fields: ${inArgs}. Your task is to generate new fields: ${outArgs}.`;
  }

  /**
   * Build task definition section: signature description / user-added prompt.
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
    const parts: string[] = [];

    parts.push(
      '**Available Functions**: You can call the following functions to complete the task:\n'
    );

    const funcList = funcs
      .map(
        (fn) => `- \`${fn.name}\`: ${formatDescription(fn.description ?? '')}`
      )
      .join('\n');

    parts.push(funcList);
    parts.push(`\n${functionCallInstructions.trim()}`);

    return parts.join('\n');
  }

  /**
   * Build input fields section
   */
  private buildInputFieldsSection(): string {
    const fieldMap = this.getFieldNameToTitleMap();
    const inputFields = renderInputFields(this.sig.getInputFields(), fieldMap);
    return `**Input Fields**: The following fields will be provided to you:\n\n${inputFields}`;
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

  /**
   * Build formatting rules section with protection
   */
  private buildFormattingRulesSection(): string {
    const hasComplexFields = this.sig.hasComplexFields();

    if (hasComplexFields && this.structuredOutputFunctionName) {
      return renderPromptTemplate(
        'dsp/formatting-rules-structured-function.md',
        {
          structuredOutputFunctionName: this.structuredOutputFunctionName,
        }
      ).trim();
    }

    if (hasComplexFields) {
      return renderPromptTemplate(
        'dsp/formatting-rules-structured-json.md'
      ).trim();
    }

    return renderPromptTemplate('dsp/formatting-rules-plain-text.md').trim();
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

    return prompt.every((v) => v.type === 'text')
      ? prompt.map((v) => v.text).join('\n')
      : prompt.reduce(combineConsecutiveStrings('\n'), []);
  };

  public render = <T = any>(
    values: T | ReadonlyArray<AxMessage<T>>,
    options: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }>
  ): Extract<
    AxChatRequest['chatPrompt'][number],
    { role: 'user' | 'system' | 'assistant' | 'function' }
  >[] => {
    // Check if we have examples or demos
    const hasExamplesOrDemos =
      (examples && examples.length > 0) || (demos && demos.length > 0);

    // System prompt contains only instructions (no examples)
    // Add disclaimer if examples/demos will follow
    const systemContent = hasExamplesOrDemos
      ? `${this.task.text}\n${exampleDisclaimer}`
      : this.task.text;

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

    // Apply cache to last assistant message (creates breakpoint after demos)
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
      if (lastMsg?.role === 'assistant') {
        fewShotMessages[lastIdx] = { ...lastMsg, cache: true };
      }
    }

    // Handle multi-turn history
    if (Array.isArray(values)) {
      const historyMessages: Extract<
        AxChatRequest['chatPrompt'][number],
        { role: 'user' | 'assistant' }
      >[] = [];

      const history = values as ReadonlyArray<AxMessage<T>>;
      let isFirstUserMessage = true;

      for (const message of history) {
        const renderedContent = this.renderInputFields(message.values);
        let content: string | ChatRequestUserMessage = renderedContent.every(
          (v) => v.type === 'text'
        )
          ? renderedContent.map((v) => v.text).join('\n')
          : renderedContent.reduce(combineConsecutiveStrings('\n'), []);

        if (message.role === 'user') {
          // Add separator before first user message if we had examples/demos
          if (isFirstUserMessage && hasExamplesOrDemos) {
            if (typeof content === 'string') {
              content = exampleSeparator + content;
            } else {
              content = [
                { type: 'text' as const, text: exampleSeparator },
                ...content,
              ];
            }
            isFirstUserMessage = false;
          }
          historyMessages.push({ role: 'user', content });
          continue;
        }

        if (message.role !== 'assistant') {
          throw new Error('Invalid message role');
        }

        if (typeof content !== 'string') {
          throw new Error(
            'Assistant message cannot contain non-text content like images, files, etc'
          );
        }

        historyMessages.push({ role: 'assistant', content });
      }

      return [systemPrompt, ...fewShotMessages, ...historyMessages];
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

      return [
        systemPrompt,
        ...fewShotMessages,
        {
          role: 'user' as const,
          content: formattedCachedContent,
          cache: true,
        },
        { role: 'user' as const, content: formattedNonCachedContent },
      ];
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

    return [
      systemPrompt,
      ...fewShotMessages,
      {
        role: 'user' as const,
        content: formattedUserContent,
        ...(allFieldsCached ? { cache: true } : {}),
      },
    ];
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    return this.adapter.renderExtraFields(extraFields);
  };
}
