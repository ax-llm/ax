// TS-golden AxGen cachingFunction fixtures. Each case runs a sequence of
// TypeScript AxGen forward / streamingForward calls on one generator with one
// in-memory cache, and records each call's output (and deltas), its request
// count, and every read and write of the cache. Keys are not compared: each
// port hashes its own deterministic key with SHA-256.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import { AxGen } from '../../../src/ax/dsp/generate.js';
import { axGlobals } from '../../../src/ax/dsp/globals.js';
import { runControl } from '../../../src/ax/dsp/runControl.js';
import { mergeDeltas } from '../../../src/ax/dsp/util.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axgen'
);

// Keys sort, except inside inputs and outputs, which keep their order.
function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered = [
      'input',
      'expected_outputs',
      'expected_cache_sets',
    ].includes(parentKey)
      ? entries
      : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [
        key,
        stable(item, parentKey === 'expected_outputs' ? parentKey : key),
      ])
    );
  }
  return value;
}

function writeFixture(name: string, fixture: Record<string, unknown>): void {
  writeFileSync(
    join(outDir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

type ChunkSpec = { results: JsonMap[] };
type ResponseSpec = { stream: ChunkSpec[] } | { results: JsonMap[] };

function tsResult(result: JsonMap): AxChatResponse['results'][number] {
  const out: Record<string, unknown> = { index: result.index ?? 0 };
  if (result.content !== undefined) out.content = result.content;
  if (result.finish_reason !== undefined)
    out.finishReason = result.finish_reason;
  return out as AxChatResponse['results'][number];
}

function scriptedAI(responses: ResponseSpec[], features: JsonMap | undefined) {
  const queue = clone(responses);
  let calls = 0;
  const ai = new AxMockAIService({
    features: {
      functions: (features?.functions as boolean | undefined) ?? true,
      streaming: true,
      structuredOutputs: features?.structured_outputs as boolean | undefined,
    },
    chatResponse: async () => {
      calls++;
      const next = queue.shift();
      if (!next) throw new Error('scripted client exhausted');
      if ('results' in next) return { results: next.results.map(tsResult) };
      const chunks = [...next.stream];
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const chunk = chunks.shift();
          if (!chunk) controller.close();
          else controller.enqueue({ results: chunk.results.map(tsResult) });
        },
      });
    },
  });
  return { ai, calls: () => calls };
}

const optionNames: Record<string, string> = {
  sample_count: 'sampleCount',
  max_retries: 'maxRetries',
};

function tsOptions(options: JsonMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    out[optionNames[key] ?? key] = clone(value);
  }
  return out;
}

type CallSpec = {
  kind: 'forward' | 'streaming_forward';
  input: JsonMap;
  forward_options?: JsonMap;
  // Attach a run control to this call.
  control?: boolean;
  // Pass the input with its keys in reverse order. Fixture JSON sorts its
  // keys, so the order is a flag every runner applies.
  reverse_input_keys?: boolean;
};

type Case = {
  signature: string;
  // Constructor options.
  options?: JsonMap;
  // Where the caching function goes: the call's options (default), the
  // constructor's, or the process-wide global (axGlobals.cachingFunction).
  cache_in?: 'call' | 'constructor' | 'global';
  // A run control in the AxGen constructor's options.
  constructor_control?: boolean;
  features?: JsonMap;
  result_picker_index?: number;
  // The cache throws this message on every read, or on every write.
  cache_read_error?: string;
  cache_write_error?: string;
  responses: ResponseSpec[];
  calls: CallSpec[];
};

