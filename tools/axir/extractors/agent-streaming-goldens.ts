// TS-golden AxAgent run fixtures: streamingForward and the forward paths it
// shares. Each case runs TypeScript's real agent() against AxMockAIService
// with scripted model responses and a scripted code runtime, and records what
// every port must reproduce: the streamed {version, index, delta} deltas, the
// output, the request count, the order of model requests and observer
// callbacks, the run-control events, the chat-log shape, and the error.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from '../../../src/ax/agent/agentInternal/sharedSession.js';
import { agent } from '../../../src/ax/agent/index.js';
import type { AxCodeRuntime } from '../../../src/ax/agent/rlm.js';
import { AxMockAIService } from '../../../src/ax/ai/mock/api.js';
import type { AxChatResponse } from '../../../src/ax/ai/types.js';
import { runControl } from '../../../src/ax/dsp/runControl.js';
import { mergeDeltas } from '../../../src/ax/dsp/util.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonMap = { [key: string]: Json };

const outDir = join(
  process.env.AXIR_CONFORMANCE_OUT_ROOT ?? process.cwd(),
  'ir/conformance/axagent'
);

function stable(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item, parentKey));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const ordered =
      parentKey === 'input' ||
      parentKey === 'expected_output' ||
      parentKey === 'options' ||
      parentKey === 'delta'
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

// ----- scripted model -----
// {content} answers in one response; {stream: [...]} streams its chunks.
type ChunkSpec = { results: JsonMap[] };
type ResponseSpec = { content: string } | { stream: ChunkSpec[] };

function tsChunk(chunk: ChunkSpec): AxChatResponse {
  return {
    results: chunk.results.map((result) => {
      const out: Record<string, unknown> = { index: result.index ?? 0 };
      if (result.content !== undefined) out.content = result.content;
      if (result.finish_reason !== undefined)
        out.finishReason = result.finish_reason;
      return out;
    }),
  } as AxChatResponse;
}

// Which part of the run sent a request, by its system prompt; the port
// runners classify their requests the same way.
function requestStage(system: string): string {
  if (system.includes('You (`distiller`)')) return 'distiller';
  if (system.includes('You (`executor`)')) return 'executor';
  if (
    system.includes('context-map Distiller') ||
    system.includes('context-map Cartographer')
  )
    return 'context_map';
  return 'responder';
}

function scriptedAI(
  responses: ResponseSpec[],
  features: JsonMap,
  transcript: string[]
) {
  const queue = clone(responses);
  let calls = 0;
  const ai = new AxMockAIService({
    features: {
      functions: (features.functions as boolean | undefined) ?? false,
      streaming: (features.streaming as boolean | undefined) ?? true,
      structuredOutputs: features.structured_outputs as boolean | undefined,
    },
    chatResponse: async (req) => {
      calls++;
      const first = req.chatPrompt[0];
      const system =
        first?.role === 'system' && typeof first.content === 'string'
          ? first.content
          : '';
      transcript.push(`request:${requestStage(system)}`);
      const next = queue.shift();
      if (!next) throw new Error('scripted client exhausted');
      if ('content' in next) {
        return {
          results: [{ index: 0, content: next.content, finishReason: 'stop' }],
        } as AxChatResponse;
      }
      const chunks = [...next.stream];
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const chunk = chunks.shift();
          if (!chunk) controller.close();
          else controller.enqueue(tsChunk(chunk));
        },
      });
    },
  });
  return { ai, calls: () => calls };
}

// ----- scripted code runtime -----
// Each step checks the actor's code and ends the stage with its result, as
// the ports' ScriptedCodeRuntime does with `runtime_script`.
type ScriptStep = {
  expected_code: string;
  result: { type: 'final' | 'respond' | 'askClarification'; args: Json[] };
};

