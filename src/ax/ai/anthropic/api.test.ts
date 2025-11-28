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

describe('AxAIAnthropic schema validation', () => {
  it('should throw an error for arbitrary JSON objects in structured outputs', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });

    const fetch = createMockFetch({
      id: 'id',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-3-5-sonnet-latest',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    ai.setOptions({ fetch });

    await expect(
      ai.chat({
        chatPrompt: [{ role: 'user', content: 'hi' }],
        responseFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              arbitrary: {
                type: [
                  'object',
                  'array',
                  'string',
                  'number',
                  'boolean',
                  'null',
                ],
              },
            },
          },
        },
      })
    ).rejects.toThrow(
      'Anthropic models do not support arbitrary JSON objects (e.g. f.json() or f.object() with no properties) in structured outputs. Please use f.string() and instruct the model to return a JSON string, or define the expected structure with f.object({ ... })'
    );
  });
});

describe('AxAIAnthropic trims trailing whitespace in assistant content', () => {
  it('removes trailing whitespace from assistant string content in request body', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });

    const capture: { lastBody?: any } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
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
              model: 'claude-3-5-sonnet-latest',
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      );

    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [
          { role: 'assistant', content: 'hello  \n\t ' },
          { role: 'user', content: 'continue' },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body).toBeDefined();
    const assistantMsgs = (body.messages as any[]).filter(
      (m) => m.role === 'assistant'
    );
    expect(assistantMsgs.length).toBeGreaterThan(0);
    for (const m of assistantMsgs) {
      if (typeof m.content === 'string') {
        expect(m.content).toBe('hello');
      }
    }
  });
});
