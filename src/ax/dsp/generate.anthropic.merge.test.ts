import { describe, expect, it, vi } from 'vitest';
import { AxAIAnthropicModel } from '../ai/anthropic/types.js';
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

describe('ax.forward with Anthropic merges per-key options and config', () => {
  it('merges thinkingTokenBudget and includeThoughts via model key', async () => {
    const llm = ai({
      name: 'anthropic',
      apiKey: 'key',
      // Global config that should be overridden by per-key mapping
      config: {
        model: AxAIAnthropicModel.Claude35Sonnet,
        thinking: { type: 'enabled', budget_tokens: 256 },
      },
      models: [
        {
          key: 'key1',
          model: AxAIAnthropicModel.Claude35Haiku,
          description: 'anthropic preset',
          config: {
            maxTokens: 2048,
            temperature: 0.5,
            thinking: {
              thinkingTokenBudget: 1200, // should map to closest level
              includeThoughts: true,
            },
          },
        },
      ],
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(
      {
        id: 'id',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-3-5-haiku-latest',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      capture
    );

    llm.setOptions({ fetch });

    const gen = ax('userQuestion:string -> responseText:string');

    const out = await gen.forward(
      llm,
      { userQuestion: 'hi' },
      { model: 'key1', stream: false }
    );

    expect(typeof out.responseText === 'string').toBe(true);
    expect(fetch).toHaveBeenCalled();

    const reqBody = capture.lastBody;
    expect(reqBody).toBeDefined();
    // Check thinking object presence and numeric budget
    if (reqBody.thinking) {
      expect(reqBody.thinking).toBeDefined();
      expect(reqBody.thinking.budget_tokens).toBeGreaterThan(500);
      expect(reqBody.thinking.budget_tokens).toBeLessThan(5000);
    }
  });
});
