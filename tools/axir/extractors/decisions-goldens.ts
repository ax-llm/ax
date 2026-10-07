import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxAIOpenAIDecisions } from '../../../src/ax/ai/openai-decisions/api.js';
import { openaiDecisions } from '../../../src/ax/ai/openai-decisions/client.js';
import type { AxAIOpenAIDecisionsRequest } from '../../../src/ax/ai/openai-decisions/types.js';
import type { AxChatRequest } from '../../../src/ax/ai/types.js';

const out = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axai'
);
mkdirSync(out, { recursive: true });
function stable(value: unknown, preserveOrder = false): unknown {
  if (Array.isArray(value))
    return value.map((item) => stable(item, preserveOrder));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (preserveOrder ? 0 : a.localeCompare(b)))
        .map(([k, v]) => [k, stable(v, preserveOrder || k === 'request')])
    );
  return value;
}
function write(name: string, fixture: object) {
  writeFileSync(
    join(out, `decisions-${name}.json`),
    `${JSON.stringify(stable({ name: `decisions-${name}`, ...fixture }), null, 2)}\n`
  );
}
const usage = {
  input_tokens: 20,
  output_tokens: 3,
  total_tokens: 23,
  input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
  output_tokens_details: { reasoning_tokens: 1 },
};
const questions = [
  {
    type: 'predicate',
    name: 'urgent',
    instructions: 'Does this need immediate attention?',
  },
  {
    type: 'choice',
    name: 'route',
    instructions: 'Choose the route.',
    choices: [{ value: true }, { value: 'true' }, { value: false }],
  },
  {
    type: 'score',
    name: 'severity',
    instructions: 'Rate the severity.',
    levels: [{ label: 'Minor' }, { label: 'Blocked' }, { label: 'Outage' }],
  },
] as const;
const answers = [
  { type: 'predicate', name: 'urgent', probability: 0.5 },
  {
    type: 'choice',
    name: 'route',
    choice: true,
    confidence: 0.6,
    probabilities: [
      { value: true, probability: 0.6 },
      { value: 'true', probability: 0.3 },
      { value: false, probability: 0.1 },
    ],
  },
  {
    type: 'score',
    name: 'severity',
    score: 1.5,
    confidence: 0.7,
    probabilities: [
      { value: 0, label: 'Minor', probability: 0.1 },
      { value: 1, label: 'Blocked', probability: 0.3 },
      { value: 2, label: 'Outage', probability: 0.6 },
    ],
  },
];
const request = { input: 'Checkout is broken.', questions };
const response = { model: 'gpt-6-luna', answers, usage };
async function native(
  name: string,
  input: unknown,
  raw: unknown,
  error?: string
) {
  let captured: unknown;
  let count = 0;
  const client = openaiDecisions({
    apiKey: 'test-key',
    options: {
      fetch: async (_url, init) => {
        count++;
        captured = JSON.parse(String(init?.body));
        return Response.json(raw);
      },
    },
  });
  let result: unknown;
  try {
    result = await client.create(input as AxAIOpenAIDecisionsRequest);
  } catch (e) {
    assert.ok(error, `${name}: unexpected ${e}`);
    assert.ok(String(e).includes(error!), `${name}: missing ${error} in ${e}`);
  }
  if (!error) assert.ok(result, `${name}: no result`);
  else assert.equal(result, undefined, `${name}: expected error`);
  write(`native-${name}`, {
    kind: 'ai_decisions_native',
    request: input,
    response: raw,
    ...(error
      ? { expected_error_contains: error }
      : { expected_output: result }),
    expected_transport_request_count: count,
    ...(count
      ? {
          expected_transport_request: {
            method: 'POST',
            url: 'https://api.openai.com/v1/decisions',
            json: captured,
          },
        }
      : {}),
  });
}
await native('rich-questions', request, response);
await native(
  'null-name',
  { input: '', questions: [{ type: 'predicate', instructions: '' }] },
  {
    model: 'gpt-6-luna',
    answers: [{ type: 'predicate', name: null, probability: 1 }],
    usage,
  }
);
await native(
  'empty-names-labels',
  {
    input: '',
    questions: [
      {
        type: 'choice',
        name: '',
        instructions: '',
        choices: [{ value: '' }, { value: false }],
      },
    ],
  },
  {
    model: 'gpt-6-luna',
    answers: [
      {
        type: 'choice',
        name: '',
        choice: '',
        confidence: 0.8,
        probabilities: [
          { value: '', probability: 0.8 },
          { value: false, probability: 0.2 },
        ],
      },
    ],
    usage,
  }
);
await native('refusal', request, {
  ...response,
  answers: [{ type: 'refusal', name: 'urgent' }, answers[1], answers[2]],
});
await native(
  'inline-image',
  {
    ...request,
    input: [
      {
        role: 'user',
        type: 'message',
        content: [
          { type: 'input_text', text: '' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,YQ==',
            detail: 'original',
          },
        ],
      },
    ],
  },
  response
);
const image = { type: 'input_image', image_url: 'data:image/png;base64,YQ==' };
await native(
  '128-images',
  {
    ...request,
    input: [
      { role: 'user', content: Array.from({ length: 128 }, () => image) },
    ],
  },
  response
);
await native(
  '129-images',
  {
    ...request,
    input: [
      { role: 'user', content: Array.from({ length: 129 }, () => image) },
    ],
  },
  response,
  '128 images'
);
for (const [kind, max] of [
  ['choice', 255],
  ['score', 10],
] as const) {
  for (const size of [2, max, max + 1, 1]) {
    const options = Array.from({ length: size }, (_, i) =>
      kind === 'choice' ? { value: String(i) } : { label: String(i) }
    );
    const q = {
      type: kind,
      name: 'result',
      instructions: 'Choose.',
      [kind === 'choice' ? 'choices' : 'levels']: options,
    };
    const a =
      kind === 'choice'
        ? {
            type: kind,
            name: 'result',
            choice: '0',
            confidence: 1,
            probabilities: options.map((_, i) => ({
              value: String(i),
              probability: i === 0 ? 1 : 0,
            })),
          }
        : {
            type: kind,
            name: 'result',
            score: 0,
            confidence: 1,
            probabilities: options.map((_, i) => ({
              value: i,
              label: String(i),
              probability: i === 0 ? 1 : 0,
            })),
          };
    await native(
      `${kind}-${size}-options`,
      { input: '', questions: [q] },
      { model: 'gpt-6-luna', answers: [a], usage },
      size < 2 || size > max ? kind : undefined
    );
  }
}
for (const total of [0.99, 1.01, 0.989, 1.011]) {
  await native(
    `distribution-${String(total).replace('.', '-')}`,
    { input: '', questions: [questions[1]] },
    {
      ...response,
      answers: [
        {
          ...answers[1],
          probabilities: [
            { value: true, probability: total - 0.2 },
            { value: 'true', probability: 0.1 },
            { value: false, probability: 0.1 },
          ],
        },
      ],
    },
    total < 0.99 || total > 1.01 ? 'distribution' : undefined
  );
}
const invalidRequests: [string, unknown, string][] = [
  [
    'null-message-type',
    { ...request, input: [{ role: 'user', type: null, content: 'text' }] },
    'user',
  ],
  ['empty-questions', { ...request, questions: [] }, 'question'],
  ['missing-input', { questions }, 'input'],
  ['blank-model', { ...request, model: ' ' }, 'model'],
  [
    'invalid-message-type',
    { ...request, input: [{ role: 'user', type: 'other', content: 'text' }] },
    'user',
  ],
  [
    'system-role',
    { ...request, input: [{ role: 'system', content: 'Secret instructions' }] },
    'user',
  ],
  ['empty-input-array', { ...request, input: [] }, 'input'],
  [
    'empty-content',
    { ...request, input: [{ role: 'user', content: [] }] },
    'input',
  ],
  [
    'hosted-image',
    {
      ...request,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'https://example.com/image.png' },
          ],
        },
      ],
    },
    'inline base64',
  ],
  [
    'invalid-image-detail',
    {
      ...request,
      input: [{ role: 'user', content: [{ ...image, detail: 'giant' }] }],
    },
    'image detail',
  ],
  [
    'audio-input',
    {
      ...request,
      input: [
        { role: 'user', content: [{ type: 'input_audio', data: 'YQ==' }] },
      ],
    },
    'inline base64',
  ],
  [
    'duplicate-name',
    { ...request, questions: [questions[0], questions[0]] },
    'duplicate question name',
  ],
  [
    'null-name-request',
    { ...request, questions: [{ ...questions[0], name: null }] },
    'question name',
  ],
  [
    'missing-instructions',
    { ...request, questions: [{ type: 'predicate' }] },
    'instructions',
  ],
  [
    'duplicate-choice',
    {
      ...request,
      questions: [
        { ...questions[1], choices: [{ value: true }, { value: true }] },
      ],
    },
    'duplicate option',
  ],
  [
    'duplicate-score-label',
    {
      ...request,
      questions: [
        { ...questions[2], levels: [{ label: 'A' }, { label: 'A' }] },
      ],
    },
    'duplicate option',
  ],
  [
    'numeric-choice',
    {
      ...request,
      questions: [{ ...questions[1], choices: [{ value: 1 }, { value: 2 }] }],
    },
    'option value',
  ],
  [
    'numeric-level',
    {
      ...request,
      questions: [{ ...questions[2], levels: [{ label: 1 }, { label: 2 }] }],
    },
    'option value',
  ],
  [
    'null-description',
    {
      ...request,
      questions: [
        {
          ...questions[1],
          choices: [{ value: true, description: null }, { value: false }],
        },
      ],
    },
    'description',
  ],
];
for (const [name, input, error] of invalidRequests)
  await native(name, input, response, error);
