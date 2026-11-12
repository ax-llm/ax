import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxAIGoogleGeminiDecisions } from '../../../src/ax/ai/google-gemini-decisions/api.js';
import { googleGeminiDecisions } from '../../../src/ax/ai/google-gemini-decisions/client.js';
import type { AxAIGoogleGeminiDecisionsRequest } from '../../../src/ax/ai/google-gemini-decisions/types.js';
import type { AxChatRequest } from '../../../src/ax/ai/types.js';
import { toJsonSchema } from '../../../src/ax/dsp/jsonSchema.js';
import { AxSignature } from '../../../src/ax/dsp/sig.js';
import { ax } from '../../../src/ax/dsp/template.js';

const root = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const directory = join(root, 'ir/conformance/axai');
mkdirSync(directory, { recursive: true });
const provider = 'google-gemini-decisions';
const model = 'gemini-decision-1';
const url = 'https://generativelanguage.googleapis.com/v1beta/decisions';
const questions = {
  urgent: {
    type: 'noul',
    instructions: 'Is this urgent?',
    criteria: {
      true_description: 'Core task blocked',
      false_description: 'Routine request',
    },
  },
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
const response = { answers, usage };
const request = { input: 'Checkout is broken.', questions };
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, stable(child)])
        )
      : value;
function write(name: string, fixture: object, area = 'axai') {
  const dir = join(root, 'ir/conformance', area);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `google-decisions-${name}.json`),
    `${JSON.stringify(stable({ name: `google-decisions-${name}`, ...fixture }), null, 2)}\n`
  );
}
async function native(
  name: string,
  payload: unknown = request,
  raw: unknown = response,
  error?: string
) {
  let count = 0;
  let captured: unknown;
  const client = googleGeminiDecisions({
    apiKey: 'test-key',
    options: {
      fetch: async (_url, init) => {
        count++;
        captured = JSON.parse(String(init?.body));
        return Response.json(raw);
      },
    },
  });
  let output: unknown;
  try {
    output = await client.create(payload as AxAIGoogleGeminiDecisionsRequest);
  } catch (e) {
    assert.ok(error, `${name}: unexpected ${e}`);
    assert.ok(
      String(e).includes(error!),
      `${name}: expected ${error}, got ${e}`
    );
  }
  if (error) assert.equal(output, undefined);
  else assert.ok(output);
  write(`native-${name}`, {
    kind: 'ai_google_decisions_native',
    provider,
    request: payload,
    response: raw,
    ...(error
      ? { expected_error_contains: error }
      : { expected_output: output }),
    expected_transport_request_count: count,
    ...(count
      ? {
          expected_transport_request: {
            method: 'POST',
            url,
            json: captured,
            headers: { 'x-goog-api-key': 'test-key' },
          },
        }
      : {}),
  });
}
await native('questions');
await native(
  'text-blocks',
  {
    ...request,
    input: [
      { type: 'text', text: 'First\n' },
      { type: 'text', text: 'Second' },
    ],
    questions: {
      urgent: {
        type: 'noul',
        instructions: [
          { type: 'text', text: 'Is this ' },
          { type: 'text', text: 'urgent?' },
        ],
      },
    },
  },
  { answers: { urgent: answers.urgent }, usage }
);
for (const [name, block] of [
  [
    'image',
    {
      type: 'image',
      mime_type: 'image/png',
      data: 'YQ==',
      resolution: 'ultra_high',
    },
  ],
  ['audio', { type: 'audio', mime_type: 'audio/mpeg', data: 'YQ==' }],
  [
    'video',
    {
      type: 'video',
      mime_type: 'video/mp4',
      uri: 'https://example.com/clip.mp4',
      resolution: 'low',
    },
  ],
  [
    'pdf',
    {
      type: 'document',
      mime_type: 'application/pdf',
      uri: 'https://generativelanguage.googleapis.com/v1beta/files/sample',
    },
  ],
] as const)
  await native(name, { ...request, input: block });
