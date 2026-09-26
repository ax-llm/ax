import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type extractionState,
  extractValues,
  streamingExtractFinalValue,
  streamingExtractValues,
} from '../../../src/ax/dsp/extract.js';
import { createStructuredDelta } from '../../../src/ax/dsp/response/structuredDelta.js';
import { AxSignature, f } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axgen'
);

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'inputs' ||
      parentKey === 'outputs' ||
      parentKey === 'fields' ||
      parentKey === 'input' ||
      parentKey === 'output' ||
      parentKey === 'expected_output'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [key, stable(item, key)])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Fixture): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

function touchReferenceBehavior(): void {
  AxSignature.create('question:string -> answer:string');
  f()
    .input('document', f.string('Cached document').cache())
    .input('question', f.string())
    .output('answer', f.string())
    .build();
}

mkdirSync(outDir, { recursive: true });
touchReferenceBehavior();

writeFixture('examples-demos-render', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Current question?' },
  examples: [
    {
      input: { question: 'Example question?' },
      output: { answer: 'Example answer' },
    },
  ],
  demos: [
    {
      input: { question: 'Demo question?' },
      output: { answer: 'Demo answer' },
    },
  ],
  responses: [{ content: '{"answer":"Current answer"}' }],
  expected_output: { answer: 'Current answer' },
  expected_request_contains: [
    'Example question?',
    'Example answer',
    'Demo question?',
    'Demo answer',
    'Current question?',
  ],
  expected_request_count: 1,
});

writeFixture('assertion-retry', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Say the good word' },
  assertions: [
    {
      field: 'answer',
      contains: 'good',
      message: 'answer must contain good',
    },
  ],
  responses: [
    { content: '{"answer":"bad"}' },
    { content: '{"answer":"good"}' },
  ],
  expected_output: { answer: 'good' },
  expected_request_contains: [
    'answer must contain good',
    'Return only corrected JSON',
  ],
  expected_request_count: 2,
});

writeFixture('field-processor', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Capital?' },
  field_processors: [{ field: 'answer', op: 'uppercase' }],
  responses: [{ content: '{"answer":"paris"}' }],
  expected_output: { answer: 'PARIS' },
  expected_request_count: 1,
});

writeFixture('trace-capture', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Trace me' },
  responses: [{ content: '{"answer":"traced"}' }],
  expected_output: { answer: 'traced' },
  expected_trace: {
    status: 'ok',
    input: { question: 'Trace me' },
    output: { answer: 'traced' },
  },
  expected_request_count: 1,
});

// As in TS, a user stop function ends the forward without an answer: the
// tool still runs, but its result is not the output, and neither is any
// content or the stop step's thought. Earlier steps' thought is kept. The
// outputs match a TS AxMockAIService probe.
const stopSearchTool = {
  name: 'search',
  description: 'Search docs',
  args: { query: { type: 'string', min: 1 } },
  returns: { answer: { type: 'string' } },
  result: { answer: 'Found directly' },
};

writeFixture('stop-function-empty-output', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [stopSearchTool],
  stop_functions: ['search'],
  responses: [
    {
      content: '',
      function_calls: [
        { id: 'call_1', name: 'search', params: { query: 'ax docs' } },
      ],
    },
  ],
  expected_output: {},
  expected_tool_calls: [{ name: 'search', args: { query: 'ax docs' } }],
  expected_request_count: 1,
});

writeFixture('stop-function-keeps-earlier-thought', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [
    stopSearchTool,
    {
      name: 'lookup',
      description: 'Look up a key',
      args: { key: { type: 'string' } },
      result: 'status is green',
    },
  ],
  stop_functions: ['search'],
  responses: [
    {
      results: [
        {
          index: 0,
          content: '',
          thought: 'Look it up',
          function_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'lookup', params: { key: 'a' } },
            },
          ],
          finish_reason: 'function_call',
        },
      ],
    },
    {
      results: [
        {
          index: 0,
          content: '',
          thought: 'Stop here',
          function_calls: [
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'search', params: { query: 'ax docs' } },
            },
          ],
          finish_reason: 'function_call',
        },
      ],
    },
  ],
  expected_output: { thought: 'Look it up' },
  expected_request_count: 2,
});

writeFixture('cache-field-prompt-rendering', {
  kind: 'forward',
  signature_spec: {
    inputs: {
      document: { type: 'string', description: 'Cached document', cache: true },
      question: { type: 'string' },
    },
    outputs: {
      answer: { type: 'string' },
    },
  },
  input: { document: 'Cached text', question: 'What is inside?' },
  responses: [{ content: '{"answer":"Cached text"}' }],
  expected_output: { answer: 'Cached text' },
  expected_request_contains: ['Cached text', 'cache'],
  expected_request_count: 1,
});

writeFixture('structured-stream-rich', {
  kind: 'stream',
  stream_events: [
    { data: { results: [{ content: '{"items":[' }] } },
    { data: { delta: '{"name":"alpha"}' } },
    { data: { content_delta: ',{"name":"beta"}' } },
    { data: { contentDelta: ']}' } },
    { type: 'message_stop' },
  ],
  expected_folded: '{"items":[{"name":"alpha"},{"name":"beta"}]}',
});

const structuredDeltaSig = f()
  .input('question', f.string())
  .output(
    'items',
    f
      .object({
        id: f.number(),
        name: f.string(),
      })
      .array()
  )
  .output('summary', f.string())
  .output('count', f.number())
  .output('scratch', f.string().internal())
  .build();
