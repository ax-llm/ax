// cspell:ignore noul jev systemone
import { describe, expect, it, vi } from 'vitest';
import {
  AxAIServiceAbortedError,
  AxAIServiceAuthenticationError,
  AxAIServiceTimeoutError,
} from '../../util/apicall.js';
import { typesafe } from './client.js';
import type { AxAITypesafeQuestions, AxAITypesafeRequest } from './types.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const questions = {
  urgent: {
    type: 'noul',
    instructions: { task: 'Is this urgent?' },
    criteria: { true: ['Core task blocked'], false: null },
  },
  team: {
    type: 'choice',
    instructions: null,
    criteria: { support: { covers: ['Help'] }, engineering: null },
  },
  severity: {
    type: 'score',
    criteria: [null, { description: 'Some impact' }, ['Core task blocked']],
  },
} as const satisfies AxAITypesafeQuestions;
const answers = {
  urgent: { type: 'noul', noul: 0.7 },
  team: {
    type: 'choice',
    choice: 'engineering',
    confidence: 0.8,
    probabilities: { support: 0.1, engineering: 0.9 },
  },
  severity: {
    type: 'score',
    score: 1.3,
    confidence: 0.6,
    probabilities: { 0: 0.2, 1: 0.3, 2: 0.5 },
    legend: {
      0: null,
      1: { description: 'Some impact' },
      2: ['Core task blocked'],
    },
  },
};
const response = (value: unknown = answers) => ({
  model: 'jev-latest',
  answers: value,
  usage: { input_tokens: 20, output_tokens: 5 },
});