const levels = Array.from({ length: 255 }, (_, i) => `Level ${i}`);
await native(
  '255-levels',
  {
    input: 'Rate this',
    questions: {
      severity: {
        type: 'score',
        instructions: 'How severe?',
        criteria: levels,
      },
    },
  },
  {
    answers: {
      severity: {
        type: 'score',
        score: 254,
        confidence: 1,
        probabilities: Object.fromEntries(
          levels.map((_, i) => [i, i === 254 ? 1 : 0])
        ),
        legend: Object.fromEntries(levels.map((label, i) => [i, label])),
      },
    },
    usage,
  }
);
await native(
  'unicode-options',
  {
    input: 'Route this',
    questions: {
      team: {
        type: 'choice',
        instructions: 'Which team?',
        criteria: { 帮助: '', '🧑‍💻 engineering': '' },
      },
    },
  },
  {
    answers: {
      team: {
        type: 'choice',
        choice: '帮助',
        probabilities: { 帮助: 0.9, '🧑‍💻 engineering': 0.1 },
        confidence: 0.9,
      },
    },
    usage,
  }
);
for (const [name, patch, error] of [
  ['empty-input', { input: '' }, 'input'],
  ['empty-questions', { questions: {} }, 'questions'],
  [
    'invalid-key',
    { questions: { 'bad key': questions.urgent } },
    'question keys',
  ],
  [
    'missing-instructions',
    { questions: { urgent: { type: 'noul' } } },
    'object',
  ],
  [
    'non-text-instructions',
    {
      questions: {
        urgent: {
          type: 'noul',
          instructions: [{ type: 'image', data: 'YQ==' }],
        },
      },
    },
    'text only',
  ],
  [
    'later-invalid-text',
    {
      input: [
        { type: 'text', text: 'Valid' },
        { type: 'text', text: 42 },
      ],
    },
    'input text',
  ],
  [
    'sparse-instructions',
    {
      questions: {
        urgent: {
          type: 'noul',
          instructions: [{ type: 'text', text: 'Valid' }, null],
        },
      },
    },
    'object',
  ],
  [
    'noul-criteria',
    {
      questions: {
        urgent: { ...questions.urgent, criteria: { true: 'wrong key' } },
      },
    },
    'noul criterion',
  ],
  [
    'single-choice',
    { questions: { team: { ...questions.team, criteria: { only: '' } } } },
    'choice',
  ],
  [
    'spaced-option',
    {
      questions: {
        team: { ...questions.team, criteria: { ' trailing ': '', valid: '' } },
      },
    },
    'option key',
  ],
  [
    'unicode-space-option',
    {
      questions: {
        team: {
          ...questions.team,
          criteria: { 'non\u00a0ascii': '', valid: '' },
        },
      },
    },
    'option key',
  ],
  [
    'empty-score-level',
    {
      questions: {
        severity: { ...questions.severity, criteria: ['Valid', ''] },
      },
    },
    'criteria',
  ],
  [
    'unknown-question',
    { questions: { urgent: { type: 'box', instructions: 'Find it' } } },
    'question type',
  ],
  [
    'media-base64',
    {
      input: [
        {
          type: 'image',
          mime_type: 'image/png',
          data: 'data:image/png;base64,YQ==',
        },
      ],
    },
    'base64',
  ],
  [
    'media-gcs',
    {
      input: [
        { type: 'video', mime_type: 'video/mp4', uri: 'gs://bucket/clip' },
      ],
    },
    'HTTPS',
  ],
  [
    'media-youtube',
    {
      input: [
        { type: 'video', mime_type: 'video/mp4', uri: 'https://youtu.be/x' },
      ],
    },
    'YouTube',
  ],
  [
    'mime-mismatch',
    {
      input: [
        { type: 'audio', mime_type: 'application/octet-stream', data: 'YQ==' },
      ],
    },
    'MIME type',
  ],
  [
    'non-pdf',
    { input: [{ type: 'document', mime_type: 'text/plain', data: 'YQ==' }] },
    'MIME type',
  ],
  [
    'audio-resolution',
    {
      input: [
        {
          type: 'audio',
          mime_type: 'audio/mpeg',
          data: 'YQ==',
          resolution: 'high',
        },
      ],
    },
    'resolution',
  ],
  [
    'both-media-sources',
    {
      input: [
        {
          type: 'image',
          mime_type: 'image/png',
          data: 'YQ==',
          uri: 'https://example.com/image',
        },
      ],
    },
    'exactly one',
  ],
] as const)
  await native(name, { ...request, ...patch }, response, error);
