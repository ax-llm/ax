import {
  logChatRequest,
  logChatRequestMessage,
  logFunctionResults,
  logResponseDelta,
  logResponseResult,
} from '../ai/debug.js';
import type {
  AxChatRequest,
  AxChatResponseResult,
  AxFunctionResult,
  AxLoggerFunction,
} from '../ai/types.js';
import {
  axValidateChatRequestMessage,
  axValidateChatResponseResult,
} from '../ai/validate.js';

import type { AxAIMemory, AxMemoryData } from './types.js';

export class MemoryImpl {
  private data: AxMemoryData = [];

  constructor(
    private options?: {
      debug?: boolean;
      debugHideSystemPrompt?: boolean;
      logger?: AxLoggerFunction;
    }
  ) {}

  addRequest(items: AxChatRequest['chatPrompt'], index: number): void {
    this.data.push(
      ...items.map((item) => {
        const value = structuredClone(item);
        return {
          role: item.role,
          chat: [{ index, value }],
        };
      })
    );

    if (this.options?.debug) {
      debugRequest(
        items,
        this.options?.debugHideSystemPrompt,
        this.options?.logger
      );
    }
  }

  addFunctionResults(results: Readonly<AxFunctionResult[]>): void {
    const chat = results.map(({ index, ...value }) => ({
      index,
      value: structuredClone(value),
    }));

    const lastItem = this.getLast();
    if (lastItem?.role === 'function') {
      lastItem.chat.push(...chat);
    } else {
      this.data.push({ role: 'function', chat });
    }

    if (this.options?.debug) {
      debugFunctionResults(results, this.options?.logger);
    }
  }

  addResponse(results: Readonly<AxChatResponseResult[]>): void {
    const chat = results.map(({ index, ...value }) => ({
      index,
      value: structuredClone(value),
    }));

    this.data.push({ role: 'assistant', chat });

    if (this.options?.debug) {
      for (const result of results) {
        debugResponse(result, this.options?.logger);
      }
    }
  }

  updateResult({
    content,
    name,
    functionCalls,
    delta,
    index,
  }: Readonly<AxChatResponseResult & { delta?: string; index: number }>): void {
    const lastItem = this.data.at(-1);

    const log = (logger?: AxLoggerFunction) => {
      if (this.options?.debug) {
        if (delta && typeof delta === 'string') {
          debugResponseDelta(delta, logger);
        } else {
          debugResponse({ content, name, functionCalls, index }, logger);
        }
      }
    };

    if (
      !lastItem ||
      lastItem.role !== 'assistant' ||
      (lastItem.role === 'assistant' && !lastItem.updatable)
    ) {
      this.data.push({
        role: 'assistant',
        updatable: true,
        chat: [
          { index, value: structuredClone({ content, name, functionCalls }) },
        ],
      });
      log(this.options?.logger);
      return;
    }

    const chat = lastItem.chat.find((v) => v.index === index);

    if (!chat) {
      lastItem.chat.push({
        index,
        value: structuredClone({ content, name, functionCalls }),
      });
      log(this.options?.logger);
      return;
    }

    if (typeof content === 'string' && content.trim() !== '') {
      (chat.value as { content: string }).content = content;
    }

    if (typeof name === 'string' && name.trim() !== '') {
      (chat.value as { name: string }).name = name;
    }

    if (Array.isArray(functionCalls) && functionCalls.length > 0) {
      (chat.value as { functionCalls: typeof functionCalls }).functionCalls =
        functionCalls;
    }

    log(this.options?.logger);
  }

  addTag(name: string): void {
    const lastItem = this.data.at(-1);
    if (!lastItem) {
      return;
    }

    if (!lastItem.tags) {
      lastItem.tags = [];
    }

    if (!lastItem.tags.includes(name)) {
      lastItem.tags.push(name);
    }
  }

  rewindToTag(name: string): AxMemoryData {
    const tagIndex = this.data.findIndex((item) => item.tags?.includes(name));
    if (tagIndex === -1) {
      throw new Error(`Tag "${name}" not found`);
    }

    // Remove and return the tagged item and everything after it
    return this.data.splice(tagIndex);
  }

