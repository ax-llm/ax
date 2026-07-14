import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AxAIRefusalError } from '../../util/apicall.js';
import {
  AxAIServiceAuthenticationError,
  AxAIServiceStatusError,
} from '../../util/apicall.js';
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

function createMockStreamFetch(chunks: readonly unknown[]) {
  return vi.fn().mockImplementation(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}

describe('AxAIAnthropic model key preset merging', () => {
  it('preserves message ids on streaming chunks', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });
    const fetch = createMockStreamFetch([
      {
        type: 'message_start',
        message: {
          id: 'msg_stream_123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-3-5-sonnet',
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    ]);

    ai.setOptions({ fetch });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: true }
    )) as ReadableStream<any>;
    const reader = stream.getReader();
    const values: any[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      values.push(value);
    }

    expect(values.map((value) => value.remoteId)).toEqual([
      'msg_stream_123',
      'msg_stream_123',
    ]);
  });

  it('throws refusal errors with stop_details on streaming chunks', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    const fetch = createMockStreamFetch([
      {
        type: 'message_start',
        message: {
          id: 'msg_stream_refusal',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4-8',
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'message_delta',
        delta: {
          stop_reason: 'refusal',
          stop_sequence: null,
          stop_details: {
            type: 'refusal',
            category: 'cyber',
            explanation: 'Streaming cyber safety policy refusal.',
          },
        },
        usage: { output_tokens: 4 },
      },
    ]);

    ai.setOptions({ fetch });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'unsafe request' }] },
      { stream: true }
    )) as ReadableStream<any>;
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
      value: { remoteId: 'msg_stream_refusal' },
    });
    await expect(reader.read()).rejects.toMatchObject({
      name: 'AxAIRefusalError',
      category: 'cyber',
      explanation: 'Streaming cyber safety policy refusal.',
      refusalMessage: 'Streaming cyber safety policy refusal.',
    } satisfies Partial<AxAIRefusalError>);
  });

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
    expect(capture.lastBody?.output_format).toBeUndefined();
    expect(capture.lastBody?.output_config?.format?.type).toBe('json_schema');
    expect(
      capture.lastBody?.output_config?.format?.schema?.additionalProperties
    ).toBe(false);
    // Multi-type-array union should be collapsed to a permissive object.
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.arbitrary
        ?.type
    ).toBe('object');
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.arbitrary
        ?.additionalProperties
    ).toBe(true);
  });

  it('should preserve nullable type unions in structured output schemas', async () => {
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
        chatPrompt: [{ role: 'user', content: 'hi' }],
        responseFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              nickname: { type: ['string', 'null'], minLength: 2 },
              profile: {
                type: ['object', 'null'],
                properties: {
                  age: { type: ['number', 'null'], maximum: 120 },
                },
                required: ['age'],
                additionalProperties: false,
              },
            },
            required: ['nickname', 'profile'],
            additionalProperties: false,
          },
        },
      },
      { stream: false }
    );

    expect(
      capture.lastBody?.output_config?.format?.schema?.additionalProperties
    ).toBe(false);
    expect(capture.lastBody?.output_config?.format?.schema?.required).toEqual([
      'nickname',
      'profile',
    ]);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.nickname
        ?.type
    ).toEqual(['string', 'null']);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.nickname
        ?.minLength
    ).toBeUndefined();
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.profile?.type
    ).toEqual(['object', 'null']);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.profile
        ?.additionalProperties
    ).toBe(false);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.profile
        ?.required
    ).toEqual(['age']);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.profile
        ?.properties?.age?.type
    ).toEqual(['number', 'null']);
    expect(
      capture.lastBody?.output_config?.format?.schema?.properties?.profile
        ?.properties?.age?.maximum
    ).toBeUndefined();
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

function createCaptureFetch(modelResponse: string, response?: any) {
  const capture: { lastBody?: any; lastHeaders?: Record<string, string> } = {};
  const fetch = vi
    .fn()
    .mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capture.lastHeaders = Object.fromEntries(
        new Headers(init?.headers).entries()
      );
      if (init?.body && typeof init.body === 'string') {
        capture.lastBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify(
          response ?? {
            id: 'id',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: modelResponse,
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }
        ),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });
  return { capture, fetch };
}

