import { describe, expect, it } from 'vitest';

import { AxAIServiceTimeoutError } from '../util/apicall.js';
import { AxAIGoogleGeminiModel } from './google-gemini/types.js';
import { AxAIOpenAIModel } from './openai/chat_types.js';
import { AxAIOpenAIResponsesModel } from './openai/responses_types.js';
import type { AxChatResponse } from './types.js';
import { ai } from './wrap.js';

// Per-call service options that the generated ports follow. The conformance
// fixtures (tools/axir/extractors/axai-goldens.ts) and the ports' loopback
// examples pin the same behavior.

const chatPrompt = [{ role: 'user' as const, content: 'hi' }];

// A fetch that never answers; only an abort ends it.
const hangingFetch = () => {
  let calls = 0;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(init.signal?.reason ?? new Error('aborted'))
      );
    });
  }) as typeof fetch;
  return { fetchFn, calls: () => calls };
};

// A Chat Completions stream whose headers arrive at once and whose events
// arrive gapMs apart.
const slowStreamFetch = (gapMs: number) =>
  (async () => {
    const encoder = new TextEncoder();
    const chunk = (content: string, finish: string | null) => ({
      id: 'chatcmpl_slow',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'gpt-5.4-mini',
      choices: [{ index: 0, delta: { content }, finish_reason: finish }],
    });
    const events = [chunk('Hel', null), chunk('lo', 'stop')];
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of events) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as typeof fetch;

const openAI = (fetchFn: typeof fetch) =>
  ai({
    name: 'openai',
    apiKey: 'test',
    config: { model: AxAIOpenAIModel.GPT54Mini },
    options: { fetch: fetchFn },
  });

describe('a per-call timeout (milliseconds)', () => {
  it('ends a request whose response has not started with AxAIServiceTimeoutError', async () => {
    const { fetchFn, calls } = hangingFetch();
    const error = await openAI(fetchFn)
      .chat({ chatPrompt }, { stream: false, timeout: 50 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceTimeoutError);
    expect((error as Error).message).toContain('Request timed out after 50ms');
    // A timeout is not retried by the request layer.
    expect(calls()).toBe(1);
  });

  it('ends a stream whose response has not started', async () => {
    const { fetchFn, calls } = hangingFetch();
    const error = await openAI(fetchFn)
      .chat({ chatPrompt }, { stream: true, timeout: 50 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceTimeoutError);
    expect(calls()).toBe(1);
  });

  it('stops once the response starts, so a slower stream still completes', async () => {
    const stream = (await openAI(slowStreamFetch(120)).chat(
      { chatPrompt },
      { stream: true, timeout: 50 }
    )) as ReadableStream<AxChatResponse>;
    let text = '';
    for await (const chunk of stream) text += chunk.results[0]?.content ?? '';
    expect(text).toBe('Hello');
  });
});

// A fetch that records each request's URL and JSON body and answers with a
// Responses, Gemini or Chat Completions reply.
const recordingFetch = () => {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    if (url.includes('generateContent')) {
      return Response.json({
        candidates: [
          { content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
        ],
      });
    }
    return Response.json({
      id: 'r1',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          id: 'm1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;
  return { fetchFn, urls, bodies };
};

describe('Responses prompt_cache_key', () => {
  it('goes out on every request: promptCacheKey, else sessionId', async () => {
    const { fetchFn, bodies } = recordingFetch();
    const service = ai({
      name: 'openai-responses',
      apiKey: 'test',
      config: { model: AxAIOpenAIResponsesModel.GPT54Mini, stream: false },
      options: { fetch: fetchFn },
    });
    await service.chat({ chatPrompt }, { sessionId: 'session-1' });
    await service.chat(
      { chatPrompt },
      { promptCacheKey: 'key-1', sessionId: 'session-1' }
    );
    await service.chat({ chatPrompt });
    await service.chat(
      { chatPrompt, model: AxAIOpenAIResponsesModel.GPT6Luna },
      { sessionId: 'session-6' }
    );
    expect(bodies.map((body) => body.prompt_cache_key)).toEqual([
      'session-1',
      'key-1',
      undefined,
      'session-6',
    ]);
  });

  it("takes the service's promptCacheKey or sessionId when the call has none", async () => {
    const { fetchFn, bodies } = recordingFetch();
    const withSession = ai({
      name: 'openai-responses',
      apiKey: 'test',
      config: { model: AxAIOpenAIResponsesModel.GPT54Mini, stream: false },
      options: { fetch: fetchFn, sessionId: 'service-session' },
    });
    await withSession.chat({ chatPrompt });
    await withSession.chat({ chatPrompt }, { sessionId: 'call-session' });
    const withKey = ai({
      name: 'openai-responses',
      apiKey: 'test',
      config: { model: AxAIOpenAIResponsesModel.GPT54Mini, stream: false },
      options: { fetch: fetchFn, promptCacheKey: 'service-key' },
    });
    // A promptCacheKey from either level beats a sessionId from either level.
    await withKey.chat({ chatPrompt }, { sessionId: 'call-session' });
    expect(bodies.map((body) => body.prompt_cache_key)).toEqual([
      'service-session',
      'call-session',
      'service-key',
    ]);
  });

  it("keeps the service's key when GPT-6 prompt caching is requested", async () => {
    const { fetchFn, bodies } = recordingFetch();
    for (const options of [
      { promptCacheKey: 'service-key' },
      { sessionId: 'service-session' },
    ]) {
      const service = ai({
        name: 'openai-responses',
        apiKey: 'test',
        config: { model: AxAIOpenAIResponsesModel.GPT6Sol, stream: false },
        options: { fetch: fetchFn, ...options },
      });
      await service.chat({ chatPrompt }, { contextCache: {} });
    }
    expect(
      bodies.map((body) => [body.prompt_cache_key, body.prompt_cache_options])
    ).toEqual([
      ['service-key', { mode: 'explicit', ttl: '30m' }],
      ['service-session', { mode: 'explicit', ttl: '30m' }],
    ]);
  });
});

describe('a per-call Vertex beta', () => {
  const vertex = (fetchFn: typeof fetch, beta?: boolean) =>
    ai({
      name: 'google-gemini',
      apiKey: async () => 'vertex-token',
      projectId: 'demo-project',
      region: 'us-central1',
      config: { model: AxAIGoogleGeminiModel.Gemini35Flash, stream: false },
      options: { fetch: fetchFn, ...(beta === undefined ? {} : { beta }) },
    });
  const version = (url: string) => new URL(url).pathname.split('/')[1];

  it('routes that call onto v1beta1', async () => {
    const { fetchFn, urls } = recordingFetch();
    const service = vertex(fetchFn);
    await service.chat({ chatPrompt }, { beta: true });
    await service.chat({ chatPrompt });
    expect(urls.map(version)).toEqual(['v1beta1', 'v1']);
  });

  it("wins over the service's beta", async () => {
    const { fetchFn, urls } = recordingFetch();
    const service = vertex(fetchFn, true);
    await service.chat({ chatPrompt }, { beta: false });
    await service.chat({ chatPrompt });
    expect(urls.map(version)).toEqual(['v1', 'v1beta1']);
  });
});