const changed = (i: number, patch: object) => ({
  ...response,
  answers: answers.map((a, index) => (index === i ? { ...a, ...patch } : a)),
});
const invalidResponses: [string, unknown, string][] = [
  [
    'missing-answer-name',
    {
      ...response,
      answers: [
        { type: 'predicate', probability: 0.8 },
        answers[1],
        answers[2],
      ],
    },
    'answer name',
  ],
  ['boolean-score', changed(2, { score: true }), 'score'],
  ['missing-answer', { ...response, answers: answers.slice(1) }, 'answers'],
  ['wrong-name', changed(0, { name: 'route' }), 'answer name'],
  ['wrong-type', changed(0, { type: 'choice' }), 'answer type'],
  ['bad-probability', changed(0, { probability: 2 }), 'probability'],
  ['boolean-probability', changed(0, { probability: true }), 'probability'],
  ['bad-confidence', changed(1, { confidence: -0.1 }), 'confidence'],
  ['unknown-choice', changed(1, { choice: 'other' }), 'choice'],
  ['numeric-choice-answer', changed(1, { choice: 1 }), 'choice'],
  ['missing-distribution', changed(1, { probabilities: [] }), 'probabilities'],
  [
    'duplicate-distribution',
    changed(1, {
      probabilities: [
        { value: true, probability: 0.6 },
        { value: true, probability: 0.3 },
        { value: false, probability: 0.1 },
      ],
    }),
    'probability value',
  ],
  [
    'wrong-score-label',
    changed(2, {
      probabilities: [
        { value: 0, label: 'Wrong', probability: 0.1 },
        { value: 1, label: 'Blocked', probability: 0.3 },
        { value: 2, label: 'Outage', probability: 0.6 },
      ],
    }),
    'score label',
  ],
  ['score-outside', changed(2, { score: 3 }), 'score'],
  [
    'fractional-usage',
    { ...response, usage: { ...usage, total_tokens: 23.5 } },
    'token',
  ],
  [
    'negative-usage',
    { ...response, usage: { ...usage, input_tokens: -1 } },
    'token',
  ],
  [
    'missing-cache-detail',
    {
      ...response,
      usage: { ...usage, input_tokens_details: { cached_tokens: 4 } },
    },
    'token',
  ],
];
for (const [name, raw, error] of invalidResponses)
  await native(name, request, raw, error);

