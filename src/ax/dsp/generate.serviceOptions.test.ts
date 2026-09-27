import { describe, expect, it } from 'vitest';

import { ai } from '../ai/wrap.js';
import { AxGen } from './generate.js';

// A fetch that records each request's URL and JSON body and answers with a
// Responses or Chat Completions reply.
const recordingFetch = () => {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
    if (url.includes('responses')) {
      return Response.json({
        id: 'r1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Answer: ok' }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }
    return Response.json({
      id: 'c1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-5.4-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Answer: ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }) as typeof fetch;
  return { fetchFn, urls, bodies };
};

describe('AxGen service options reach the provider request', () => {
  it('sends promptCacheRetention from the constructor or the call to Responses', async () => {
    const { fetchFn, bodies } = recordingFetch();
    const service = ai({
      name: 'openai-responses',
      apiKey: 'test',
      config: { model: 'gpt-5.4-mini' },
      options: { fetch: fetchFn },
    });
    const gen = new AxGen('question:string -> answer:string', {
      promptCacheRetention: '24h',
    });
    await gen.forward(service, { question: 'q' }, { stream: false });
    await gen.forward(
      service,
      { question: 'q' },
      { stream: false, promptCacheRetention: 'in_memory' }
    );
    expect(bodies.map((body) => body.prompt_cache_retention)).toEqual([
      '24h',
      'in_memory',
    ]);
  });

  it('routes a chat through a per-call corsProxy, else the service one', async () => {
    const { fetchFn, urls } = recordingFetch();
    const service = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model: 'gpt-5.4-mini' },
      options: { fetch: fetchFn, corsProxy: 'https://service.proxy/p' },
    });
    const request = { chatPrompt: [{ role: 'user' as const, content: 'hi' }] };
    await service.chat(request, { stream: false });
    await service.chat(request, {
      stream: false,
      corsProxy: 'https://call.proxy/p',
    });
    expect(urls.map((url) => new URL(url).origin)).toEqual([
      'https://service.proxy',
      'https://call.proxy',
    ]);
  });

  it('sends a chat through a per-call fetch, else the service one', async () => {
    const service = recordingFetch();
    const call = recordingFetch();
    const provider = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model: 'gpt-5.4-mini' },
      options: { fetch: service.fetchFn },
    });
    const request = { chatPrompt: [{ role: 'user' as const, content: 'hi' }] };
    await provider.chat(request, { stream: false });
    await provider.chat(request, { stream: false, fetch: call.fetchFn });
    expect([service.urls.length, call.urls.length]).toEqual([1, 1]);
  });

  it('times a chat out with a per-call timeout', async () => {
    // The request never answers; only an abort ends it.
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason ?? new Error('aborted'))
        );
      })) as typeof fetch;
    const provider = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model: 'gpt-5.4-mini' },
      options: { fetch: hanging },
    });
    await expect(
      provider.chat(
        { chatPrompt: [{ role: 'user', content: 'hi' }] },
        { stream: false, timeout: 20, retry: { maxRetries: 0 } }
      )
    ).rejects.toThrow();
  }, 2000);

  it('routes an AxGen forward through the constructor corsProxy', async () => {
    const { fetchFn, urls } = recordingFetch();
    const service = ai({
      name: 'openai',
      apiKey: 'test',
      config: { model: 'gpt-5.4-mini' },
      options: { fetch: fetchFn },
    });
    const gen = new AxGen('question:string -> answer:string', {
      corsProxy: 'https://constructor.proxy/p',
    });
    await gen.forward(service, { question: 'q' }, { stream: false });
    expect(new URL(urls[0]!).origin).toBe('https://constructor.proxy');
  });
});