describe('Typesafe native client', () => {
  it('preserves structured state, criteria and raw answers for all primitives', async () => {
    const fetch = vi.fn(async () => json(response()));
    const client = typesafe({ apiKey: 'key', options: { fetch } });
    const state = {
      ticket: { id: 123, text: 'Checkout fails' },
      events: [true, null, 2],
    };
    const result = await client.systemOne({ state, questions });
    expect(result).toEqual(response());
    expect(result.answers.urgent.noul).toBe(0.7);
    expect(result.answers.severity.score).toBe(1.3);
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'jev-latest',
      state,
      questions,
    });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer key');
  });

  it.each([
    { state: 'text' },
    { state: null },
    { state: ['ticket', { impact: true }] },
  ])('accepts native state %j', async ({ state }) => {
    const client = typesafe({
      apiKey: 'key',
      options: { fetch: async () => json(response()) },
    });
    expect((await client.systemOne({ state, questions })).answers).toEqual(
      answers
    );
  });

  it('resolves defaults and per-call model, transport options and headers', async () => {
    const defaultFetch = vi.fn();
    const fetch = vi.fn(async () => json(response()));
    const client = typesafe({
      apiKey: 'key',
      apiURL: 'https://proxy.test/api/',
      model: 'custom-model',
      headers: { 'X-Test': 'yes' },
      options: { fetch: defaultFetch },
    });
    await client.systemOne({ state: null, questions }, { fetch });
    await client.systemOne(
      { state: null, questions, model: 'override-model' },
      { fetch }
    );
    const calls = fetch.mock.calls as unknown as [URL, RequestInit][];
    expect(
      calls.map(([, init]) => JSON.parse(init.body as string).model)
    ).toEqual(['custom-model', 'override-model']);
    expect(String(calls[0]![0])).toBe('https://proxy.test/api/v1/systemone');
    expect(new Headers(calls[0]![1].headers).get('X-Test')).toBe('yes');
    expect(defaultFetch).not.toHaveBeenCalled();
  });

  it('lists the native model catalog using GET without a body and fresh credentials', async () => {
    const models = [
      { name: 'jev-latest', description: 'Latest', release_date: '2026-01-01' },
    ];
    const credentialProvider = vi.fn(async () => ({
      Authorization: 'Bearer fresh',
    }));
    const fetch = vi.fn(async () => json({ models }));
    const client = typesafe({ credentialProvider, options: { fetch } });
    expect(await client.listModels()).toEqual(models);
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe('https://api.typesafe.ai/v1/models');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(credentialProvider).toHaveBeenCalledWith({
      profile: 'typesafe',
      operation: 'models',
      method: 'GET',
      url: String(url),
    });
  });

  it.each([{}, { models: {} }, { models: [{ name: 'broken' }] }])(
    'rejects malformed model catalogs %j',
    async (body) => {
      const client = typesafe({
        apiKey: 'key',
        options: { fetch: async () => json(body) },
      });
      await expect(client.listModels()).rejects.toThrow('Typesafe:');
    }
  );

  it.each([
    { state: 1, questions },
    { state: { invalid: Number.NaN }, questions },
    { state: null, questions: {} },
    { state: null, questions: { q: { type: 'score', criteria: ['one'] } } },
    {
      state: null,
      questions: { q: { type: 'score', criteria: Array(11).fill(null) } },
    },
    { state: null, questions: { q: { type: 'choice', criteria: {} } } },
    {
      state: null,
      questions: {
        q: {
          type: 'choice',
          criteria: Object.fromEntries(
            Array.from({ length: 256 }, (_, i) => [String(i), null])
          ),
        },
      },
    },
    {
      state: null,
      questions: { q: { type: 'noul', criteria: { maybe: null } } },
    },
    { state: null, questions: { q: { type: 'other' } } },
    { state: null, questions, model: '' },
  ])(
    'validates invalid native request %# before credentials or network access',
    async (request) => {
      const fetch = vi.fn();
      const credentialProvider = vi.fn();
      const client = typesafe({ credentialProvider, options: { fetch } });
      await expect(
        client.systemOne(request as unknown as AxAITypesafeRequest)
      ).rejects.toThrow('Typesafe:');
      expect(fetch).not.toHaveBeenCalled();
      expect(credentialProvider).not.toHaveBeenCalled();
    }
  );

  it('accepts the exact Choice and Score size limits', async () => {
    const criteria = Object.fromEntries(
      Array.from({ length: 255 }, (_, i) => [String(i), null])
    );
    const probabilities = Object.fromEntries(
      Object.keys(criteria).map((key) => [key, key === '0' ? 1 : 0])
    );
    const rubric = Array.from({ length: 10 }, (_, i) => `Level ${i}`) as [
      string,
      string,
      ...string[],
    ];
    const fetch = vi.fn(async () =>
      json(
        response({
          choice: { type: 'choice', choice: '0', confidence: 1, probabilities },
          score: {
            type: 'score',
            score: 0,
            confidence: 1,
            probabilities: Object.fromEntries(
              rubric.map((_, i) => [i, i === 0 ? 1 : 0])
            ),
            legend: Object.fromEntries(rubric.map((value, i) => [i, value])),
          },
        })
      )
    );
    const client = typesafe({ apiKey: 'key', options: { fetch } });
    await client.systemOne({
      state: null,
      questions: {
        choice: { type: 'choice', criteria },
        score: { type: 'score', criteria: rubric },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { ...answers, urgent: { type: 'noul', noul: 2 } },
    { ...answers, team: { ...answers.team, choice: 'unknown' } },
    { ...answers, team: { ...answers.team, confidence: -1 } },
    { ...answers, severity: { ...answers.severity, score: 3 } },
    { ...answers, severity: { ...answers.severity, probabilities: { 0: 1 } } },
    {
      ...answers,
      severity: { ...answers.severity, probabilities: { 0: 0, 1: 0, 2: 0 } },
    },
    { ...answers, severity: { ...answers.severity, legend: {} } },
  ])('rejects malformed native answers %#', async (value) => {
    const client = typesafe({
      apiKey: 'key',
      options: { fetch: async () => json(response(value)) },
    });
    await expect(client.systemOne({ state: null, questions })).rejects.toThrow(
      'Typesafe:'
    );
  });

  it('keeps concurrent responses and caller mutations separate', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      if (body.questions.first)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return json(response({ second: { type: 'noul', noul: 0.1 } }));
    });
    const client = typesafe({ apiKey: 'key', options: { fetch } });
    const request: AxAITypesafeRequest = {
      state: null,
      questions: { first: { type: 'noul' } },
    };
    const first = client.systemOne(request);
    await vi.waitFor(() => expect(release).toBeDefined());
    (request.questions as Record<string, unknown>).first = {
      type: 'score',
      criteria: ['low', 'high'],
    };
    const second = await client.systemOne({
      state: null,
      questions: { second: { type: 'noul' } },
    });
    release!(json(response({ first: { type: 'noul', noul: 0.9 } })));
    expect((await first).answers.first).toEqual({ type: 'noul', noul: 0.9 });
    expect(second.answers.second.noul).toBe(0.1);
  });

  it('retries with fresh credentials and propagates authentication failures', async () => {
    const credentialProvider = vi.fn(async () => ({
      Authorization: `Bearer token-${credentialProvider.mock.calls.length}`,
    }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'busy' }, 529))
      .mockResolvedValueOnce(json(response()));
    const client = typesafe({
      credentialProvider,
      options: { fetch, retry: { maxRetries: 1, initialDelayMs: 1 } },
    });
    await client.systemOne({ state: null, questions });
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init.headers).get('authorization')
      )
    ).toEqual(['Bearer token-1', 'Bearer token-2']);
    await expect(
      client.systemOne(
        { state: null, questions },
        { fetch: async () => json({}, 401) }
      )
    ).rejects.toBeInstanceOf(AxAIServiceAuthenticationError);
  });

  it('propagates cancellation and timeouts', async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true }
          );
        })
    );
    const client = typesafe({
      apiKey: 'key',
      options: { fetch, retry: { maxRetries: 0 } },
    });
    const controller = new AbortController();
    const pending = expect(
      client.systemOne(
        { state: null, questions },
        { abortSignal: controller.signal }
      )
    ).rejects.toBeInstanceOf(AxAIServiceAbortedError);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort('User cancelled');
    await pending;
    await expect(client.listModels({ timeout: 5 })).rejects.toBeInstanceOf(
      AxAIServiceTimeoutError
    );
  });

  it.each(['client', 'request'] as const)(
    'honors %s cancellation when both signals are supplied',
    async (source) => {
      const clientController = new AbortController();
      const requestController = new AbortController();
      let signal: AbortSignal | undefined;
      let finish: (() => void) | undefined;
      const fetch = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            signal = init!.signal!;
            finish = () => resolve(json(response()));
            signal.addEventListener('abort', () => reject(signal!.reason), {
              once: true,
            });
          })
      );
      const client = typesafe({
        apiKey: 'key',
        options: { fetch, abortSignal: clientController.signal },
      });
      const pending = client.systemOne(
        { state: null, questions },
        { abortSignal: requestController.signal }
      );
      // Observe immediately so cancellation cannot produce an unhandled rejection.
      const outcome = pending.catch((error: unknown) => error);
      await vi.waitFor(() => expect(signal).toBeDefined());
      const controller =
        source === 'client' ? clientController : requestController;
      controller.abort('Cancelled');
      // Settle even a broken implementation, keeping this regression test bounded.
      finish!();
      expect(await outcome).toBeInstanceOf(AxAIServiceAbortedError);
      expect(signal!.aborted).toBe(true);
    }
  );
});