const firstItem = { id: 1, name: 'First' };
const secondItem = { id: 2, name: 'Second' };
const incompleteMarker = {
  nestingLevel: 2,
  inString: false,
  inArray: true,
  inObject: true,
};
const structuredParsedStates: Array<{
  parsedValues: Record<string, unknown>;
  partialMarker: typeof incompleteMarker | null;
}> = [
  {
    parsedValues: {
      items: [{ id: 1, name: 'Fir' }],
      summary: 'Hel',
      count: 1,
      scratch: 'hidden-1',
    },
    partialMarker: incompleteMarker,
  },
  {
    parsedValues: {
      items: [firstItem, { id: 2 }],
      summary: 'Hello',
      count: 1,
      scratch: 'hidden-2',
    },
    partialMarker: incompleteMarker,
  },
  {
    parsedValues: {
      items: [firstItem, secondItem],
      summary: 'Hello',
      count: 1,
      scratch: 'hidden-3',
    },
    partialMarker: null,
  },
  {
    parsedValues: {
      items: [firstItem, secondItem],
      summary: 'Hello',
      count: 1,
      scratch: 'hidden-4',
    },
    partialMarker: null,
  },
];
let structuredPreviousValues: Record<string, unknown> = {};
const structuredStates = structuredParsedStates.map((state) => {
  const result = createStructuredDelta({
    signature: structuredDeltaSig,
    parsedValues: structuredClone(state.parsedValues),
    previousValues: structuredPreviousValues,
    partialMarker: state.partialMarker,
  });
  structuredPreviousValues = {
    ...structuredPreviousValues,
    ...result.fullValues,
  };
  return {
    parsed_values: state.parsedValues,
    partial_array_incomplete: state.partialMarker !== null,
    expected_delta: result.delta,
    expected_full_values: result.fullValues,
  };
});

writeFixture('structured-object-array-delta', {
  kind: 'stream',
  route_cases: [
    { has_complex_fields: true, expected: 'structured_json' },
    { has_complex_fields: false, expected: 'prompt_extraction' },
  ],
  field_specs: structuredDeltaSig.getOutputFields().map((field) => ({
    name: field.name,
    isInternal: field.isInternal,
  })),
  structured_states: structuredStates as Json,
  tracked_array_field: 'items',
  expected_emitted_items: [firstItem, secondItem],
  expected_final_values: structuredPreviousValues as Json,
  expected_folded: '',
});

writeFixture('streaming-assertion-fail-fast', {
  kind: 'stream',
  stream_events: ['Answer: safe ', 'forbidden'],
  streaming_assertions: [
    {
      field: 'answer',
      not_contains: 'forbidden',
      message: 'answer must not include forbidden',
    },
  ],
  expected_error_contains: 'answer must not include forbidden',
});

writeFixture('structured-output-ax-choice-source', {
  kind: 'forward',
  signature: 'query:string -> answer:string, confidence:number',
  // A simple signature selects no rung unless forced (TS useStructured()).
  options: { force_structured: true },
  input: { query: 'test' },
  features: { structured_outputs: false, functions: true },
  responses: [
    {
      content: '',
      function_calls: [
        {
          id: 'call1',
          name: '__axOutput',
          params: { answer: 'Done', confidence: 1 },
        },
      ],
    },
  ],
  expected_output: { answer: 'Done', confidence: 1 },
  expected_request: {
    function_call: { type: 'function', function: { name: '__axOutput' } },
    function_call_source: 'ax',
  },
  expected_request_count: 1,
});

for (const finishReason of ['length', 'error']) {
  writeFixture(`streaming-terminal-${finishReason}`, {
    kind: 'stream',
    stream_events: [
      { results: [{ index: 0, content: '{"answer":"Done"}' }] },
      { results: [{ index: 0, finish_reason: finishReason }] },
    ],
    expected_error_contains:
      finishReason === 'length'
        ? 'Max tokens reached before completion'
        : 'Streaming response failed',
  });
}

writeFixture('examples-message-pairs-exact', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Live?' },
  examples: [
    { input: { question: 'Example?' }, output: { answer: 'Example answer' } },
  ],
  responses: [{ content: '{"answer":"Live answer"}' }],
  expected_output: { answer: 'Live answer' },
  expected_chat_prompt_contains: [
    'Example Input',
    'Question: Example?',
    'Example Output',
    'Answer: Example answer',
    'Question: Live?',
  ],
  expected_request_count: 1,
});

writeFixture('examples-in-system-legacy', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  options: { examplesInSystem: true },
  input: { question: 'Current?' },
  examples: [
    {
      input: { question: 'Legacy example?' },
      output: { answer: 'Legacy answer' },
    },
  ],
  responses: [{ content: '{"answer":"Current answer"}' }],
  expected_output: { answer: 'Current answer' },
  expected_chat_prompt_contains: [
    '--- EXAMPLES ---',
    'Legacy example?',
    '--- END OF EXAMPLES ---',
  ],
  expected_request_count: 1,
});

writeFixture('examples-zero-false-values', {
  kind: 'forward',
  signature: 'count:number, enabled:boolean -> answer:string',
  input: { count: 0, enabled: false },
  examples: [
    {
      input: { count: 0, enabled: false },
      output: { answer: 'zero false kept' },
    },
  ],
  responses: [{ content: '{"answer":"ok"}' }],
  expected_output: { answer: 'ok' },
  expected_chat_prompt_contains: [
    'Count: 0',
    'Enabled: false',
    'zero false kept',
  ],
  expected_request_count: 1,
});

