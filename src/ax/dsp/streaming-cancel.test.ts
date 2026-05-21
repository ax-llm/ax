import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

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

    const ai = new AxMockAIService<string>({
      features: { functions: false, streaming: true },
      chatResponse: streamingResponse,
    });

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
    ).rejects.toThrow('Answer contains forbidden content');

    expect(cancelled).toBe(true);
  });
});
