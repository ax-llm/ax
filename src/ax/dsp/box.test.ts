// cspell:ignore jev noul
import { describe, expect, it, vi } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { typesafe } from '../ai/typesafe/client.js';
import { validateTypesafeRequest } from '../ai/typesafe/validate.js';
import { ai } from '../ai/wrap.js';
import { validateBox } from './box.js';
import { decisionExampleValues } from './decision.js';
import { toJsonSchema } from './jsonSchema.js';
import { AxSignature, f } from './sig.js';
import { ax } from './template.js';

const box = { top: 0.2, bottom: 0.8, left: 0.1, right: 0.7 };
const photo = { mimeType: 'image/png', data: 'aGVsbG8=' };
const native = {
  model: 'jev-1.14.0',
  answers: {
    target: { type: 'box', box, confidence: 0.9 },
    visible: { type: 'noul', noul: 0.95 },
  },
  usage: { input_tokens: 100, output_tokens: 20 },
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
const mock = (output: unknown) =>
  new AxMockAIService({
    name: 'Vision test',
    features: { structuredOutputs: true, streaming: false },
    chatResponse: { results: [{ index: 0, content: JSON.stringify(output) }] },
  });

describe('box signatures and images', () => {
  it('round trips string/fluent fields and separates inference and result schemas', () => {
    const sig = new AxSignature(
      'photo:image -> target:box(evidence), region:box'
    );
    expect(new AxSignature(sig.toString()).getOutputFields()).toEqual(
      sig.getOutputFields()
    );
    expect(new AxSignature(sig).getOutputFields()).toEqual(
      sig.getOutputFields()
    );
    const fluent = f()
      .input('photo', f.image())
      .output('target', f.box().withEvidence())
      .output('region', f.box())
      .build();
    expect(toJsonSchema(fluent.getOutputFields())).toEqual(
      toJsonSchema(sig.getOutputFields())
    );
    const schema = toJsonSchema(sig.getOutputFields());
    expect(schema.properties.target.properties.box.properties.top).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 1,
    });
    expect(schema.properties.region.required).toEqual([
      'top',
      'bottom',
      'left',
      'right',
    ]);
    const result = sig.toJSONSchema();
    expect(result.properties.target.properties).toHaveProperty('value');
    expect(result.properties.target.properties).not.toHaveProperty(
      'probabilities'
    );
    expect(result.properties.region.properties).toHaveProperty('top');
  });

  it.each([
    {},
    [],
    null,
    { ...box, top: -0.1 },
    { ...box, bottom: 1.01 },
    { ...box, top: Number.NaN },
    { ...box, right: Number.POSITIVE_INFINITY },
    { ...box, top: 0.8 },
    { ...box, left: 0.9 },
    { ...box, extra: 1 },
  ])('rejects invalid boxes %j', (value) => {
    expect(() => validateBox(value, 'target')).toThrow('box');
  });

  it('maps images and native boxes through forward, with trusted confidence', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json(native)
    );
    const model = ai({
      name: 'typesafe',
      apiKey: 'test',
      config: { model: 'jev-1.14.0' },
      options: { fetch },
    });
    expect(model.getFeatures().media?.images?.supported).toBe(true);
    const gen = ax(
      'photo:image -> target:box(evidence) "The mug in photo", visible:boolean'
    );
    const out = await gen.forward(model, { photo });
    expect(out).toEqual({
      target: {
        value: box,
        confidence: 0.9,
        provenance: {
          source: 'native',
          provider: 'Typesafe',
          model: 'jev-1.14.0',
        },
      },
      visible: true,
    });
    const init = fetch.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string);
    const refs = Object.keys(body.assets);
    expect(refs).toHaveLength(1);
    expect(body.assets[refs[0]!]).toEqual({
      type: 'image',
      format: 'png',
      data_base64: photo.data,
    });
    expect(JSON.stringify(body.state)).toContain(refs[0]);
    expect(body.questions.target).toMatchObject({ type: 'box' });
    expect(body.questions.target).not.toHaveProperty('criteria');
    expect(new Headers(init.headers).get('TypeSafe-Danger-Zone-Images')).toBe(
      'true'
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves ordered image arrays and matching inline data URLs', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({
        ...native,
        answers: { visible: { type: 'noul', noul: 0.9 } },
      })
    );
    const model = ai({ name: 'typesafe', apiKey: 'test', options: { fetch } });
    const gen = ax('photos:image[] -> visible:boolean');
    expect(
      await gen.forward(model, {
        photos: [
          photo,
          { ...photo, data: `data:image/png;base64,${photo.data}` },
        ],
      })
    ).toEqual({ visible: true });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    const refs = Object.keys(body.assets);
    expect(refs).toHaveLength(2);
    const state = JSON.stringify(body.state);
    expect(state.indexOf(refs[0]!)).toBeLessThan(state.indexOf(refs[1]!));
    expect(Object.values(body.assets)).toEqual([
      { type: 'image', format: 'png', data_base64: photo.data },
      { type: 'image', format: 'png', data_base64: photo.data },
    ]);
  });

  it('omits the experimental header for text-only requests', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({
        ...native,
        answers: { visible: { type: 'noul', noul: 0.9 } },
      })
    );
    const model = ai({ name: 'typesafe', apiKey: 'test', options: { fetch } });
    await ax('query:string -> visible:boolean').forward(model, {
      query: 'hello',
    });
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).has(
        'TypeSafe-Danger-Zone-Images'
      )
    ).toBe(false);
    expect(
      JSON.parse(fetch.mock.calls[0]![1]!.body as string)
    ).not.toHaveProperty('assets');
  });

  it('preserves an explicit refusal for a generative box evidence field', async () => {
    const gen = ax('query:string -> target:box(evidence, refusal return)');
    const out = await gen.forward(mock({ target: { status: 'refused' } }), {
      query: 'locate',
    });
    expect(out.target).toMatchObject({
      status: 'refused',
      provenance: { source: 'elicited' },
    });
    expect(out.target).not.toHaveProperty('value');
  });

  it('supports plain box results and completed streaming values', async () => {
    const model = ai({
      name: 'typesafe',
      apiKey: 'test',
      config: { model: 'jev-1.14.0' },
      options: { fetch: async () => json(native) },
    });
    const gen = ax('photo:image -> target:box, visible:boolean');
    expect(await gen.forward(model, { photo })).toEqual({
      target: box,
      visible: true,
    });
    const chunks = [];
    for await (const chunk of gen.streamingForward(model, { photo }))
      chunks.push(chunk);
    expect(JSON.stringify(chunks)).toContain('"top":0.2');
  });

  it('supports generic vision schemas including nested arrays without inventing confidence', async () => {
    const gen = ax(
      'query:string -> target:box(evidence), regions:box[], matches:object{ region:box(evidence) }[], absent?:box'
    );
    const out = await gen.forward(
      mock({ target: { box }, regions: [box], matches: [{ region: { box } }] }),
      { query: 'locate' }
    );
    expect(out.target.value).toEqual(box);
    expect(out.target.provenance.source).toBe('elicited');
    expect(out.target).not.toHaveProperty('confidence');
    expect(out.regions).toEqual([box]);
    expect(out.matches[0]?.region.value).toEqual(box);
    expect(out.absent).toBeUndefined();
  });

  it('validates generated edges and rejects model-authored confidence', async () => {
    const gen = ax('query:string -> target:box(evidence)', { maxRetries: 0 });
    await expect(
      gen.forward(mock({ target: { box: { ...box, left: 1 } } }), {
        query: 'locate',
      })
    ).rejects.toThrow();
    await expect(
      gen.forward(mock({ target: { box, confidence: 1 } }), { query: 'locate' })
    ).rejects.toThrow();
  });

  it('renders box demonstrations and accepts box inputs', async () => {
    const gen = ax('region:box -> target:box(evidence)');
    gen.setExamples([{ region: box, target: box }]);
    const sig = new AxSignature('query:string -> target:box(evidence)');
    expect(
      decisionExampleValues(sig.getOutputFields(), { target: box })
    ).toEqual({ target: { box } });
    expect(
      await gen.forward(mock({ target: { box } }), { region: box })
    ).toMatchObject({ target: { value: box } });
  });

  it('rejects Box with OpenAI Decisions before transport', async () => {
    const fetch = vi.fn();
    const model = ai({
      name: 'openai-decisions',
      apiKey: 'test',
      options: { fetch },
    });
    await expect(
      ax('photo:image -> target:box').forward(model, { photo })
    ).rejects.toThrow('does not support box');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves image inputs with existing OpenAI Decisions evidence fields', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json({
        id: 'decision-test',
        object: 'decision',
        model: 'gpt-6-luna',
        answers: [{ type: 'predicate', name: 'visible', probability: 0.9 }],
        usage: {
          input_tokens: 100,
          output_tokens: 2,
          total_tokens: 102,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      })
    );
    const model = ai({
      name: 'openai-decisions',
      apiKey: 'test',
      options: { fetch },
    });
    const out = await ax('photo:image -> visible:boolean(evidence)').forward(
      model,
      { photo }
    );
    expect(out.visible.value).toBe(true);
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(JSON.stringify(body.input)).toContain(
      `data:image/png;base64,${photo.data}`
    );
  });

  it('supports native assets in state, instructions and criteria with mixed questions', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      json(native)
    );
    const client = typesafe({ apiKey: 'test', options: { fetch } });
    const result = await client.systemOne({
      model: 'jev-1.14.0',
      state: { photo: 'ref-photo' },
      assets: {
        'ref-photo': { format: 'png', data_base64: photo.data },
        'ref-example': { format: 'jpeg', data_base64: photo.data },
      },
      questions: {
        target: { type: 'box', instructions: 'Find ref-example in photo' },
        visible: {
          type: 'noul',
          criteria: { true: { examples: ['ref-example'] } },
        },
      },
    });
    expect(result.answers.target.box).toEqual(box);
    expect(result.answers.target.confidence).toBe(0.9);
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).get(
        'TypeSafe-Danger-Zone-Images'
      )
    ).toBe('true');
  });

  it.each([
    { format: 'webp', data_base64: photo.data },
    { format: 'png', data_base64: 'data:image/png;base64,aGVsbG8=' },
    { format: 'png', data_base64: ' aGVsbG8=' },
    { format: 'png', data_base64: 'abc' },
    { format: 'png', data_base64: 'AAA\n' },
    { format: 'png', data_base64: 'AAA\r' },
    { format: 'png', part: 'photo' },
  ])('rejects invalid native assets before transport %j', async (asset) => {
    const fetch = vi.fn();
    const client = typesafe({ apiKey: 'test', options: { fetch } });
    await expect(
      client.systemOne({
        state: 'ref-photo',
        assets: { 'ref-photo': asset as never },
        questions: { visible: { type: 'noul' } },
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates photograph-sized assets without overflowing and enforces the image size limit', () => {
    const request = (data: string) => ({
      model: 'jev-1.14.0',
      state: 'photo',
      assets: { photo: { format: 'png' as const, data_base64: data } },
      questions: { visible: { type: 'noul' as const } },
    });
    expect(() =>
      validateTypesafeRequest(request('AAAA'.repeat(256 * 1024)))
    ).not.toThrow();
    expect(() =>
      validateTypesafeRequest(request('AAAA'.repeat(6 * 1024 * 1024)))
    ).toThrow('exceeds 16 MiB');
  });

  it('rejects missing images, unused assets, invalid confidence and malformed native boxes', async () => {
    const fetch = vi.fn();
    const client = typesafe({ apiKey: 'test', options: { fetch } });
    const questions = {
      target: { type: 'box', instructions: 'Find mug' },
    } as const;
    await expect(
      client.systemOne({ state: 'hello', questions })
    ).rejects.toThrow('requires an image');
    await expect(
      client.systemOne({
        state: null,
        questions,
        assets: { unused: { format: 'png', data_base64: photo.data } },
      })
    ).rejects.toThrow('not referenced');
    expect(fetch).not.toHaveBeenCalled();
    for (const answer of [
      { type: 'box', box: { ...box, right: 0 }, confidence: 0.9 },
      { type: 'box', box, confidence: 2 },
    ]) {
      const bad = typesafe({
        apiKey: 'test',
        options: {
          fetch: async () => json({ ...native, answers: { target: answer } }),
        },
      });
      await expect(
        bad.systemOne({
          state: 'ref',
          questions,
          assets: { ref: { format: 'png', data_base64: photo.data } },
        })
      ).rejects.toThrow();
    }
  });
});