writeFixture('context-cache-breakpoints', {
  kind: 'forward',
  signature: 'document:string, question:string -> answer:string',
  options: { context_cache: { breakpoint: 'after_examples' } },
  input: { document: 'cache me', question: 'ask' },
  examples: [
    {
      input: { document: 'doc example', question: 'q' },
      output: { answer: 'a' },
    },
  ],
  responses: [{ content: '{"answer":"cached"}' }],
  expected_output: { answer: 'cached' },
  expected_chat_prompt_contains: ['cache', 'Example Output'],
  expected_request_count: 1,
});

writeFixture('memory-history-and-chat-log', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Remember?' },
  responses: [
    { content: '{"answer":"remembered"}', usage: { total_tokens: 12 } },
  ],
  expected_output: { answer: 'remembered' },
  expected_memory_history_subset: [{ role: 'request' }, { role: 'assistant' }],
  expected_chat_log_subset: [
    {
      response: { content: '{"answer":"remembered"}' },
      usage: { total_tokens: 12 },
    },
  ],
  expected_request_count: 1,
});

writeFixture('thoughts-in-chat-log', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Keep the thought summary?' },
  responses: [
    {
      results: [
        {
          index: 0,
          content: '{"answer":"kept"}',
          thought: 'I should preserve this summary.',
          thought_blocks: [
            {
              data: 'I should preserve this summary.',
              encrypted: false,
            },
          ],
        },
      ],
      model_usage: { tokens: { total_tokens: 17 } },
    },
  ],
  // As in TS, the response's thought is also a forward output.
  expected_output: {
    answer: 'kept',
    thought: 'I should preserve this summary.',
  },
  expected_chat_log_subset: [
    {
      thought: 'I should preserve this summary.',
      thought_blocks: [
        {
          data: 'I should preserve this summary.',
          encrypted: false,
        },
      ],
    },
  ],
  expected_request_count: 1,
});

writeFixture('empty-response-memory-skip', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Recover from blank?' },
  responses: [{ content: ' \n ' }, { content: '{"answer":"recovered"}' }],
  expected_output: { answer: 'recovered' },
  expected_memory_history_count: 2,
  expected_memory_history_subset: [
    { role: 'request' },
    { role: 'assistant', response: { content: '{"answer":"recovered"}' } },
  ],
  expected_request_count: 2,
});

writeFixture('correction-tags-cleaned-after-retry', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Retry' },
  responses: [
    { content: '{"wrong":"field"}' },
    { content: '{"answer":"fixed"}' },
  ],
  expected_output: { answer: 'fixed' },
  expected_memory_history_subset: [
    { role: 'request' },
    { role: 'assistant' },
    { role: 'assistant' },
  ],
  expected_request_count: 2,
});

writeFixture('assertion-return-modes', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [{ field: 'answer', return: 'custom assertion retry' }],
  responses: [
    { content: '{"answer":"bad"}' },
    { content: '{"answer":"still bad"}' },
    { content: '{"answer":"again"}' },
    { content: '{"answer":"once more"}' },
  ],
  expected_error_contains: 'custom assertion retry',
  expected_request_count: 4,
});

// TS assertAssertions throws a plain Error for a failure without a message
// (asserts.ts), which the validation loop does not retry, and lets an error
// the assertion throws escape the same way. A string result or a failure with
// a message is an AxAssertionError and is retried. The request counts match a
// TS AxGen probe.
const badAnswers = [
  { content: '{"answer":"bad"}' },
  { content: '{"answer":"still bad"}' },
  { content: '{"answer":"again"}' },
  { content: '{"answer":"once more"}' },
];

writeFixture('assertion-false-without-message-error', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [{ field: 'answer', return: false }],
  responses: badAnswers,
  expected_error_contains: 'Assertion failed without message',
  expected_request_count: 1,
});

writeFixture('assertion-false-with-message-retried', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [
    { field: 'answer', return: false, message: 'answer must be fixed' },
  ],
  responses: badAnswers,
  expected_error_contains: 'answer must be fixed',
  expected_request_count: 4,
});

writeFixture('assertion-contains-without-message-error', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [{ field: 'answer', contains: 'good' }],
  responses: badAnswers,
  expected_error_contains: 'Assertion failed without message',
  expected_request_count: 1,
});

writeFixture('assertion-thrown-error-not-retried', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [{ field: 'answer', throw: 'assertion exploded' }],
  responses: badAnswers,
  expected_error_contains: 'assertion exploded',
  expected_request_count: 1,
});

writeFixture('assertion-false-without-message-structured-output', {
  kind: 'forward',
  signature: 'query:string -> answer:string, confidence:number',
  options: { force_structured: true },
  input: { query: 'test' },
  features: { structured_outputs: false, functions: true },
  assertions: [{ field: 'answer', return: false }],
  responses: Array.from({ length: 2 }, (_, index) => ({
    content: '',
    function_calls: [
      {
        id: `call${index + 1}`,
        name: '__axOutput',
        params: { answer: 'Done', confidence: 1 },
      },
    ],
  })),
  expected_error_contains: 'Assertion failed without message',
  expected_request_count: 1,
});

// When an __axOutput call fails validation or a message-bearing assertion,
// TS keeps the call on the assistant turn with a "done" result, then adds the
// tool-call failure notice and the rendered error ("Invalid Field" or "Follow
// these instructions"), and forces __axOutput again. The retry corrects it, as
// a TS AxGen probe shows.
const outputCall = (id: string, params: Record<string, Json>) => ({
  content: '',
  function_calls: [{ id, name: '__axOutput', params }],
});
const outputRetryNotice =
  'The previous tool call failed. Fix arguments and try again, ensuring required fields match schema.';
const forcedOutputRetry = {
  index: 1,
  request: {
    function_call: { type: 'function', function: { name: '__axOutput' } },
  },
  function_names: ['__axOutput'],
};

