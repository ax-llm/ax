import type { AxChatRequest, AxContextCacheOptions } from '../ai/types.js';
import {
  AxDefaultAdapter,
  type AxPromptAdapter,
  type ChatRequestUserMessage,
} from './adapter.js';
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

  public setInstruction(instruction: string): void {
    this.adapter.setInstruction(instruction);
  }

  public getInstruction(): string | undefined {
    return this.adapter.getInstruction();
  }

  public render = <T = any>(
    values: T | ReadonlyArray<AxMessage<T>>,
    options: Readonly<{
      skipSystemPrompt?: boolean;
      examples?: Record<string, AxFieldValue>[];
      demos?: Record<string, AxFieldValue>[];
    }> = {}
  ): AxChatRequest['chatPrompt'] => {
    return this.adapter.render(values, options);
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    return this.adapter.renderExtraFields(extraFields);
  };
}
