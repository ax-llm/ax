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
        text: 'ok',
        generation_id: 'gid',
        response_id: 'rid',
        finish_reason: 'COMPLETE',
        meta: { billed_units: { input_tokens: 1, output_tokens: 1 } },
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
    // max_tokens should reflect merged modelConfig from key
    expect(reqBody.max_tokens).toBe(333);
  });
});