async function record(name: string, spec: Case): Promise<void> {
  const { ai, calls: requestCount } = scriptedAI(spec.responses, spec.features);
  const store = new Map<string, unknown>();
  let cacheGets = 0;
  const cacheSets: Json[] = [];
  const outputs: Json[] = [];
  const deltas: Json[] = [];
  const requests: number[] = [];
  const errors: (string | null)[] = [];
  const cachingFunction = async (key: string, value?: unknown) => {
    if (value !== undefined) {
      if (spec.cache_write_error) throw new Error(spec.cache_write_error);
      cacheSets.push(clone(value) as Json);
      store.set(key, clone(value));
      return undefined;
    }
    cacheGets++;
    if (spec.cache_read_error) throw new Error(spec.cache_read_error);
    const hit = store.get(key);
    return hit === undefined ? undefined : clone(hit);
  };
  const cacheIn = spec.cache_in ?? 'call';
  const previousGlobal = axGlobals.cachingFunction;
  if (cacheIn === 'global') axGlobals.cachingFunction = cachingFunction;
  try {
    await runCalls();
  } finally {
    axGlobals.cachingFunction = previousGlobal;
  }
  async function runCalls() {
    const gen = new AxGen(spec.signature, {
      ...tsOptions(spec.options),
      ...(cacheIn === 'constructor' ? { cachingFunction } : {}),
      ...(spec.constructor_control ? { control: runControl() } : {}),
    });

    for (const call of spec.calls) {
      const before = requestCount();
      const options: Record<string, unknown> = tsOptions(call.forward_options);
      if (cacheIn === 'call') options.cachingFunction = cachingFunction;
      if (call.control) options.control = runControl();
      if (spec.result_picker_index !== undefined) {
        const picked = spec.result_picker_index;
        options.resultPicker = async () => picked;
      }
      const input = call.reverse_input_keys
        ? Object.fromEntries(Object.entries(call.input).reverse())
        : call.input;
      errors.push(null);
      if (call.kind === 'forward') {
        try {
          outputs.push(clone((await gen.forward(ai, input, options)) as Json));
        } catch (e) {
          errors[errors.length - 1] = (e as Error).message.split('\n')[0]!;
          outputs.push(null);
        }
        deltas.push(null);
      } else {
        const seen: JsonMap[] = [];
        for await (const delta of gen.streamingForward(ai, input, options)) {
          seen.push(clone(delta) as unknown as JsonMap);
        }
        // A consumer merges each index's deltas and starts over when the
        // version changes; the output is the first sample of the last version.
        let buffer: { version: number; index: number; delta: object }[] = [];
        let version = 0;
        for (const delta of seen) {
          if (delta.version !== version) buffer = [];
          version = delta.version as number;
          buffer = mergeDeltas(buffer as never, clone(delta) as never) as never;
        }
        outputs.push(clone((buffer[0]?.delta ?? {}) as Json));
        deltas.push(seen);
      }
      requests.push(requestCount() - before);
    }
  }

  const fixture: Record<string, unknown> = {
    kind: 'cache_sequence',
    signature: spec.signature,
    responses: spec.responses,
    calls: spec.calls,
    expected_outputs: outputs,
    expected_deltas: deltas,
    expected_requests: requests,
    expected_request_count: requestCount(),
    expected_cache_gets: cacheGets,
    expected_cache_sets: cacheSets,
  };
  if (errors.some((error) => error !== null)) fixture.expected_errors = errors;
  for (const key of [
    'options',
    'cache_in',
    'features',
    'result_picker_index',
    'cache_read_error',
    'cache_write_error',
    'constructor_control',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  writeFixture(name, fixture);
}

const answer = (content: string): ResponseSpec => ({
  results: [{ index: 0, content }],
});
const streamed = (...contents: string[]): ResponseSpec => ({
  stream: contents.map((content, i) => ({
    results: [
      i === contents.length - 1
        ? { index: 0, content, finish_reason: 'stop' }
        : { index: 0, content },
    ],
  })),
});
const forward = (input: JsonMap, extra: Partial<CallSpec> = {}): CallSpec => ({
  kind: 'forward',
  input,
  ...extra,
});
const streaming = (
  input: JsonMap,
  extra: Partial<CallSpec> = {}
): CallSpec => ({ kind: 'streaming_forward', input, ...extra });

const cases: Record<string, Case> = {
  // A miss runs the model and stores the output; the same input then hits
  // without a request.
  'cache-forward-miss-then-hit': {
    signature: 'question:string -> answer:string',
    responses: [answer('Answer: Paris')],
    calls: [
      forward({ question: 'Capital of France?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // Different inputs get their own keys.
  'cache-forward-different-inputs': {
    signature: 'question:string -> answer:string',
    responses: [answer('Answer: Paris'), answer('Answer: Rome')],
    calls: [
      forward({ question: 'Capital of France?' }),
      forward({ question: 'Capital of Italy?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // The constructor's caching function applies to every call.
  'cache-constructor-option': {
    signature: 'question:string -> answer:string',
    cache_in: 'constructor',
    responses: [answer('Answer: Paris')],
    calls: [
      forward({ question: 'Capital of France?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // streamingForward stores the merged output without a result picker, and
  // a hit yields it as one delta.
  'cache-streaming-store-and-hit': {
    signature: 'question:string -> answer:string',
    responses: [streamed('Answer: Pa', 'ris')],
    calls: [
      streaming({ question: 'Capital of France?' }),
      streaming({ question: 'Capital of France?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // With a result picker, the picked sample is stored.
  'cache-streaming-store-with-picker': {
    signature: 'question:string -> answer:string',
    result_picker_index: 1,
    responses: [
      {
        stream: [
          {
            results: [
              { index: 0, content: 'Answer: first' },
              { index: 1, content: 'Answer: second' },
            ],
          },
          {
            results: [
              { index: 0, finish_reason: 'stop' },
              { index: 1, finish_reason: 'stop' },
            ],
          },
        ],
      },
    ],
    calls: [
      streaming(
        { question: 'Pick one' },
        { forward_options: { sample_count: 2 } }
      ),
      forward({ question: 'Pick one' }),
    ],
  },
  // forward with stream: true reads and stores the cache as forward does.
  'cache-forward-stream-option': {
    signature: 'question:string -> answer:string',
    responses: [streamed('Answer: Pa', 'ris')],
    calls: [
      forward(
        { question: 'Capital of France?' },
        { forward_options: { stream: true } }
      ),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // The process-wide caching function applies when neither the call nor the
  // constructor sets one.
  'cache-global-fallback': {
    signature: 'question:string -> answer:string',
    cache_in: 'global',
    responses: [answer('Answer: Paris')],
    calls: [
      forward({ question: 'Capital of France?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // An empty output is stored and hits like any other: only undefined is a
  // miss.
  'cache-empty-output-hit': {
    signature: 'question:string -> answer?:string, note?:string',
    responses: [answer('Nothing to report.')],
    calls: [
      forward({ question: 'Anything new?' }),
      forward({ question: 'Anything new?' }),
    ],
  },
  // forward: an error from the cache read propagates, without a request.
  'cache-forward-read-error-propagates': {
    signature: 'question:string -> answer:string',
    cache_read_error: 'cache offline',
    responses: [answer('Answer: Paris')],
    calls: [forward({ question: 'Capital of France?' })],
  },
  // streamingForward ignores an error from the cache read and runs.
  'cache-streaming-read-error-ignored': {
    signature: 'question:string -> answer:string',
    cache_read_error: 'cache offline',
    responses: [streamed('Answer: Pa', 'ris')],
    calls: [streaming({ question: 'Capital of France?' })],
  },
  // An error from the cache write is ignored, streaming or not.
  'cache-write-error-ignored': {
    signature: 'question:string -> answer:string',
    cache_write_error: 'cache full',
    responses: [answer('Answer: Paris'), streamed('Answer: Ro', 'me')],
    calls: [
      forward({ question: 'Capital of France?' }),
      streaming({ question: 'Capital of Italy?' }),
    ],
  },
  // A run control bypasses the cache: no reads, no writes.
  'cache-control-skips-cache': {
    signature: 'question:string -> answer:string',
    responses: [answer('Answer: Paris'), answer('Answer: Paris again')],
    calls: [
      forward({ question: 'Capital of France?' }, { control: true }),
      forward({ question: 'Capital of France?' }, { control: true }),
    ],
  },
  // A run control in the constructor's options skips the cache too, as a
  // constructor default.
  'cache-constructor-control-skips-cache': {
    signature: 'question:string -> answer:string',
    constructor_control: true,
    responses: [answer('Answer: Paris'), answer('Answer: Paris again')],
    calls: [
      forward({ question: 'Capital of France?' }),
      forward({ question: 'Capital of France?' }),
    ],
  },
  // Media inputs key on their data: other image data misses, the same
  // image hits.
  // The key does not depend on the order of the input's keys.
  'cache-forward-key-stable-input-order': {
    signature: 'firstName:string, lastName:string -> fullName:string',
    responses: [answer('Full Name: Ada Lovelace')],
    calls: [
      forward({ firstName: 'Ada', lastName: 'Lovelace' }),
      forward(
        { firstName: 'Ada', lastName: 'Lovelace' },
        { reverse_input_keys: true }
      ),
    ],
  },
  'cache-media-keys': {
    signature: 'photo:image, question:string -> answer:string',
    responses: [answer('Answer: a cat'), answer('Answer: a dog')],
    calls: [
      forward({
        photo: { mimeType: 'image/png', data: 'Y2F0' },
        question: 'What is it?',
      }),
      forward({
        photo: { mimeType: 'image/png', data: 'ZG9n' },
        question: 'What is it?',
      }),
      forward({
        photo: { mimeType: 'image/png', data: 'Y2F0' },
        question: 'What is it?',
      }),
    ],
  },
};

mkdirSync(outDir, { recursive: true });
for (const [name, spec] of Object.entries(cases)) {
  await record(name, spec);
}