for (const [name, patch, error] of [
  [
    'missing-answer',
    { answers: { urgent: answers.urgent, team: answers.team } },
    'answer keys',
  ],
  [
    'unknown-answer',
    { answers: { ...answers, extra: answers.urgent } },
    'answer keys',
  ],
  [
    'wrong-type',
    { answers: { ...answers, urgent: { ...answers.urgent, type: 'choice' } } },
    'incorrect answer type',
  ],
  [
    'noul-range',
    { answers: { ...answers, urgent: { ...answers.urgent, noul: 1 } } },
    'noul',
  ],
  [
    'confidence',
    { answers: { ...answers, urgent: { ...answers.urgent, confidence: -1 } } },
    'confidence',
  ],
  [
    'choice',
    { answers: { ...answers, team: { ...answers.team, choice: 'unknown' } } },
    'choice',
  ],
  [
    'distribution',
    {
      answers: {
        ...answers,
        team: {
          ...answers.team,
          probabilities: { support: 0.2, billing: 0.5 },
        },
      },
    },
    'distribution',
  ],
  [
    'missing-probability',
    {
      answers: {
        ...answers,
        team: { ...answers.team, probabilities: { support: 1 } },
      },
    },
    'distribution',
  ],
  [
    'legend',
    {
      answers: {
        ...answers,
        severity: {
          ...answers.severity,
          legend: { '0': 'Wrong', '1': 'Blocked' },
        },
      },
    },
    'legend',
  ],
  [
    'output-tokens',
    { usage: { ...usage, total_output_tokens: 1 } },
    'zero output',
  ],
  ['negative-tokens', { usage: { ...usage, total_input_tokens: -1 } }, 'token'],
  [
    'modality',
    {
      usage: {
        ...usage,
        input_tokens_by_modality: [{ modality: 'video', tokens: 20 }],
      },
    },
    'modality',
  ],
] as const)
  await native(`malformed-${name}`, request, { ...response, ...patch }, error);
await native('rounded-distribution', request, {
  ...response,
  answers: {
    ...answers,
    team: { ...answers.team, probabilities: { support: 0.2, billing: 0.79 } },
  },
});

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
          urgent: { type: 'boolean', description: 'Is this urgent?' },
          team: {
            type: 'string',
            enum: ['support', 'billing'],
            description: 'Which team?',
          },
        },
        required: ['urgent', 'team'],
      },
    },
    fieldDescriptions: {
      urgent: {
        description: 'Is this urgent?',
        valueDescriptions: {
          true: 'Core task blocked',
          false: 'Routine request',
        },
      },
      team: {
        description: 'Which team?',
        valueDescriptions: { billing: 'Invoice problems' },
      },
    },
  },
  modelConfig: { stream: false },
};
const chatResponse = {
  answers: { urgent: answers.urgent, team: answers.team },
  usage,
};
async function adapter(
  name: string,
  req = chat,
  raw: unknown = chatResponse,
  options: object = {},
  error?: string
) {
  let count = 0;
  let captured: unknown;
  const client = new AxAIGoogleGeminiDecisions({
    name: provider,
    apiKey: 'test-key',
    ...options,
    options: {
      fetch: async (_url, init) => {
        count++;
        captured = JSON.parse(String(init?.body));
        return Response.json(raw);
      },
    },
  });
  let output: unknown;
  try {
    output = await client.chat(req);
  } catch (e) {
    assert.ok(error, `${name}: unexpected ${e}`);
    assert.ok(
      String(e).includes(error!),
      `${name}: expected ${error}, got ${e}`
    );
  }
  if (error) assert.equal(output, undefined);
  else assert.ok(output);
  write(`adapter-${name}`, {
    kind: 'ai_chat',
    provider,
    model,
    request: req,
    service_options: options,
    transport_responses: [raw],
    ...(error
      ? { expected_error_contains: error }
      : { expected_output: output }),
    expected_transport_request_count: count,
    ...(count
      ? {
          expected_transport_request: {
            method: 'POST',
            url,
            json: captured,
            headers: { 'x-goog-api-key': 'test-key' },
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
await adapter('signature');
await adapter(
  'required-list',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { urgent: { type: 'boolean' } },
          required: 'urgent',
        },
      },
    },
  } as unknown as AxChatRequest,
  chatResponse,
  {},
  'cannot evaluate'
);
await adapter(
  'empty-schema',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: { type: 'object', properties: {}, required: [] },
      },
    },
  },
  chatResponse,
  {},
  'at least one output field'
);
await adapter(
  'root-composition',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { urgent: { type: 'boolean' } },
          required: ['urgent'],
          allOf: [],
        },
      },
    },
  } as unknown as AxChatRequest,
  chatResponse,
  {},
  'flat object'
);
await adapter(
  'evidence-composition',
  {
    ...chat,
    responseFormat: {
      type: 'json_schema',
      schema: {
        name: 'output',
        schema: {
          type: 'object',
          properties: { urgent: { type: 'object', oneOf: [] } },
          required: ['urgent'],
        },
      },
      decisionFields: { urgent: { type: 'boolean', evidence: {} } },
    },
  } as unknown as AxChatRequest,
  chatResponse,
  {},
  'cannot evaluate'
);

