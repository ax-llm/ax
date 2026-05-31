import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

import { AxGen } from './generate.js';
import { AxStreamingGuardError } from './guards.js';

describe('AxGen streaming cancellation', () => {
  it('cancels the response stream when a streaming guard fails early', async () => {
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

    gen.addStreamingGuard(
      'answer',
      (content) => !content.includes('forbidden'),
      'Answer contains forbidden content'
    );

    await expect(
      gen.forward(ai, { userInput: 'test' }, { stream: true, maxRetries: 0 })
    ).rejects.toBeInstanceOf(AxStreamingGuardError);

    expect(cancelled).toBe(true);
    expect(calls).toBe(1);
  });

  it('validates streaming guard target fields', () => {
    const gen = new AxGen<{ userInput: string }, { score: number }>(
      'userInput:string -> score:number'
    );

    expect(() => {
      gen.addStreamingGuard('missing' as 'score', () => true);
    }).toThrow(/not found/);

    expect(() => {
      gen.addStreamingGuard('score', () => true);
    }).toThrow(/must be a string field/);
  });
});
