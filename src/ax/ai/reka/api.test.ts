import { describe, expect, it, vi } from 'vitest';

import { AxAIReka } from './api.js';
import { AxAIRekaModel } from './types.js';

function createMockFetch(capture: { url?: string; body?: any }) {
  return vi
    .fn()
    .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      capture.url = String(url);
      if (init?.body && typeof init.body === 'string') {
        capture.body = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-reka',
          object: 'chat.completion',
          created: 0,
          model: capture.body?.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok', refusal: null },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
}

describe('AxAIReka OpenAI compatibility', () => {
  it('uses the OpenAI-compatible chat completions endpoint', async () => {
    const capture: { url?: string; body?: any } = {};
    const ai = new AxAIReka({
      apiKey: 'key',
      config: { model: AxAIRekaModel.RekaFlash },
      options: { fetch: createMockFetch(capture) },
    });

    const res = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    )) as any;

    expect(res.results[0]?.content).toBe('ok');
    expect(capture.url).toBe('https://api.reka.ai/v1/chat/completions');
    expect(capture.body?.model).toBe(AxAIRekaModel.RekaFlash);
    expect(capture.body?.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
