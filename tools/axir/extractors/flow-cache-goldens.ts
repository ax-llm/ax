// TS-golden AxFlow cachingFunction fixtures. Each case runs a sequence of
// TypeScript AxFlow forward / streamingForward calls on one flow with one
// in-memory cache, and records each call's output (and delta), its request
// count, and every read and write of the cache: the flow's own entry, and the
// entries of the AxGen nodes the flow's options reach. Keys are not compared:
// each port hashes its own deterministic key with SHA-256.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import { axGlobals } from '../../../src/ax/dsp/globals.js';
import { runControl } from '../../../src/ax/dsp/runControl.js';
import { flow } from '../../../src/ax/flow/flow.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axflow'
);

// Keys sort, except inside inputs, outputs and stored values, which keep
// their order.
function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered = [
      'input',
      'expected_outputs',
      'expected_cache_sets',
      'delta',
    ].includes(parentKey)
      ? entries
      : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [
        key,
        stable(
          item,
          ['expected_outputs', 'expected_cache_sets'].includes(parentKey)
            ? parentKey
            : key
        ),
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

type ResponseSpec = { results: JsonMap[] };

function scriptedAI(responses: ResponseSpec[]) {
  const queue = clone(responses);
  let calls = 0;
  const ai = new AxMockAIService({
    features: { functions: true, streaming: false },
    chatResponse: async () => {
      calls++;
      const next = queue.shift();
      if (!next) throw new Error('scripted client exhausted');
      return {
        results: next.results.map((result) => ({
          index: (result.index as number | undefined) ?? 0,
          content: result.content as string,
        })),
      } as AxChatResponse;
    },
  });
  return { ai, calls: () => calls };
}

// The flows, as TS builds them and as the ports' flow fixtures spell them.
const flows = {
  // One AxGen node: the flow's cachingFunction reaches the node's forward.
  qa: {
    build: () =>
      flow<{ question: string }, { answer: string }>()
        .node('qa', 'question:string -> answer:string')
        .execute('qa', (state) => ({ question: state.question }))
        .returns((state) => ({
          answer: String((state as any).qaResult.answer),
        })),
    steps: [
      {
        kind: 'execute',
        name: 'qa',
        signature: 'question:string -> answer:string',
      },
    ],
    returns: { answer: 'answer' },
  },
  // No model call: only the flow's own entry is cached.
  name: {
    build: () =>
      flow<{ firstName: string; lastName: string }, { fullName: string }>()
        .map((state) => ({ ...state, fullName: 'Ada Lovelace' }))
        .returns((state) => ({ fullName: String((state as any).fullName) })),
    steps: [
      { kind: 'map', name: 'fullName', output: { fullName: 'Ada Lovelace' } },
    ],
    returns: { fullName: 'fullName' },
  },
} as const;

type CallSpec = {
  kind: 'forward' | 'streaming_forward';
  input: JsonMap;
  // Attach a run control to this call.
  control?: boolean;
  // Pass the input with its keys in reverse order. Fixture JSON sorts its
  // keys, so the order is a flag every runner applies.
  reverse_input_keys?: boolean;
};

type Case = {
  flow: keyof typeof flows;
  // Where the caching function goes: the call's options (default) or the
  // process-wide global (axGlobals.cachingFunction). TS's AxFlow constructor
  // takes no cachingFunction.
  cache_in?: 'call' | 'global';
  // The cache throws this message on every read, or on every write.
  cache_read_error?: string;
  cache_write_error?: string;
  responses: ResponseSpec[];
  calls: CallSpec[];
};

async function record(name: string, spec: Case): Promise<void> {
  const { ai, calls: requestCount } = scriptedAI(spec.responses);
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
    const program = flows[spec.flow].build();
    for (const call of spec.calls) {
      const before = requestCount();
      const options: Record<string, unknown> = {};
      if (cacheIn === 'call') options.cachingFunction = cachingFunction;
      if (call.control) options.control = runControl();
      const input = call.reverse_input_keys
        ? Object.fromEntries(Object.entries(call.input).reverse())
        : call.input;
      errors.push(null);
      try {
        if (call.kind === 'forward') {
          outputs.push(
            clone((await program.forward(ai, input as never, options)) as Json)
          );
          deltas.push(null);
        } else {
          const seen: JsonMap[] = [];
          for await (const delta of program.streamingForward(
            ai,
            input as never,
            options
          )) {
            seen.push(clone(delta) as unknown as JsonMap);
          }
          // TS's flow stream is the whole output as one update.
          outputs.push(clone((seen.at(-1)?.delta ?? null) as Json));
          deltas.push(seen);
        }
      } catch (e) {
        errors[errors.length - 1] = (e as Error).message.split('\n')[0]!;
        outputs.push(null);
        deltas.push(null);
      }
      requests.push(requestCount() - before);
    }
  } finally {
    axGlobals.cachingFunction = previousGlobal;
  }

  const fixture: Record<string, unknown> = {
    kind: 'flow_cache_sequence',
    steps: flows[spec.flow].steps,
    returns: flows[spec.flow].returns,
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
    'cache_in',
    'cache_read_error',
    'cache_write_error',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  writeFixture(name, fixture);
}

const answer = (content: string): ResponseSpec => ({
  results: [{ index: 0, content }],
});
const forward = (input: JsonMap, extra: Partial<CallSpec> = {}): CallSpec => ({
  kind: 'forward',
  input,
  ...extra,
});
const streaming = (input: JsonMap): CallSpec => ({
  kind: 'streaming_forward',
  input,
});

const france = { question: 'Capital of France?' };
const ada = { firstName: 'Ada', lastName: 'Lovelace' };

const cases: Record<string, Case> = {
  // A miss runs the flow, and the node's forward caches its own output too;
  // the second call is a flow hit that runs nothing.
  'flow-cache-forward-miss-then-hit': {
    flow: 'qa',
    responses: [answer('Answer: Paris')],
    calls: [forward(france), forward(france)],
  },
  // Without a function in the call's options, the process-wide one applies.
  'flow-cache-global-fallback': {
    flow: 'qa',
    cache_in: 'global',
    responses: [answer('Answer: Paris')],
    calls: [forward(france), forward(france)],
  },
  // Other inputs miss.
  'flow-cache-different-inputs': {
    flow: 'qa',
    responses: [answer('Answer: Paris'), answer('Answer: Rome')],
    calls: [forward(france), forward({ question: 'Capital of Italy?' })],
  },
  // The key does not depend on the order of the input's keys.
  'flow-cache-key-stable-input-order': {
    flow: 'name',
    responses: [],
    calls: [forward(ada), forward(ada, { reverse_input_keys: true })],
  },
  // The flow ignores errors from its own cache reads and writes.
  'flow-cache-errors-ignored': {
    flow: 'name',
    cache_read_error: 'cache read failed',
    cache_write_error: 'cache write failed',
    responses: [],
    calls: [forward(ada), forward(ada)],
  },
  // The flow ignores its own read error, but its AxGen node's forward
  // reads the same function and, as AxGen forward does, fails with it.
  'flow-cache-node-read-error-propagates': {
    flow: 'qa',
    cache_read_error: 'cache read failed',
    responses: [answer('Answer: Paris')],
    calls: [forward(france)],
  },
  // A run control skips the cache, for the flow and its nodes.
  'flow-cache-control-skips-cache': {
    flow: 'qa',
    responses: [answer('Answer: Paris'), answer('Answer: Paris again')],
    calls: [
      forward(france, { control: true }),
      forward(france, { control: true }),
    ],
  },
  // A streamed flow is its whole output as one update, hit or miss.
  'flow-cache-streaming-miss-then-hit': {
    flow: 'qa',
    responses: [answer('Answer: Paris')],
    calls: [streaming(france), streaming(france)],
  },
};

mkdirSync(outDir, { recursive: true });
for (const [name, spec] of Object.entries(cases)) {
  await record(name, spec);
}
