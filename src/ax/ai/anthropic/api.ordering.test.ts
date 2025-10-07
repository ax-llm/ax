import { describe, expect, it, vi } from 'vitest';

import { AxAIAnthropic } from './api.js';
import { AxAIAnthropicModel } from './types.js';

function createMockFetch(capture: { lastBody?: any }) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      try {
        if (init?.body && typeof init.body === 'string') {
          capture.lastBody = JSON.parse(init.body);
        }
      } catch {}
      return new Response(
        JSON.stringify({
          id: 'id',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          model: 'claude-3-7-sonnet-latest',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
}

describe('Anthropic assistant content ordering with thinking and tool_use', () => {
  it('prepends redacted_thinking before tool_use when thinking is enabled', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude37Sonnet },
    });

    const capture: { lastBody?: any } = {};
    const fetch = createMockFetch(capture);
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'assistant',
            functionCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'my_tool', params: { a: 1 } },
              },
            ],
          },
          { role: 'user', content: 'now continue' },
        ],
      },
      { stream: false, thinkingTokenBudget: 'low' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);

    const assistantMsgs = (body.messages as any[]).filter(
      (m) => m.role === 'assistant'
    );
    expect(assistantMsgs.length).toBeGreaterThan(0);

    for (const m of assistantMsgs) {
      if (Array.isArray(m.content)) {
        // First block must be thinking or redacted_thinking
        expect(
          m.content[0]?.type === 'thinking' ||
            m.content[0]?.type === 'redacted_thinking'
        ).toBe(true);
        // And tool_use should appear after
        const hasToolUseAfter = m.content
          .slice(1)
          .some((b: any) => b.type === 'tool_use');
        expect(hasToolUseAfter).toBe(true);
      }
    }
  });
});
