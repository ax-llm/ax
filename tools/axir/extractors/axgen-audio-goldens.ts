// TS-golden fixtures for AxGen audio outputs. Each case runs TypeScript's real
// AxGen (forward or streamingForward) against AxMockAIService with scripted
// chat and speak responses, and records the output (or deltas), each speak()
// request, and the chat request count. TypeScript renders audio outputs
// through speak() by default; the ports do so with the renderAudio option, so
// every fixture passes renderAudio: true to them unless it pins the ports'
// text default ("off" variants), which expect the text TS sent to speak() and
// no speak requests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import { AxGen } from '../../../src/ax/dsp/generate.js';
import { mergeDeltas } from '../../../src/ax/dsp/util.js';
import { flow } from '../../../src/ax/flow/flow.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

const outRoot = process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd();
const axgenDir = join(outRoot, 'ir/conformance/axgen');
const flowDir = join(outRoot, 'ir/conformance/axflow');

// Keys sort, except inside inputs and outputs, which keep their order.
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

function writeFixture(
  dir: string,
  name: string,
  fixture: Record<string, unknown>
): void {
  writeFileSync(
    join(dir, `${name}.json`),
    `${JSON.stringify(stable({ name, ...fixture }), null, 2)}\n`
  );
}

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

// Scripted chat responses use the ports' fixture shape: {results: [...]} is
// one response and {stream: [...]} streams its chunks.
type ChunkSpec = { results: JsonMap[] };
type ResponseSpec = { stream: ChunkSpec[] } | { results: JsonMap[] };
// A scripted speak() response, or {error: {type: 'plain', message}} to make
// speak() throw.
type SpeakSpec = JsonMap;

function tsResult(result: JsonMap): AxChatResponse['results'][number] {
  const out: Record<string, unknown> = { index: result.index ?? 0 };
  if (result.content !== undefined) out.content = result.content;
  if (result.function_calls !== undefined)
    out.functionCalls = clone(result.function_calls);
  if (result.finish_reason !== undefined)
    out.finishReason = result.finish_reason;
  return out as AxChatResponse['results'][number];
}

function scriptedAI(
  responses: ResponseSpec[],
  speakResponses: SpeakSpec[],
  features: JsonMap | undefined
) {
  const queue = clone(responses);
  const speakQueue = clone(speakResponses);
  let calls = 0;
  const prompts: Json[] = [];
  const speakRequests: Json[] = [];
  const ai = new AxMockAIService({
    features: {
      functions: (features?.functions as boolean | undefined) ?? true,
      streaming: true,
      structuredOutputs: features?.structured_outputs as boolean | undefined,
    },
    chatResponse: async (req) => {
      calls++;
      prompts.push(clone(req.chatPrompt) as unknown as Json);
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
    speechResponse: (req) => {
      speakRequests.push(clone(req) as unknown as Json);
      const next = speakQueue.shift();
      if (!next) throw new Error('scripted speak exhausted');
      // {error: {type: 'plain', message}} makes speak() throw that message.
      if (next.error) {
        throw new Error(String((next.error as JsonMap).message));
      }
      return clone(next) as never;
    },
  });
  return {
    ai,
    calls: () => calls,
    prompts: () => prompts,
    speakRequests: () => speakRequests,
  };
}

// Option keys the fixtures spell in snake_case, mapped to TS names.
const optionNames: Record<string, string> = {
  sample_count: 'sampleCount',
  structured_output_mode: 'structuredOutputMode',
};

function tsOptions(options: JsonMap | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    out[optionNames[key] ?? key] = clone(value);
  }
  return out;
}

type Case = {
  kind?: 'forward' | 'streaming_forward';
  signature: string;
  input?: JsonMap;
  // AxGen constructor options.
  options?: JsonMap;
  forward_options?: JsonMap;
  features?: JsonMap;
  result_picker_index?: number;
  responses: ResponseSpec[];
  speak_responses?: SpeakSpec[];
  // The ports' opt-in: renderAudio true (default), unset ("unset"), or false.
  render?: true | 'unset' | false;
  // Output fields TS rendered, in speak() order; an "off" fixture puts the
  // text TS sent to speak() back in them.
  rendered?: string[];
  // Pin the trace the forward records.
  trace?: boolean;
  // Pin the first request's user message.
  pin_user_prompt?: boolean;
  error_contains?: string;
};

