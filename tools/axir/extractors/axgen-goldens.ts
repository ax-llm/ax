import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxSignature, f } from '../../../src/ax/dsp/sig.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fixture = Record<string, Json>;

const outDir = join(process.cwd(), 'ir/conformance/axgen');

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

writeFixture('stop-function-tool-output', {
  kind: 'forward',
  signature: 'query:string -> answer:string',
  input: { query: 'ax docs' },
  tools: [
    {
      name: 'search',
      description: 'Search docs',
      args: { query: { type: 'string', min: 1 } },
      returns: { answer: { type: 'string' } },
      result: { answer: 'Found directly' },
    },
  ],
  stop_functions: ['search'],
  responses: [
    {
      content: '',
      function_calls: [
        { id: 'call_1', name: 'search', params: { query: 'ax docs' } },
      ],
    },
  ],
  expected_output: { answer: 'Found directly' },
  expected_tool_calls: [{ name: 'search', args: { query: 'ax docs' } }],
  expected_request_count: 1,
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
  ],
  expected_error_contains: 'custom assertion retry',
});

writeFixture('assertion-false-without-message-error', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Assert' },
  assertions: [{ field: 'answer', return: false }],
  responses: [
    { content: '{"answer":"bad"}' },
    { content: '{"answer":"still bad"}' },
    { content: '{"answer":"again"}' },
  ],
  expected_error_contains: 'assertion failed without message',
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
    { id: 'call_1', name: 'search', status: 'ok' },
  ],
  expected_memory_history_subset: [{ role: 'function' }],
  expected_tool_calls: [{ name: 'search', args: { query: 'ax docs' } }],
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
