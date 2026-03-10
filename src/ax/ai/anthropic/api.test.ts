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
  it('should allow arbitrary JSON objects in structured outputs', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });

    const capture: { lastBody?: any } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body && typeof init.body === 'string') {
            capture.lastBody = JSON.parse(init.body);
          }
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

    await expect(
      ai.chat(
        {
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
        },
        { stream: false }
      )
    ).resolves.toMatchObject({
      results: [{ content: 'ok' }],
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(capture.lastBody?.output_format?.type).toBe('json_schema');
    expect(capture.lastBody?.output_format?.schema?.additionalProperties).toBe(
      false
    );
  });
});

describe('AxAIAnthropic system prompt caching', () => {
  it('should add cache_control when system message has cache: true', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });

    const capture: { lastBody?: any } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body && typeof init.body === 'string') {
            capture.lastBody = JSON.parse(init.body);
          }
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
          {
            role: 'system',
            content: 'You are a helpful assistant.',
            cache: true,
          },
          { role: 'user', content: 'hi' },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.system).toBeDefined();
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('should NOT add cache_control when system message has no cache flag', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });

    const capture: { lastBody?: any } = {};
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          if (init?.body && typeof init.body === 'string') {
            capture.lastBody = JSON.parse(init.body);
          }
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
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'hi' },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.system).toBeDefined();
    expect(body.system[0].cache_control).toBeUndefined();
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

function createCaptureFetch(modelResponse: string) {
  const capture: { lastBody?: any } = {};
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        capture.lastBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          id: 'id',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          model: modelResponse,
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
  return { capture, fetch };
}

describe('AxAIAnthropic thinking configuration', () => {
  it('Opus 4.6 with high produces adaptive thinking + effort high', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude46Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-6');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('Opus 4.5 with medium produces budget_tokens 10000 + effort medium', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude45Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-5-20251101');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'medium' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 });
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  it('older thinking model with high produces budget_tokens 20000, no output_config', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude37Sonnet },
    });

    const { capture, fetch } = createCaptureFetch('claude-3-7-sonnet-latest');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 20000 });
    expect(body.output_config).toBeUndefined();
  });

  it('none disables thinking and effort for all models', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude46Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-6');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'none' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it('highest caps effort to high on Opus 4.5', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude45Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-5-20251101');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'highest' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 32000 });
    // 'max' effort is capped to 'high' on Opus 4.5
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('Opus 4.6 with highest produces adaptive + effort max', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude46Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-6');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'highest' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'max' });
  });
});