type Run = {
  output?: Json;
  deltas: JsonMap[];
  error?: string;
  errorMessage?: string;
  chatCalls: number;
  speakRequests: Json[];
  prompts: Json[];
  trace?: JsonMap;
};

async function run(spec: Case): Promise<Run> {
  const kind = spec.kind ?? 'forward';
  const input = spec.input ?? { question: 'Say hi' };
  const { ai, calls, prompts, speakRequests } = scriptedAI(
    spec.responses,
    spec.speak_responses ?? [],
    spec.features
  );
  const gen = new AxGen(spec.signature, tsOptions(spec.options) as never);
  const forwardOptions: Record<string, unknown> = tsOptions(
    spec.forward_options
  );
  if (spec.result_picker_index !== undefined) {
    const picked = spec.result_picker_index;
    forwardOptions.resultPicker = async () => picked;
  }
  const deltas: JsonMap[] = [];
  let output: Json | undefined;
  let error: string | undefined;
  let errorMessage: string | undefined;
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
    errorMessage = (e as Error).message;
    error = errorMessage.split('\n')[0];
  }
  const traces = gen.getTraces();
  return {
    output,
    deltas,
    error,
    errorMessage,
    chatCalls: calls(),
    speakRequests: speakRequests(),
    prompts: prompts(),
    trace: traces.at(-1)?.trace as JsonMap | undefined,
  };
}

// What a streaming consumer merges: the first sample in the last version.
function mergedOutput(deltas: JsonMap[]): Json {
  let buffer: { version: number; index: number; delta: object }[] = [];
  let version = 0;
  for (const delta of deltas) {
    if (delta.version !== version) buffer = [];
    version = delta.version as number;
    buffer = mergeDeltas(buffer as never, clone(delta) as never) as never;
  }
  return clone(buffer[0]?.delta ?? {}) as Json;
}

// The output the ports return without rendering: the text TS sent to speak()
// in each rendered field.
function unrendered(output: Json, spec: Case, speakRequests: Json[]): Json {
  const rendered = spec.rendered ?? [];
  if (rendered.length !== speakRequests.length) {
    throw new Error(
      `rendered fields ${JSON.stringify(rendered)} do not match ${speakRequests.length} speak requests`
    );
  }
  const out = clone(output) as JsonMap;
  rendered.forEach((field, index) => {
    const text = (speakRequests[index] as JsonMap).text;
    const artifact = out[field] as JsonMap | undefined;
    if (!artifact || typeof artifact !== 'object') {
      throw new Error(`field ${field} was not rendered`);
    }
    out[field] = text;
  });
  return out;
}