describe('AxAIAnthropic thinking configuration', () => {
  it('Opus 4.8 with high produces adaptive thinking + effort high', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-8');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('Opus 4.7 with high produces adaptive thinking + effort high', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude47Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-7');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.model).toBe('claude-opus-4-7');
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });

  it('Sonnet 5 with high produces adaptive thinking + effort high', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude5Sonnet },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.thinking?.budget_tokens).toBeUndefined();
  });

  it('Sonnet 5 with highest produces adaptive + effort max', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude5Sonnet },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'highest' }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'max' });
    expect(body.thinking?.budget_tokens).toBeUndefined();
  });

  // `display` is derived purely from showThoughts inside the shared
  // isAdaptiveThinkingModel branch, so it behaves identically for every
  // adaptive model — exercise one, chosen arbitrarily.
  const adaptiveModel = AxAIAnthropicModel.Claude5Sonnet;

  it('adaptive model requests summarized display when showThoughts is true', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: adaptiveModel },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high', showThoughts: true }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
  });

  it('adaptive model omits display when showThoughts is false', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: adaptiveModel },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false, thinkingTokenBudget: 'high', showThoughts: false }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.thinking).toEqual({
      type: 'adaptive',
      display: 'omitted',
    });
  });

  it('Sonnet 5 accepts direct xhigh effort', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude5Sonnet, effort: 'xhigh' },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.output_config).toEqual({ effort: 'xhigh' });
    expect(capture.lastBody?.thinking).toBeUndefined();
  });

  it('Opus 4.8 accepts direct xhigh effort and omits sampling params', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-8');
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: {
          effort: 'xhigh',
          temperature: 0.2,
          topP: 0.9,
          topK: 40,
        },
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'xhigh' });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
  });

  // Anthropic rejects sampling params on every adaptive model, not only Opus
  // 4.7+: `temperature` is deprecated for these models and any value other than
  // the default is an unconditional HTTP 400 ("`temperature` is deprecated for
  // this model."). Verified against the live API on claude-sonnet-5, including
  // with no effort and no thinking block on the wire — the rejection tracks the
  // model, not the request.
  it('Sonnet 5 omits sampling params', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude5Sonnet },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-5');
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { temperature: 0.2, topP: 0.9, topK: 40 },
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
  });

  it('Opus 4.6 omits sampling params', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude46Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-6');
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { temperature: 0.2, topP: 0.9, topK: 40 },
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
  });

  // Non-adaptive models still accept sampling params — the guard must not
  // suppress them everywhere.
  it('Sonnet 4.6 still sends sampling params', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude46Sonnet },
    });

    const { capture, fetch } = createCaptureFetch('claude-sonnet-4-6');
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { temperature: 0.2, topP: 0.9 },
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.temperature).toBe(0.2);
    expect(body.top_p).toBe(0.9);
  });

  it('Opus 4.8 accepts provider config xhigh effort', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: {
        model: AxAIAnthropicModel.Claude48Opus,
        effort: 'xhigh',
      },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-8');
    ai.setOptions({ fetch });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.output_config).toEqual({ effort: 'xhigh' });
  });

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
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
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
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'max' });
  });

  it('Opus 4.8 fast mode sends speed and merged beta headers', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-8', {
      id: 'id',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-opus-4-8',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, speed: 'fast' },
    });
    ai.setOptions({ fetch });

    const res = (await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'hi' }],
        modelConfig: { speed: 'fast' },
      },
      { stream: false }
    )) as any;

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.speed).toBe('fast');
    expect(capture.lastHeaders?.['anthropic-beta']).toContain(
      'structured-outputs-2025-11-13'
    );
    expect(capture.lastHeaders?.['anthropic-beta']).toContain(
      'web-search-2025-03-05'
    );
    expect(capture.lastHeaders?.['anthropic-beta']).toContain(
      'fast-mode-2026-02-01'
    );
    expect(res.modelUsage.tokens.speed).toBe('fast');
  });

  it('Opus 4.8 task budget sends output_config and beta header', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { capture, fetch } = createCaptureFetch('claude-opus-4-8');
    ai.setOptions({ fetch });

    await ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'review this repo' }],
        modelConfig: {
          effort: 'high',
          taskBudget: { type: 'tokens', total: 64_000, remaining: 32_000 },
        },
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    expect(capture.lastBody?.output_config).toEqual({
      effort: 'high',
      task_budget: { type: 'tokens', total: 64_000, remaining: 32_000 },
    });
    expect(capture.lastHeaders?.['anthropic-beta']).toContain(
      'task-budgets-2026-03-13'
    );
    expect(capture.lastHeaders?.['anthropic-beta']).toContain(
      'structured-outputs-2025-11-13'
    );
  });

  it('rejects task budgets below Anthropic minimum locally', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { fetch } = createCaptureFetch('claude-opus-4-8');
    ai.setOptions({ fetch });

    await expect(
      ai.chat(
        {
          chatPrompt: [{ role: 'user', content: 'review this repo' }],
          modelConfig: { taskBudget: { type: 'tokens', total: 19_999 } },
        },
        { stream: false }
      )
    ).rejects.toThrow('taskBudget.total must be at least 20000');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws refusal errors with Anthropic stop_details', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });

    const { fetch } = createCaptureFetch('claude-opus-4-8', {
      id: 'msg_refusal',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      model: 'claude-opus-4-8',
      stop_reason: 'refusal',
      stop_details: {
        type: 'refusal',
        category: 'cyber',
        explanation: 'Cyber safety policy refusal.',
      },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    ai.setOptions({ fetch });

    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: 'unsafe request' }] },
        { stream: false }
      )
    ).rejects.toMatchObject({
      name: 'AxAIRefusalError',
      category: 'cyber',
      explanation: 'Cyber safety policy refusal.',
      refusalMessage: 'Cyber safety policy refusal.',
    } satisfies Partial<AxAIRefusalError>);
  });
});

