import { describe, expect, it, vi } from 'vitest';

import { AxAICohere } from './api.js';
import { AxAICohereModel } from './types.js';

function createMockFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('AxAICohere model key preset merging', () => {
  it('merges model list item modelConfig into effective config', async () => {
    const ai = new AxAICohere({
      apiKey: 'key',
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

    const fetch = createMockFetch({
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
    });

    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        model: 'fast',
        chatPrompt: [{ role: 'user', content: 'hi' }],
      },
      { stream: false }
    )) as any;

    expect(res.results[0]?.content).toBe('ok');
    expect(fetch).toHaveBeenCalled();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://api.cohere.ai/compatibility/v1/chat/completions'
    );

    const mc = ai.getLastUsedModelConfig();
    expect(mc?.maxTokens).toBe(333);
  });
});
