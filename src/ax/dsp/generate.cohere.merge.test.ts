import { describe, expect, it, vi } from 'vitest';
import { AxAICohereModel } from '../ai/cohere/types.js';
import { ai, ax } from '../index.js';

function createMockFetch(body: unknown, capture: { lastBody?: any }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.body && typeof init.body === 'string') {
          capture.lastBody = JSON.parse(init.body);
        }
      } catch {}
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('ax.forward with Cohere merges per-key options and config', () => {
  it('merges modelConfig via model key', async () => {
    const llm = ai({
      name: 'cohere',
      apiKey: 'key',
      // Global config that should be overridden by per-key mapping
      config: { maxTokens: 9999, temperature: 0.9 },
      models: [
        {
          key: 'fast',
          model: AxAICohereModel.CommandR,
          description: 'fast preset',
          // @ts-expect-error provider-specific config is normalized
          config: { maxTokens: 333, temperature: 0.1, stopSequences: ['\n'] },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        id: 'chatcmpl-cohere',
        object: 'chat.completion',
        created: 0,
        model: AxAICohereModel.CommandR,
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
      },
      capture
    );

    llm.setOptions({ fetch });

    const gen = ax('userQuestion:string -> responseText:string');
    const out = await gen.forward(
      llm,
      { userQuestion: 'hi' },
      { model: 'fast', stream: false }
    );

    expect(typeof out.responseText === 'string').toBe(true);
    expect(fetch).toHaveBeenCalled();

    const reqBody = capture.lastBody;
    expect(reqBody).toBeDefined();
    // max_completion_tokens should reflect merged OpenAI-compatible modelConfig from key
    expect(reqBody.max_completion_tokens).toBe(333);
  });
});
