import { describe, expect, it, vi } from 'vitest';
import { ax } from '../../dsp/template.js';
import {
  AxAIServiceAbortedError,
  AxAIServiceAuthenticationError,
} from '../../util/apicall.js';
import { AxBalancer } from '../balance.js';
import { axSelectOptimalProvider } from '../capabilities.js';
import { axGetSupportedAIModels } from '../catalog.js';
import { AxMockAIService } from '../mock/api.js';
import type { AxChatRequest, AxChatResponse } from '../types.js';
import { ai } from '../wrap.js';
import { openaiDecisions } from './client.js';
import type {
  AxAIOpenAIDecisionQuestion,
  AxAIOpenAIDecisionsRequest,
} from './types.js';
import { decodeDecisionsResponse } from './validate.js';

const usage = {
  input_tokens: 20,
  output_tokens: 3,
  total_tokens: 23,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
};
const result = (answers: unknown[]) => ({
  model: 'gpt-6-luna',
  answers,
  usage,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'decision-1',
    },
  });
const predicate = {
  name: 'urgent',
  type: 'predicate',
  instructions: 'Does the issue require immediate attention?',
} as const;
const choice = {
  name: 'team',
  type: 'choice',
  instructions: 'Who should handle the issue?',
  choices: [{ value: 'support' }, { value: 'billing' }],
} as const;
const score = {
  name: 'severity',
  type: 'score',
  instructions: 'How severe is the issue?',
  levels: [{ label: 'Minor' }, { label: 'Blocked' }],
} as const;
const pAnswer = { name: 'urgent', type: 'predicate', probability: 0.9 };
const cAnswer = {
  name: 'team',
  type: 'choice',
  choice: 'billing',
  confidence: 0.8,
  probabilities: [
    { value: 'support', probability: 0.2 },
    { value: 'billing', probability: 0.8 },
  ],
};
const sAnswer = {
  name: 'severity',
  type: 'score',
  score: 0.8,
  confidence: 0.7,
  probabilities: [
    { value: 0, label: 'Minor', probability: 0.2 },
    { value: 1, label: 'Blocked', probability: 0.8 },
  ],
};
const request = (
  field: object = { type: 'boolean' },
  required = true
): AxChatRequest => ({
  chatPrompt: [{ role: 'user', content: 'Checkout is broken.' }],
  responseFormat: {
    type: 'json_schema',
    schema: {
      name: 'output',
      schema: {
        type: 'object',
        properties: { urgent: field },
        required: required ? ['urgent'] : [],
        additionalProperties: false,
      },
    },
  },
});

