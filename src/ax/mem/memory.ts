// Removed debug imports - logging now handled in base.ts
import type {
  AxChatRequest,
  AxChatResponseResult,
  AxFunctionResult,
} from '../ai/types.js';
import {
  axValidateChatRequestMessage,
  axValidateChatResponseResult,
} from '../ai/validate.js';

import type { AxAIMemory, AxMemoryData } from './types.js';

export class MemoryImpl {
  private data: AxMemoryData = [];
  private seenTags = new Set<string>();

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
  }

  addResponse(results: Readonly<AxChatResponseResult[]>): void {
    const chat = results.map(({ index, ...value }) => ({
      index,
      value: structuredClone(value),
    }));

    this.data.push({ role: 'assistant', chat });
  }

  updateResult({
    content,
    name,
    functionCalls,
    thought,
    thoughtBlocks,
    index,
  }: Readonly<AxChatResponseResult & { index: number }>): void {
    const lastItem = this.data.at(-1);

    if (
      !lastItem ||
      lastItem.role !== 'assistant' ||
      (lastItem.role === 'assistant' && !lastItem.updatable)
    ) {
      this.data.push({
        role: 'assistant',
        updatable: true,
        chat: [
          {
            index,
            value: structuredClone({
              content,
              name,
              functionCalls,
              thought,
              thoughtBlocks,
            }),
          },
        ],
      });
      return;
    }

    const chat = lastItem.chat.find((v) => v.index === index);

    if (!chat) {
      lastItem.chat.push({
        index,
        value: structuredClone({
          content,
          name,
          functionCalls,
          thought,
          thoughtBlocks,
        }),
      });
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

    if (typeof thought === 'string' && thought.trim() !== '') {
      const existing = (chat.value as any).thought;
      (chat.value as any).thought =
        typeof existing === 'string' ? existing + thought : thought;
    }

    // Handle thoughtBlocks array - append new blocks or merge last block's data
    if (Array.isArray(thoughtBlocks) && thoughtBlocks.length > 0) {
      const existing = ((chat.value as any).thoughtBlocks ??
        []) as typeof thoughtBlocks;

      // For streaming, we may receive partial data for the same block
      // New blocks are appended, existing blocks have their data concatenated
      for (const newBlock of thoughtBlocks) {
        const lastExisting =
          existing.length > 0 ? existing[existing.length - 1] : undefined;

        // If the new block has no signature yet (streaming partial), merge with last block
        if (lastExisting && !newBlock.signature && newBlock.data) {
          lastExisting.data = (lastExisting.data ?? '') + newBlock.data;
          if (newBlock.encrypted) {
            lastExisting.encrypted = true;
          }
        } else if (newBlock.signature) {
          // Block has a signature, so it's complete - check if we need to update or append
          if (lastExisting && !lastExisting.signature) {
            // Update existing block with final signature
            lastExisting.data = (lastExisting.data ?? '') + newBlock.data;
            lastExisting.signature = newBlock.signature;
            if (newBlock.encrypted) {
              lastExisting.encrypted = true;
            }
          } else {
            // Append as new complete block
            existing.push(structuredClone(newBlock));
          }
        } else if (existing.length === 0) {
          // First block, no signature yet (streaming)
          existing.push(structuredClone(newBlock));
        }
      }

      (chat.value as any).thoughtBlocks = existing;

      // Update thought string for display
      if (existing.length > 0) {
        (chat.value as any).thought = existing.map((b) => b.data).join('');
      }
    }
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
    this.seenTags.add(name);
  }

  rewindToTag(name: string): AxMemoryData {
    const tagIndex = this.data.findIndex((item) => item.tags?.includes(name));
    if (tagIndex === -1) {
      // If tag was never seen in this memory, throw; otherwise return []
      if (!this.seenTags.has(name)) {
        throw new Error(`Tag "${name}" not found`);
      }
      return [];
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
      return [];
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
    this.seenTags = new Set<string>();
  }
}

export class AxMemory implements AxAIMemory {
  private memories = new Map<string, MemoryImpl>();
  private defaultMemory: MemoryImpl;

  constructor() {
    this.defaultMemory = new MemoryImpl();
  }

  private getMemory(sessionId?: string): MemoryImpl {
    if (!sessionId) {
      return this.defaultMemory;
    }

    if (!this.memories.has(sessionId)) {
      this.memories.set(sessionId, new MemoryImpl());
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

  removeByTag(name: string, sessionId?: string) {
    return this.getMemory(sessionId).removeByTag(name);
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
      this.memories.set(sessionId, new MemoryImpl());
    }
  }
}

// Debug functions removed - logging now handled in base.ts
