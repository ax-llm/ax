import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { ai } from '../ai/wrap.js';
import {
  type AxBooleanEvidence,
  type AxClassEvidence,
  AxDecisionRefusalError,
  type AxScoreEvidence,
} from './decision.js';
import { toJsonSchema } from './jsonSchema.js';
import { AxSignature, f } from './sig.js';
import { ax } from './template.js';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
const usage = {
  input_tokens: 20,
  output_tokens: 3,
  total_tokens: 23,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
};
const signature =
  'query:string, document:string -> relevant:boolean(evidence, threshold 0.7), category:class "a, b"(evidence), relevance:score "No, Some, Yes"(evidence)' as const;
const input = { query: 'How does it work?', document: 'A helpful document' };
const content = JSON.stringify({
  relevant: { probability: 0.6 },
  category: { probabilities: { a: 0.4, b: 0.6 } },
  relevance: { probabilities: [0.2, 0.3, 0.5] },
});
const mock = (body = content) =>
  new AxMockAIService({
    name: 'Test provider',
    features: { structuredOutputs: true, streaming: false },
    chatResponse: {
      results: [{ index: 0, content: body }],
      modelUsage: {
        ai: 'Test provider',
        model: 'test-model',
        tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    },
  });

describe('signature decision evidence', () => {
  it('infers fluent and string evidence without changing scalar fields', async () => {
    const gen = ax(signature);
    const result = await gen.forward(mock(), input);
    expectTypeOf(result.relevant).toEqualTypeOf<AxBooleanEvidence>();
    expectTypeOf(result.category).toEqualTypeOf<AxClassEvidence<'a' | 'b'>>();
    expectTypeOf(result.relevance).toEqualTypeOf<AxScoreEvidence>();
    expect(result).toMatchObject({
      relevant: { value: false, probability: 0.6, threshold: 0.7 },
      category: { value: 'b', probabilities: { a: 0.4, b: 0.6 } },
      relevance: {
        value: 1.3,
        levels: ['No', 'Some', 'Yes'],
        probabilities: [0.2, 0.3, 0.5],
      },
    });
    expect(result.category).not.toHaveProperty('confidence');
    expect(result.relevant.provenance).toEqual({
      source: 'elicited',
      provider: 'Test provider',
      model: 'test-model',
    });
    const fluent = ax(
      f()
        .input('query', f.string())
        .output('relevant', f.boolean().withEvidence().optional().array())
        .output('category', f.class(['a', 'b']).withEvidence())
        .output('relevance', f.score(['No', 'Some', 'Yes']).withEvidence())
        .build()
    );
    type FluentOut = Awaited<ReturnType<typeof fluent.forward>>;
    expectTypeOf<FluentOut['relevant']>().toEqualTypeOf<
      AxBooleanEvidence[] | undefined
    >();
    expectTypeOf<FluentOut['category']>().toEqualTypeOf<
      AxClassEvidence<'a' | 'b'>
    >();
    expectTypeOf<FluentOut['relevance']>().toEqualTypeOf<AxScoreEvidence>();
    const plain = ax('query:string -> relevance:score "No, Some, Yes"');
    expect(
      await plain.forward(
        mock('{"relevance":{"probabilities":[0.2,0.3,0.5]}}'),
        { query: 'x' }
      )
    ).toEqual({ relevance: 1.3 });
    const legacy = ax(
      'query:string -> relevant:boolean, category:class "a, b"'
    );
    expect(
      await legacy.forward(mock('Relevant: true\nCategory: a'), { query: 'x' })
    ).toEqual({ relevant: true, category: 'a' });
  });

  it('keeps wire schemas separate from the result schema', () => {
    const sig = new AxSignature(signature);
    const request = toJsonSchema(sig.getOutputFields());
    expect(request.properties.relevant.properties).toEqual({
      probability: { type: 'number', minimum: 0, maximum: 1 },
    });
    expect(request.properties.relevance.description).toContain('No');
    expect(sig.toJSONSchema().properties.relevant.properties).toHaveProperty(
      'value'
    );
    expect(new AxSignature(sig.toString()).getOutputFields()).toEqual(
      sig.getOutputFields()
    );
    for (const invalid of [
      'query:string -> result:string(evidence)',
      'query:string -> result:score "One"',
      'query:string -> result:score "One, One"',
      'query:string -> result:boolean(threshold 0.7)',
      'query:string -> result:class "a, b"(evidence, threshold 0.7)',
    ])
      expect(() => new AxSignature(invalid)).toThrow();
    expect(() => f.score(['a', 'a'])).toThrow();
    // @ts-expect-error threshold is exclusive to boolean fields
    expect(() =>
      f.class(['a', 'b']).withEvidence({ threshold: 0.5 })
    ).toThrow();
  });

  it('supports nested objects, arrays, and optional fields on generative models', async () => {
    const gen = ax(
      'query:string -> matches:object{ relevant:boolean(evidence), relevance:score "No, Yes"(evidence), category?:class "a, b"(evidence) }[]'
    );
    const out = await gen.forward(
      mock(
        '{"matches":[{"relevant":{"probability":0.8},"relevance":{"probabilities":[0.1,0.9]}}]}'
      ),
      { query: 'x' }
    );
    expect(out.matches).toEqual([
      {
        relevant: {
          value: true,
          probability: 0.8,
          threshold: 0.5,
          provenance: {
            source: 'elicited',
            provider: 'Test provider',
            model: 'test-model',
          },
        },
        relevance: {
          value: 0.9,
          levels: ['No', 'Yes'],
          probabilities: [0.1, 0.9],
          provenance: {
            source: 'elicited',
            provider: 'Test provider',
            model: 'test-model',
          },
        },
      },
    ]);
  });

  it('rejects malformed evidence and never trusts generated provenance or confidence', async () => {
    const gen = ax('query:string -> category:class "a, b"(evidence)');
    for (const body of [
      '{"category":{"probabilities":{"a":0.5}}}',
      '{"category":{"probabilities":{"a":0.7,"b":0.7}}}',
      '{"category":{"probabilities":{"a":0.5,"b":0.5},"confidence":0.9}}',
      '{"category":{"probabilities":{"a":0.5,"b":0.5},"provenance":{"source":"native","provider":"fake"}}}',
    ])
      await expect(
        gen.forward(mock(body), { query: 'x' }, { maxRetries: 1 })
      ).rejects.toThrow();
  });

  it('surfaces refusal once and offers an explicit tagged union', async () => {
    const refused = mock('{"relevant":{"status":"refused"}}');
    const chat = vi.spyOn(refused, 'chat');
    await expect(
      ax('query:string -> relevant:boolean(evidence)').forward(refused, {
        query: 'x',
      })
    ).rejects.toBeInstanceOf(AxDecisionRefusalError);
    expect(chat).toHaveBeenCalledTimes(1);
    const gen = ax(
      'query:string -> relevant:boolean(evidence, refusal return)'
    );
    const answer = await gen.forward(refused, { query: 'x' });
    expect(answer.relevant).toEqual({
      status: 'refused',
      provenance: {
        source: 'elicited',
        provider: 'Test provider',
        model: 'test-model',
      },
    });
    const answered = await gen.forward(
      mock('{"relevant":{"status":"answered","probability":0.8}}'),
      { query: 'x' }
    );
    expect(answered.relevant).toMatchObject({
      status: 'answered',
      value: true,
      probability: 0.8,
    });
    if (answered.relevant.status === 'answered')
      expectTypeOf(answered.relevant.value).toEqualTypeOf<boolean>();
  });

  it('preserves native choices, continuous scores, confidence and threshold policy', async () => {
    const fetch = vi.fn(async () =>
      json({
        model: 'gpt-6-luna',
        usage,
        answers: [
          { name: 'relevant', type: 'predicate', probability: 0.6 },
          {
            name: 'category',
            type: 'choice',
            choice: 'a',
            confidence: 0.8,
            probabilities: [
              { value: 'b', probability: 0.6 },
              { value: 'a', probability: 0.4 },
            ],
          },
          {
            name: 'relevance',
            type: 'score',
            score: 1.1,
            confidence: 0.7,
            probabilities: [
              { value: 0, label: 'No', probability: 0.2 },
              { value: 1, label: 'Some', probability: 0.3 },
              { value: 2, label: 'Yes', probability: 0.5 },
            ],
          },
        ],
      })
    );
    const provider = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      trueThreshold: 0.2,
      options: { fetch },
    });
    const result = await ax(signature).forward(provider, input);
    expect(result).toMatchObject({
      relevant: { value: false, threshold: 0.7 },
      category: { value: 'a', confidence: 0.8 },
      relevance: { value: 1.1, confidence: 0.7 },
    });
    expect(result.relevant.provenance.source).toBe('native');
    const req = JSON.parse(
      (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
        .body as string
    );
    expect(req.questions[2]).toMatchObject({
      type: 'score',
      levels: [{ label: 'No' }, { label: 'Some' }, { label: 'Yes' }],
    });
    expect(req.questions[0]).not.toHaveProperty('threshold');
  });

  it('emits complete evidence objects when streaming', async () => {
    const chunks: AxChatResponse[] = [
      { results: [{ index: 0, content: '{"relevant":{"probability":' }] },
      {
        results: [{ index: 0, content: '0.8}}', finishReason: 'stop' }],
        modelUsage: {
          ai: 'Stream provider',
          model: 'stream-model',
          tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ];
    const provider = new AxMockAIService({
      name: 'Stream provider',
      features: { streaming: true, structuredOutputs: true },
      chatResponse: () =>
        Promise.resolve(
          new ReadableStream({
            start(c) {
              for (const chunk of chunks) c.enqueue(chunk);
              c.close();
            },
          })
        ),
    });
    const deltas = [];
    for await (const chunk of ax(
      'query:string -> relevant:boolean(evidence)'
    ).streamingForward(provider, { query: 'x' }))
      deltas.push(chunk);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.delta.relevant).toMatchObject({
      value: true,
      probability: 0.8,
      provenance: { model: 'stream-model' },
    });
  });

  it('caches the decoded evidence and separates providers and instructions', async () => {
    const cache = new Map<string, unknown>();
    const cachingFunction = vi.fn(async (key: string, value?: unknown) => {
      if (value !== undefined) cache.set(key, value);
      return cache.get(key);
    });
    const gen = ax('query:string -> relevant:boolean(evidence)');
    const first = mock('{"relevant":{"probability":0.8}}');
    const second = new AxMockAIService({
      name: 'Other provider',
      features: { structuredOutputs: true },
      chatResponse: {
        results: [{ index: 0, content: '{"relevant":{"probability":0.2}}' }],
      },
    });
    const chat = vi.spyOn(first, 'chat');
    const a = await gen.forward(first, { query: 'x' }, { cachingFunction });
    expect(
      await gen.forward(first, { query: 'x' }, { cachingFunction })
    ).toEqual(a);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(
      (await gen.forward(second, { query: 'x' }, { cachingFunction })).relevant
        .value
    ).toBe(false);
    gen.setInstruction('A changed definition');
    await gen.forward(first, { query: 'x' }, { cachingFunction });
    expect(chat).toHaveBeenCalledTimes(2);
  });
  it('preserves Jev rubric order and rejects unsupported native shapes before transport', async () => {
    const fetch = vi.fn(async () =>
      json({
        model: 'jev-latest',
        usage: { input_tokens: 20, output_tokens: 3 },
        answers: {
          relevant: { type: 'noul', noul: 0.6 },
          category: {
            type: 'choice',
            choice: 'a',
            confidence: 0.8,
            probabilities: { a: 0.4, b: 0.6 },
          },
          relevance: {
            type: 'score',
            score: 1.1,
            confidence: 0.7,
            probabilities: { '2': 0.5, '0': 0.2, '1': 0.3 },
            legend: { '0': 'No', '1': 'Some', '2': 'Yes' },
          },
        },
      })
    );
    const provider = ai({
      name: 'typesafe',
      apiKey: 'key',
      trueThreshold: 0.2,
      options: { fetch },
    });
    const result = await ax(signature).forward(provider, input);
    expect(result).toMatchObject({
      relevant: { value: false, threshold: 0.7 },
      category: { value: 'a', confidence: 0.8 },
      relevance: {
        value: 1.1,
        probabilities: [0.2, 0.3, 0.5],
        confidence: 0.7,
        provenance: {
          source: 'native',
          provider: 'Typesafe',
          model: 'jev-latest',
        },
      },
    });
    const req = JSON.parse(
      (fetch.mock.calls as unknown as [unknown, RequestInit][])[0]![1]
        .body as string
    );
    expect(req.questions.relevance).toMatchObject({
      type: 'score',
      criteria: ['No', 'Some', 'Yes'],
    });
    for (const name of ['typesafe', 'openai-decisions'] as const) {
      const transport = vi.fn();
      const native = ai({ name, apiKey: 'key', options: { fetch: transport } });
      await expect(
        ax('query:string -> results:boolean(evidence)[]').forward(
          native,
          { query: 'x' },
          { maxRetries: 1 }
        )
      ).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    }
  });

  it('decodes tool output before processors, assertions and traces', async () => {
    const provider = new AxMockAIService({
      name: 'Tool provider',
      features: { functions: true, structuredOutputs: false },
      chatResponse: {
        results: [
          {
            index: 0,
            functionCalls: [
              {
                id: 'answer',
                type: 'function',
                function: {
                  name: '__axOutput',
                  params: { relevant: { probability: 0.8 } },
                },
              },
            ],
            finishReason: 'stop',
          },
        ],
      },
    });
    const gen = ax('query:string -> relevant:boolean(evidence)');
    const processor = vi.fn((value: AxBooleanEvidence) => {
      expect(value.value).toBe(true);
      expect(value.provenance.source).toBe('elicited');
    });
    gen.addFieldProcessor('relevant', processor);
    gen.addAssert(({ relevant }) => relevant.value, 'Must be relevant');
    const out = await gen.forward(provider, { query: 'x' });
    expect(out.relevant).toMatchObject({ value: true, probability: 0.8 });
    expect(processor).toHaveBeenCalledOnce();
    expect(gen.getTraces().at(-1)).toMatchObject({
      trace: { relevant: out.relevant },
    });
  });

  it('renders known evidence in examples without generated provenance', async () => {
    const gen = ax('query:string -> relevant:boolean(evidence)');
    gen.setExamples([
      {
        query: 'positive',
        relevant: {
          value: true,
          probability: 0.9,
          threshold: 0.5,
          provenance: { source: 'native', provider: 'example-provider' },
        },
      },
    ]);
    const provider = mock('{"relevant":{"probability":0.8}}');
    const chat = vi.spyOn(provider, 'chat');
    await gen.forward(provider, { query: 'x' });
    const prompt = JSON.stringify(chat.mock.calls[0]?.[0].chatPrompt);
    expect(prompt).toContain('0.9');
    expect(prompt).not.toContain('example-provider');
  });
  it('keeps label-only examples without manufacturing evidence', async () => {
    const gen = ax(
      'query:string -> relevant:boolean(evidence), category:class "a, b"(evidence), relevance:score "No, Yes"(evidence)'
    );
    gen.setExamples([
      { query: 'training', relevant: true, category: 'b', relevance: 1 },
    ]);
    const provider = mock(
      '{"relevant":{"probability":0.8},"category":{"probabilities":{"a":0.1,"b":0.9}},"relevance":{"probabilities":[0.2,0.8]}}'
    );
    const chat = vi.spyOn(provider, 'chat');
    await gen.forward(provider, { query: 'x' });
    const demo = chat.mock.calls[0]?.[0].chatPrompt.find(
      (message) => message.role === 'assistant'
    );
    expect(JSON.parse(demo?.content as string)).toEqual({
      relevant: true,
      category: 'b',
      relevance: 1,
    });
  });

  it('keeps native cache identity stable after first use and preserves refusals', async () => {
    const fetch = vi.fn(async () =>
      json({
        model: 'gpt-6-luna',
        usage,
        answers: [{ name: 'relevant', type: 'predicate', probability: 0.8 }],
      })
    );
    const provider = ai({
      name: 'openai-decisions',
      apiKey: 'key',
      options: { fetch },
    });
    const gen = ax('query:string -> relevant:boolean(evidence)');
    const cache = new Map<string, unknown>();
    const cachingFunction = async (key: string, value?: unknown) => {
      if (value !== undefined) cache.set(key, value);
      return cache.get(key);
    };
    const first = await gen.forward(
      provider,
      { query: 'x' },
      { cachingFunction }
    );
    expect(
      await gen.forward(provider, { query: 'x' }, { cachingFunction })
    ).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const name of ['openai-decisions'] as const) {
      const refusedFetch = vi.fn(async () =>
        json({
          model: 'gpt-6-luna',
          usage,
          answers: [{ name: 'relevant', type: 'refusal' }],
        })
      );
      const native = ai({
        name,
        apiKey: 'key',
        options: { fetch: refusedFetch },
      });
      await expect(gen.forward(native, { query: 'x' })).rejects.toBeInstanceOf(
        AxDecisionRefusalError
      );
      expect(refusedFetch).toHaveBeenCalledTimes(1);
      const returned = await ax(
        'query:string -> relevant:boolean(evidence, refusal return)'
      ).forward(native, { query: 'x' });
      expect(returned.relevant).toMatchObject({
        status: 'refused',
        provenance: { source: 'native' },
      });
    }
  });
});