describe('OpenAI Decisions adapter', () => {
  it('runs described boolean/class signatures through the dedicated endpoint with usage and metadata', async () => {
    const fetch = vi.fn(async () => json(result([pAnswer, cAnswer])));
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      trueThreshold: 0.9,
      safetyIdentifier: 'user-1',
      options: { fetch },
    });
    const gen = ax(
      'ticket:string -> urgent:boolean(true "Core task blocked", false "Routine request"), team:class "support, billing"(billing "Invoice problems")'
    );
    expect(await gen.forward(llm, { ticket: 'Checkout is broken.' })).toEqual({
      urgent: true,
      team: 'billing',
    });
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/decisions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer key');
    const body = JSON.parse(init.body as string);
    expect(body.questions[0]).toMatchObject({
      type: 'predicate',
      name: 'urgent',
    });
    expect(body.questions[0].instructions).toContain('true: Core task blocked');
    expect(body.questions[0].instructions).toContain('false: Routine request');
    expect(body.questions[1].choices).toEqual([
      { value: 'support' },
      { value: 'billing', description: 'Invoice problems' },
    ]);
    expect(body.input[0].role).toBe('user');
    expect(JSON.stringify(body.input)).toContain('Checkout is broken.');
    expect(body.safety_identifier).toBe('user-1');
    expect(body).not.toHaveProperty('trueThreshold');
    expect(body).not.toHaveProperty('stream');
    expect(
      gen.getChatLog().at(-1)?.providerMetadata?.openaiDecisions?.answers
    ).toEqual([pAnswer, cAnswer]);
    expect(gen.getUsage().at(-1)?.tokens).toMatchObject({
      promptTokens: 20,
      completionTokens: 3,
      totalTokens: 23,
    });
    expect(llm.getFeatures()).toMatchObject({
      functions: false,
      functionEmulation: false,
      streaming: false,
      requiresStructuredOutput: true,
    });
  });
  it.each([
    [undefined, 0.5, true],
    [undefined, 0.49, false],
    [0.9, 0.9, true],
    [0.9, 0.89, false],
    [0, 0, true],
    [1, 1, true],
  ] as const)(
    'converts predicates with threshold %s and probability %s',
    async (trueThreshold, probability, expected) => {
      const llm = ai({
        name: 'openai-decisions',
        apiKey: 'key',
        trueThreshold,
        options: {
          fetch: async () => json(result([{ ...pAnswer, probability }])),
        },
      });
      expect(
        await ax('ticket:string -> urgent:boolean').forward(llm, {
          ticket: 'Help',
        })
      ).toEqual({ urgent: expected });
    }
  );
  it.each([-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid threshold %s',
    (trueThreshold) => {
      expect(() =>
        ai({ name: 'openai-decisions', apiKey: 'key', trueThreshold })
      ).toThrow('invalid probability');
    }
  );
  it('normalizes full token details and keeps Decisions cache/output prices free', async () => {
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: {
        fetch: async () =>
          json({
            ...result([pAnswer]),
            usage: {
              ...usage,
              input_tokens_details: { cached_tokens: 8, cache_write_tokens: 2 },
            },
          }),
      },
    });
    const response = (await llm.chat(request())) as AxChatResponse;
    expect(response.modelUsage?.tokens).toMatchObject({
      promptTokens: 10,
      cacheReadTokens: 8,
      cacheCreationTokens: 2,
      completionTokens: 3,
      totalTokens: 23,
      reasoningTokens: 0,
    });
    expect(llm.getEstimatedCost(response.modelUsage)).toBeCloseTo(0.000001, 10);
  });
  it('preserves inline image evidence and system/history text in a user message', async () => {
    const fetch = vi.fn(async () => json(result([pAnswer])));
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    await llm.chat({
      ...request(),
      chatPrompt: [
        { role: 'system', content: 'Inspect the product.' },
        { role: 'assistant', content: 'Previous observation.' },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: 'aGVsbG8=',
              mimeType: 'image/png',
              details: 'high',
            },
          ],
        },
      ],
    });
    const body = JSON.parse(
      (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
        .body as string
    );
    expect(body.input[0].content).toContainEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,aGVsbG8=',
      detail: 'high',
    });
    expect(body.input[0].content).toContainEqual({
      type: 'input_text',
      text: 'system:',
    });
    expect(body.input[0].content).toContainEqual({
      type: 'input_text',
      text: 'Previous observation.',
    });
  });
  it('throws on refusal instead of converting it into a false or missing result', async () => {
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: {
        fetch: async () => json(result([{ type: 'refusal', name: 'urgent' }])),
      },
    });
    await expect(llm.chat(request())).rejects.toThrow(
      'refused question "urgent"'
    );
  });
  it('delivers a completed streamingForward result', async () => {
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: { fetch: async () => json(result([pAnswer])) },
    });
    const deltas = [];
    for await (const delta of ax(
      'ticket:string -> urgent:boolean'
    ).streamingForward(llm, { ticket: 'Help' }))
      deltas.push(delta);
    expect(deltas.at(-1)?.delta).toEqual({ urgent: true });
  });
  it.each([
    { type: 'string' },
    { type: 'number', minimum: 0, maximum: 5 },
    { type: 'array', items: { type: 'boolean' } },
    { type: 'object', properties: {} },
    { type: ['boolean', 'null'] },
  ])(
    'rejects unsupported field %j before transport and routing',
    async (field) => {
      const fetch = vi.fn();
      const llm = ai({
        name: 'openai-decisions',
        apiKey: 'key',
        options: { fetch },
      });
      await expect(llm.chat(request(field))).rejects.toThrow('cannot evaluate');
      expect(() =>
        axSelectOptimalProvider(request(field), [llm], {
          allowDegradation: true,
        })
      ).toThrow('No providers support');
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('rejects optional outputs, tools, unsupported controls and bare chat before transport', async () => {
    const fetch = vi.fn();
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    for (const req of [
      request({ type: 'boolean' }, false),
      { chatPrompt: request().chatPrompt },
      { ...request(), functions: [{ name: 'lookup', description: 'Look up' }] },
      { ...request(), modelConfig: { temperature: 0 } },
    ])
      await expect(llm.chat(req)).rejects.toThrow('OpenAI Decisions');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('works in a decision-only balancer and skips incompatible fallback requests', async () => {
    const fetch = vi.fn(async () => json(result([pAnswer])));
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    const balancer = new AxBalancer([llm]);
    expect(
      await ax('ticket:string -> urgent:boolean').forward(balancer, {
        ticket: 'Help',
      })
    ).toEqual({ urgent: true });
    const fallback = new AxMockAIService<string>({
      name: 'generative',
      features: { streaming: false, functions: true },
    });
    expect(
      axSelectOptimalProvider(request({ type: 'string' }), [llm, fallback], {
        allowDegradation: true,
      })
    ).toBe(fallback);
  });
  it('supports endpoint/model aliases and catalog capabilities', async () => {
    const fetch = vi.fn(async () => json(result([pAnswer])));
    const llm = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      apiURL: 'https://gateway.test/v1',
      models: [{ key: 'fast', model: 'gpt-6-luna' }],
      options: { fetch },
    });
    const response = (await llm.chat({
      ...request(),
      model: 'fast',
    })) as AxChatResponse;
    expect(response.remoteRequestId).toBe('decision-1');
    expect(llm.getEstimatedCost(response.modelUsage)).toBeCloseTo(0.000002, 10);
    expect(String((fetch.mock.calls as unknown as [URL][])[0]![0])).toBe(
      'https://gateway.test/v1/decisions'
    );
    expect(
      axGetSupportedAIModels().find((p) => p.name === 'openai-decisions')
    ).toMatchObject({
      defaultModel: 'gpt-6-luna',
      models: [{ name: 'gpt-6-luna' }],
    });
  });
});

