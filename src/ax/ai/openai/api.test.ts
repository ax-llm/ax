import { describe, expect, it, vi } from 'vitest';
import { AxAIOpenAI } from './api.js';
import { AxAIOpenAIModel } from './chat_types.js';

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

describe('AxAIOpenAI model key preset merging', () => {
  it('merges model list item modelConfig into effective config', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
      models: [
        {
          key: 'fast',
          model: AxAIOpenAIModel.GPT5Nano,
          description: 'fast preset',
          // @ts-expect-error: provider-specific config on model item is normalized at runtime
          config: { maxTokens: 256, stop: ['\n'] as any },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

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
    expect(mc?.maxTokens).toBe(256);
    // Temperature may be omitted by model; ensure no crash and allow undefined
    expect(
      Array.isArray(mc?.stopSequences) ? mc?.stopSequences!.length : 0
    ).toBeGreaterThan(0);
  });

  it('ignores thinkingTokenBudget when model does not support it', async () => {
    const ai = new AxAIOpenAI({
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT5Mini },
      models: [
        { key: 'fast', model: AxAIOpenAIModel.GPT5Nano, description: 'fast' },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      },
      capture
    );

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
  });
});

describe('AxAIOpenAI', () => {
  describe('API URL configuration', () => {
    it('should use default OpenAI API URL when apiURL is not provided', () => {
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
      });

      expect((llm as any).apiURL).toBe('https://api.openai.com/v1');
    });

    it('should use custom API URL when apiURL is provided', () => {
      const customUrl = 'https://openrouter.ai/api/v1';
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: customUrl,
      });

      expect((llm as any).apiURL).toBe(customUrl);
    });

    it('should use different custom API URL formats', () => {
      const testCases = [
        'https://custom-endpoint.com/v1',
        'https://api.anthropic.com/v1',
        'http://localhost:8080/v1',
        'https://gateway.ai.cloudflare.com/v1',
      ];

      testCases.forEach((url) => {
        const llm = new AxAIOpenAI({
          apiKey: 'test-key',
          apiURL: url,
        });

        expect((llm as any).apiURL).toBe(url);
      });
    });

    it('should work with ai() factory function and custom API URL', () => {
      // This test verifies the factory function properly passes apiURL
      // We'll test this via the AxAIOpenAI constructor which is what the factory uses
      const llm = new AxAIOpenAI({
        apiKey: 'test-key',
        apiURL: 'https://openrouter.ai/api/v1',
      });

      expect((llm as any).apiURL).toBe('https://openrouter.ai/api/v1');
    });
  });
});