writeFixture('structured-output-retry-missing-field', {
  kind: 'forward',
  signature: 'query:string -> answer:string, confidence:number',
  options: { force_structured: true },
  input: { query: 'test' },
  features: { structured_outputs: false, functions: true },
  responses: [
    outputCall('output_1', { answer: 'Done' }),
    outputCall('output_2', { answer: 'Done', confidence: 1 }),
  ],
  expected_output: { answer: 'Done', confidence: 1 },
  expected_request_contains: [
    'output_1',
    '"done"',
    outputRetryNotice,
    'Invalid Field: ',
  ],
  expected_step_requests: [forcedOutputRetry],
  expected_request_count: 2,
});

writeFixture('structured-output-retry-assertion', {
  kind: 'forward',
  signature: 'query:string -> answer:string, confidence:number',
  options: { force_structured: true },
  input: { query: 'test' },
  features: { structured_outputs: false, functions: true },
  assertions: [
    { field: 'answer', contains: 'Fixed', message: 'answer must say Fixed' },
  ],
  responses: [
    outputCall('output_1', { answer: 'Done', confidence: 1 }),
    outputCall('output_2', { answer: 'Fixed', confidence: 1 }),
  ],
  expected_output: { answer: 'Fixed', confidence: 1 },
  expected_request_contains: [
    'output_1',
    '"done"',
    outputRetryNotice,
    'Follow these instructions: answer must say Fixed.',
  ],
  expected_step_requests: [forcedOutputRetry],
  expected_request_count: 2,
});

// As in TS, a response's non-empty thought becomes a forward output under the
// thought field (default `thought`, renamed by the constructor's
// thought_field_name) on every rung. The output thought joins each tool
// step's thought in order, and a validation retry starts it over. The outputs
// match a TS AxMockAIService probe.
const thoughtResult = (
  content: string,
  thought?: string,
  index = 0
): Record<string, Json> => ({
  index,
  content,
  ...(thought === undefined ? {} : { thought }),
  finish_reason: 'stop',
});
const thoughtText = (content: string, thought?: string) => ({
  results: [thoughtResult(content, thought)],
});
const thoughtCall = (
  id: string,
  name: string,
  params: Record<string, Json>,
  thought?: string
) => ({
  results: [
    {
      index: 0,
      content: '',
      ...(thought === undefined ? {} : { thought }),
      function_calls: [{ id, type: 'function', function: { name, params } }],
      finish_reason: 'function_call',
    },
  ],
});
const lookupTool = {
  name: 'lookup',
  description: 'Look up a key',
  args: { key: { type: 'string' } },
  result: 'status is green',
};

for (const [name, source] of Object.entries({
  'thought-output-text-contract': {
    responses: [thoughtText('Answer: ok', 'Thinking it over')],
    expected_output: { answer: 'ok', thought: 'Thinking it over' },
  },
  'thought-output-absent': {
    responses: [thoughtText('Answer: ok')],
    expected_output: { answer: 'ok' },
  },
  'thought-output-empty-omitted': {
    responses: [thoughtText('Answer: ok', '')],
    expected_output: { answer: 'ok' },
  },
  'thought-output-renamed-field': {
    options: { thought_field_name: 'reasoning' },
    responses: [thoughtText('Answer: ok', 'Thinking it over')],
    expected_output: { answer: 'ok', reasoning: 'Thinking it over' },
  },
  'thought-output-joins-tool-steps': {
    tools: [lookupTool],
    responses: [
      thoughtCall('call_1', 'lookup', { key: 'a' }, 'First '),
      thoughtCall('call_2', 'lookup', { key: 'b' }),
      thoughtText('Answer: ok', 'then answer'),
    ],
    expected_output: { answer: 'ok', thought: 'First then answer' },
  },
  'thought-output-from-tool-step-only': {
    tools: [lookupTool],
    responses: [
      thoughtCall('call_1', 'lookup', { key: 'a' }, 'Look it up'),
      thoughtText('Answer: ok'),
    ],
    expected_output: { answer: 'ok', thought: 'Look it up' },
  },
})) {
  writeFixture(name, {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Status?' },
    ...source,
  });
}

writeFixture('thought-output-validation-retry-starts-over', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  tools: [lookupTool],
  responses: [
    thoughtCall('call_1', 'lookup', { key: 'a' }, 'Look it up'),
    thoughtText('{"answer":"not a number"}', 'Wrong guess'),
    thoughtText('Answer: 4', 'Fixed it'),
  ],
  expected_output: { answer: 4, thought: 'Fixed it' },
  expected_request_count: 3,
});

writeFixture('thought-output-native-json', {
  kind: 'forward',
  signature: 'question:string -> user:object{name:string}',
  input: { question: 'Who?' },
  features: { functions: true, structured_outputs: true },
  responses: [thoughtText('{"user":{"name":"Ada"}}', 'Native thought')],
  expected_output: { user: { name: 'Ada' }, thought: 'Native thought' },
  expected_request: {
    provider_metadata: { ax: { structured_output_rung: 'native' } },
  },
});

writeFixture('thought-output-json-object', {
  kind: 'forward',
  signature: 'question:string -> user:object{name:string}',
  input: { question: 'Who?' },
  features: {
    functions: true,
    structured_outputs: false,
    structured_output_modes: ['json_object'],
  },
  responses: [thoughtText('{"user":{"name":"Ada"}}', 'JSON thought')],
  expected_output: { user: { name: 'Ada' }, thought: 'JSON thought' },
  expected_request: {
    provider_metadata: { ax: { structured_output_rung: 'json_object' } },
  },
});