describe('AxAIAnthropic error-event classification', () => {
  it('maps a non-streaming overloaded_error event to a 529 status error', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    const fetch = createMockFetch({
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    });
    ai.setOptions({ fetch });

    const err = await ai
      .chat(
        { chatPrompt: [{ role: 'user', content: 'hello' }] },
        { stream: false }
      )
      .then(
        () => undefined,
        (e) => e
      );

    expect(err).toBeInstanceOf(AxAIServiceStatusError);
    expect((err as AxAIServiceStatusError).status).toBe(529);
  });

  it('maps a streaming overloaded_error event to a 529 status error', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    const fetch = createMockStreamFetch([
      {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      },
    ]);
    // Disable retries so this exercises the classification mapping in isolation; the
    // retry-with-backoff behavior is covered by 'streaming transient-error retry'.
    ai.setOptions({ fetch, retry: { maxRetries: 0 } });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: true }
    )) as ReadableStream<any>;
    const reader = stream.getReader();

    const err = await reader.read().then(
      () => undefined,
      (e) => e
    );

    expect(err).toBeInstanceOf(AxAIServiceStatusError);
    expect((err as AxAIServiceStatusError).status).toBe(529);
  });

  it('maps an authentication_error event to an authentication error', async () => {
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    const fetch = createMockFetch({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    ai.setOptions({ fetch });

    const err = await ai
      .chat(
        { chatPrompt: [{ role: 'user', content: 'hello' }] },
        { stream: false }
      )
      .then(
        () => undefined,
        (e) => e
      );

    expect(err).toBeInstanceOf(AxAIServiceAuthenticationError);
  });

  it.each([
    ['invalid_request_error', 400],
    ['permission_error', 403],
    ['not_found_error', 404],
    ['request_too_large', 413],
  ])(
    'maps a %s event to a non-refusal %i status error',
    async (type, status) => {
      const ai = new AxAIAnthropic({
        apiKey: 'key',
        config: { model: AxAIAnthropicModel.Claude48Opus },
      });
      const fetch = createMockFetch({
        type: 'error',
        error: { type, message: type },
      });
      ai.setOptions({ fetch });

      const err = await ai
        .chat(
          { chatPrompt: [{ role: 'user', content: 'hello' }] },
          { stream: false }
        )
        .then(
          () => undefined,
          (e) => e
        );

      expect(err).toBeInstanceOf(AxAIServiceStatusError);
      expect((err as AxAIServiceStatusError).status).toBe(status);
    }
  );
});

describe('AxAIAnthropic streaming transient-error retry', () => {
  const overloadChunk = {
    type: 'error',
    error: { type: 'overloaded_error', message: 'Overloaded' },
  };
  const goodChunks = [
    {
      type: 'message_start',
      message: {
        id: 'msg_ok',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-opus-4-8',
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'recovered' },
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 2 },
    },
  ];

  // Builds a streaming Response from chunks, choosing per fetch call so we can return an
  // overload first and a healthy stream on retry.
  const streamFetch = (chunksByCall: readonly (readonly unknown[])[]) => {
    let call = 0;
    return vi.fn().mockImplementation(async () => {
      const chunks = chunksByCall[Math.min(call, chunksByCall.length - 1)];
      call++;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks ?? []) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
            );
          }
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
  };

  it('retries a pre-content overloaded_error then streams the recovered response', async () => {
    const fetch = streamFetch([[overloadChunk], goodChunks]);
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    ai.setOptions({ fetch, retry: { initialDelayMs: 1, maxRetries: 2 } });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: true }
    )) as ReadableStream<any>;

    let text = '';
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value.results?.[0]?.content ?? '';
    }

    expect(text).toBe('recovered');
    expect(fetch).toHaveBeenCalledTimes(2); // initial overload + 1 retry that succeeded
  });

  it('surfaces a 529 after exhausting the streaming overload retry budget', async () => {
    const fetch = streamFetch([[overloadChunk]]); // always overloaded
    const ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude48Opus },
    });
    ai.setOptions({ fetch, retry: { initialDelayMs: 1, maxRetries: 2 } });

    const stream = (await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: true }
    )) as ReadableStream<any>;

    const err = await stream
      .getReader()
      .read()
      .then(
        () => undefined,
        (e) => e
      );

    expect(err).toBeInstanceOf(AxAIServiceStatusError);
    expect((err as AxAIServiceStatusError).status).toBe(529);
    expect(fetch).toHaveBeenCalledTimes(3); // initial + maxRetries(2)
  });
});

