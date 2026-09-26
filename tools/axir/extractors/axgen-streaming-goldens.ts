// TS-golden AxGen streaming fixtures. Each case runs TypeScript's real
// AxGen.streamingForward (or forward) against AxMockAIService with scripted
// provider chunks, and records the exact {version, index, delta} sequence, the
// merged output, and the request and tool-call counts. The port runners replay
// the same scripts and must match all of them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import { AxGen } from '../../../src/ax/dsp/generate.js';
import { f, fn } from '../../../src/ax/dsp/sig.js';
import { mergeDeltas } from '../../../src/ax/dsp/util.js';
import {
  AxAIRefusalError,
  AxAIServiceNetworkError,
  AxAIServiceResponseError,
  AxAIServiceStatusError,
  AxAIServiceStreamTerminatedError,
  AxAIServiceTimeoutError,
} from '../../../src/ax/util/apicall.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axgen'
);

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'input' || parentKey === 'expected_output'
        ? entries
        : entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(
      ordered.map(([key, item]) => [key, stable(item, key)])
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

// Scripted responses use the ports' snake_case fixture shape: {stream: [...]}
// streams its chunks, {error: {...}} fails the call before any chunk, and an
// {error: {...}} entry inside a stream fails the stream at that point.
type ErrorSpec = { type?: string; message?: string; status?: number };
type ChunkSpec = { results?: JsonMap[]; error?: ErrorSpec };
type ResponseSpec =
  | { stream: ChunkSpec[] }
  | { error: ErrorSpec }
  | { results: JsonMap[] };

function tsError(spec: ErrorSpec): Error {
  const message = spec.message ?? 'fixture error';
  switch (spec.type ?? 'network') {
    case 'status':
      return new AxAIServiceStatusError(
        spec.status ?? 500,
        message,
        'fixture://chat',
        undefined,
        undefined
      );
    case 'timeout':
      return new AxAIServiceTimeoutError('fixture://chat', 1);
    case 'refusal':
      return new AxAIRefusalError(message, 'fixture', 'fixture-request');
    case 'response':
      return new AxAIServiceResponseError(message, 'fixture://chat');
    case 'stream_terminated':
      return new AxAIServiceStreamTerminatedError('fixture://chat');
    case 'plain':
      return new Error(message);
    default:
      return new AxAIServiceNetworkError(
        new Error(message),
        'fixture://chat',
        undefined,
        undefined
      );
  }
}

function tsResult(result: JsonMap): AxChatResponse['results'][number] {
  const out: Record<string, unknown> = { index: result.index ?? 0 };
  if (result.content !== undefined) out.content = result.content;
  if (result.thought !== undefined) out.thought = result.thought;
  if (result.function_calls !== undefined)
    out.functionCalls = clone(result.function_calls);
  if (result.finish_reason !== undefined)
    out.finishReason = result.finish_reason;
  return out as AxChatResponse['results'][number];
}

function tsChunk(chunk: ChunkSpec): AxChatResponse {
  return { results: (chunk.results ?? []).map(tsResult) };
}

function scriptedAI(responses: ResponseSpec[], features: JsonMap | undefined) {
  const queue = clone(responses);
  let calls = 0;
  const ai = new AxMockAIService({
    features: {
      functions: (features?.functions as boolean | undefined) ?? true,
      streaming: true,
      structuredOutputs: features?.structured_outputs as boolean | undefined,
      ...(features?.structured_output_modes
        ? {
            structuredOutputModes: features.structured_output_modes as never,
          }
        : {}),
    },
    chatResponse: async () => {
      calls++;
      const next = queue.shift();
      if (!next) throw new Error('scripted client exhausted');
      if ('error' in next) throw tsError(next.error);
      if ('results' in next) return tsChunk(next);
      // Pull one chunk per read so a scripted error fails the stream only
      // after the earlier chunks were delivered.
      const chunks = [...next.stream];
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const chunk = chunks.shift();
          if (!chunk) {
            controller.close();
          } else if (chunk.error) {
            controller.error(tsError(chunk.error));
          } else {
            controller.enqueue(tsChunk(chunk));
          }
        },
      });
    },
  });
  return { ai, calls: () => calls };
}