writeFixture('thought-output-function-rung', {
  kind: 'forward',
  signature: 'question:string -> user:object{name:string}',
  input: { question: 'Who?' },
  options: { structured_output_mode: 'function' },
  features: { functions: true, structured_outputs: false },
  tools: [lookupTool],
  responses: [
    thoughtCall('call_1', 'lookup', { key: 'a' }, 'Look it up. '),
    thoughtCall('output_1', '__axOutput', { user: { name: 'Ada' } }, 'Done.'),
  ],
  expected_output: { user: { name: 'Ada' }, thought: 'Look it up. Done.' },
  expected_request_count: 2,
});

writeFixture('thought-output-multi-sample', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  options: { sampleCount: 2 },
  result_picker_index: 1,
  responses: [
    {
      results: [
        thoughtResult('Answer: zero', 'Sample zero', 0),
        thoughtResult('Answer: one', 'Sample one', 1),
      ],
    },
  ],
  expected_output: { answer: 'one', thought: 'Sample one' },
});

writeFixture('field-processor-memory-write', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Process' },
  field_processors: [{ field: 'answer', op: 'trim' }],
  responses: [{ content: '{"answer":"  done  "}' }],
  expected_output: { answer: 'done' },
  expected_memory_history_subset: [
    { role: 'processor', output: { answer: 'done' } },
  ],
  expected_request_count: 1,
});

writeFixture('function-call-trace-hook', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [
    {
      name: 'search',
      description: 'Search docs',
      args: { query: { type: 'string' } },
      returns: { title: { type: 'string' } },
      result: { title: 'Docs' },
    },
  ],
  responses: [
    {
      content: '',
      function_calls: [
        { id: 'call_1', name: 'search', params: { query: 'ax docs' } },
      ],
    },
    { content: '{"answer":"Docs"}' },
  ],
  expected_output: { answer: 'Docs' },
  expected_function_traces_subset: [
    { id: 'call_1', name: 'search', args: { query: 'ax docs' }, status: 'ok' },
  ],
  expected_memory_history_subset: [{ role: 'function' }],
  expected_tool_calls: [{ name: 'search', args: { query: 'ax docs' } }],
  expected_request_count: 2,
});

writeFixture('reasoning-tool-loop-replay', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'warehouse totals' },
  tools: [
    {
      name: 'search',
      description: 'Search warehouse data',
      args: { query: { type: 'string' } },
      result: { total: 42 },
    },
  ],
  responses: [
    {
      results: [
        {
          index: 0,
          content: '',
          thought: 'Use the warehouse search tool.',
          thought_blocks: [
            {
              data: 'Use the warehouse search tool.',
              encrypted: false,
            },
          ],
          function_calls: [
            {
              id: 'call_reasoning_1',
              type: 'function',
              function: {
                name: 'search',
                params: { query: 'warehouse totals' },
              },
            },
          ],
          finish_reason: 'function_call',
        },
      ],
    },
    {
      results: [
        {
          index: 0,
          content: '{"answer":"42"}',
          finish_reason: 'stop',
        },
      ],
    },
  ],
  // TS joins each step's thought into the output thought; the answering
  // step has none here, so the tool step's thought is the output thought.
  expected_output: { answer: '42', thought: 'Use the warehouse search tool.' },
  expected_request_contains: [
    'Use the warehouse search tool.',
    'thought_blocks',
    'call_reasoning_1',
  ],
  expected_tool_calls: [
    { name: 'search', args: { query: 'warehouse totals' } },
  ],
  expected_request_count: 2,
});

writeFixture('unknown-tool-call-correction', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'docs' },
  tools: [
    {
      name: 'search',
      description: 'Search docs',
      args: { query: { type: 'string' } },
      result: { title: 'Docs' },
    },
  ],
  responses: [
    {
      content: '',
      function_calls: [
        { id: 'call_1', name: 'lookup', params: { query: 'docs' } },
      ],
    },
    { content: '{"answer":"No lookup tool is registered."}' },
  ],
  expected_output: { answer: 'No lookup tool is registered.' },
  expected_function_traces_subset: [
    { id: 'call_1', name: 'lookup', status: 'error' },
  ],
  expected_request_contains: [
    'Function not found: lookup',
    'Available functions: search',
  ],
  expected_tool_calls: [],
  expected_request_count: 2,
});

writeFixture('prompt-cache-key-forward-options', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Use the stable conversation cache' },
  options: { promptCacheKey: 'service-fallback' },
  forward_options: {
    promptCacheKey: 'conversation-42',
    sessionId: 'loses',
    contextCache: {},
  },
  responses: [{ content: '{"answer":"cached"}' }],
  expected_output: { answer: 'cached' },
  expected_chat_options_subset: {
    promptCacheKey: 'conversation-42',
    sessionId: 'loses',
    contextCache: {},
  },
  expected_request_count: 1,
});

const searchTool = {
  name: 'search',
  description: 'Search docs',
  args: { query: { type: 'string' } },
  result: { title: 'Ax docs' },
};
const searchCall = (id: string) => ({
  content: '',
  function_calls: [{ id, name: 'search', params: { query: 'ax docs' } }],
});
const searchRecord = { name: 'search', args: { query: 'ax docs' } };

// TS AxGen caps the tool loop at maxSteps (default 25) and throws
// "Generate failed: Max steps reached: N" after N tool steps.
writeFixture('max-steps-default', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [searchTool],
  responses: Array.from({ length: 25 }, (_, index) =>
    searchCall(`call_${index + 1}`)
  ),
  expected_error_contains: 'Generate failed: Max steps reached: 25',
  expected_tool_calls: Array.from({ length: 25 }, () => searchRecord),
  expected_request_count: 25,
});

