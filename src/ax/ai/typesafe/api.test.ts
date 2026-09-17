// cspell:ignore noul jev systemone
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axGlobals } from '../../dsp/globals.js';
import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import {
  AxAIServiceAbortedError,
  AxAIServiceAuthenticationError,
} from '../../util/apicall.js';
import { axGetSupportedAIModels } from '../catalog.js';
import { AxMockAIService } from '../mock/api.js';
import { axGetAIProfile } from '../provider_profiles.js';
import type { AxChatRequest, AxChatResponse } from '../types.js';
import { ai } from '../wrap.js';

const result = (answers: Record<string, unknown>) => ({
  model: 'jev-latest',
  answers,
  usage: { input_tokens: 20, output_tokens: 3 },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-typesafe-request-id': 'ts-request-1',
    },
  });
const request = (properties: Record<string, unknown>): AxChatRequest => ({
  chatPrompt: [{ role: 'user', content: 'Customer cannot log in.' }],
  responseFormat: {
    type: 'json_schema',
    schema: {
      name: 'output',
      schema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
  },
});
const flag = { type: 'boolean' };
describe('Typesafe signature adapter', () => {
  afterEach(() => {
    axGlobals.onUsage = undefined;
  });
  it('uses System One directly from an ordinary scalar Ax signature', async () => {
    const fetch = vi.fn(async () =>
      json(
        result({
          urgent: { type: 'noul', noul: 0.9 },
          team: {
            type: 'choice',
            choice: 'support',
            confidence: 0.8,
            probabilities: { support: 0.8, billing: 0.2 },
          },
        })
      )
    );
    const usageObserver = vi.fn();
    axGlobals.onUsage = usageObserver;
    const llm = ai({
      name: 'typesafe',
      apiKey: 'test-key',
      options: { fetch },
    });
    const gen = ax(
      'ticket:string -> urgent:boolean, team:class "support, billing"'
    );
    const output = await gen.forward(llm, {
      ticket: 'Customer cannot log in.',
    });
    expect(output).toEqual({ urgent: true, team: 'support' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer test-key'
    );
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.questions).toMatchObject({
      urgent: { type: 'noul' },
      team: { type: 'choice', criteria: { support: null, billing: null } },
    });
    expect(JSON.stringify(body.state)).toContain('Customer cannot log in.');
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('stream');
    expect(
      gen.getChatLog().at(-1)?.providerMetadata?.typesafe?.answers
    ).toMatchObject({
      urgent: { type: 'noul', noul: 0.9 },
    });
    expect(usageObserver).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: { promptTokens: 20, completionTokens: 3, totalTokens: 23 },
        remoteRequestId: 'ts-request-1',
      })
    );
    expect(llm.getFeatures()).toMatchObject({
      streaming: false,
      functions: false,
      functionEmulation: false,
      requiresStructuredOutput: true,
    });
  });

  it('preserves raw probabilities and supports custom thresholds, endpoints and model aliases', async () => {
    const fetch = vi.fn(async () =>
      json(result({ urgent: { type: 'noul', noul: 0.7 } }))
    );
    const llm = ai({
      name: 'typesafe',
      apiKey: 'key',
      trueThreshold: 0.8,
      apiURL: 'https://typesafe.test',
      models: [{ key: 'fast', model: 'jev-latest' }],
      options: { fetch },
    });
    const response = (await llm.chat({
      ...request({ urgent: flag }),
      model: 'fast',
    })) as AxChatResponse;
    expect(JSON.parse(response.results[0]!.content!)).toEqual({
      urgent: false,
    });
    expect(response.providerMetadata?.typesafe?.answers).toEqual({
      urgent: { type: 'noul', noul: 0.7 },
    });
    expect(response.remoteRequestId).toBe('ts-request-1');
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://typesafe.test/v1/systemone'
    );
  });

  it('delivers a completed streamingForward result without changing later generative calls', async () => {
    const fetch = vi.fn(async () =>
      json(result({ urgent: { type: 'noul', noul: 0.5 } }))
    );
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    const gen = ax('ticket:string -> urgent:boolean');
    const deltas = [];
    for await (const delta of gen.streamingForward(llm, { ticket: 'Help' }))
      deltas.push(delta);
    expect(deltas.at(-1)?.delta).toEqual({ urgent: true });
    const mock = new AxMockAIService({
      features: { functions: true, streaming: false },
    });
    mock.chat = async (req) => {
      expect(req.responseFormat).toBeUndefined();
      return { results: [{ index: 0, content: 'Urgent: false' }] };
    };
    expect(await gen.forward(mock, { ticket: 'Help' })).toEqual({
      urgent: false,
    });
  });

  it('rejects prompt tool emulation before modifying the signature or sending a request', async () => {
    const fetch = vi.fn();
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    const gen = ax('ticket:string -> urgent:boolean', {
      functions: [
        {
          name: 'lookup',
          description: 'Look up a ticket',
          func: async () => 'Found',
        },
      ],
    });
    await expect(gen.forward(llm, { ticket: 'Help' })).rejects.toThrow(
      'does not support tools'
    );
    expect(
      gen
        .getSignature()
        .getOutputFields()
        .map((field) => field.name)
    ).toEqual(['urgent']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown choices instead of accepting an invalid enum value', async () => {
    const fetch = vi.fn(async () =>
      json(
        result({
          team: {
            type: 'choice',
            choice: 'other',
            confidence: 0.8,
            probabilities: { support: 0.8, billing: 0.2 },
          },
        })
      )
    );
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    await expect(
      llm.chat(
        request({ team: { type: 'string', enum: ['support', 'billing'] } })
      )
    ).rejects.toThrow('unknown choice');
  });

  it('keeps concurrent request schemas separate when responses arrive out of order', async () => {
    let release: ((value: Response) => void) | undefined;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      if (body.questions.first)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return json(result({ second: { type: 'noul', noul: 0.1 } }));
    });
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    const first = llm.chat(request({ first: flag }));
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = (await llm.chat(
      request({ second: flag })
    )) as AxChatResponse;
    release!(json(result({ first: { type: 'noul', noul: 0.9 } })));
    expect(
      JSON.parse(((await first) as AxChatResponse).results[0]!.content!)
    ).toEqual({ first: true });
    expect(JSON.parse(second.results[0]!.content!)).toEqual({ second: false });
  });

  it.each([
    { type: 'string' },
    { type: 'number' },
    { type: 'number', minimum: 1, maximum: 5 },
    { type: 'integer', minimum: 1, maximum: 5 },
    { type: 'array', items: { type: 'boolean' } },
    { type: 'object', properties: {} },
    { type: ['boolean', 'null'] },
    { type: 'boolean', enum: [true] },
  ])(
    'rejects unsupported output schemas before transport: %j',
    async (field) => {
      const fetch = vi.fn();
      const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
      await expect(llm.chat(request({ answer: field }))).rejects.toThrow(
        'Typesafe cannot evaluate'
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('rejects freeform and optional Ax outputs, tools, media and plain chat before transport', async () => {
    const fetch = vi.fn();
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    await expect(
      ax('ticket:string -> summary:string').forward(llm, { ticket: 'Help' })
    ).rejects.toThrow('Typesafe cannot evaluate');
    await expect(
      ax(
        f()
          .input('ticket', f.string())
          .output('urgent', f.boolean().optional())
          .build()
      ).forward(llm, { ticket: 'Help' })
    ).rejects.toThrow('Typesafe cannot evaluate');
    await expect(
      llm.chat({ chatPrompt: [{ role: 'user', content: 'Hi' }] })
    ).rejects.toThrow('requires an output schema');
    await expect(
      llm.chat({
        ...request({ urgent: flag }),
        functions: [{ name: 'lookup', description: 'Look up' }],
      })
    ).rejects.toThrow('does not support tools');
    await expect(
      llm.chat({
        ...request({ urgent: flag }),
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'image', image: 'aGVsbG8=', mimeType: 'image/png' },
            ],
          },
        ],
      })
    ).rejects.toThrow('text input only');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { urgent: { type: 'choice', choice: 'yes' } },
    { urgent: { type: 'noul', noul: 2 } },
    { urgent: { type: 'noul', noul: 'true' } },
  ])('rejects malformed boolean responses: %j', async (answers) => {
    const llm = ai({
      name: 'typesafe',
      apiKey: 'key',
      options: { fetch: async () => json(result(answers)) },
    });
    await expect(llm.chat(request({ urgent: flag }))).rejects.toThrow(
      'Typesafe:'
    );
  });

  it('retries transient errors with refreshed credentials and exposes authentication failures', async () => {
    const credentials = vi.fn(async () => ({
      Authorization: `Bearer token-${credentials.mock.calls.length}`,
    }));
    const headers: string[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get('authorization')!);
      return headers.length === 1
        ? json({ error: 'busy' }, 503)
        : json(result({ urgent: { type: 'noul', noul: 0.6 } }));
    });
    const llm = ai({
      name: 'typesafe',
      credentialProvider: credentials,
      options: { fetch, retry: { maxRetries: 1, initialDelayMs: 1 } },
    });
    await llm.chat(request({ urgent: flag }));
    expect(headers).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(credentials).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'typesafe', operation: 'chat' })
    );
    llm.setOptions({ fetch: async () => json({ error: 'unauthorized' }, 401) });
    await expect(llm.chat(request({ urgent: flag }))).rejects.toBeInstanceOf(
      AxAIServiceAuthenticationError
    );
  });

  it('propagates cancellation to the in-flight request', async () => {
    const controller = new AbortController();
    let reachedFetch = false;
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          reachedFetch = true;
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true }
          );
        })
    );
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    const pending = expect(
      llm.chat(request({ urgent: flag }), { abortSignal: controller.signal })
    ).rejects.toBeInstanceOf(AxAIServiceAbortedError);
    await vi.waitFor(() => expect(reachedFetch).toBe(true));
    controller.abort();
    await pending;
  });

  it('publishes truthful capabilities and validates configuration', () => {
    expect(axGetAIProfile('typesafe')).toMatchObject({
      transport: 'typesafe-system-one',
      defaultModel: 'jev-latest',
      capabilities: { streaming: false, functions: false },
    });
    expect(
      axGetSupportedAIModels().find((provider) => provider.name === 'typesafe')
    ).toBeDefined();
    expect(() => ai({ name: 'typesafe' })).toThrow('requires apiKey');
    expect(() =>
      ai({ name: 'typesafe', apiKey: 'key', trueThreshold: -1 })
    ).toThrow('invalid probability');
  });
  it.each([
    [undefined, 0.5, true],
    [undefined, 0.49, false],
    [0.9, 0.9, true],
    [0.9, 0.89, false],
    [0, 0, true],
    [1, 1, true],
    [1, 0.99, false],
  ] as const)(
    'converts at threshold %s for probability %s',
    async (trueThreshold, noul, expected) => {
      const fetch = vi.fn(async () =>
        json(result({ urgent: { type: 'noul', noul } }))
      );
      const llm = ai({
        name: 'typesafe',
        apiKey: 'key',
        trueThreshold,
        options: { fetch },
      });
      const response = (await llm.chat(
        request({ urgent: flag })
      )) as AxChatResponse;
      expect(JSON.parse(response.results[0]!.content!)).toEqual({
        urgent: expected,
      });
      const body = JSON.parse(
        (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
          .body as string
      );
      expect(body).not.toHaveProperty('trueThreshold');
    }
  );

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.01,
    1.01,
  ])('rejects invalid threshold %s', (trueThreshold) => {
    expect(() =>
      ai({ name: 'typesafe', apiKey: 'key', trueThreshold })
    ).toThrow('invalid probability');
  });

  it('keeps independent thresholds and preserves field descriptions', async () => {
    const fetch = vi.fn(async () =>
      json(result({ urgent: { type: 'noul', noul: 0.7 } }))
    );
    const normal = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    const strict = ai({
      name: 'typesafe',
      apiKey: 'key',
      trueThreshold: 0.9,
      options: { fetch },
    });
    const req = request({
      urgent: {
        type: 'boolean',
        description: 'Customers cannot complete a core task',
      },
    });
    const responses = (await Promise.all([
      normal.chat(req),
      strict.chat(req),
    ])) as AxChatResponse[];
    expect(
      responses.map((res) => JSON.parse(res.results[0]!.content!).urgent)
    ).toEqual([true, false]);
    const body = JSON.parse(
      (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
        .body as string
    );
    expect(body.questions.urgent.instructions).toBe(
      'urgent: Customers cannot complete a core task'
    );
  });

  it.each([
    { temperature: 0 },
    { maxTokens: 100 },
    { topP: 0.8 },
    { topK: 2 },
    { effort: 'high' as const },
    { stopSequences: ['stop'] },
    { n: 2 },
  ])(
    'rejects unsupported generation controls %j before transport',
    async (modelConfig) => {
      const fetch = vi.fn();
      const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
      await expect(
        llm.chat({ ...request({ urgent: flag }), modelConfig })
      ).rejects.toThrow('Typesafe does not support');
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('rejects oversized class schemas before transport', async () => {
    const fetch = vi.fn();
    const llm = ai({ name: 'typesafe', apiKey: 'key', options: { fetch } });
    await expect(
      llm.chat(
        request({
          team: {
            type: 'string',
            enum: Array.from({ length: 256 }, (_, i) => String(i)),
          },
        })
      )
    ).rejects.toThrow('1–255');
    expect(fetch).not.toHaveBeenCalled();
  });
});
