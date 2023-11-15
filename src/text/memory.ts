import { TextResponseResult } from '../ai/types.js';
import { convertToChatPromptItem } from '../ai/util.js';
import { AITextChatPromptItem } from '../tracing/types.js';

import { AIMemory } from './types.js';

/**
 * A memory class to store ai interactions
 * @export
 */
export class Memory implements AIMemory {
  private data: AITextChatPromptItem[] = [];
  private sdata = new Map<string, AITextChatPromptItem[]>();
  private limit: number;

  constructor(limit = 50) {
    if (limit <= 0) {
      throw Error("argument 'last' must be greater than 0");
    }
    this.limit = limit;
  }

  add(
    value: Readonly<AITextChatPromptItem | AITextChatPromptItem[]>,
    sessionId?: string
  ): void {
    const d = this.get(sessionId);
    let n = 0;
    if (Array.isArray(value)) {
      n = d.push(...value);
    } else {
      n = d.push(value as AITextChatPromptItem);
    }
    if (d.length > this.limit) {
      d.splice(0, this.limit + n - this.limit);
    }
  }

  addResult(result: Readonly<TextResponseResult>, sessionId?: string): void {
    this.add(convertToChatPromptItem(result), sessionId);
  }

  history(sessionId?: string): Readonly<AITextChatPromptItem[]> {
    return this.get(sessionId);
  }

  peek(sessionId?: string): Readonly<AITextChatPromptItem[]> {
    return this.get(sessionId);
  }

  reset(sessionId?: string) {
    if (!sessionId) {
      this.data = [];
    } else {
      this.sdata.set(sessionId, []);
    }
  }

  private get(sessionId?: string): AITextChatPromptItem[] {
    if (!sessionId) {
      return this.data;
    }

    if (!this.sdata.has(sessionId)) {
      this.sdata.set(sessionId, []);
    }

    return this.sdata.get(sessionId) || [];
  }
}