writeFixture('max-steps-forward-option', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  options: { max_steps: 5 },
  forward_options: { maxSteps: 2 },
  tools: [searchTool],
  responses: [
    searchCall('call_1'),
    searchCall('call_2'),
    { content: 'Answer: never requested' },
  ],
  expected_error_contains: 'Generate failed: Max steps reached: 2',
  expected_tool_calls: [searchRecord, searchRecord],
  expected_request_count: 2,
});

writeFixture('max-steps-zero', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  options: { max_steps: 0 },
  tools: [searchTool],
  responses: [{ content: 'Answer: never requested' }],
  expected_error_contains: 'Generate failed: Max steps reached: 0',
  expected_tool_calls: [],
  expected_request_count: 0,
  expect_chat_path: false,
});

// Validation and assertion retries stay inside the current step.
writeFixture('max-steps-retries-stay-in-step', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Capital of France?' },
  options: { max_steps: 1 },
  assertions: [
    { field: 'answer', contains: 'Paris', message: 'answer must name Paris' },
  ],
  responses: [{ content: 'Answer: Lyon' }, { content: 'Answer: Paris' }],
  expected_output: { answer: 'Paris' },
  expected_request_count: 2,
});

// TS selects no structured-output rung for a simple signature (not even an
// explicit structuredOutputMode), so native tools keep the `field: value`
// text contract without a response schema or JSON instruction turn.
writeFixture('native-tools-simple-signature-text-contract', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [searchTool],
  responses: [searchCall('call_1'), { content: 'Answer: Found Ax docs' }],
  expected_output: { answer: 'Found Ax docs' },
  expected_request_contains: ['field name: value'],
  expected_request_not_contains: [
    'response_format',
    'structured_output_rung',
    'Return exactly one JSON object',
    '__axOutput',
  ],
  expected_tool_calls: [searchRecord],
  expected_request_count: 2,
});

writeFixture('native-tools-simple-signature-ignores-structured-mode', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  features: { structured_outputs: false, functions: true },
  options: { structured_output_mode: 'function' },
  tools: [searchTool],
  responses: [searchCall('call_1'), { content: 'Answer: Found Ax docs' }],
  expected_output: { answer: 'Found Ax docs' },
  expected_request_not_contains: [
    '__axOutput',
    'response_format',
    'Emit the complete structured output',
  ],
  expected_tool_calls: [searchRecord],
  expected_request_count: 2,
});

writeFixture('native-tools-complex-signature-keeps-native-rung', {
  kind: 'forward',
  signature_spec: {
    inputs: { query: { type: 'string' } },
    outputs: {
      summary: { type: 'object', fields: { answer: { type: 'string' } } },
    },
  },
  input: { query: 'ax docs' },
  tools: [searchTool],
  responses: [
    searchCall('call_1'),
    { content: '{"summary":{"answer":"Found Ax docs"}}' },
  ],
  expected_output: { summary: { answer: 'Found Ax docs' } },
  expected_request: {
    response_format: { type: 'json_schema' },
    provider_metadata: { ax: { structured_output_rung: 'native' } },
  },
  expected_tool_calls: [searchRecord],
  expected_request_count: 2,
});

// force_structured mirrors TS useStructured(); Agent actor stages set it.
writeFixture('native-tools-force-structured-keeps-native-rung', {
  kind: 'forward',
  signature: 'task:string -> javascriptCode:code',
  input: { task: 'Look up the docs title' },
  options: { force_structured: true },
  tools: [searchTool],
  responses: [
    searchCall('call_1'),
    { content: '{"javascriptCode":"final(\\"Ax docs\\");"}' },
  ],
  expected_output: { javascriptCode: 'final("Ax docs");' },
  expected_request: {
    response_format: { type: 'json_schema' },
    provider_metadata: { ax: { structured_output_rung: 'native' } },
  },
  expected_tool_calls: [searchRecord],
  expected_request_count: 2,
});

// Exact wire keys advertised by prompts must also work in text and chunked responses.
for (const [name, content] of Object.entries({
  wire: 'urgent: true\nassignedTeam: engineering',
  titles: 'Urgent: true\nAssigned Team: engineering',
  mixed: 'Urgent: true\nassignedTeam: engineering',
})) {
  const signature =
    'ticket:string -> urgent:boolean(true "Core task blocked", false "Routine"), assignedTeam:class "support, engineering"';
  const sig = AxSignature.from(signature);
  const values: Record<string, unknown> = {};
  extractValues(sig, values, content);
  writeFixture(`value-descriptions-text-${name}`, {
    kind: 'forward',
    signature,
    input: { ticket: 'Outage' },
    responses: [{ content }],
    expected_output: values as Json,
    expected_request_count: 1,
  });
  const streamed: Record<string, unknown> = {};
  const state: extractionState = {
    extractedFields: [],
    streamedIndex: {},
    s: -1,
  };
  for (let i = 1; i <= content.length; i++)
    streamingExtractValues(sig, streamed, state, content.slice(0, i));
  streamingExtractFinalValue(sig, streamed, state, content, {
    forceFinalize: true,
  });
  writeFixture(`value-descriptions-stream-${name}`, {
    kind: 'stream',
    text_signature: signature,
    stream_events: [...content],
    expected_folded: content,
    expected_text_output: streamed as Json,
  });
}

// TS createFunctionConfig applies a caller-forced call ('required' or a named
// function) to the first step only. Later steps drop the forcing and the
// caller tools so the model can answer.
const forceSearch = { type: 'function', function: { name: 'search' } };
const forceOutput = { type: 'function', function: { name: '__axOutput' } };