// Option keys the fixtures spell in snake_case, mapped to TS names.
const optionNames: Record<string, string> = {
  show_thoughts: 'showThoughts',
  structured_output_mode: 'structuredOutputMode',
  max_retries: 'maxRetries',
  max_steps: 'maxSteps',
  sample_count: 'sampleCount',
  thought_field_name: 'thoughtFieldName',
  function_call: 'functionCall',
};

function tsOptions(options: JsonMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    out[optionNames[key] ?? key] = clone(value);
  }
  return out;
}

type ToolSpec = {
  name: string;
  description?: string;
  args?: Record<string, { type: string }>;
  result?: Json;
  error?: string;
};

function tsTools(specs: ToolSpec[], calls: JsonMap[]) {
  return specs.map((spec) => {
    let builder = fn(spec.name).description(spec.description ?? spec.name);
    for (const [name, arg] of Object.entries(spec.args ?? {})) {
      const field =
        arg.type === 'number'
          ? f.number(name)
          : arg.type === 'boolean'
            ? f.boolean(name)
            : f.string(name);
      builder = builder.arg(name, field) as typeof builder;
    }
    return builder
      .handler(async (args: Record<string, unknown>) => {
        calls.push({ name: spec.name, args: clone(args) as Json });
        if (spec.error) throw new Error(spec.error);
        return clone(spec.result);
      })
      .build();
  });
}

// Port assertion descriptors: {field?, contains?, equals?, return?, message?}.
type AssertSpec = {
  field?: string;
  contains?: string;
  equals?: Json;
  return?: Json;
  message?: string;
};

function tsAssert(spec: AssertSpec) {
  return (values: Record<string, unknown>) => {
    const value = spec.field ? values[spec.field] : values;
    if ('return' in spec) {
      if (spec.return === null) return undefined;
      if (spec.return === false) return false;
      if (typeof spec.return === 'string') return spec.return;
    }
    if (
      spec.contains !== undefined &&
      !String(value).includes(String(spec.contains))
    )
      return false;
    if (
      spec.equals !== undefined &&
      JSON.stringify(value) !== JSON.stringify(spec.equals)
    )
      return false;
    return true;
  };
}

// Port streaming assertion descriptors: {field, not_contains, message?}.
type StreamingAssertSpec = {
  field: string;
  not_contains: string;
  message?: string;
};

// Processor descriptors for fixtures. A processor records each call and
// returns `returns` (or the value itself with `echo`), optionally only once
// the field is done.
type ProcessorSpec = {
  field: string;
  returns?: Json;
  echo?: boolean;
  when_done?: boolean;
  times?: number;
  throws?: string;
};

function tsProcessor(spec: ProcessorSpec, calls: JsonMap[]) {
  let returned = 0;
  return (value: unknown, context?: { done?: boolean }) => {
    const done = context?.done ?? false;
    calls.push({ field: spec.field, value: clone(value) as Json, done });
    if (spec.throws !== undefined) throw new Error(spec.throws);
    if (spec.when_done && !done) return undefined;
    if (spec.times !== undefined && returned >= spec.times) return undefined;
    const result = spec.echo
      ? value
      : spec.returns === null
        ? undefined
        : clone(spec.returns);
    if (result !== undefined) returned++;
    return result;
  };
}

type Case = {
  kind?: 'streaming_forward' | 'forward';
  signature: string;
  input?: JsonMap;
  options?: JsonMap;
  forward_options?: JsonMap;
  features?: JsonMap;
  tools?: ToolSpec[];
  assertions?: AssertSpec[];
  streaming_assertions?: StreamingAssertSpec[];
  feedback_processors?: ProcessorSpec[];
  streaming_processors?: ProcessorSpec[];
  result_picker_index?: number;
  stop_functions?: string[];
  responses: ResponseSpec[];
  // The part of TS's error message the ports must produce; defaults to the
  // first line without TS's "Generate failed: " wrapper.
  error_contains?: string;
};