describe('native OpenAI Decisions client', () => {
  it('preserves all native answer shapes and refusal results', async () => {
    const answers = [
      pAnswer,
      cAnswer,
      sAnswer,
      { type: 'refusal', name: null },
    ];
    const fetch = vi.fn(async () => json(result(answers)));
    const client = openaiDecisions({ apiKey: 'key' });
    const response = await client.create(
      {
        input: 'Checkout is broken.',
        questions: [
          predicate,
          choice,
          score,
          { type: 'predicate', instructions: 'Is this safe?' },
        ],
      },
      { fetch }
    );
    expect(response).toEqual(result(answers));
  });
  it('distinguishes boolean values from strings and accepts rounded distributions without normalization', async () => {
    const q = {
      type: 'choice',
      instructions: 'Choose',
      choices: [{ value: true }, { value: 'true' }],
    } as const;
    const a = {
      name: null,
      type: 'choice',
      choice: true,
      confidence: 0.5,
      probabilities: [
        { value: 'true', probability: 0.49 },
        { value: true, probability: 0.5 },
      ],
    };
    const client = openaiDecisions({
      apiKey: 'key',
      options: { fetch: async () => json(result([a])) },
    });
    expect(
      (await client.create({ input: '', questions: [q] })).answers[0]
    ).toEqual(a);
  });
  it('preserves valid empty strings in native names, instructions, choice values and score labels', async () => {
    const q = {
      type: 'choice',
      name: '',
      instructions: '',
      choices: [{ value: '' }, { value: 'other' }],
    } as const;
    const answer = {
      type: 'choice',
      name: '',
      choice: '',
      confidence: 0.8,
      probabilities: [
        { value: '', probability: 0.9 },
        { value: 'other', probability: 0.1 },
      ],
    };
    const scoreQuestion = {
      type: 'score',
      instructions: '',
      levels: [{ label: '' }, { label: 'other' }],
    } as const;
    const scoreAnswer = {
      ...sAnswer,
      name: null,
      probabilities: [
        { value: 0, label: '', probability: 0.2 },
        { value: 1, label: 'other', probability: 0.8 },
      ],
    };
    const client = openaiDecisions({
      apiKey: 'key',
      options: { fetch: async () => json(result([answer, scoreAnswer])) },
    });
    expect(
      (await client.create({ input: '', questions: [q, scoreQuestion] }))
        .answers
    ).toEqual([answer, scoreAnswer]);
  });
  it.each([
    { input: [{ role: 'system', content: 'Instructions' }] },
    {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'https://example.com/a.png' },
          ],
        },
      ],
    },
    {
      input: [
        { role: 'user', content: [{ type: 'input_audio', data: 'abc' }] },
      ],
    },
    {
      input: [
        {
          role: 'user',
          content: Array.from({ length: 129 }, () => ({
            type: 'input_image',
            image_url: 'data:image/png;base64,aGVsbG8=',
          })),
        },
      ],
    },
    { questions: [{ ...choice, choices: [{ value: 'only' }] }] },
    {
      questions: [
        {
          ...choice,
          choices: Array.from({ length: 256 }, (_, i) => ({
            value: String(i),
          })),
        },
      ],
    },
    {
      questions: [
        {
          ...score,
          levels: Array.from({ length: 11 }, (_, i) => ({ label: String(i) })),
        },
      ],
    },
    { questions: [] },
    { questions: [predicate, predicate] },
    {
      questions: [
        { ...choice, choices: [{ value: 'same' }, { value: 'same' }] },
      ],
    },
    { questions: [{ ...score, levels: [{ label: 'Only' }] }] },
  ])(
    'rejects unsupported native inputs %# without transport',
    async (patch) => {
      const fetch = vi.fn();
      const client = openaiDecisions({ apiKey: 'key', options: { fetch } });
      await expect(
        client.create({
          input: 'Help',
          questions: [predicate],
          ...patch,
        } as AxAIOpenAIDecisionsRequest)
      ).rejects.toThrow('OpenAI Decisions');
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    [],
    [{ ...pAnswer, name: 'wrong' }],
    [{ ...pAnswer, probability: 2 }],
    [{ ...pAnswer, probability: '0.9' }],
    [{ ...pAnswer, type: 'score' }],
  ])('rejects malformed predicate answers %j', (answers) => {
    expect(() => decodeDecisionsResponse(result(answers), [predicate])).toThrow(
      'OpenAI Decisions'
    );
  });
  it.each([
    { ...cAnswer, choice: 'unknown' },
    {
      ...cAnswer,
      probabilities: [
        { value: 'support', probability: 0.5 },
        { value: 'support', probability: 0.5 },
      ],
    },
    {
      ...cAnswer,
      probabilities: [
        { value: 'support', probability: 0.5 },
        { value: 'billing', probability: 0.1 },
      ],
    },
    { ...cAnswer, confidence: Number.NaN },
  ])('rejects malformed choice answers %#', (answer) => {
    expect(() => decodeDecisionsResponse(result([answer]), [choice])).toThrow(
      'OpenAI Decisions'
    );
  });
  it.each([
    { ...sAnswer, score: 2 },
    {
      ...sAnswer,
      probabilities: [
        { value: 0, label: 'Wrong', probability: 0.2 },
        { value: 1, label: 'Blocked', probability: 0.8 },
      ],
    },
  ])('rejects malformed scores %#', (answer) => {
    expect(() => decodeDecisionsResponse(result([answer]), [score])).toThrow(
      'OpenAI Decisions'
    );
  });
  it('rejects malformed token usage', () => {
    expect(() =>
      decodeDecisionsResponse(
        { ...result([pAnswer]), usage: { ...usage, input_tokens: -1 } },
        [predicate]
      )
    ).toThrow('invalid input_tokens');
  });
  it('snapshots questions while requests are in flight', async () => {
    let release: ((value: Response) => void) | undefined;
    const client = openaiDecisions({
      apiKey: 'key',
      options: {
        fetch: async () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      },
    });
    const questions: AxAIOpenAIDecisionQuestion[] = [{ ...predicate }];
    const pending = client.create({ input: 'Help', questions });
    await vi.waitFor(() => expect(release).toBeDefined());
    questions[0] = choice;
    release!(json(result([pAnswer])));
    expect((await pending).answers).toEqual([pAnswer]);
  });
  it('refreshes credentials on retry and preserves authentication errors', async () => {
    const credentials = vi.fn(async () => ({
      Authorization: `Bearer token-${credentials.mock.calls.length}`,
    }));
    const headers: string[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers).get('authorization')!);
      return headers.length === 1
        ? json({ error: 'busy' }, 503)
        : json(result([pAnswer]));
    });
    const client = openaiDecisions({
      credentialProvider: credentials,
      options: { fetch, retry: { maxRetries: 1, initialDelayMs: 1 } },
    });
    await client.create({ input: 'Help', questions: [predicate] });
    expect(headers).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(credentials).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'openai-decisions',
        operation: 'chat',
      })
    );
    await expect(
      client.create(
        { input: 'Help', questions: [predicate] },
        { fetch: async () => json({ error: 'unauthorized' }, 401) }
      )
    ).rejects.toBeInstanceOf(AxAIServiceAuthenticationError);
  });
  it.each(['instance', 'call'] as const)(
    'combines cancellation from %s options',
    async (source) => {
      const controller = new AbortController();
      let reached = false;
      const fetch = async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          reached = true;
          init!.signal!.addEventListener(
            'abort',
            () => reject(init!.signal!.reason),
            { once: true }
          );
        });
      const client = openaiDecisions({
        apiKey: 'key',
        options: {
          fetch,
          ...(source === 'instance' ? { abortSignal: controller.signal } : {}),
        },
      });
      const pending = expect(
        client.create(
          { input: 'Help', questions: [predicate] },
          source === 'call' ? { abortSignal: controller.signal } : undefined
        )
      ).rejects.toBeInstanceOf(AxAIServiceAbortedError);
      await vi.waitFor(() => expect(reached).toBe(true));
      controller.abort();
      await pending;
    }
  );
});