for (const [name, source] of Object.entries({
  'forced-function-call-first-step-only': {
    forward_options: { function_call: forceSearch },
    choice: forceSearch,
  },
  'forced-function-call-required-first-step-only': {
    forward_options: { function_call: 'required' },
    choice: 'required',
  },
  'forced-function-call-generator-option': {
    options: { functionCall: forceSearch },
    choice: forceSearch,
  },
  // A tool choice passed as functionCallMode is routed through functionCall
  // instead of reaching the provider on every request.
  'forced-function-call-mode-routed': {
    forward_options: { function_call_mode: 'required' },
    choice: 'required',
  },
})) {
  const { choice, ...programOptions } = source;
  writeFixture(name, {
    kind: 'forward',
    signature: 'query:string -> answer:string',
    input: { query: 'ax docs' },
    ...programOptions,
    tools: [searchTool],
    responses: [searchCall('call_1'), { content: 'Answer: Found Ax docs' }],
    expected_output: { answer: 'Found Ax docs' },
    expected_step_requests: [
      {
        index: 0,
        request: { function_call: choice, function_call_source: 'caller' },
        function_names: ['search'],
      },
      { index: 1, request: { function_call: 'auto' }, function_names: [] },
    ],
    expected_tool_calls: [searchRecord],
    expected_request_count: 2,
  });
}

// 'none' is not forcing, so it reaches every request with the tools declared.
writeFixture('function-call-none-every-step', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  forward_options: { function_call: 'none' },
  tools: [searchTool],
  responses: [{ content: 'Answer: Nothing to look up' }],
  expected_output: { answer: 'Nothing to look up' },
  expected_step_requests: [
    {
      index: 0,
      request: { function_call: 'none', function_call_source: 'caller' },
      function_names: ['search'],
    },
  ],
  expected_tool_calls: [],
  expected_request_count: 1,
});

// Under the function rung the forced step withholds __axOutput, so the forcing
// must reach a user tool. The next step forces __axOutput.
for (const [name, choice] of Object.entries({
  'forced-function-call-function-rung': forceSearch,
  'forced-function-call-required-function-rung': 'required',
})) {
  writeFixture(name, {
    kind: 'forward',
    signature_spec: {
      inputs: { query: { type: 'string' } },
      outputs: {
        summary: { type: 'object', fields: { answer: { type: 'string' } } },
      },
    },
    input: { query: 'ax docs' },
    features: { structured_outputs: false, functions: true },
    options: { structured_output_mode: 'function' },
    forward_options: { function_call: choice },
    tools: [searchTool],
    responses: [
      searchCall('call_1'),
      {
        content: '',
        function_calls: [
          {
            id: 'output_1',
            name: '__axOutput',
            params: { summary: { answer: 'Found Ax docs' } },
          },
        ],
      },
    ],
    expected_output: { summary: { answer: 'Found Ax docs' } },
    expected_step_requests: [
      {
        index: 0,
        request: { function_call: choice, function_call_source: 'caller' },
        function_names: ['search'],
      },
      {
        index: 1,
        request: { function_call: forceOutput, function_call_source: 'ax' },
        function_names: ['__axOutput'],
      },
    ],
    expected_tool_calls: [searchRecord],
    expected_request_count: 2,
  });
}

// Beside native tools, TS auto keeps the rung it picks without them, for
// every provider and for forced calls too: a provider that verifies both
// native JSON and the function rung, as Gemini does, still gets native JSON.
// structured_output_mode 'function' is the opt-in to answer through
// __axOutput beside tools.
const nativeAndFunctionRungs = {
  functions: true,
  structured_outputs: true,
  structured_output_modes: ['native', 'function'],
};
const summarySpec = {
  inputs: { query: { type: 'string' } },
  outputs: {
    summary: { type: 'object', fields: { answer: { type: 'string' } } },
  },
};

for (const [name, source] of Object.entries({
  'output-native-rung-beside-callable-tools': {},
  'output-native-rung-for-forced-call': {
    forward_options: { function_call: forceSearch },
  },
  'output-native-rung-for-required-call': {
    forward_options: { function_call: 'required' },
  },
})) {
  writeFixture(name, {
    kind: 'forward',
    signature_spec: summarySpec,
    input: { query: 'ax docs' },
    features: nativeAndFunctionRungs,
    tools: [searchTool],
    ...source,
    responses: [
      searchCall('call_1'),
      { content: '{"summary":{"answer":"Found Ax docs"}}' },
    ],
    expected_output: { summary: { answer: 'Found Ax docs' } },
    expected_request: {
      response_format: { type: 'json_schema' },
      provider_metadata: { ax: { structured_output_rung: 'native' } },
    },
    expected_request_not_contains: ['__axOutput'],
    expected_tool_calls: [searchRecord],
    expected_request_count: 2,
  });
}

// TS AxGen retries only infrastructure errors (5xx status, network, timeout,
// stream termination), up to maxRetries (default 3) times. Everything else
// surfaces after one request. The counts match a TS AxGen probe.
const scriptedError = (type: string, extra: Record<string, Json> = {}) => ({
  error: { type, message: 'Service fixture failure', ...extra },
});
const recovered = { content: 'Answer: Recovered' };

for (const [name, error] of Object.entries({
  'infra-retry-status-400-not-retried': scriptedError('status', {
    status: 400,
  }),
  'infra-retry-status-429-not-retried': scriptedError('status', {
    status: 429,
  }),
  'infra-retry-response-error-not-retried': scriptedError('response'),
})) {
  writeFixture(name, {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Status?' },
    responses: [error, recovered],
    expected_error_contains: 'Service fixture failure',
    expected_request_count: 1,
  });
}