function scriptedRuntime(script: ScriptStep[]): AxCodeRuntime {
  const steps = clone(script);
  return {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        async execute(code: string) {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          const step = steps.shift();
          if (!step) throw new Error('scripted runtime exhausted');
          if (step.expected_code !== code) {
            throw new Error(
              `expected code ${JSON.stringify(step.expected_code)}, got ${JSON.stringify(code)}`
            );
          }
          const complete = globals?.[step.result.type] as
            | ((...args: unknown[]) => unknown)
            | undefined;
          if (!complete) {
            throw new Error(`runtime global ${step.result.type} is missing`);
          }
          await complete(...clone(step.result.args));
          return 'done';
        },
        async patchGlobals(patch: Record<string, unknown>) {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        inspectGlobals() {
          return JSON.stringify({ entries: [] });
        },
        snapshotGlobals() {
          return { version: 1, entries: [], bindings: {} };
        },
        close() {},
      };
    },
  };
}

// ----- cases -----
type Case = {
  kind?: 'agent_streaming_forward' | 'agent_forward';
  signature?: string;
  input?: JsonMap;
  // Agent options the fixture spells as JSON; the runtime is always the
  // scripted one.
  options?: JsonMap;
  forward_options?: JsonMap;
  features?: JsonMap;
  responses: ResponseSpec[];
  runtime_script: ScriptStep[];
  // Callbacks to record: used_memories, used_skills, citations.
  observers?: ('used_memories' | 'used_skills' | 'citations')[];
  // Attach a run control and record every event it hears.
  control?: boolean;
  // The consumer stops the stream after this many deltas.
  stop_after_deltas?: number;
  // Pin the chat log's {name, stage} shape.
  chat_log_shape?: boolean;
  // Substrings every port's request JSON must contain (ASCII only).
  request_contains?: string[];
};

async function record(name: string, spec: Case): Promise<void> {
  const kind = spec.kind ?? 'agent_streaming_forward';
  const signature = spec.signature ?? 'question:string -> answer:string';
  const input = spec.input ?? { question: 'How long do refunds take?' };
  const features = spec.features ?? {
    functions: false,
    streaming: true,
    structured_outputs: false,
  };
  const transcript: string[] = [];
  const { ai, calls } = scriptedAI(spec.responses, features, transcript);

  const observerCalls: JsonMap[] = [];
  const observe =
    (label: string) =>
    (payload: unknown): void => {
      transcript.push(label);
      observerCalls.push({ callback: label, payload: clone(payload) as Json });
    };
  const options: Record<string, unknown> = clone(spec.options ?? {});
  for (const label of spec.observers ?? []) {
    if (label === 'used_memories') options.onUsedMemories = observe(label);
    if (label === 'used_skills') options.onUsedSkills = observe(label);
    if (label === 'citations') {
      const citations =
        options.citations && typeof options.citations === 'object'
          ? (options.citations as Record<string, unknown>)
          : {};
      options.citations = { ...citations, onCitations: observe(label) };
    }
  }
  const ag = agent(signature, {
    ...(options as object),
    ai,
    runtime: scriptedRuntime(spec.runtime_script),
  } as never);

  const forwardOptions: Record<string, unknown> = clone(
    spec.forward_options ?? {}
  );
  const controlEvents: JsonMap[] = [];
  if (spec.control) {
    const control = runControl();
    control.onEvent(({ type, path }) => {
      controlEvents.push({ type, path });
    });
    forwardOptions.control = control;
  }

  const deltas: JsonMap[] = [];
  let output: Json | undefined;
  let error: string | undefined;
  try {
    if (kind === 'agent_forward') {
      output = clone(
        (await ag.forward(ai, input as never, forwardOptions as never)) as Json
      );
    } else {
      for await (const delta of ag.streamingForward(
        ai,
        input as never,
        forwardOptions as never
      )) {
        deltas.push(clone(delta) as unknown as JsonMap);
        if (deltas.length === spec.stop_after_deltas) break;
      }
    }
  } catch (e) {
    error = (e as Error).message.split('\n')[0];
  }
  // Fire-and-forget observers settle before the fixture is written.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fixture: Record<string, unknown> = {
    kind,
    signature,
    input,
    options: {
      ...clone(spec.options ?? {}),
      runtime: { language: 'JavaScript' },
    },
    features,
    responses: spec.responses,
    runtime_script: spec.runtime_script,
    expected_request_count: calls(),
    expected_transcript: transcript,
  };
  for (const key of [
    'forward_options',
    'observers',
    'control',
    'stop_after_deltas',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = clone(spec[key]);
  }
  if (spec.observers) fixture.expected_observer_calls = observerCalls;
  if (spec.control) fixture.expected_control_events = controlEvents;
  if (kind === 'agent_streaming_forward') {
    fixture.expected_deltas = deltas;
    if (error === undefined && spec.stop_after_deltas === undefined) {
      // What a consumer merges: each index's deltas, starting over when the
      // version changes; the output is index 0 of the last version.
      let buffer: { version: number; index: number; delta: object }[] = [];
      let version = -1;
      for (const delta of deltas) {
        if (delta.version !== version) buffer = [];
        version = delta.version as number;
        buffer = mergeDeltas(buffer as never, clone(delta) as never) as never;
      }
      fixture.expected_output = clone(buffer[0]?.delta ?? {});
    }
  } else if (error === undefined) {
    fixture.expected_output = output;
  }
  if (spec.chat_log_shape) {
    fixture.expected_chat_log_shape = ag
      .getChatLog()
      .map((entry) => ({
        name: entry.name ?? null,
        stage: entry.stage ?? null,
      }));
  }
  if (spec.request_contains) {
    fixture.expected_request_contains = spec.request_contains;
  }
  if (error !== undefined) {
    fixture.expected_error_contains = error;
  }
  writeFixture(name, fixture);
}

