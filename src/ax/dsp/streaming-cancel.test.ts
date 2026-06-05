import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

import { AxStreamingAssertionError } from './asserts.js';
import { AxGen } from './generate.js';

describe('AxGen streaming cancellation', () => {
  it('cancels the response stream when a streaming assertion fails early', async () => {
    let cancelled = false;

    const streamingResponse = new ReadableStream<AxChatResponse>({
      start(controller) {
        controller.enqueue({
          results: [{ index: 0, content: 'Answer: forbidden content' }],
        });
      },
      cancel() {
        cancelled = true;
      },
    });

    let calls = 0;
    const ai = new AxMockAIService<string>({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });
    const originalChat = ai.chat.bind(ai);
    ai.chat = async (...args) => {
      calls++;
      return originalChat(...args);
    };

    const gen = new AxGen<{ userInput: string }, { answer: string }>(
      'userInput:string -> answer:string'
    );

    gen.addStreamingAssert(
      'answer',
      (content) => !content.includes('forbidden'),
      'Answer contains forbidden content'
    );

    await expect(
      gen.forward(ai, { userInput: 'test' }, { stream: true, maxRetries: 0 })
    ).rejects.toBeInstanceOf(AxStreamingAssertionError);

    expect(cancelled).toBe(true);
    expect(calls).toBe(1);
  });

  it('validates streaming assertion target fields', () => {
    const gen = new AxGen<{ userInput: string }, { score: number }>(
      'userInput:string -> score:number'
    );

    expect(() => {
      gen.addStreamingAssert('missing' as 'score', () => true);
    }).toThrow(/not found/);

    expect(() => {
      gen.addStreamingAssert('score', () => true);
    }).toThrow(/must be a string field/);
  });

  it('does not expose addStreamingGuard', () => {
    const gen = new AxGen<{ userInput: string }, { answer: string }>(
      'userInput:string -> answer:string'
    );

    expect('addStreamingGuard' in gen).toBe(false);
  });
});