async function record(name: string, spec: Case): Promise<void> {
  const kind = spec.kind ?? 'forward';
  const input = spec.input ?? { question: 'Say hi' };
  const result = await run(spec);
  const render = spec.render ?? true;
  const forwardOptions: JsonMap = { ...(spec.forward_options ?? {}) };
  if (render !== 'unset') forwardOptions.renderAudio = render;

  const fixture: Record<string, unknown> = {
    kind,
    signature: spec.signature,
    input,
    responses: spec.responses,
    forward_options: forwardOptions,
    expected_request_count: result.chatCalls,
  };
  for (const key of [
    'options',
    'features',
    'result_picker_index',
    'speak_responses',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  const rendering = render === true;
  fixture.expected_speak_requests = rendering ? result.speakRequests : [];

  if (result.error !== undefined) {
    if (!rendering) throw new Error(`${name}: an off fixture cannot fail`);
    const expected = spec.error_contains ?? result.error;
    if (!result.errorMessage!.includes(expected)) {
      throw new Error(
        `${name}: TS error "${result.error}" lacks "${expected}"`
      );
    }
    fixture.expected_error_contains = expected;
    if (kind === 'streaming_forward') fixture.expected_deltas = result.deltas;
  } else {
    if (spec.error_contains !== undefined) {
      throw new Error(
        `${name}: expected TS to fail with ${spec.error_contains}`
      );
    }
    if (kind === 'forward') {
      fixture.expected_output = rendering
        ? result.output
        : unrendered(result.output!, spec, result.speakRequests);
    } else {
      const merged = mergedOutput(result.deltas);
      if (rendering) {
        fixture.expected_deltas = result.deltas;
        fixture.expected_output = merged;
      } else {
        const text = unrendered(merged, spec, result.speakRequests);
        // Only a result picker's single envelope is rendered.
        if (result.deltas.length !== 1) {
          throw new Error(`${name}: an off stream needs one rendered delta`);
        }
        fixture.expected_deltas = [{ ...result.deltas[0], delta: text }];
        fixture.expected_output = text;
      }
    }
    if (spec.trace) {
      // TS's trace is the input and the output together.
      const expectedTrace = { ...input, ...(result.output as JsonMap) };
      if (JSON.stringify(result.trace) !== JSON.stringify(expectedTrace)) {
        throw new Error(
          `${name}: TS trace ${JSON.stringify(result.trace)} is not the input and output`
        );
      }
      fixture.expected_trace = {
        status: 'ok',
        input,
        output: fixture.expected_output,
      };
    }
  }
  if (spec.pin_user_prompt) {
    const first = (result.prompts[0] ?? []) as {
      role?: string;
      content?: Json;
    }[];
    const user = first.filter((message) => message.role === 'user').at(-1);
    if (typeof user?.content !== 'string') {
      throw new Error(`${name}: no text user message to pin`);
    }
    fixture.expected_chat_prompt_contains = [JSON.stringify(user.content)];
  }
  writeFixture(axgenDir, name, fixture);
}

// ----- scripted response helpers -----
const answer = (content: string): ResponseSpec => ({
  results: [{ index: 0, content, finish_reason: 'stop' }],
});
const streamed = (...chunks: ChunkSpec[]): ResponseSpec => ({
  stream: chunks,
});
const chunk = (fields: JsonMap): ChunkSpec => ({
  results: [{ index: 0, ...fields }],
});
const structuredCall = (args: JsonMap): ResponseSpec => ({
  results: [
    {
      index: 0,
      content: '',
      function_calls: [
        {
          id: 'output_1',
          type: 'function',
          function: { name: '__axOutput', params: JSON.stringify(args) },
        },
      ],
      finish_reason: 'function_call',
    },
  ],
});

// TypeScript's speak() responses (AxSpeechResponse): audio data, format, mime
// type and, from real providers, the spoken text as the transcript.
const mp3 = (transcript?: string): JsonMap => ({
  data: 'SUQzBAA=',
  format: 'mp3',
  mimeType: 'audio/mpeg',
  ...(transcript === undefined ? {} : { transcript }),
});
const wav = (transcript?: string): JsonMap => ({
  data: 'UklGRg==',
  format: 'wav',
  mimeType: 'audio/wav',
  ...(transcript === undefined ? {} : { transcript }),
});

mkdirSync(axgenDir, { recursive: true });
mkdirSync(flowDir, { recursive: true });

const speechSignature = 'question:string -> speech:audio, summary:string';

const cases: Record<string, Case> = {
  // One audio field: speak() gets the model's text, and the artifact keeps
  // the text as its transcript when speak() returns none.
  'audio-output-forward-single-field': {
    signature: speechSignature,
    responses: [answer('Speech: Hello there\nSummary: A greeting')],
    speak_responses: [mp3()],
    rendered: ['speech'],
    trace: true,
  },
  // Each audio field is rendered in output field order; a transcript from
  // speak() wins over the text.
  'audio-output-forward-two-fields': {
    signature: 'question:string -> intro:audio, summary:string, outro:audio',
    responses: [
      answer('Intro: Welcome in\nSummary: A greeting\nOutro: See you soon'),
    ],
    speak_responses: [mp3(), wav('see you soon, spoken')],
    rendered: ['intro', 'outro'],
  },
  // speech.speak holds speak() defaults and speech.fields per-field
  // overrides; the text always comes from the output.
  'audio-output-forward-speech-config': {
    signature: 'question:string -> intro:audio, outro:audio',
    responses: [answer('Intro: Welcome in\nOutro: See you soon')],
    forward_options: {
      speech: {
        speak: { model: 'tts-model', voice: 'alloy', format: 'wav' },
        fields: { outro: { voice: 'nova', speed: 1.25 } },
      },
    },
    speak_responses: [wav('Welcome in'), wav('See you soon')],
    rendered: ['intro', 'outro'],
  },
  // A structured answer may already carry an audio artifact (an object with
  // data); it passes through, and only the text field is rendered.
  'audio-output-forward-artifact-passes-through': {
    signature:
      'question:string -> speech:audio, intro:audio, card:object{title:string}',
    options: { structured_output_mode: 'function' },
    features: { functions: true, structured_outputs: false },
    responses: [
      structuredCall({
        speech: { data: 'UklGRg==', format: 'wav' },
        intro: 'Hi there',
        card: { title: 'Greeting' },
      }),
    ],
    speak_responses: [mp3('Hi there')],
    rendered: ['intro'],
  },
  // An optional audio field the model leaves out is not rendered.
  'audio-output-forward-optional-absent': {
    signature: 'question:string -> speech?:audio, summary:string',
    responses: [answer('Summary: Nothing to say')],
    rendered: [],
  },
  // forward with stream: true renders what the streamed answer merges to.
  'audio-output-forward-stream-option': {
    signature: speechSignature,
    forward_options: { stream: true },
    responses: [
      streamed(
        chunk({ content: 'Speech: Hello ' }),
        chunk({ content: 'there\nSummary: A greeting' }),
        chunk({ finish_reason: 'stop' })
      ),
    ],
    speak_responses: [mp3('Hello there')],
    rendered: ['speech'],
  },
  // With several samples only the picked one is rendered.
  'audio-output-forward-multi-sample-picker': {
    signature: speechSignature,
    forward_options: { sample_count: 2 },
    result_picker_index: 1,
    responses: [
      {
        results: [
          {
            index: 0,
            content: 'Speech: First take\nSummary: One',
            finish_reason: 'stop',
          },
          {
            index: 1,
            content: 'Speech: Second take\nSummary: Two',
            finish_reason: 'stop',
          },
        ],
      },
    ],
    speak_responses: [mp3('Second take')],
    rendered: ['speech'],
  },
  // A speak() failure surfaces as the forward's error, without a retry.
  'audio-output-forward-speak-error': {
    signature: speechSignature,
    responses: [answer('Speech: Hello there\nSummary: A greeting')],
    speak_responses: [
      { error: { type: 'plain', message: 'voice synthesis unavailable' } },
    ],
    error_contains: 'voice synthesis unavailable',
  },
  // streamingForward renders the picked sample before sending it as its one
  // delta.
  'audio-output-streaming-result-picker': {
    kind: 'streaming_forward',
    signature: speechSignature,
    forward_options: { sample_count: 2 },
    result_picker_index: 1,
    responses: [
      streamed(
        {
          results: [
            { index: 0, content: 'Speech: First take\nSummary: One' },
            { index: 1, content: 'Speech: Second take\nSummary: Two' },
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
    speak_responses: [mp3('Second take')],
    rendered: ['speech'],
  },
  // Without a result picker, streamingForward streams the text as it comes
  // and renders nothing, even with the opt-in.
  'audio-output-streaming-no-picker-streams-text': {
    kind: 'streaming_forward',
    signature: speechSignature,
    responses: [
      streamed(
        chunk({ content: 'Speech: Hello ' }),
        chunk({ content: 'there\nSummary: A greeting' }),
        chunk({ finish_reason: 'stop' })
      ),
    ],
    rendered: [],
  },
  // A rendered artifact fed to the next program's audio input reaches the
  // model as its transcript: the ports' speak() result, older audio key and
  // all, as it would arrive from a port's audio output.
  'audio-input-rendered-artifact-as-transcript': {
    signature: 'speech:audio -> summary:string',
    input: {
      speech: {
        audio: 'SUQzBAA=',
        format: 'mp3',
        data: 'SUQzBAA=',
        mimeType: 'audio/mpeg',
        transcript: 'Hello there',
      },
    },
    responses: [answer('Summary: A greeting')],
    rendered: [],
    pin_user_prompt: true,
  },
};

// The ports' default this release: audio fields keep the model's text and
// speak() is not called, with renderAudio unset or false.
const offCases: Record<string, Case> = {
  'audio-output-off-by-default': {
    ...cases['audio-output-forward-single-field']!,
    render: 'unset',
    trace: false,
  },
  'audio-output-off-explicit-false': {
    ...cases['audio-output-forward-two-fields']!,
    render: false,
  },
  'audio-output-off-streaming-result-picker': {
    ...cases['audio-output-streaming-result-picker']!,
    render: 'unset',
  },
};

for (const [name, spec] of Object.entries({ ...cases, ...offCases })) {
  await record(name, spec);
}

// Arrays of generated audio are not supported: TS rejects the signature.
{
  const signature = 'question:string -> clips:audio[]';
  let message = '';
  try {
    new AxGen(signature);
  } catch (e) {
    message = (e as Error).message;
  }
  const expected = 'Arrays of audio are not supported';
  if (!message.includes(expected)) {
    throw new Error(
      `audio[] output: TS error "${message}" lacks "${expected}"`
    );
  }
  writeFixture(axgenDir, 'audio-output-array-signature-error', {
    kind: 'signature_error',
    signature,
    expected_error_contains: expected,
  });
}

// A two-step flow: the speaker's rendered audio output is the summarizer's
// audio input, which reaches the model as the transcript.
{
  const responses = [
    answer('Speech: Hello there'),
    answer('Summary: A greeting'),
  ];
  const speakResponses = [mp3('Hello there')];
  const { ai, calls, prompts, speakRequests } = scriptedAI(
    responses,
    speakResponses,
    undefined
  );
  const wf = flow<{ question: string }, { summary: string }>({
    autoParallel: false,
  })
    .node('speaker', 'question:string -> speech:audio')
    .node('summarizer', 'speech:audio -> summary:string')
    .execute('speaker', (state) => ({ question: state.question }))
    .execute('summarizer', (state) => ({
      speech: state.speakerResult.speech,
    }))
    .returns((state) => ({ summary: state.summarizerResult.summary }));
  const input = { question: 'Say hi' };
  // Each port step reads and writes what TS's plan says it does.
  const planSteps = wf.getExecutionPlan().steps ?? [];
  const stepOptions = (name: string): JsonMap => {
    const step = planSteps.find((item) => item.nodeName === name);
    if (!step) throw new Error(`flow: no plan step for ${name}`);
    return {
      reads: [...step.dependencies],
      writes: [...step.produces],
      isBarrier: step.isBarrier ?? false,
    };
  };
  const output = clone(await wf.forward(ai, input)) as Json;
  const summarizerUser = (prompts()[1] as { role: string; content: Json }[]).at(
    -1
  )!;
  if (summarizerUser.content !== 'Speech: Hello there\n') {
    throw new Error(
      `flow: summarizer got ${JSON.stringify(summarizerUser.content)}`
    );
  }
  writeFixture(flowDir, 'audio-output-flow-speaker-to-summarizer', {
    kind: 'flow',
    source: {
      tsDerived: true,
      extractor: 'tools/axir/extractors/axgen-audio-goldens.ts',
      reference: ['src/ax/flow/flow.ts', 'src/ax/dsp/generate.ts'],
    },
    flow_options: { autoParallel: false },
    input,
    steps: [
      {
        kind: 'execute',
        name: 'speaker',
        signature: 'question:string -> speech:audio',
        options: stepOptions('speaker'),
      },
      {
        kind: 'execute',
        name: 'summarizer',
        signature: 'speech:audio -> summary:string',
        options: stepOptions('summarizer'),
      },
    ],
    returns: { summary: 'summary' },
    forward_options: { renderAudio: true },
    responses,
    speak_responses: speakResponses,
    expected_output: output,
    expected_request_count: calls(),
    expected_speak_requests: speakRequests(),
    expected_request_contains: ['Speech: Hello there'],
  });
}
