import { describe, expect, it, vi } from 'vitest';

import { AxAIAnthropic } from './api.js';
import { AxAIAnthropicModel } from './types.js';

function createMockFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('AxAIAnthropic model key preset merging', () => {
  it('merges model list item modelConfig into effective config', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
      models: [
        {
          key: 'fast',
          model: AxAIAnthropicModel.Claude35Haiku,
          description: 'fast preset',
          // @ts-expect-error provider-specific config is normalized
          config: { maxTokens: 512, temperature: 0.4, stopSequences: ['\n'] },
        },
      ],
    });

    const fetch = createMockFetch({
      id: 'id',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-3-haiku',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
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

    const mc = ai.getLastUsedModelConfig();
    expect(mc?.maxTokens).toBe(512);
  });
});
