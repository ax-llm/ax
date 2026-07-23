import { ReadableStream } from 'node:stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { axGlobals } from '../dsp/globals.js';
import type { AxBaseAIArgs } from './base.js';
import { AxBaseAI } from './base.js';
import type {
  AxAIServiceImpl,
  AxEmbedResponse,
  AxModelInfo,
  AxUsageEvent,
} from './types.js';

const usage = {
  promptTokens: 12,
  completionTokens: 8,
  totalTokens: 20,
  thoughtsTokens: 3,
  cacheReadTokens: 2,
} as const;

const config: AxBaseAIArgs<string, string> = {
  name: 'usage-test-ai',
  apiURL: 'https://example.test',
  headers: async () => ({}),
  modelInfo: [{ name: 'usage-test-model' } as AxModelInfo],
  defaults: {
    model: 'usage-test-model',
    embedModel: 'usage-test-embed-model',
  },
  supportFor: {
    functions: false,
    streaming: true,
  },
};

function createService({
  stream = false,
  includeUsage = true,
}: {
  stream?: boolean;
  includeUsage?: boolean;
} = {}) {
  const modelUsage = includeUsage
    ? {
        ai: 'usage-test-ai',
        model: 'usage-test-model',
        tokens: usage,
      }
    : undefined;

  const impl: AxAIServiceImpl<
    string,
    string,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  > = {
    createChatReq: () => [{ name: 'chat', headers: {} }, {}],
    createChatResp: () => ({
      results: [{ index: 0, content: 'ok' }],
      remoteId: 'response-1',
      remoteSessionId: 'provider-session-1',
      modelUsage,
    }),
    createChatStreamResp: () => ({
      results: [{ index: 0, content: 'ok' }],
      remoteId: 'response-stream-1',
      modelUsage,
    }),
    createEmbedReq: () => [{ name: 'embed', headers: {} }, {}],
    createEmbedResp: () => ({
      embeddings: [[1, 2, 3]],
      remoteId: 'embed-1',
      modelUsage: includeUsage
        ? {
            ai: 'usage-test-ai',
            model: 'usage-test-embed-model',
            tokens: usage,
          }
        : undefined,
    }),
    getModelConfig: () => ({
      maxTokens: 100,
      temperature: 0,
      stream,
    }),
    getTokenUsage: () => undefined,
  };

  const ai = new AxBaseAI(impl, config);
  const fetch = stream
    ? vi.fn().mockImplementation(
        async () =>
          new Response('data: {"delta":"ok"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
      )
    : vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'provider-request-1',
            },
          })
      );

  ai.setOptions({
    fetch,
    usageContext: {
      tenantId: 'tenant-default',
      feature: 'assistant',
      attributes: { environment: 'test', tier: 1 },
    },
  });
  return ai;
}

afterEach(() => {
  axGlobals.onUsage = undefined;
});

describe('global usage observer', () => {
  it('emits an immutable attributed chat event once', async () => {
    const events: Readonly<AxUsageEvent>[] = [];
    axGlobals.onUsage = (event) => events.push(event);
    const ai = createService();

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      {
        stream: false,
        sessionId: 'local-session-1',
        usageContext: {
          tenantId: 'tenant-call',
          userId: 'user-1',
          requestId: 'request-1',
          runId: 'run-1',
          attributes: { tier: 2, route: 'chat' },
        },
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      operation: 'chat',
      ai: 'usage-test-ai',
      model: 'usage-test-model',
      tokens: usage,
      context: {
        tenantId: 'tenant-call',
        userId: 'user-1',
        requestId: 'request-1',
        runId: 'run-1',
        feature: 'assistant',
        attributes: {
          environment: 'test',
          tier: 2,
          route: 'chat',
        },
      },
      sessionId: 'local-session-1',
      remoteId: 'response-1',
      remoteRequestId: 'provider-request-1',
      remoteSessionId: 'provider-session-1',
      streaming: false,
    });
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]?.tokens)).toBe(true);
    expect(Object.isFrozen(events[0]?.context?.attributes)).toBe(true);
  });

  it('emits embedding and fully-consumed streaming usage once each', async () => {
    const events: Readonly<AxUsageEvent>[] = [];
    axGlobals.onUsage = (event) => events.push(event);

    const embedAI = createService();
    await embedAI.embed(
      { texts: ['hello'] },
      { usageContext: { requestId: 'embed-request' } }
    );

    const streamAI = createService({ stream: true });
    const response = await streamAI.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      {
        stream: true,
        usageContext: { requestId: 'stream-request' },
      }
    );
    expect(response).toBeInstanceOf(ReadableStream);
    if (response instanceof ReadableStream) {
      const reader = response.getReader();
      while (!(await reader.read()).done) {}
    }

    expect(
      events.map(({ operation, streaming, context }) => ({
        operation,
        streaming,
        requestId: context?.requestId,
      }))
    ).toEqual([
      {
        operation: 'embed',
        streaming: false,
        requestId: 'embed-request',
      },
      {
        operation: 'chat',
        streaming: true,
        requestId: 'stream-request',
      },
    ]);
  });

  it('does not emit without provider usage', async () => {
    const observer = vi.fn();
    axGlobals.onUsage = observer;
    const ai = createService({ includeUsage: false });

    await ai.chat(
      { chatPrompt: [{ role: 'user', content: 'hello' }] },
      { stream: false }
    );

    expect(observer).not.toHaveBeenCalled();
  });

  it('keeps synchronous and asynchronous observer failures fail-open', async () => {
    const ai = createService();
    axGlobals.onUsage = () => {
      throw new Error('observer failed');
    };

    await expect(
      ai.chat(
        { chatPrompt: [{ role: 'user', content: 'hello' }] },
        { stream: false }
      )
    ).resolves.toMatchObject({ results: [{ content: 'ok' }] });

    axGlobals.onUsage = async () => {
      throw new Error('async observer failed');
    };
    await expect(
      ai.embed({ texts: ['hello'] })
    ).resolves.toMatchObject<AxEmbedResponse>({ embeddings: [[1, 2, 3]] });
  });
});
