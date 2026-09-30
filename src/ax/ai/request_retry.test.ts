import { describe, expect, it } from 'vitest';
import {
  AxAIServiceAuthenticationError,
  AxAIServiceNetworkError,
  AxAIServiceStatusError,
} from '../util/apicall.js';
import { AxAIOpenAIModel } from './openai/chat_types.js';
import { ai } from './wrap.js';

// Which failed requests apiCall's request layer sends again, streaming or
// not. The generated ports pin the same counts with scripted transports.

const chatBody = {
  id: 'chatcmpl_retry',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-5.4-mini',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const streamBody = [
  `data: ${JSON.stringify({ ...chatBody, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`,
  'data: [DONE]\n\n',
].join('');

const embedBody = {
  object: 'list',
  data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
  model: 'text-embedding-3-small',
  usage: { prompt_tokens: 1, total_tokens: 1 },
};

type Reply = number | 'ok' | 'network';

// A fetch that answers each request with the next scripted reply: a status
// with a JSON error body, the success body, or a failed fetch.
const scripted = (replies: Reply[], ok: () => Response) => {
  let requests = 0;
  const fetch = (async () => {
    const reply = replies[Math.min(requests, replies.length - 1)];
    requests++;
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply === 'ok') return ok();
    return new Response(
      JSON.stringify({ error: { message: `status ${reply}`, type: 'error' } }),
      { status: reply, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof globalThis.fetch;
  return { fetch, requests: () => requests };
};

const jsonOk = (body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const streamOk = () =>
  new Response(streamBody, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const service = (
  fetch: typeof globalThis.fetch,
  retry: { maxRetries: number } = { maxRetries: 2 }
) =>
  ai({
    name: 'openai',
    apiKey: 'test',
    config: { model: AxAIOpenAIModel.GPT54Mini },
    options: {
      fetch,
      retry: { ...retry, initialDelayMs: 1, maxDelayMs: 2 },
    },
  });

const chatPrompt = [{ role: 'user' as const, content: 'hi' }];

const drain = async (stream: unknown) => {
  const reader = (stream as ReadableStream<unknown>).getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
};

describe("apiCall's request-layer retry", () => {
  it('sends a non-streaming chat again for each retryable status', async () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      const { fetch, requests } = scripted(
        [status, status, 'ok'],
        jsonOk(chatBody)
      );
      const response = await service(fetch).chat(
        { chatPrompt },
        { stream: false }
      );
      expect(response).toMatchObject({ results: [{ content: 'ok' }] });
      // maxRetries 2: the first request and two retries.
      expect(requests()).toBe(3);
    }
  });

  it('surfaces a retryable status once maxRetries is spent', async () => {
    const { fetch, requests } = scripted([503], jsonOk(chatBody));
    const error = await service(fetch)
      .chat({ chatPrompt }, { stream: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceStatusError);
    expect(requests()).toBe(3);
  });

  it('does not send other statuses again', async () => {
    for (const status of [400, 404, 422, 501]) {
      const { fetch, requests } = scripted([status, 'ok'], jsonOk(chatBody));
      const error = await service(fetch)
        .chat({ chatPrompt }, { stream: false })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AxAIServiceStatusError);
      expect(requests()).toBe(1);
    }
    const { fetch, requests } = scripted([401, 'ok'], jsonOk(chatBody));
    const error = await service(fetch)
      .chat({ chatPrompt }, { stream: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceAuthenticationError);
    expect(requests()).toBe(1);
  });

  it('sends a non-streaming chat again after a network error', async () => {
    const { fetch, requests } = scripted(['network', 'ok'], jsonOk(chatBody));
    await service(fetch).chat({ chatPrompt }, { stream: false });
    expect(requests()).toBe(2);
    const exhausted = scripted(['network'], jsonOk(chatBody));
    const error = await service(exhausted.fetch)
      .chat({ chatPrompt }, { stream: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceNetworkError);
    expect(exhausted.requests()).toBe(3);
  });

  it('opens a stream again for a retryable status', async () => {
    const { fetch, requests } = scripted([503, 'ok'], streamOk);
    await drain(await service(fetch).chat({ chatPrompt }, { stream: true }));
    expect(requests()).toBe(2);
  });

  it('sends an embed again for a retryable status', async () => {
    const { fetch, requests } = scripted([503, 'ok'], jsonOk(embedBody));
    await service(fetch).embed({ texts: ['hi'] });
    expect(requests()).toBe(2);
  });

  it("uses the call's retry options over the client's", async () => {
    const { fetch, requests } = scripted([503], jsonOk(chatBody));
    await service(fetch, { maxRetries: 0 })
      .chat(
        { chatPrompt },
        { stream: false, retry: { maxRetries: 1, initialDelayMs: 1 } }
      )
      .catch(() => {});
    expect(requests()).toBe(2);
  });

  it('does not open a stream again when its first event fails to read', async () => {
    let requests = 0;
    const fetch = (async () => {
      requests++;
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new TypeError('terminated'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      );
    }) as typeof globalThis.fetch;
    const error = await (async () =>
      drain(
        await service(fetch).chat({ chatPrompt }, { stream: true })
      ))().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AxAIServiceNetworkError);
    expect(requests).toBe(1);
  });
});
