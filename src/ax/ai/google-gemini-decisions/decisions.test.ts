// cspell:ignore noul
import { describe, expect, it, vi } from 'vitest';
import { ax } from '../../dsp/template.js';
import { AxAIServiceAuthenticationError } from '../../util/apicall.js';
import { axGetSupportedAIModels } from '../catalog.js';
import type { AxChatRequest } from '../types.js';
import { ai } from '../wrap.js';
import { googleGeminiDecisions } from './client.js';
import type { AxAIGoogleGeminiDecisionsRequest } from './types.js';
import { decodeDecisionsResponse } from './validate.js';

const questions = {
  urgent: { type: 'noul', instructions: 'Does this need immediate attention?' },
  team: {
    type: 'choice',
    instructions: 'Which team?',
    criteria: { support: '', billing: 'Invoice problems' },
  },
  severity: {
    type: 'score',
    instructions: 'How severe?',
    criteria: ['Minor', 'Blocked'],
  },
} as const;
const answers = {
  urgent: { type: 'noul', noul: 0.9, confidence: 0.9 },
  team: {
    type: 'choice',
    choice: 'billing',
    probabilities: { support: 0.2, billing: 0.8 },
    confidence: 0.8,
  },
  severity: {
    type: 'score',
    score: 0.8,
    probabilities: { '0': 0.2, '1': 0.8 },
    legend: { '0': 'Minor', '1': 'Blocked' },
    confidence: 0.8,
  },
};
const usage = {
  total_input_tokens: 20,
  total_output_tokens: 0,
  total_tokens: 20,
  input_tokens_by_modality: [{ modality: 'text', tokens: 20 }],
};
const result = () => structuredClone({ answers, usage });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const request = { input: 'Checkout is broken.', questions };
const chat = (): AxChatRequest => ({
  chatPrompt: [{ role: 'user', content: 'Checkout is broken.' }],
  responseFormat: {
    type: 'json_schema',
    schema: {
      name: 'output',
      schema: {
        type: 'object',
        properties: { urgent: { type: 'boolean' } },
        required: ['urgent'],
      },
    },
  },
});