for (const [name, error] of Object.entries({
  'infra-retry-status-500-retried': scriptedError('status', { status: 500 }),
  'infra-retry-network-retried': scriptedError('network'),
  'infra-retry-timeout-retried': scriptedError('timeout'),
})) {
  writeFixture(name, {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Status?' },
    responses: [error, recovered],
    expected_output: { answer: 'Recovered' },
    expected_request_count: 2,
  });
}

writeFixture('infra-retry-default-attempts', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  responses: Array.from({ length: 5 }, () =>
    scriptedError('status', { status: 503 })
  ),
  expected_error_contains: 'Service fixture failure',
  expected_request_count: 4,
});

writeFixture('infra-retry-max-retries-option', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  options: { max_retries: 1 },
  responses: Array.from({ length: 3 }, () =>
    scriptedError('status', { status: 503 })
  ),
  expected_error_contains: 'Service fixture failure',
  expected_request_count: 2,
});

// TS AxGen retries a model refusal inside its validation loop, so a refusal
// spends the validation budget (maxRetries in TS, validation_retries here).
// The same prompt goes out again at once, with no correction message.
const refusal = {
  error: { type: 'refusal', message: 'Model refused the fixture request' },
};

writeFixture('refusal-retried-without-correction', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  responses: [refusal, recovered],
  expected_output: { answer: 'Recovered' },
  expected_request_not_contains: ['Model refused the fixture request'],
  expected_request_count: 2,
});

writeFixture('refusal-retries-exhausted', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  options: { validation_retries: 1 },
  responses: [refusal, refusal, recovered],
  expected_error_contains: 'Model refused the fixture request',
  expected_request_count: 2,
});

writeFixture('refusal-shares-validation-budget', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  options: { validation_retries: 1 },
  responses: [
    refusal,
    { content: '{"answer":"not a number"}' },
    { content: 'Answer: 4' },
  ],
  expected_error_contains: 'to be a number',
  expected_request_count: 2,
});

// As in TS, maxRetries (default 3) also caps the validation retries of each
// step, and each tool step starts with a fresh budget. The request counts
// match a TS AxGen probe. validation_retries stays a port override that wins
// over max_retries.
const badNumber = { content: '{"answer":"not a number"}' };

writeFixture('validation-budget-default-attempts', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  responses: Array.from({ length: 5 }, () => badNumber),
  expected_error_contains: 'to be a number',
  expected_request_count: 4,
});

writeFixture('validation-budget-max-retries-option', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  options: { max_retries: 1 },
  responses: Array.from({ length: 3 }, () => badNumber),
  expected_error_contains: 'to be a number',
  expected_request_count: 2,
});

writeFixture('validation-budget-validation-retries-override', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  options: { validation_retries: 1, max_retries: 3 },
  responses: Array.from({ length: 3 }, () => badNumber),
  expected_error_contains: 'to be a number',
  expected_request_count: 2,
});

writeFixture('validation-budget-resets-per-step', {
  kind: 'forward',
  signature: 'query:string -> answer:number',
  input: { query: 'ax docs' },
  tools: [searchTool],
  options: { max_retries: 1 },
  responses: [
    badNumber,
    searchCall('call_1'),
    badNumber,
    { content: 'Answer: 4' },
  ],
  expected_output: { answer: 4 },
  expected_tool_calls: [searchRecord],
  expected_request_count: 4,
});

writeFixture('validation-budget-step-exhausted', {
  kind: 'forward',
  signature: 'query:string -> answer:number',
  input: { query: 'ax docs' },
  tools: [searchTool],
  options: { max_retries: 1 },
  responses: [
    badNumber,
    searchCall('call_1'),
    badNumber,
    badNumber,
    { content: 'Answer: 4' },
  ],
  expected_error_contains: 'to be a number',
  expected_tool_calls: [searchRecord],
  expected_request_count: 4,
});

// TS nests the validation loop inside the infrastructure loop of each step.
// An infrastructure retry spends the step's maxRetries budget and restarts
// validation with a fresh budget, and the next tool step starts with fresh
// budgets. The request counts match a TS AxGen probe.
const unavailable = scriptedError('status', { status: 503 });
const answered = { content: 'Answer: 4' };

writeFixture('infra-retry-restarts-validation-budget', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  options: { max_retries: 1 },
  responses: [badNumber, unavailable, badNumber, answered],
  expected_output: { answer: 4 },
  expected_request_count: 4,
});

writeFixture('infra-retry-restarts-default-validation-budget', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  responses: [
    badNumber,
    badNumber,
    badNumber,
    unavailable,
    badNumber,
    badNumber,
    badNumber,
    answered,
  ],
  expected_output: { answer: 4 },
  expected_request_count: 8,
});

writeFixture('infra-retry-budget-shared-within-step', {
  kind: 'forward',
  signature: 'question:string -> answer:number',
  input: { question: 'Status?' },
  options: { max_retries: 1 },
  responses: [unavailable, badNumber, unavailable, answered],
  expected_error_contains: 'Service fixture failure',
  expected_request_count: 3,
});

writeFixture('infra-retry-budget-resets-per-step', {
  kind: 'forward',
  signature: 'query:string -> answer:number',
  input: { query: 'ax docs' },
  tools: [searchTool],
  options: { max_retries: 1 },
  responses: [unavailable, searchCall('call_1'), unavailable, answered],
  expected_output: { answer: 4 },
  expected_tool_calls: [searchRecord],
  expected_request_count: 4,
});