  removeByTag(name: string): AxMemoryData {
    const indices = this.data.reduce<number[]>((acc, item, index) => {
      if (item.tags?.includes(name)) {
        acc.push(index);
      }
      return acc;
    }, []);

    if (indices.length === 0) {
      throw new Error(`No items found with tag "${name}"`);
    }

    return indices
      .reverse()
      .map((index) => this.data.splice(index, 1).at(0))
      .filter((item) => item !== undefined)
      .reverse();
  }

  history(index: number): AxChatRequest['chatPrompt'] {
    const result: AxChatRequest['chatPrompt'] = [];

    for (const { role, chat } of this.data) {
      let values: unknown;

      if (role === 'function') {
        values = chat.filter((v) => v.index === index).map((v) => v.value);
      } else {
        values = chat.find((v) => v.index === index)?.value;
      }

      if (Array.isArray(values) && values.length > 0) {
        result.push(
          ...values.map(
            (v) => ({ ...v, role }) as AxChatRequest['chatPrompt'][number]
          )
        );
      } else if (typeof values === 'object' && values !== null) {
        result.push({ ...values, role } as AxChatRequest['chatPrompt'][number]);
      }
      // Skip when values is undefined (no matching index found)
    }
    return result;
  }

  getLast(): AxMemoryData[number] | undefined {
    return this.data.at(-1);
  }

  reset(): void {
    this.data = [];
  }
}

export class AxMemory implements AxAIMemory {
  private memories = new Map<string, MemoryImpl>();
  private defaultMemory: MemoryImpl;

  constructor(
    private options?: {
      debug?: boolean;
      debugHideSystemPrompt?: boolean;
    }
  ) {
    this.defaultMemory = new MemoryImpl(options);
  }

  private getMemory(sessionId?: string): MemoryImpl {
    if (!sessionId) {
      return this.defaultMemory;
    }

    if (!this.memories.has(sessionId)) {
      this.memories.set(sessionId, new MemoryImpl(this.options));
    }

    return this.memories.get(sessionId) as MemoryImpl;
  }

  addRequest(value: AxChatRequest['chatPrompt'], sessionId?: string): void {
    for (const item of value) {
      axValidateChatRequestMessage(item);
    }
    this.getMemory(sessionId).addRequest(value, 0);
  }

  addResponse(
    results: Readonly<AxChatResponseResult[]>,
    sessionId?: string
  ): void {
    axValidateChatResponseResult(results);
    this.getMemory(sessionId).addResponse(results);
  }

  addFunctionResults(
    results: Readonly<AxFunctionResult[]>,
    sessionId?: string
  ): void {
    this.getMemory(sessionId).addFunctionResults(results);
  }

  updateResult(
    result: Readonly<AxChatResponseResult & { delta?: string }>,
    sessionId?: string
  ): void {
    this.getMemory(sessionId).updateResult(result);
  }

  addTag(name: string, sessionId?: string) {
    this.getMemory(sessionId).addTag(name);
  }

  rewindToTag(name: string, sessionId?: string) {
    return this.getMemory(sessionId).rewindToTag(name);
  }

  history(index: number, sessionId?: string) {
    return this.getMemory(sessionId).history(index);
  }

  getLast(sessionId?: string) {
    return this.getMemory(sessionId).getLast();
  }

  reset(sessionId?: string): void {
    if (!sessionId) {
      this.defaultMemory.reset();
    } else {
      this.memories.set(sessionId, new MemoryImpl(this.options));
    }
  }
}

function debugRequest(
  value: AxChatRequest['chatPrompt'][number] | AxChatRequest['chatPrompt'],
  hideSystemPrompt?: boolean,
  logger?: AxLoggerFunction
) {
  if (Array.isArray(value)) {
    logChatRequest(value, hideSystemPrompt, logger);
  } else {
    logChatRequestMessage(value, hideSystemPrompt, logger);
  }
}

function debugResponse(
  value: Readonly<AxChatResponseResult & { index: number }>,
  logger?: AxLoggerFunction
) {
  logResponseResult(value, logger);
}

function debugResponseDelta(delta: string, logger?: AxLoggerFunction) {
  logResponseDelta(delta, logger);
}

function debugFunctionResults(
  results: Readonly<AxFunctionResult[]>,
  logger?: AxLoggerFunction
) {
  logFunctionResults(results, logger);
}