describe('AxAIAnthropic user message caching', () => {
  let ai: AxAIAnthropic;
  let capture: { lastBody?: any };
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });
    ({ capture, fetch } = createCaptureFetch('claude-3-5-sonnet-latest'));
    ai.setOptions({ fetch });
  });

  it('string content + cache: true serializes to a single text block with block-level cache_control', async () => {
    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi', cache: true }] },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].role).toBe('user');
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0]).toEqual({
      type: 'text',
      text: 'hi',
      cache_control: { type: 'ephemeral' },
    });
    // Regression guard: cache_control must NOT sit on the message envelope.
    expect(body.messages[0].cache_control).toBeUndefined();
  });

  it('string content without cache flag is preserved as a plain string', async () => {
    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hi' }] },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].content).toBe('hi');
    expect(body.messages[0].cache_control).toBeUndefined();
  });

  it('array content + message-level cache attaches cache_control to the last block', async () => {
    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
            cache: true,
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[1].cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(body.messages[0].cache_control).toBeUndefined();
  });

  it('array content with per-block cache continues to honor block-level flag', async () => {
    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a', cache: true },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].content[0].cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
  });

  it('array content without any cache flag leaks no cache_control anywhere', async () => {
    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[1].cache_control).toBeUndefined();
  });

  it('message-level cache on array content whose tail is an image attaches cache_control to that image block', async () => {
    await ai.chat(
      {
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              {
                type: 'image',
                mimeType: 'image/png',
                image: 'aGVsbG8=',
              },
            ],
            cache: true,
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[0].content[0].cache_control).toBeUndefined();
    expect(body.messages[0].content[1].type).toBe('image');
    expect(body.messages[0].content[1].cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(body.messages[0].cache_control).toBeUndefined();
  });
});

describe('AxAIAnthropic assistant message caching', () => {
  let ai: AxAIAnthropic;
  let capture: { lastBody?: any };
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });
    ({ capture, fetch } = createCaptureFetch('claude-3-5-sonnet-latest'));
    ai.setOptions({ fetch });
  });

  it('string content + cache: true normalizes to a single text block with cache_control', async () => {
    await ai.chat(
      {
        chatPrompt: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'cached reply', cache: true },
          { role: 'user', content: 'continue' },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[1].role).toBe('assistant');
    expect(Array.isArray(body.messages[1].content)).toBe(true);
    expect(body.messages[1].content[0]).toEqual({
      type: 'text',
      text: 'cached reply',
      cache_control: { type: 'ephemeral' },
    });
    expect(body.messages[1].cache_control).toBeUndefined();
  });

  it('functionCalls + message-level cache marks each tool_use block (block-level, not envelope)', async () => {
    await ai.chat(
      {
        chatPrompt: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            functionCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', params: '{"q":"x"}' },
              },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'lookup', params: '{"q":"y"}' },
              },
            ],
            cache: true,
          },
          {
            role: 'function',
            functionId: 'call_1',
            result: 'r1',
          },
          {
            role: 'function',
            functionId: 'call_2',
            result: 'r2',
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[1].cache_control).toBeUndefined();
    expect(body.messages[1].content[0].type).toBe('tool_use');
    expect(body.messages[1].content[0].cache_control).toEqual({
      type: 'ephemeral',
    });
    expect(body.messages[1].content[1].cache_control).toEqual({
      type: 'ephemeral',
    });
  });
});

describe('AxAIAnthropic function (tool_result) caching', () => {
  let ai: AxAIAnthropic;
  let capture: { lastBody?: any };
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ai = new AxAIAnthropic({
      apiKey: 'key',
      config: { model: AxAIAnthropicModel.Claude35Sonnet },
    });
    ({ capture, fetch } = createCaptureFetch('claude-3-5-sonnet-latest'));
    ai.setOptions({ fetch });
  });

  it('function role + cache: true emits cache_control on the tool_result block (not a stray `cache` key, not the envelope)', async () => {
    await ai.chat(
      {
        chatPrompt: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            functionCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', params: '{}' },
              },
            ],
          },
          {
            role: 'function',
            functionId: 'call_1',
            result: 'result body',
            cache: true,
          },
        ],
      },
      { stream: false }
    );

    expect(fetch).toHaveBeenCalled();
    const body = capture.lastBody;
    const toolResultMsg = body.messages[2];
    expect(toolResultMsg.role).toBe('user');
    expect(toolResultMsg.cache_control).toBeUndefined();
    const block = toolResultMsg.content[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('call_1');
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
    // Regression guard for the previous typo: must not be a `cache` field.
    expect(block.cache).toBeUndefined();
  });
});
