import { describe, expect, it, vi } from 'vitest';

import { AxAIMistral } from './api.js';
import { AxAIMistralModel } from './types.js';

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
          id: 'chatcmpl-mistral',
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

describe('AxAIMistral OpenAI compatibility', () => {
  it('uses Mistral chat completions quirks through the OpenAI base', async () => {
    const capture: { url?: string; body?: any } = {};
    const ai = new AxAIMistral({
      apiKey: 'key',
      config: { model: AxAIMistralModel.MistralSmall, maxTokens: 333 },
      options: { fetch: createMockFetch(capture) },
    });

    const res = (await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'describe this',
              },
              {
                type: 'image',
                image: 'aW1hZ2U=',
                mimeType: 'image/png',
              },
            ],
          },
        ],
      },
      { stream: false }
    )) as any;

    expect(res.results[0]?.content).toBe('ok');
    expect(capture.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(capture.body?.max_tokens).toBe(333);
    expect(capture.body?.max_completion_tokens).toBeUndefined();
    expect(capture.body?.messages[0]?.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
    });
  });
});
