import type { AxContextCacheOptions } from '../ai/types.js';
import type { AxChatRequest } from '../ai/types.js';
import type { AxInputFunctionType } from './functions.js';
import { AxSignature, type AxField, type AxIField } from './sig.js';
import type { AxFieldValue, AxMessage } from './types.js';

import {
  AxDefaultAdapter,
  type AxPromptAdapter,
  type ChatRequestUserMessage,
} from './adapter.js';

export interface AxPromptTemplateOptions {
  functions?: Readonly<AxInputFunctionType>;
  thoughtFieldName?: string;
  contextCache?: AxContextCacheOptions;
  examplesInSystem?: boolean;
  ignoreBreakpoints?: boolean;
}

export type AxFieldTemplateFn = (
  field: Readonly<AxField>,
  value: Readonly<AxFieldValue>
) => ChatRequestUserMessage;

export class AxPromptTemplate {
  private adapter: AxPromptAdapter;

  constructor(
    signature: Readonly<AxSignature | string>,
    options: Readonly<
      AxPromptTemplateOptions & { adapter?: AxPromptAdapter }
    > = {},
    fieldTemplates?: Record<string, AxFieldTemplateFn>
  ) {
    const sig =
      typeof signature === 'string' ? new AxSignature(signature) : signature;
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
  ): Extract<
    AxChatRequest['chatPrompt'][number],
    { role: 'user' | 'system' | 'assistant' }
  >[] => {
    return this.adapter.render(values, options);
  };

  public renderExtraFields = (extraFields: readonly AxIField[]) => {
    return this.adapter.renderExtraFields(extraFields);
  };
}