const chat: AxChatRequest = {
  chatPrompt: [
    { role: 'system', content: 'Classify the supplied evidence.' },
    { role: 'user', content: 'Checkout is broken.' },
  ],
  responseFormat: {
    type: 'json_schema',
    schema: {
      name: 'output',
      schema: {
        type: 'object',
        properties: {
          urgent: { type: 'boolean', description: 'Urgent?' },
          team: { type: 'string', enum: ['support', 'billing'] },
        },
        required: ['urgent', 'team'],
        additionalProperties: false,
      },
    },
    fieldDescriptions: {
      urgent: {
        description: 'Urgent?',
        valueDescriptions: { true: 'Blocked', false: 'Routine' },
      },
      team: {
        description: 'Route the issue.',
        valueDescriptions: { billing: 'Invoice issues' },
      },
    },
  },
  modelConfig: { stream: false },
};
const chatRaw = {
  ...response,
  answers: [
    answers[0],
    {
      type: 'choice',
      name: 'team',
      choice: 'support',
      confidence: 0.8,
      probabilities: [
        { value: 'support', probability: 0.8 },
        { value: 'billing', probability: 0.2 },
      ],
    },
  ],
};
async function adapter(
  name: string,
  input: AxChatRequest,
  raw: unknown,
  serviceOptions: object = {},
  error?: string
) {
  let captured: unknown;
  let count = 0;
  const client = new AxAIOpenAIDecisions({
    name: 'openai-decisions',
    apiKey: 'test-key',
    ...serviceOptions,
    options: {
      fetch: async (_url, init) => {
        count++;
        captured = JSON.parse(String(init?.body));
        return Response.json(raw);
      },
    },
  });
  let result: unknown;
  try {
    result = await client.chat(input);
  } catch (e) {
    assert.ok(error, `${name}: unexpected ${e}`);
    assert.ok(String(e).includes(error!), `${name}: missing ${error} in ${e}`);
  }
  if (error) assert.equal(result, undefined, `${name}: expected error`);
  else assert.ok(result);
  write(`adapter-${name}`, {
    kind: 'ai_chat',
    provider: 'openai-decisions',
    model: 'gpt-6-luna',
    request: input,
    service_options: serviceOptions,
    transport_responses: [raw],
    ...(error
      ? { expected_error_contains: error }
      : { expected_output: result }),
    expected_transport_request_count: count,
    ...(count
      ? {
          expected_transport_request: {
            method: 'POST',
            url: 'https://api.openai.com/v1/decisions',
            json: captured,
          },
          expected_transport_json_absent: [
            'stream',
            'temperature',
            'trueThreshold',
          ],
        }
      : {}),
  });
}
await adapter('descriptions', chat, chatRaw, {
  safetyIdentifier: 'customer-1',
});
await adapter('threshold-inclusive', chat, chatRaw);
await adapter('threshold-custom', chat, chatRaw, { trueThreshold: 0.6 });
await adapter(
  'image',
  {
    ...chat,
    chatPrompt: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Is this red?' },
          {
            type: 'image',
            mimeType: 'image/png',
            image: 'YQ==',
            details: 'low',
          },
        ],
      },
    ],
  },
  chatRaw
);
await adapter(
  'refusal',
  chat,
  {
    ...chatRaw,
    answers: [{ type: 'refusal', name: 'urgent' }, chatRaw.answers[1]],
  },
  {},
  'refused question'
);
await adapter(
  'unsupported-number',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { count: { type: 'number' } },
          required: ['count'],
        },
      },
    },
  },
  chatRaw,
  {},
  'required boolean or class'
);
await adapter(
  'optional-field',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { urgent: { type: 'boolean' } },
          required: [],
        },
      },
    },
  },
  chatRaw,
  {},
  'required boolean or class'
);
await adapter(
  'sampling-control',
  { ...chat, modelConfig: { temperature: 0.3 } },
  chatRaw,
  {},
  'generation control'
);
await adapter(
  'tool-history',
  {
    ...chat,
    chatPrompt: [{ role: 'function', functionId: 'tool', result: 'done' }],
  },
  chatRaw,
  {},
  'tool or media history'
);
console.log(
  'Decisions native and signature fixtures derived from the TypeScript implementation.'
);