// ----- scripted helpers -----
const actor = (code: string): ResponseSpec => ({
  content: JSON.stringify({ javascriptCode: code }),
});
const text = (content: string, finish = false): ChunkSpec => ({
  results: [
    finish
      ? { index: 0, content, finish_reason: 'stop' }
      : { index: 0, content },
  ],
});
const streamed = (...chunks: ChunkSpec[]): ResponseSpec => ({
  stream: chunks,
});
const step = (
  code: string,
  type: ScriptStep['result']['type'],
  ...args: Json[]
): ScriptStep => ({ expected_code: code, result: { type, args } });

const DISTILL = 'final("Answer the question", {})';
const EXECUTE =
  'final("Answer the question", {policy: "Refunds take 30 days."})';
const EVIDENCE: JsonMap = { policy: 'Refunds take 30 days.' };
const baseRuntime = (): ScriptStep[] => [
  step(DISTILL, 'final', 'Answer the question', {}),
  step(EXECUTE, 'final', 'Answer the question', EVIDENCE),
];
const baseActors = (): ResponseSpec[] => [actor(DISTILL), actor(EXECUTE)];

const RESPOND =
  'respond("Refunds take 30 days.", {policy: "Refunds take 30 days."})';
const CLARIFY = 'askClarification("Which order do you mean?")';
const answerStream = (): ResponseSpec =>
  streamed(text('Answer: Refunds '), text('take 30 '), text('days.', true));
const citedStream = (citations: string): ResponseSpec =>
  streamed(
    text('Answer: Refunds '),
    text('take 30 days.\n'),
    text(`Evidence Citations: ${citations}`, true)
  );
const cited = (citations: string): ResponseSpec => ({
  content: `Answer: Refunds take 30 days.\nEvidence Citations: ${citations}`,
});
// The context-map distiller and cartographer answer as JSON objects.
const contextMapTurns = (): ResponseSpec[] => [
  {
    content: JSON.stringify({
      diagnosis: 'refund window is reusable',
      itemTags: {},
    }),
  },
  {
    content: JSON.stringify({
      operations: [
        {
          type: 'ADD',
          section: 'reusable_results',
          content: 'Refund window = 30 days',
        },
      ],
    }),
  },
];

mkdirSync(outDir, { recursive: true });

