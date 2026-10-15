import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import { AxAIOpenAIDecisions } from '../../../src/ax/ai/openai-decisions/api.js';
import { AxAITypesafe } from '../../../src/ax/ai/typesafe/api.js';
import { typesafe } from '../../../src/ax/ai/typesafe/client.js';
import { validateTypesafeRequest } from '../../../src/ax/ai/typesafe/validate.js';
import { validateBox } from '../../../src/ax/dsp/box.js';
import { decodeDecisionValues } from '../../../src/ax/dsp/decision.js';
import { toJsonSchema } from '../../../src/ax/dsp/jsonSchema.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';
import { ax } from '../../../src/ax/dsp/template.js';

const root = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
function write(area: string, name: string, fixture: object) {
  const dir = join(root, 'ir/conformance', area);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `box-${name}.json`),
    `${JSON.stringify({ name: `box-${name}`, ...fixture }, null, 2)}\n`
  );
}
const box = { bottom: 0.8, left: 0.1, right: 0.7, top: 0.2 };
const image = { type: 'image', format: 'png', data_base64: 'aGVsbG8=' };
const request = {
  model: 'jev-1.14.0',
  state: { image: 'photo' },
  assets: { photo: image },
  questions: {
    target: { type: 'box', instructions: 'Find the square in photo' },
  },
};
const raw = {
  model: 'jev-1.14.0',
  answers: { target: { type: 'box', box, confidence: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 4 },
};
for (const [name, patch] of [
  ['native', {}],
  [
    'structured-reference',
    {
      state: null,
      questions: {
        target: { type: 'box', instructions: { image: ['photo'] } },
      },
    },
  ],
  [
    'criterion-reference',
    {
      state: null,
      questions: {
        present: { type: 'noul', criteria: { true: { image: 'photo' } } },
      },
    },
  ],
] as const) {
  const input = { ...request, ...patch };
  const response =
    name === 'criterion-reference'
      ? { ...raw, answers: { present: { type: 'noul', noul: 0.9 } } }
      : raw;
  let captured: any;
  const client = typesafe({
    apiKey: 'test-key',
    options: {
      fetch: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        assert.equal(
          new Headers(init?.headers).get('TypeSafe-Danger-Zone-Images'),
          'true'
        );
        return Response.json(response);
      },
    },
  });
  const output = await client.systemOne(input as any);
  write('axai', name, {
    kind: 'ai_typesafe_native',
    operation: 'system_one',
    request: input,
    response,
    expected_output: output,
    expected_transport_request_count: 1,
    expected_transport_request: {
      json: captured,
      headers: { 'TypeSafe-Danger-Zone-Images': 'true' },
    },
  });
}
const invalidRequests: [string, any, string][] = [
  ['no-image', { assets: {} }, 'image'],
  [
    'unused-image',
    {
      state: { photo: null },
      questions: { target: { type: 'box', instructions: 'Find it' } },
    },
    'not referenced',
  ],
  [
    'empty-instructions',
    { questions: { target: { type: 'box', instructions: ' ' } } },
    'instructions',
  ],
  [
    'criteria',
    { questions: { target: { ...request.questions.target, criteria: null } } },
    'criteria',
  ],
  ['gif', { assets: { photo: { ...image, format: 'gif' } } }, 'PNG or JPEG'],
  [
    'base64',
    { assets: { photo: { ...image, data_base64: 'AA==' + '\n' } } },
    'base64',
  ],
  [
    'base64-final-linefeed',
    { assets: { photo: { ...image, data_base64: 'AAA\n' } } },
    'base64',
  ],
  [
    'base64-final-return',
    { assets: { photo: { ...image, data_base64: 'AAA\r' } } },
    'base64',
  ],
  [
    'data-url',
    {
      assets: {
        photo: { ...image, data_base64: 'data:image/png;base64,AAAA' },
      },
    },
    'base64',
  ],
  ['multipart', { assets: { photo: { ...image, part: 'file' } } }, 'multipart'],
  [
    'unicode-key-too-long',
    { state: '😀'.repeat(257), assets: { ['😀'.repeat(257)]: image } },
    'reference length',
  ],
];
for (const [name, patch, error] of invalidRequests) {
  const input = { ...request, ...patch };
  assert.throws(() => validateTypesafeRequest(input), new RegExp(error));
  write('axai', name, {
    kind: 'ai_typesafe_native',
    operation: 'system_one',
    request: input,
    expected_transport_request_count: 0,
    expected_error_contains: error,
  });
}
for (const [name, value] of [
  ['reversed', { ...box, top: 0.9 }],
  ['extra-edge', { ...box, width: 0.5 }],
  ['out-of-range', { ...box, left: -0.1 }],
  ['zero-area', { ...box, right: box.left }],
  ['boolean-edge', { ...box, top: true }],
  ['missing-edge', { bottom: 1, left: 0, right: 1 }],
] as const) {
  assert.throws(() => validateBox(value, 'target'), /box/);
  write('axai', `native-${name}`, {
    kind: 'ai_typesafe_native',
    operation: 'system_one',
    request,
    response: {
      ...raw,
      answers: { target: { ...raw.answers.target, box: value } },
    },
    expected_transport_request_count: 1,
    expected_error_contains: 'box',
  });
}
for (const signature of [
  'query:string -> target:box',
  'query:string -> target:box(evidence)',
  'query:string -> targets?:box[]',
  'query:string -> target:box(evidence, refusal return)',
]) {
  const sig = new AxSignature(signature);
  const name = signature.includes('refusal')
    ? 'refusal'
    : signature.includes('[]')
      ? 'array'
      : signature.includes('evidence')
        ? 'evidence'
        : 'plain';
  write('schema', `${name}-result`, {
    kind: 'json_schema',
    signature,
    target: 'outputs',
    schema_options: { decisionMode: 'result' },
    expected_schema: toJsonSchema(sig.getOutputFields(), 'Schema', {
      decisionMode: 'result',
    }),
  });
  write('schema', name, {
    kind: 'json_schema',
    signature,
    target: 'outputs',
    expected_schema: toJsonSchema(sig.getOutputFields(), 'Schema'),
  });
}
for (const [name, signature, value, native] of [
  ['plain', 'query:string -> target:box', { target: box }, undefined],
  [
    'elicited',
    'query:string -> target:box(evidence)',
    { target: { box } },
    undefined,
  ],
  [
    'native',
    'query:string -> target:box(evidence)',
    { target: { box } },
    { target: { confidence: 0.9 } },
  ],
  [
    'nested-array',
    'query:string -> group:object { targets?:box[] }',
    { group: { targets: [box, box] } },
    undefined,
  ],
  [
    'refusal',
    'query:string -> target:box(evidence, refusal return)',
    { target: { status: 'refused' } },
    undefined,
  ],
] as const) {
  const context = {
    provenance: native
      ? { source: 'native', provider: 'Typesafe', model: 'jev-1.14.0' }
      : { source: 'elicited', provider: 'AI' },
    ...(native ? { native } : {}),
  };
  const result = structuredClone(value);
  decodeDecisionValues(
    new AxSignature(signature).getOutputFields(),
    result as any,
    context as any
  );
  write('axgen', name, {
    kind: 'forward',
    signature,
    input: { query: 'Locate' },
    features: { structured_outputs: true },
    responses: [
      {
        results: [
          {
            index: 0,
            content: JSON.stringify(value),
            ...(native ? { decisionContext: context } : {}),
          },
        ],
      },
    ],
    expected_output: result,
    expected_request_count: 1,
  });
}
// Adapter references are opaque. Canonicalize only the UUIDs to the portable
// deterministic reference sequence; retain message order, assets and all values.
const sig = new AxSignature('photo:image -> target:box(evidence)');
const adapterRequest = {
  model: 'jev-1.14.0',
  chatPrompt: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', mimeType: 'image/png', image: image.data_base64 },
        { type: 'text', text: 'after' },
        {
          type: 'image',
          mimeType: 'image/jpeg',
          image: 'data:image/jpeg;base64,AAAA',
        },
      ],
    },
  ],
  modelConfig: { stream: false },
  responseFormat: {
    type: 'json_schema',
    schema: { name: 'box', schema: toJsonSchema(sig.getOutputFields()) },
    decisionFields: { target: { type: 'box', evidence: {} } },
  },
};
let payload: any;
const client = new AxAITypesafe({
  apiKey: 'test-key',
  options: {
    fetch: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json(raw);
    },
  },
});
const output = await client.chat(adapterRequest as any);
let canonical = JSON.stringify(payload);
Object.keys(payload.assets).forEach((key, index) => {
  canonical = canonical.replaceAll(key, `ax-image-${index}-ref`);
});
write('axai', 'adapter-images', {
  kind: 'ai_chat',
  provider: 'typesafe',
  request: adapterRequest,
  transport_responses: [raw],
  expected_output: output,
  expected_transport_request_count: 1,
  expected_transport_request: {
    json: JSON.parse(canonical),
    headers: { 'TypeSafe-Danger-Zone-Images': 'true' },
  },
});
let calls = 0;
const decisions = new AxAIOpenAIDecisions({
  apiKey: 'test-key',
  options: {
    fetch: async () => {
      calls++;
      throw new Error('unexpected transport');
    },
  },
});
await assert.rejects(decisions.chat(adapterRequest as any), /box/);
assert.equal(calls, 0);
write('axai', 'decisions-rejected', {
  kind: 'ai_chat',
  provider: 'openai-decisions',
  request: adapterRequest,
  expected_error_contains: 'box',
  expected_transport_request_count: 0,
});