await adapter('threshold', chat, chatResponse, { trueThreshold: 0.95 });
await adapter('media', {
  ...chat,
  chatPrompt: [
    { role: 'system', content: 'Review media.' },
    { role: 'assistant', content: 'Previous answer' },
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
        { type: 'audio', format: 'pcm16', sampleRate: 16000, data: 'YQ==' },
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
for (const [name, field] of [
  ['freeform', { type: 'string' }],
  ['array', { type: 'array', items: { type: 'boolean' } }],
  ['nested', { type: 'object', properties: { child: { type: 'boolean' } } }],
] as const)
  await adapter(
    name,
    {
      ...chat,
      responseFormat: {
        type: 'json_schema',
        schema: {
          name: 'output',
          schema: {
            type: 'object',
            properties: { urgent: field },
            required: ['urgent'],
          },
        },
      },
    },
    chatResponse,
    {},
    'cannot evaluate'
  );
await adapter(
  'optional',
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
  chatResponse,
  {},
  'cannot evaluate'
);
await adapter(
  'generation-control',
  { ...chat, modelConfig: { maxTokens: 20 } },
  chatResponse,
  {},
  'generation control'
);
await adapter(
  'tools',
  {
    ...chat,
    functions: [
      {
        name: 'lookup',
        description: 'Lookup',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
  chatResponse,
  {},
  'does not support tools'
);
await adapter(
  'tool-history',
  {
    ...chat,
    chatPrompt: [{ role: 'function', functionId: 'call', result: 'Done' }],
  },
  chatResponse,
  {},
  'tool or media history'
);
await adapter(
  'url-context',
  {
    ...chat,
    chatPrompt: [
      { role: 'user', content: [{ type: 'url', url: 'https://example.com' }] },
    ],
  },
  chatResponse,
  {},
  'URL context'
);
// Exercise boolean confidence and score decoding through AxGen, not only the adapter.
const program = ax(
  'ticket:string -> urgent:boolean(evidence, threshold 0.95), team:class "support, billing"(evidence), severity:score "Minor, Blocked"(evidence)'
);
const client = new AxAIGoogleGeminiDecisions({
  name: provider,
  apiKey: 'test-key',
  options: { fetch: async () => Response.json(response) },
});
const values = { ticket: 'Checkout is broken.' };
let capturedRequest: AxChatRequest | undefined;
let normalizedResponse: unknown;
const chatCall = client.chat.bind(client);
client.chat = async (request, options) => {
  capturedRequest = request;
  const result = await chatCall(request, options);
  normalizedResponse = result;
  return result;
};
const expected = await program.forward(client, values);
assert.ok(capturedRequest);
await adapter('evidence', capturedRequest, response);
write(
  'evidence',
  {
    kind: 'forward',
    signature: program.getSignature().toString(),
    input: values,
    features: { structured_outputs: true },
    responses: [normalizedResponse],
    expected_output: expected,
    expected_request_count: 1,
  },
  'axgen'
);

for (const [name, signature] of [
  ['boolean-result-schema', 'ticket:string -> urgent:boolean(evidence)'],
  [
    'boolean-refusal-result-schema',
    'ticket:string -> urgent:boolean(evidence, refusal return)',
  ],
]) {
  const signatureObject = new AxSignature(signature);
  write(
    name!,
    {
      kind: 'json_schema',
      signature,
      target: 'outputs',
      schema_options: { decisionMode: 'result' },
      expected_schema: toJsonSchema(
        signatureObject.getOutputFields(),
        'Schema',
        { decisionMode: 'result' }
      ),
    },
    'schema'
  );
}