describe('Google Gemini Decisions', () => {
  it('runs signatures on the dedicated endpoint, maps criteria, usage and metadata', async () => {
    const fetch = vi.fn(async () => json(result()));
    const model = ai({
      name: 'google-gemini-decisions',
      apiKey: 'key',
      trueThreshold: 0.9,
      options: { fetch },
    });
    const gen = ax(
      'ticket:string -> urgent:boolean(true "Core task blocked", false "Routine request"), team:class "support, billing"(billing "Invoice problems"), severity:score "Minor, Blocked"'
    );
    expect(await gen.forward(model, { ticket: 'Checkout is broken.' })).toEqual(
      { urgent: true, team: 'billing', severity: 0.8 }
    );
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/decisions'
    );
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('key');
    expect(String(url)).not.toContain('key=');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemini-decision-1');
    expect(body.questions.urgent).toMatchObject({
      type: 'noul',
      criteria: {
        true_description: 'Core task blocked',
        false_description: 'Routine request',
      },
    });
    expect(body.questions.team.criteria).toEqual(questions.team.criteria);
    expect(body.questions.severity.criteria).toEqual(['Minor', 'Blocked']);
    expect(JSON.stringify(body.input)).toContain('Checkout is broken.');
    expect(body).not.toHaveProperty('trueThreshold');
    expect(body).not.toHaveProperty('stream');
    expect(gen.getUsage().at(-1)?.tokens).toMatchObject({
      promptTokens: 20,
      completionTokens: 0,
      totalTokens: 20,
    });
    expect(
      gen.getChatLog().at(-1)?.providerMetadata?.googleGeminiDecisions
    ).toEqual(result());
    expect(model.getFeatures()).toMatchObject({
      functions: false,
      functionEmulation: false,
      streaming: false,
      requiresStructuredOutput: true,
      media: {
        audio: { supported: true },
        files: { supported: true, formats: ['application/pdf'] },
      },
    });
  });
  it('preserves native evidence and field thresholds in forward and completed streaming', async () => {
    const model = ai({
      name: 'google-gemini-decisions',
      apiKey: 'key',
      options: { fetch: async () => json(result()) },
    });
    const gen = ax(
      'ticket:string -> urgent:boolean(evidence, threshold 0.95), team:class "support, billing"(evidence), severity:score "Minor, Blocked"(evidence)'
    );
    const out = await gen.forward(model, { ticket: 'Checkout is broken.' });
    expect(out.urgent).toMatchObject({
      value: false,
      probability: 0.9,
      confidence: 0.9,
      threshold: 0.95,
      provenance: {
        source: 'native',
        provider: 'Google Gemini Decisions',
        model: 'gemini-decision-1',
      },
    });
    expect(out.team).toMatchObject({
      value: 'billing',
      probabilities: answers.team.probabilities,
      confidence: 0.8,
    });
    expect(out.severity).toMatchObject({
      value: 0.8,
      probabilities: [0.2, 0.8],
      levels: ['Minor', 'Blocked'],
      confidence: 0.8,
    });
    const chunks = [];
    for await (const chunk of gen.streamingForward(model, {
      ticket: 'Checkout is broken.',
    }))
      chunks.push(chunk);
    expect(chunks.at(-1)?.delta).toEqual(out);
  });
  it.each([
    'urgent?:boolean',
    'urgent:boolean[]',
    'urgent:string',
    'urgent:number',
    'urgent:box(evidence)',
  ])('rejects unsupported output %s before transport', async (output) => {
    const fetch = vi.fn();
    const model = ai({
      name: 'google-gemini-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    await expect(
      ax(`ticket:string -> ${output}`).forward(model, { ticket: 'x' })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    'rejects invalid threshold %s',
    (trueThreshold) => {
      expect(() =>
        ai({ name: 'google-gemini-decisions', apiKey: 'key', trueThreshold })
      ).toThrow('probability');
    }
  );
  it('rejects tools and generation controls before transport', async () => {
    const fetch = vi.fn();
    const model = ai({
      name: 'google-gemini-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    await expect(
      model.chat({ ...chat(), modelConfig: { maxTokens: 20 } })
    ).rejects.toThrow('generation control');
    await expect(
      model.chat({
        ...chat(),
        functions: [
          {
            name: 'lookup',
            description: 'lookup',
            parameters: { type: 'object', properties: {} },
          },
        ],
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('serializes roles with separators and maps native media blocks', async () => {
    const fetch = vi.fn(async () =>
      json({ answers: { urgent: answers.urgent }, usage })
    );
    const model = ai({
      name: 'google-gemini-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    await model.chat({
      ...chat(),
      chatPrompt: [
        { role: 'system', content: 'Instructions' },
        { role: 'assistant', content: 'Previous reply' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect ' },
            {
              type: 'image',
              mimeType: 'image/png',
              image: 'data:image/png;base64,YQ==',
              details: 'high',
            },
            { type: 'audio', format: 'mp3', data: 'YQ==' },
            { type: 'file', mimeType: 'application/pdf', data: 'YQ==' },
            {
              type: 'file',
              mimeType: 'video/mp4',
              fileUri: 'https://example.com/clip.mp4',
            },
          ],
        },
      ],
    });
    const body = JSON.parse(
      (fetch.mock.calls as unknown as [URL, RequestInit][])[0]![1]
        .body as string
    );
    expect(body.input).toEqual([
      { type: 'text', text: '\nsystem:\n' },
      { type: 'text', text: 'Instructions\n' },
      { type: 'text', text: '\nassistant:\n' },
      { type: 'text', text: 'Previous reply\n' },
      { type: 'text', text: '\nuser:\n' },
      { type: 'text', text: 'Inspect ' },
      {
        type: 'image',
        mime_type: 'image/png',
        data: 'YQ==',
        resolution: 'high',
      },
      { type: 'audio', mime_type: 'audio/mpeg', data: 'YQ==' },
      { type: 'document', mime_type: 'application/pdf', data: 'YQ==' },
      {
        type: 'video',
        mime_type: 'video/mp4',
        uri: 'https://example.com/clip.mp4',
      },
    ]);
  });
  it.each(['pcm16', 'raw'] as const)(
    'preserves the sample rate for %s audio',
    async (format) => {
      const fetch = vi.fn(async () =>
        json({ answers: { urgent: answers.urgent }, usage })
      );
      const model = ai({
        name: 'google-gemini-decisions',
        apiKey: 'key',
        options: { fetch },
      });
      await model.chat({
        ...chat(),
        chatPrompt: [
          {
            role: 'user',
            content: [
              { type: 'audio', format, sampleRate: 16000, data: 'YQ==' },
            ],
          },
        ],
      });
      const body = JSON.parse(
        (fetch.mock.calls as unknown as [URL, RequestInit][])[0]![1]
          .body as string
      );
      expect(body.input.at(-1)).toEqual({
        type: 'audio',
        mime_type: 'audio/pcm;rate=16000',
        data: 'YQ==',
      });
    }
  );
  it('exposes the default model with accurate catalog capabilities', () => {
    const provider = axGetSupportedAIModels().find(
      (p) => p.name === 'google-gemini-decisions'
    );
    expect(provider?.defaultModel).toBe('gemini-decision-1');
    expect(provider?.models[0]?.capabilities).toMatchObject({
      temperature: false,
      topP: false,
      thinkingBudget: false,
      imageInput: true,
      audioInput: true,
      pdfInput: true,
      textOutput: false,
      serviceTiers: [],
    });
  });
});

describe('native Google Gemini Decisions client', () => {
  it.each([
    [
      { type: 'text', text: 'Valid' },
      { type: 'text', text: 42 },
    ],
    [{ type: 'image', mime_type: 'image/png', data: 'YQ==' }, { type: 'text' }],
  ])('validates text after earlier content %#', async (...input) => {
    const fetch = vi.fn(async () => json(result()));
    const client = googleGeminiDecisions({ apiKey: 'key', options: { fetch } });
    await expect(
      client.create({ ...request, input } as AxAIGoogleGeminiDecisionsRequest)
    ).rejects.toThrow('input text');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects missing elements in instruction block arrays', async () => {
    const instructions = [{ type: 'text', text: 'Valid instructions' }];
    instructions.length = 2;
    const fetch = vi.fn(async () =>
      json({ answers: { urgent: answers.urgent }, usage })
    );
    const client = googleGeminiDecisions({ apiKey: 'key', options: { fetch } });
    await expect(
      client.create({
        input: 'Test',
        questions: { urgent: { ...questions.urgent, instructions } },
      } as unknown as AxAIGoogleGeminiDecisionsRequest)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns all typed answers unchanged', async () => {
    const client = googleGeminiDecisions({
      apiKey: 'key',
      options: { fetch: async () => json(result()) },
    });
    expect(await client.create(request)).toEqual(result());
  });
  it('uses custom endpoint and case-insensitive credential headers', async () => {
    const fetch = vi.fn(async () => json(result()));
    const credentials = vi.fn(async () => ({ 'X-Goog-Api-Key': 'fresh' }));
    const client = googleGeminiDecisions({
      apiKey: 'old',
      credentialProvider: credentials,
      apiURL: 'https://proxy.example/v1beta',
      options: { fetch },
    });
    await client.create(request);
    const [url, init] = (
      fetch.mock.calls as unknown as [URL, RequestInit][]
    )[0]!;
    expect(String(url)).toBe('https://proxy.example/v1beta/decisions');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('fresh');
    expect(credentials).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'google-gemini-decisions',
        operation: 'chat',
        method: 'POST',
      })
    );
  });
  it('snapshots questions before awaiting transport credentials', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payload = structuredClone(request);
    const client = googleGeminiDecisions({
      credentialProvider: async () => {
        await gate;
        return { 'x-goog-api-key': 'key' };
      },
      options: { fetch: async () => json(result()) },
    });
    const pending = client.create(payload);
    Object.assign(payload.questions.team.criteria, { extra: '' });
    release();
    expect(await pending).toEqual(result());
  });
  it.each([
    { input: '' },
    { input: [] },
    { input: { hello: 'world' } },
    { questions: {} },
    { questions: { 'bad key': questions.urgent } },
    { questions: { urgent: { type: 'noul' } } },
    {
      questions: {
        urgent: { ...questions.urgent, criteria: { true: 'wrong wire name' } },
      },
    },
    { questions: { team: { ...questions.team, criteria: { only: '' } } } },
    {
      questions: {
        team: { ...questions.team, criteria: { ' trailing ': '', valid: '' } },
      },
    },
    {
      questions: {
        team: {
          ...questions.team,
          criteria: { 'non\u00a0ascii': '', valid: '' },
        },
      },
    },
    {
      questions: { severity: { ...questions.severity, criteria: ['One', ''] } },
    },
    {
      input: [
        {
          type: 'image',
          mime_type: 'image/png',
          data: 'data:image/png;base64,YQ==',
        },
      ],
    },
    {
      input: [{ type: 'video', mime_type: 'video/mp4', uri: 'gs://bucket/a' }],
    },
    {
      input: [
        { type: 'video', mime_type: 'video/mp4', uri: 'https://youtu.be/x' },
      ],
    },
    {
      input: [
        { type: 'audio', mime_type: 'application/octet-stream', data: 'YQ==' },
      ],
    },
    { input: [{ type: 'document', mime_type: 'text/plain', data: 'YQ==' }] },
    {
      input: [
        {
          type: 'audio',
          mime_type: 'audio/mp3',
          uri: 'https://example.com/a',
          resolution: 'high',
        },
      ],
    },
    {
      input: [
        {
          type: 'image',
          mime_type: 'image/png',
          data: 'YQ==',
          uri: 'https://example.com/a',
        },
      ],
    },
  ])('rejects invalid native payload %# before transport', async (invalid) => {
    const fetch = vi.fn();
    const client = googleGeminiDecisions({ apiKey: 'key', options: { fetch } });
    await expect(
      client.create({
        ...request,
        ...invalid,
      } as AxAIGoogleGeminiDecisionsRequest)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts text block instructions and 255-level native rubrics', async () => {
    const criteria = Array.from({ length: 255 }, (_, i) => `Level ${i}`) as [
      string,
      string,
      ...string[],
    ];
    const ps = Object.fromEntries(
      criteria.map((_, i) => [i, i === 254 ? 1 : 0])
    );
    const client = googleGeminiDecisions({
      apiKey: 'key',
      options: {
        fetch: async () =>
          json({
            answers: {
              score: {
                type: 'score',
                score: 254,
                confidence: 1,
                probabilities: ps,
                legend: Object.fromEntries(criteria.map((v, i) => [i, v])),
              },
            },
            usage,
          }),
      },
    });
    const out = await client.create({
      input: { type: 'text', text: 'Rate this' },
      questions: {
        score: {
          type: 'score',
          instructions: [{ type: 'text', text: 'Rate it' }],
          criteria,
        },
      },
    });
    expect(out.answers.score.score).toBe(254);
  });
  it.each([
    (r: ReturnType<typeof result>) => {
      r.answers.urgent.noul = 1;
    },
    (r: ReturnType<typeof result>) => {
      r.answers.urgent.confidence = Number.NaN;
    },
    (r: ReturnType<typeof result>) => {
      r.answers.team.choice = 'unknown';
    },
    (r: ReturnType<typeof result>) => {
      r.answers.team.probabilities.billing = 0.5;
    },
    (r: ReturnType<typeof result>) => {
      delete (r.answers.team.probabilities as Record<string, number>).support;
    },
    (r: ReturnType<typeof result>) => {
      r.answers.severity.score = Number.POSITIVE_INFINITY;
    },
    (r: ReturnType<typeof result>) => {
      r.answers.severity.legend['0'] = 'Wrong';
    },
    (r: ReturnType<typeof result>) => {
      r.usage.total_output_tokens = 1;
    },
    (r: ReturnType<typeof result>) => {
      r.usage.total_input_tokens = -1;
    },
    (r: ReturnType<typeof result>) => {
      Object.assign(r.answers, { extra: answers.urgent });
    },
  ])('rejects malformed responses %#', (mutate) => {
    const raw = result();
    mutate(raw);
    expect(() => decodeDecisionsResponse(raw, questions)).toThrow();
  });
  it('preserves rounded distributions without normalizing', () => {
    const raw = result();
    raw.answers.team.probabilities.billing = 0.79;
    expect(decodeDecisionsResponse(raw, questions)).toBe(raw);
  });
  it('surfaces HTTP safety errors without manufacturing refusals', async () => {
    const fetch = vi.fn(async () =>
      json({ error: { code: 'safety', message: 'Input blocked' } }, 400)
    );
    const client = googleGeminiDecisions({ apiKey: 'key', options: { fetch } });
    await expect(client.create(request)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses shared retry and cancellation behavior', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(result()));
    const client = googleGeminiDecisions({
      apiKey: 'key',
      options: { fetch, retry: { maxRetries: 1, initialDelayMs: 1 } },
    });
    expect(await client.create(request)).toEqual(result());
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(
      client.create(request, { abortSignal: AbortSignal.abort() })
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('surfaces authentication errors', async () => {
    const client = googleGeminiDecisions({
      apiKey: 'key',
      options: { fetch: async () => json({}, 401) },
    });
    await expect(client.create(request)).rejects.toBeInstanceOf(
      AxAIServiceAuthenticationError
    );
  });
});