const manyImagesRequest = structuredClone(adapterRequest);
manyImagesRequest.chatPrompt[0]!.content = Array.from({ length: 12 }, () => ({
  type: 'image',
  mimeType: 'image/png',
  image: image.data_base64,
}));
const manyOutput = await client.chat(manyImagesRequest as any);
let manyCanonical = JSON.stringify(payload);
Object.keys(payload.assets).forEach((key, index) => {
  manyCanonical = manyCanonical.replaceAll(key, `ax-image-${index}-ref`);
});
write('axai', 'adapter-many-images', {
  kind: 'ai_chat',
  provider: 'typesafe',
  request: manyImagesRequest,
  transport_responses: [raw],
  expected_output: manyOutput,
  expected_transport_request_count: 1,
  expected_transport_request: { json: JSON.parse(manyCanonical) },
});

const streamingValue = { target: { box } };
const streamingOutput = structuredClone(streamingValue);
decodeDecisionValues(
  new AxSignature('query:string -> target:box(evidence)').getOutputFields(),
  streamingOutput as any,
  { provenance: { source: 'elicited', provider: 'AI', model: 'actual-model' } }
);
const streamingContent = JSON.stringify(streamingValue);
const deltas = [];
const streamingModel = new AxMockAIService({
  name: 'AI',
  features: { structuredOutputs: true, streaming: true },
  chatResponse: new ReadableStream({
    start(controller) {
      controller.enqueue({
        results: [{ index: 0, content: streamingContent.slice(0, 35) }],
      });
      controller.enqueue({
        results: [{ index: 0, content: streamingContent.slice(35) }],
      });
      controller.enqueue({
        results: [{ index: 0, finishReason: 'stop' }],
        modelUsage: {
          ai: 'AI',
          model: 'actual-model',
          tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      });
      controller.close();
    },
  }),
});
for await (const delta of ax(
  'query:string -> target:box(evidence)'
).streamingForward(streamingModel, { query: 'Locate' }))
  deltas.push(delta);
write('axgen', 'streaming', {
  kind: 'streaming_forward',
  signature: 'query:string -> target:box(evidence)',
  input: { query: 'Locate' },
  features: { structured_outputs: true },
  responses: [
    {
      stream: [
        { results: [{ index: 0, content: streamingContent.slice(0, 35) }] },
        { results: [{ index: 0, content: streamingContent.slice(35) }] },
        {
          results: [{ index: 0, finish_reason: 'stop' }],
          modelUsage: {
            ai: 'AI',
            model: 'actual-model',
            tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
        },
      ],
    },
  ],
  expected_output: streamingOutput,
  expected_deltas: deltas,
  expected_request_count: 1,
});
