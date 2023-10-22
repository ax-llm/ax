import { TextResponseResult } from '../ai/types.js';
import { convertToChatPromptItem } from '../ai/util.js';
import { AITextChatPromptItem } from '../tracing/types.js';

import { AIMemory } from './types.js';

/**
 * A memory class to store ai interactions
 * @export
 */
export class Memory implements AIMemory {
  private data: TextResponseResult[] = [];
  private sdata = new Map<string, TextResponseResult[]>();
  private limit: number;

  constructor(limit = 50) {
    if (limit <= 0) {
      throw Error("argument 'last' must be greater than 0");
    }
    this.limit = limit;
  }

  add(value: Readonly<TextResponseResult>, sessionId?: string): void {
    const d = this.get(sessionId);
    d.push(value) > this.limit ? d.shift() : null;
  }

  history(sessionId?: string): Readonly<AITextChatPromptItem[]> {
    return this.get(sessionId).map(convertToChatPromptItem);
  }

  peek(sessionId?: string): Readonly<TextResponseResult[]> {
    return this.get(sessionId);
  }

  reset(sessionId?: string) {
    if (!sessionId) {
      this.data = [];
    } else {
      this.sdata.set(sessionId, []);
    }
  }

  private get(sessionId?: string): TextResponseResult[] {
    if (!sessionId) {
      return this.data;
    }

    if (!this.sdata.has(sessionId)) {
      this.sdata.set(sessionId, []);
    }

    return this.sdata.get(sessionId) || [];
  }
}
