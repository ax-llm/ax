import { describe, expect, it, vi } from 'vitest';

import { AxAILiteLLM, axAILiteLLMDefaultConfig } from './api.js';

const okResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 0,
  model: 'anthropic/claude-sonnet-4-20250514',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 1,
    total_tokens: 11,
  },
};

function createMockFetch(
  capture: { lastBody?: Record<string, unknown> },
  responseBody: unknown = okResponse
) {
  return vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        capture.lastBody = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
}

describe('AxAILiteLLM', () => {
  it('throws when apiKey is missing', () => {
    expect(
      () =>
        new AxAILiteLLM({
          apiKey: '',
          apiURL: 'http://localhost:4000/v1',
        })
    ).toThrow('LiteLLM API key not set');
  });

  it('throws when apiURL is missing', () => {
    expect(
      () =>
        new AxAILiteLLM({
          apiKey: 'sk-test',
          apiURL: '',
        })
    ).toThrow('LiteLLM API URL not set');
  });

  it('constructs with valid args', () => {
    const ai = new AxAILiteLLM({
      apiKey: 'sk-test',
      apiURL: 'http://localhost:4000/v1',
      config: { model: 'anthropic/claude-sonnet-4-20250514' },
    });
    expect(ai.getName()).toBe('LiteLLM');
  });

  it('sends chat request and parses response correctly', async () => {
    const capture: { lastBody?: Record<string, unknown> } = {};
    const mockFetch = createMockFetch(capture);

    const ai = new AxAILiteLLM({
      apiKey: 'sk-proxy-key',
      apiURL: 'http://localhost:4000/v1',
      config: { model: 'anthropic/claude-sonnet-4-20250514', stream: false },
    });
    ai.setOptions({ fetch: mockFetch });

    const res = await ai.chat({
      chatPrompt: [{ role: 'user', content: 'hello' }],
    });

    expect(mockFetch).toHaveBeenCalled();
    const url = mockFetch.mock.calls[0]?.[0];
    expect(String(url)).toContain('localhost:4000');
    expect(capture.lastBody?.model).toBe('anthropic/claude-sonnet-4-20250514');

    // Verify response is parsed, not just that fetch was called
    if (res instanceof ReadableStream) {
      throw new Error('Expected non-streaming response');
    }
    expect(res.results[0]?.content).toBe('ok');
    expect(res.results[0]?.finishReason).toBe('stop');
  });

  it('returns default config', () => {
    const config = axAILiteLLMDefaultConfig();
    expect(config.model).toBe('gpt-4o-mini');
  });

  it('fetchModelList calls proxy /models endpoint', async () => {
    const modelsResponse = {
      data: [
        { id: 'gpt-4o-mini' },
        { id: 'anthropic/claude-sonnet-4-20250514' },
      ],
    };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(modelsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const ai = new AxAILiteLLM({
      apiKey: 'sk-test',
      apiURL: 'http://localhost:4000/v1',
    });

    const models = await ai.fetchModelList({ fetch: mockFetch });
    expect(models).toHaveLength(2);
    expect(models[0]?.name).toBe('gpt-4o-mini');
    expect(models[1]?.name).toBe('anthropic/claude-sonnet-4-20250514');
  });

  it('fetchModelList returns empty array on error', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const ai = new AxAILiteLLM({
      apiKey: 'sk-bad-key',
      apiURL: 'http://localhost:4000/v1',
    });

    const models = await ai.fetchModelList({ fetch: mockFetch });
    expect(models).toEqual([]);
  });

  it('accepts custom modelInfo for cost tracking', () => {
    const ai = new AxAILiteLLM({
      apiKey: 'sk-test',
      apiURL: 'http://localhost:4000/v1',
      modelInfo: [
        {
          name: 'anthropic/claude-sonnet-4-20250514',
          promptTokenCostPer1M: 3,
          completionTokenCostPer1M: 15,
        },
      ],
    });
    expect(ai.getName()).toBe('LiteLLM');
  });
});