const cases: Record<string, Case> = {
  // ----- streaming -----
  'agent-streaming-forward-plain': {
    options: { directResponse: 'off' },
    responses: [...baseActors(), answerStream()],
    runtime_script: baseRuntime(),
    chat_log_shape: true,
  },
  'agent-streaming-forward-direct-respond': {
    responses: [actor(RESPOND), answerStream()],
    runtime_script: [
      step(RESPOND, 'respond', 'Refunds take 30 days.', EVIDENCE),
    ],
    chat_log_shape: true,
  },
  'agent-streaming-forward-clarification': {
    options: { directResponse: 'off' },
    responses: [actor(CLARIFY)],
    runtime_script: [
      step(CLARIFY, 'askClarification', 'Which order do you mean?'),
    ],
  },
  'agent-streaming-forward-citations': {
    options: { directResponse: 'off', citations: {} },
    observers: ['citations'],
    responses: [...baseActors(), citedStream('["policy"]')],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-citations-hidden': {
    options: { directResponse: 'off', citations: { surface: 'hidden' } },
    observers: ['citations'],
    responses: [...baseActors(), citedStream('["policy"]')],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-citations-retry': {
    options: { directResponse: 'off', citations: {} },
    observers: ['citations'],
    responses: [
      ...baseActors(),
      citedStream('["made_up_source"]'),
      citedStream('["policy"]'),
    ],
    runtime_script: baseRuntime(),
    request_contains: [
      'Invalid evidenceCitations entries: made_up_source. Cite only evidence ids that exist: policy',
    ],
  },
  'agent-streaming-forward-used-observers': {
    options: { directResponse: 'off', citations: {} },
    observers: ['used_memories', 'used_skills', 'citations'],
    responses: [...baseActors(), citedStream('["policy"]')],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-control': {
    options: { directResponse: 'off' },
    control: true,
    responses: [...baseActors(), answerStream()],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-control-early-stop': {
    options: { directResponse: 'off' },
    control: true,
    stop_after_deltas: 1,
    responses: [...baseActors(), answerStream()],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-context-map': {
    options: {
      directResponse: 'off',
      contextMap: {
        map: '## CONTEXT UNDERSTANDING\n[cu-1] Orders ship weekly',
      },
    },
    responses: [...baseActors(), answerStream(), ...contextMapTurns()],
    runtime_script: baseRuntime(),
  },
  // ----- forward -----
  'agent-forward-citations-retry': {
    kind: 'agent_forward',
    options: { directResponse: 'off', citations: {} },
    observers: ['citations'],
    responses: [
      ...baseActors(),
      cited('["made_up_source"]'),
      cited('["policy"]'),
    ],
    runtime_script: baseRuntime(),
    request_contains: [
      'Invalid evidenceCitations entries: made_up_source. Cite only evidence ids that exist: policy',
    ],
  },
  'agent-forward-citations-exhausted': {
    kind: 'agent_forward',
    options: { directResponse: 'off', citations: {} },
    responses: [
      ...baseActors(),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
    ],
    runtime_script: baseRuntime(),
  },
  'agent-forward-citations-no-evidence': {
    kind: 'agent_forward',
    options: { directResponse: 'off', citations: {} },
    responses: [
      actor(DISTILL),
      actor('final("Answer the question", {})'),
      cited('["made_up"]'),
      { content: 'Answer: Refunds take 30 days.' },
    ],
    runtime_script: [
      step(DISTILL, 'final', 'Answer the question', {}),
      step(
        'final("Answer the question", {})',
        'final',
        'Answer the question',
        {}
      ),
    ],
    request_contains: ['This answer has no evidence to cite'],
  },
  'agent-forward-used-observers': {
    kind: 'agent_forward',
    options: { directResponse: 'off', citations: {} },
    observers: ['used_memories', 'used_skills', 'citations'],
    responses: [...baseActors(), cited('["policy"]')],
    runtime_script: baseRuntime(),
  },
  'agent-forward-control': {
    kind: 'agent_forward',
    options: { directResponse: 'off' },
    control: true,
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
  },
  'agent-forward-context-map': {
    kind: 'agent_forward',
    options: {
      directResponse: 'off',
      contextMap: {
        map: '## CONTEXT UNDERSTANDING\n[cu-1] Orders ship weekly',
      },
    },
    responses: [
      ...baseActors(),
      { content: 'Answer: Refunds take 30 days.' },
      ...contextMapTurns(),
    ],
    runtime_script: baseRuntime(),
  },
};

for (const [name, spec] of Object.entries(cases)) {
  await record(name, spec);
}