async function record(name: string, spec: Case): Promise<void> {
  const kind = spec.kind ?? 'streaming_forward';
  const input = spec.input ?? { question: 'Status?' };
  const toolCalls: JsonMap[] = [];
  const processorCalls: JsonMap[] = [];
  const { ai, calls } = scriptedAI(spec.responses, spec.features);
  const gen = new AxGen(spec.signature, {
    ...tsOptions(spec.options),
    functions: tsTools(spec.tools ?? [], toolCalls),
  });
  for (const assertion of spec.assertions ?? []) {
    gen.addAssert(tsAssert(assertion), assertion.message);
  }
  for (const assertion of spec.streaming_assertions ?? []) {
    gen.addStreamingAssert(
      assertion.field as never,
      (content: string) => !content.includes(assertion.not_contains),
      assertion.message
    );
  }
  for (const processor of spec.feedback_processors ?? []) {
    gen.addFieldProcessor(
      processor.field as never,
      tsProcessor(processor, processorCalls) as never
    );
  }
  for (const processor of spec.streaming_processors ?? []) {
    gen.addStreamingFieldProcessor(
      processor.field as never,
      tsProcessor(processor, processorCalls) as never
    );
  }
  const forwardOptions: Record<string, unknown> = {
    ...tsOptions(spec.forward_options),
  };
  if (spec.result_picker_index !== undefined) {
    const picked = spec.result_picker_index;
    forwardOptions.resultPicker = async () => picked;
  }
  if (spec.stop_functions) {
    forwardOptions.stopFunction = [...spec.stop_functions];
  }

  const deltas: JsonMap[] = [];
  let output: Json | undefined;
  let error: string | undefined;
  try {
    if (kind === 'forward') {
      output = clone((await gen.forward(ai, input, forwardOptions)) as Json);
    } else {
      for await (const delta of gen.streamingForward(
        ai,
        input,
        forwardOptions
      )) {
        deltas.push(clone(delta) as unknown as JsonMap);
      }
    }
  } catch (e) {
    error = (e as Error).message.split('\n')[0];
  }

  const fixture: Record<string, unknown> = {
    kind,
    signature: spec.signature,
    input,
    responses: spec.responses,
    expected_request_count: calls(),
  };
  for (const key of [
    'options',
    'forward_options',
    'features',
    'tools',
    'assertions',
    'streaming_assertions',
    'feedback_processors',
    'streaming_processors',
    'result_picker_index',
    'stop_functions',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  if (spec.tools) fixture.expected_tool_calls = toolCalls;
  if (spec.feedback_processors || spec.streaming_processors)
    fixture.expected_processor_calls = processorCalls;
  if (kind === 'streaming_forward') {
    fixture.expected_deltas = deltas;
    if (error === undefined) {
      // A consumer merges the deltas per index and starts over whenever the
      // version changes; the output is the picked sample (index 0 without a
      // result picker).
      let buffer: { version: number; index: number; delta: object }[] = [];
      let version = 0;
      for (const delta of deltas) {
        if (delta.version !== version) buffer = [];
        version = delta.version as number;
        buffer = mergeDeltas(buffer as never, clone(delta) as never) as never;
      }
      // forward returns the first sample merged in the last version; a
      // result picker's single envelope is the only one there.
      fixture.expected_output = clone(buffer[0]?.delta ?? {});
    }
  } else if (error === undefined) {
    fixture.expected_output = output;
  }
  if (error !== undefined) {
    const expected =
      spec.error_contains ?? error.replace(/^Generate failed: /, '');
    if (!error.includes(expected)) {
      throw new Error(`${name}: TS error "${error}" lacks "${expected}"`);
    }
    fixture.expected_error_contains = expected;
  } else if (spec.error_contains !== undefined) {
    throw new Error(
      `${name}: expected TS to fail with "${spec.error_contains}"`
    );
  }
  writeFixture(name, fixture);
}

// ----- scripted chunk helpers -----
const chunk = (fields: JsonMap): ChunkSpec => ({
  results: [{ index: 0, ...fields }],
});
const text = (content: string): ChunkSpec => chunk({ content });
const thought = (value: string): ChunkSpec => chunk({ thought: value });
const done = (content = ''): ChunkSpec =>
  chunk(
    content ? { content, finish_reason: 'stop' } : { finish_reason: 'stop' }
  );
const streamed = (...chunks: ChunkSpec[]): ResponseSpec => ({ stream: chunks });
const call = (id: string, name: string, params: string): JsonMap => ({
  id,
  type: 'function',
  function: { name, params },
});

mkdirSync(outDir, { recursive: true });

const lookupTool: ToolSpec = {
  name: 'lookup',
  description: 'Look up a key',
  args: { key: { type: 'string' } },
  result: 'status is green',
};
const finishTool: ToolSpec = {
  name: 'finish',
  description: 'Finish the task',
  args: { note: { type: 'string' } },
  result: 'finished',
};
const nativeFeatures: JsonMap = { functions: true, structured_outputs: true };
const longTitle =
  'Quarterly results for the northern region, including revenue, churn and hiring';
const longBody =
  'Revenue grew eleven percent while churn fell to four percent. Hiring slowed in the second month, and the team expects a flat third quarter.';

const cases: Record<string, Case> = {
  // ----- text contract -----
  'streaming-forward-text-single-field': {
    signature: 'question:string -> answer:string',
    responses: [streamed(text('Answer: hel'), text('lo wor'), done('ld'))],
  },
  'streaming-forward-text-multi-field': {
    signature: 'question:string -> answer:string, score:number',
    responses: [
      streamed(
        text('Answer: The capital'),
        text(' is Paris.\nSco'),
        text('re: 9'),
        done()
      ),
    ],
  },
  'streaming-forward-text-unlabeled': {
    signature: 'question:string -> answer:string',
    responses: [streamed(text('Par'), text('is is '), done('the capital'))],
  },
  'streaming-forward-text-label-split': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(
        text('A'),
        text('ns'),
        text('wer'),
        text(':'),
        text(' hi'),
        done(' there')
      ),
    ],
  },
  'streaming-forward-text-trailing-whitespace': {
    signature: 'question:string -> answer:string, note:string',
    responses: [
      streamed(
        text('Answer: one  '),
        text('\n two \n'),
        text('\nNote:   kept  '),
        done('\n')
      ),
    ],
  },
  'streaming-forward-text-code-field': {
    signature: 'question:string -> answer:code',
    responses: [
      streamed(
        text('Answer: ```py'),
        text('thon\nprint(1)\n'),
        text('print(2)\n``'),
        done('`')
      ),
    ],
  },
  'streaming-forward-text-array-field': {
    signature: 'question:string -> items:string[], summary:string',
    responses: [
      streamed(
        text('Items:\n- ap'),
        text('ple\n- banana\n'),
        text('Summary: two fruits'),
        done()
      ),
    ],
  },
  'streaming-forward-text-number-first': {
    signature: 'question:string -> score:number, answer:string',
    responses: [streamed(text('Score: 7'), text('\nAnswer: se'), done('ven'))],
  },
  'streaming-forward-text-title-label': {
    signature: 'question:string -> finalAnswer:string',
    responses: [streamed(text('Final Ans'), text('wer: yes'), done())],
  },
  'streaming-forward-text-optional-missing': {
    signature: 'question:string -> answer:string, note?:string',
    responses: [streamed(text('Answer: only this'), done())],
  },
  'streaming-forward-text-internal-field': {
    signature: 'question:string -> reasoning!:string, answer:string',
    responses: [
      streamed(text('Reasoning: think'), text(' hard\nAnswer: done'), done()),
    ],
  },
  'streaming-forward-text-thought': {
    signature: 'question:string -> answer:string',
    forward_options: { show_thoughts: true },
    responses: [
      streamed(
        thought('Think '),
        thought('more. '),
        text('Answer: o'),
        done('k')
      ),
    ],
  },
  'streaming-forward-text-thought-renamed': {
    signature: 'question:string -> answer:string',
    options: { thought_field_name: 'reasoning' },
    forward_options: { show_thoughts: true },
    responses: [streamed(thought('Hmm.'), text('Answer: ok'), done())],
  },
  'streaming-forward-text-json-field': {
    signature: 'question:string -> answer:string, details:json',
    responses: [
      streamed(
        text('Answer: see details\nDetails: {"a":'),
        text(' [1, 2]}'),
        done()
      ),
    ],
  },

  // ----- structured JSON -----
  'streaming-forward-native-json-short': {
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    responses: [streamed(text('{"user":{"na'), text('me":"Ada"}}'), done())],
  },
  'streaming-forward-native-json-partial': {
    signature:
      'question:string -> report:object{title:string, body:string}, tags:string[]',
    features: nativeFeatures,
    responses: [
      streamed(
        text(`{"report":{"title":"${longTitle}",`),
        text(`"body":"${longBody.slice(0, 70)}`),
        text(`${longBody.slice(70)}"},`),
        text('"tags":["finance","north'),
        text('ern","quarterly"]'),
        done('}')
      ),
    ],
  },
  'streaming-forward-native-json-object-array': {
    signature: 'question:string -> people:object{name:string, role:string}[]',
    features: nativeFeatures,
    responses: [
      streamed(
        text(
          '{"people":[{"name":"Ada Lovelace","role":"analyst of the analytical engine"},{"name":"Grace Hopper","role":"compiler pioneer"},'
        ),
        text('{"name":"Katherine Johnson","ro'),
        text(
          'le":"orbital mechanics at NASA, calculating trajectories for the Mercury and Apollo programs"}'
        ),
        text(',{"name":"Alan Turing","role":"computing theory"}]}'),
        done()
      ),
    ],
  },
  'streaming-forward-json-object-rung': {
    signature: 'question:string -> user:object{name:string, age:number}',
    options: { structured_output_mode: 'json_object' },
    features: { functions: true, structured_outputs: false },
    responses: [
      streamed(text('{"user":{"name":"Ada",'), text('"age":36}}'), done()),
    ],
  },
  'streaming-forward-json-object-invalid-retry': {
    signature: 'question:string -> user:object{name:string}',
    options: { structured_output_mode: 'json_object' },
    features: { functions: true, structured_outputs: false },
    responses: [
      streamed(text('Here you go: {"user":{"name":"Ada"}}'), done()),
      streamed(text('{"user":{"name":"Ada"}}'), done()),
    ],
  },
  'streaming-forward-native-json-text-fallback': {
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    responses: [streamed(text('User: {"name":"Ada"}'), done())],
  },

  // ----- function rung -----
  'streaming-forward-function-rung': {
    signature: 'question:string -> user:object{name:string}',
    options: { structured_output_mode: 'function' },
    features: { functions: true, structured_outputs: false },
    forward_options: { show_thoughts: true },
    responses: [
      streamed(
        thought('Pick '),
        chunk({
          thought: 'a name.',
          function_calls: [call('output_1', '__axOutput', '{"user":{"name":')],
        }),
        chunk({
          function_calls: [call('output_1', '', '"Ada"}}')],
          finish_reason: 'function_call',
        })
      ),
    ],
  },

  // ----- tools -----
  'streaming-forward-tool-loop': {
    signature: 'question:string -> answer:string',
    tools: [lookupTool],
    forward_options: { show_thoughts: true },
    responses: [
      streamed(
        thought('Look '),
        chunk({
          thought: 'up. ',
          function_calls: [call('call_1', 'lookup', '{"key":')],
        }),
        chunk({
          function_calls: [call('call_1', '', '"a"}')],
          finish_reason: 'function_call',
        })
      ),
      streamed(thought('Answer.'), text('Answer: gre'), done('en')),
    ],
  },
  'streaming-forward-stop-function': {
    signature: 'question:string -> answer:string',
    tools: [lookupTool, finishTool],
    stop_functions: ['finish'],
    forward_options: { show_thoughts: true },
    responses: [
      streamed(
        thought('First. '),
        chunk({
          function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
          finish_reason: 'function_call',
        })
      ),
      streamed(
        thought('Done.'),
        chunk({
          function_calls: [call('call_2', 'finish', '{"note":"ok"}')],
          finish_reason: 'function_call',
        })
      ),
    ],
  },

  // ----- retries -----
  'streaming-forward-validation-retry': {
    signature: 'question:string -> answer:string, score:number',
    responses: [
      streamed(text('Answer: hi'), text('\nScore: abc'), done()),
      streamed(text('Answer: hi'), text('\nScore: 3'), done()),
    ],
  },
  'streaming-forward-validation-missing-field': {
    signature: 'question:string -> answer:string, score:number',
    responses: [
      streamed(text('Answer: hi there'), done()),
      streamed(text('Answer: hi there\nScore: 2'), done()),
    ],
  },
  'streaming-forward-validation-exhausted': {
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 1 },
    error_contains: "Field 'Score' has an invalid value 'y': Invalid number",
    responses: [
      streamed(text('Answer: a\nScore: x'), done()),
      streamed(text('Answer: b\nScore: y'), done()),
    ],
  },
  'streaming-forward-refusal-retry': {
    signature: 'question:string -> answer:string',
    responses: [
      {
        error: {
          type: 'refusal',
          message: 'Model refused the fixture request',
        },
      },
      streamed(text('Answer: ok'), done()),
    ],
  },
  'streaming-forward-infra-retry-before-stream': {
    signature: 'question:string -> answer:string',
    responses: [
      {
        error: { type: 'status', status: 503, message: 'Service Unavailable' },
      },
      streamed(text('Answer: ok'), done()),
    ],
  },
  'streaming-forward-infra-retry-mid-stream': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(text('Answer: hel'), {
        error: { type: 'network', message: 'socket hang up' },
      }),
      streamed(text('Answer: hel'), text('lo world'), done()),
    ],
  },
  'streaming-forward-infra-after-validation-retry': {
    signature: 'question:string -> answer:string, score:number',
    responses: [
      streamed(text('Answer: first\nScore: bad'), done()),
      streamed(text('Answer: sec'), {
        error: { type: 'network', message: 'socket hang up' },
      }),
      streamed(text('Answer: second\nScore: 4'), done()),
    ],
  },
  'streaming-forward-max-tokens': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(
        text('Answer: cut'),
        chunk({ content: ' off', finish_reason: 'length' })
      ),
    ],
  },

  // ----- samples -----
  'streaming-forward-multi-sample': {
    signature: 'question:string -> answer:string',
    forward_options: { sample_count: 2 },
    responses: [
      streamed(
        {
          results: [
            { index: 0, content: 'Answer: fir' },
            { index: 1, content: 'Answer: sec' },
          ],
        },
        { results: [{ index: 1, content: 'ond' }] },
        {
          results: [
            { index: 0, content: 'st', finish_reason: 'stop' },
            { index: 1, finish_reason: 'stop' },
          ],
        }
      ),
    ],
  },
  'streaming-forward-result-picker': {
    signature: 'question:string -> answer:string',
    forward_options: { sample_count: 2 },
    result_picker_index: 1,
    responses: [
      streamed(
        {
          results: [
            { index: 0, content: 'Answer: fir' },
            { index: 1, content: 'Answer: sec' },
          ],
        },
        {
          results: [
            { index: 0, content: 'st' },
            { index: 1, content: 'ond' },
          ],
        },
        {
          results: [
            { index: 0, finish_reason: 'stop' },
            { index: 1, finish_reason: 'stop' },
          ],
        }
      ),
    ],
  },

  // ----- assertions -----
  'streaming-forward-assertion-retry': {
    signature: 'question:string -> answer:string',
    assertions: [
      { field: 'answer', contains: 'Paris', message: 'Mention Paris' },
    ],
    responses: [
      streamed(text('Answer: Ly'), done('on')),
      streamed(text('Answer: Par'), done('is')),
    ],
  },
  'streaming-forward-assertion-without-message': {
    signature: 'question:string -> answer:string',
    assertions: [{ field: 'answer', contains: 'Paris' }],
    responses: [streamed(text('Answer: Lyon'), done())],
  },
  'streaming-forward-streaming-assertion-retry': {
    signature: 'question:string -> answer:string',
    streaming_assertions: [
      {
        field: 'answer',
        not_contains: 'forbidden',
        message: 'Do not say forbidden',
      },
    ],
    responses: [
      streamed(text('Answer: this is '), text('forbidden text'), done()),
      streamed(text('Answer: this is fine'), done()),
    ],
  },

  // ----- field processors (TypeScript feedback semantics) -----
  'streaming-forward-feedback-processor': {
    signature: 'question:string -> answer:string',
    feedback_processors: [
      { field: 'answer', returns: 'Check the spelling.', times: 1 },
    ],
    responses: [
      streamed(text('Answer: Pariss'), done()),
      streamed(text('Answer: Paris'), done()),
    ],
  },
  'streaming-forward-streaming-processor': {
    signature: 'question:string -> answer:string, note:string',
    streaming_processors: [{ field: 'answer', returns: null }],
    responses: [
      streamed(text('Answer: a'), text('b c'), text('\nNote: n'), done()),
    ],
  },
  'streaming-forward-streaming-processor-feedback': {
    signature: 'question:string -> answer:string',
    streaming_processors: [
      { field: 'answer', returns: 'Keep going.', when_done: true, times: 1 },
    ],
    responses: [
      streamed(text('Answer: dra'), done('ft')),
      streamed(text('Answer: final'), done()),
    ],
  },

  // A processor's own error ends the run at once, with no retry.
  'streaming-forward-streaming-processor-error': {
    signature: 'question:string -> answer:string',
    streaming_processors: [{ field: 'answer', throws: 'processor exploded' }],
    responses: [
      streamed(text('Answer: a'), text('b'), done()),
      streamed(text('Answer: ab'), done()),
    ],
  },
  'streaming-forward-feedback-processor-error': {
    signature: 'question:string -> answer:string',
    feedback_processors: [{ field: 'answer', throws: 'processor exploded' }],
    responses: [
      streamed(text('Answer: a'), done('b')),
      streamed(text('Answer: ab'), done()),
    ],
  },

  // ----- non-streaming forward: TypeScript's text extraction -----
  'forward-feedback-processor': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    feedback_processors: [
      { field: 'answer', returns: 'Check the spelling.', times: 1 },
    ],
    responses: [
      { results: [{ index: 0, content: 'Answer: Pariss' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
    ],
  },
  'forward-feedback-processor-error': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    feedback_processors: [{ field: 'answer', throws: 'processor exploded' }],
    responses: [
      { results: [{ index: 0, content: 'Answer: one' }] },
      { results: [{ index: 0, content: 'Answer: two' }] },
    ],
  },
  'forward-feedback-processor-echo-max-steps': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    forward_options: { max_steps: 3 },
    feedback_processors: [{ field: 'answer', echo: true }],
    responses: [
      { results: [{ index: 0, content: 'Answer: one' }] },
      { results: [{ index: 0, content: 'Answer: two' }] },
      { results: [{ index: 0, content: 'Answer: three' }] },
    ],
  },
  'text-extract-unlabeled-single-field': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [{ results: [{ index: 0, content: 'ok' }] }],
  },
  'text-extract-unlabeled-number': {
    kind: 'forward',
    signature: 'question:string -> answer:number',
    responses: [{ results: [{ index: 0, content: '42' }] }],
  },
  'text-extract-number-coercion': {
    kind: 'forward',
    signature: 'question:string -> first:number, second:number, third:number',
    responses: [
      {
        results: [{ index: 0, content: 'First: +5\nSecond: 0x10\nThird: 1e3' }],
      },
    ],
  },
  'text-extract-markdown-list': {
    kind: 'forward',
    signature: 'question:string -> answers:string[]',
    responses: [
      { results: [{ index: 0, content: 'Answers:\n- a\n- b\n* c\n1. d' }] },
    ],
  },
  'text-extract-bare-array-value': {
    kind: 'forward',
    signature: 'question:string -> answers:string[]',
    responses: [{ results: [{ index: 0, content: 'Answers: just one' }] }],
  },
  'text-extract-boolean-case': {
    kind: 'forward',
    signature: 'question:string -> approved:boolean, flagged:boolean',
    responses: [
      { results: [{ index: 0, content: 'Approved: TRUE\nFlagged: False' }] },
    ],
  },
  'text-extract-code-fence': {
    kind: 'forward',
    signature: 'question:string -> answer:code',
    responses: [
      {
        results: [{ index: 0, content: 'Answer: ```js\nconsole.log(1)\n```' }],
      },
    ],
  },
  'text-extract-json-fence': {
    kind: 'forward',
    signature: 'question:string -> answer:string, details:json',
    responses: [
      {
        results: [
          { index: 0, content: 'Answer: see\nDetails: ```json\n{"a":1}\n```' },
        ],
      },
    ],
  },
  'text-extract-null-optional': {
    kind: 'forward',
    signature: 'question:string -> answer:string, note?:string',
    responses: [
      { results: [{ index: 0, content: 'Answer: yes\nNote: null' }] },
    ],
  },
  'text-extract-out-of-order': {
    kind: 'forward',
    signature: 'question:string -> answer:string, score:number',
    responses: [
      { results: [{ index: 0, content: 'Score: 3\nAnswer: hello\nworld' }] },
    ],
  },
  'text-extract-label-mid-line': {
    kind: 'forward',
    signature: 'question:string -> answer:string, score:number',
    responses: [
      {
        results: [{ index: 0, content: 'Answer: see Score: 5 here\nScore: 2' }],
      },
    ],
  },
  // The ports' JSON-object fallback applies only to one JSON object whose
  // keys are all output fields; everything else follows TS.
  'text-extract-json-extra-keys': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [
      { results: [{ index: 0, content: '{"answer":"x","extra":1}' }] },
    ],
  },
  'text-extract-json-not-object': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [{ results: [{ index: 0, content: '["x"]' }] }],
  },
  'text-extract-json-in-text': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [{ results: [{ index: 0, content: 'Sure: {"answer":"x"}' }] }],
  },
  'text-extract-json-extra-keys-multi-field': {
    kind: 'forward',
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 1 },
    responses: [
      {
        results: [
          { index: 0, content: '{"answer":"x","score":1,"extra":true}' },
        ],
      },
      {
        results: [
          { index: 0, content: '{"answer":"x","score":1,"extra":true}' },
        ],
      },
    ],
    error_contains:
      "Required field not found: 'Answer' (string), 'Score' (number)",
  },
  'text-extract-number-array': {
    kind: 'forward',
    signature: 'question:string -> scores:number[]',
    responses: [{ results: [{ index: 0, content: 'Scores: [1, "2", 3.5]' }] }],
  },
};

// Port-only: a field transform rewrites the final value, which a stream
// cannot replace once sent, so the field streams once, transformed. TS has no
// transforms; the other deltas follow TS.
writeFixture('streaming-forward-field-transform', {
  kind: 'streaming_forward',
  signature: 'question:string -> answer:string, note:string',
  input: { question: 'Status?' },
  field_transforms: [{ field: 'answer', op: 'uppercase' }],
  responses: [streamed(text('Answer: hel'), text('lo\nNote: fi'), done('ne'))],
  expected_deltas: [
    { version: 0, index: 0, delta: { note: 'fi' } },
    { version: 0, index: 0, delta: { note: 'ne' } },
    { version: 0, index: 0, delta: { answer: 'HELLO' } },
  ],
  expected_output: { note: 'fine', answer: 'HELLO' },
  expected_request_count: 1,
});

for (const [name, spec] of Object.entries(cases)) {
  await record(name, spec);
}
