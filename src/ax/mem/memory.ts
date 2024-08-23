import type { AxChatRequest, AxChatResponseResult } from '../ai/types.js';

import type { AxAIMemory } from './types.js';

type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export class AxMemory implements AxAIMemory {
  private data: AxChatRequest['chatPrompt'] = [];
  private sdata = new Map<string, AxChatRequest['chatPrompt']>();
  private limit: number;

  constructor(limit = 50) {
    if (limit <= 0) {
      throw Error("argument 'limit' must be greater than 0");
    }
    this.limit = limit;
  }

  add(
    value: Readonly<
      AxChatRequest['chatPrompt'][0] | AxChatRequest['chatPrompt']
    >,
    sessionId?: string
  ): void {
    const d = this.get(sessionId);
    let n = 0;

    if (Array.isArray(value)) {
      n = d.push(...structuredClone(value));
    } else {
      n = d.push({
        ...structuredClone(value)
      } as AxChatRequest['chatPrompt'][0]);
    }
    if (d.length > this.limit) {
      d.splice(0, this.limit + n - this.limit);
    }
  }

  addResult(
    { content, name, functionCalls }: Readonly<AxChatResponseResult>,
    sessionId?: string
  ): void {
    if (!content && (!functionCalls || functionCalls.length === 0)) {
      return;
    }
    this.add({ content, name, role: 'assistant', functionCalls }, sessionId);
  }

  updateResult(
    { content, name, functionCalls }: Readonly<AxChatResponseResult>,
    sessionId?: string
  ): void {
    const items = this.get(sessionId);

    const lastItem = items.at(-1) as unknown as Writeable<
      AxChatRequest['chatPrompt'][0]
    >;

    if (!lastItem || lastItem.role !== 'assistant') {
      this.addResult({ content, name, functionCalls }, sessionId);
      return;
    }

    if ('content' in lastItem && content) {
      lastItem.content = content;
    }
    if ('name' in lastItem && name) {
      lastItem.name = name;
    }
    if ('functionCalls' in lastItem && functionCalls) {
      lastItem.functionCalls = functionCalls;
    }
  }

  history(sessionId?: string): AxChatRequest['chatPrompt'] {
    return this.get(sessionId);
  }

  peek(sessionId?: string): AxChatRequest['chatPrompt'] {
    return this.get(sessionId);
  }

  getLast(sessionId?: string): AxChatRequest['chatPrompt'][0] | undefined {
    const d = this.get(sessionId);
    return d.at(-1);
  }

  reset(sessionId?: string) {
    if (!sessionId) {
      this.data = [];
    } else {
      this.sdata.set(sessionId, []);
    }
  }

  private get(sessionId?: string): AxChatRequest['chatPrompt'] {
    if (!sessionId) {
      return this.data;
    }

    if (!this.sdata.has(sessionId)) {
      this.sdata.set(sessionId, []);
    }

    return this.sdata.get(sessionId) || [];
  }
}
