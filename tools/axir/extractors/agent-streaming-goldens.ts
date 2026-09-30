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
  // The playbook's ACE reflector and curator.
  if (
    system.includes('`Generator answer`') ||
    system.includes('`Question context`')
  )
    return 'playbook';
  if (
    system.includes('context-map Distiller') ||
    system.includes('context-map Cartographer')
  )
    return 'context_map';
  return 'responder';
}

// onRequest runs with each request's 1-based number while it is in flight,
// before the scripted answer, as the port runners' scripted clients do.
function scriptedAI(
  responses: ResponseSpec[],
  features: JsonMap,
  transcript: string[],
  onRequest?: (request: number) => void
) {
  const queue = clone(responses);
  let calls = 0;
  const chatOptions: Record<string, unknown>[] = [];
  const prompts: unknown[] = [];
  const ai = new AxMockAIService({
    features: {
      functions: (features.functions as boolean | undefined) ?? false,
      streaming: (features.streaming as boolean | undefined) ?? true,
      structuredOutputs: features.structured_outputs as boolean | undefined,
    },
    chatResponse: async (req, options) => {
      calls++;
      chatOptions.push({ ...(options ?? {}) });
      onRequest?.(calls);
      prompts.push(clone(req.chatPrompt));
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
  return { ai, calls: () => calls, chatOptions, prompts: () => prompts };
}

// ----- scripted code runtime -----
// Each step checks the actor's code and ends the stage with its result, as
// the ports' ScriptedCodeRuntime does with `runtime_script`.
// A step either completes the stage or fails as a runtime error: the ports'
// scripted runtime returns the error envelope, and TypeScript's throws it.
type ScriptStep = {
  expected_code: string;
  result:
    | { type: 'final' | 'respond' | 'askClarification'; args: Json[] }
    | { is_error: true; kind: 'error'; error_category: string; error: string };
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
          const result = step.result;
          if ('is_error' in result) throw new Error(result.error);
          const complete = globals?.[result.type] as
            | ((...args: unknown[]) => unknown)
            | undefined;
          if (!complete) {
            throw new Error(`runtime global ${result.type} is missing`);
          }
          await complete(...clone(result.args));
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
  // Callbacks to record: used_memories, used_skills, citations, and the
  // playbook's onUpdate after run-end learning (its status only: the ports
  // word the failure feedback it carries in their own runtime terms).
  observers?: (
    | 'used_memories'
    | 'used_skills'
    | 'citations'
    | 'playbook_update'
  )[];
  // Attach a run control and record the run's lifecycle events (every event
  // with control_steer).
  control?: boolean;
  // Steer the run while this request (1-based) is in flight; the fixture
  // then pins every control event.
  control_steer?: { during_request: number; text: string };
  // The consumer stops the stream after this many deltas.
  stop_after_deltas?: number;
  // Pin the chat log's {name, stage} shape.
  chat_log_shape?: boolean;
  // Substrings every port's request JSON must contain (ASCII only).
  request_contains?: string[];
  // Port-only: the ports keep the model's text for date fields without
  // parse_dates, where TS always parses them. TS runs the same case with the
  // date fields typed as strings, which gives that text; the fixture keeps the
  // date-typed signature and says why in its description.
  keeps_date_text?: string;
  // The ports' agent gets no runtime on the constructor and the scripted
  // runtime on the forward call, as the ports' examples pass one. TS's
  // agent(sig, {}) runs with its default JavaScript runtime; the extractor
  // gives TS the scripted runtime in its place.
  runtime_on_forward?: boolean;
  // Port-only: TS passes a forward timeout (milliseconds) to every stage's
  // ai.chat. TS runs the case with that timeout, and the extractor checks each
  // chat call got it; the fixture gives the ports' forward timeoutMs, their
  // name for it until the next major version, and pins that each chat call
  // gets it.
  call_timeout_ms?: number;
  // Pin the first request of each stage (distiller, executor, responder)
  // in full: every message's role and content, as each port must send them.
  first_requests?: boolean;
  // Why the fixture leaves out expected_request_roles.
  no_request_roles?: string;
};

// For a failure thrown after the answer parses (an assertion, as the citations
// check is), TS forward drops the failed answer and its correction once the
// next answer parses (response/nonStreaming.ts), so each retry sends one
// failed attempt; the ports' AxGen keeps them all. Two or more responder
// retries show it.
const RETRY_MEMORY_GAP =
  "the ports' non-streaming AxGen keeps every failed attempt and correction, where TS keeps the latest after an assertion failure";

const DATE_TYPES = /:(datetimeRange|dateRange|datetime|date)\b/g;

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
  const control = spec.control ? runControl() : undefined;
  const steer = spec.control_steer;
  const { ai, calls, chatOptions, prompts } = scriptedAI(
    spec.responses,
    features,
    transcript,
    (request) => {
      if (control && steer && request === steer.during_request) {
        control.steer(steer.text);
      }
    }
  );

  const observerCalls: JsonMap[] = [];
  const observe =
    (label: string) =>
    (payload: unknown): void => {
      transcript.push(label);
      observerCalls.push({ callback: label, payload: clone(payload) as Json });
    };
  const options: Record<string, unknown> = clone(spec.options ?? {});
  // The fixture's functions carry no implementation; the scripted runtime
  // never calls them.
  if (Array.isArray(options.functions)) {
    const withFunc = (fn: Record<string, unknown>) => ({
      ...fn,
      func: async () => ({}),
    });
    options.functions = (options.functions as Record<string, unknown>[]).map(
      (item) =>
        Array.isArray(item.functions)
          ? {
              ...item,
              functions: (item.functions as Record<string, unknown>[]).map(
                withFunc
              ),
            }
          : withFunc(item)
    );
  }
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
    if (label === 'playbook_update') {
      const playbook =
        options.playbook && typeof options.playbook === 'object'
          ? (options.playbook as Record<string, unknown>)
          : {};
      options.playbook = {
        ...playbook,
        onUpdate: (result: { status: string }) =>
          observe(label)({ status: result.status }),
      };
    }
  }
  const tsSignature = spec.keeps_date_text
    ? signature.replace(DATE_TYPES, ':string')
    : signature;
  const ag = agent(tsSignature, {
    ...(options as object),
    ai,
    runtime: scriptedRuntime(spec.runtime_script),
  } as never);

  const forwardOptions: Record<string, unknown> = clone(
    spec.forward_options ?? {}
  );
  if (spec.call_timeout_ms !== undefined) {
    forwardOptions.timeout = spec.call_timeout_ms;
  }
  // The run lifecycle events, in order, with their paths; with a steer,
  // every event.
  const controlEvents: JsonMap[] = [];
  if (control) {
    const lifecycle = ['started', 'completed', 'failed', 'aborted'];
    control.onEvent(({ type, path }) => {
      if (steer || lifecycle.includes(type)) controlEvents.push({ type, path });
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
    options: spec.runtime_on_forward
      ? clone(spec.options ?? {})
      : { ...clone(spec.options ?? {}), runtime: { language: 'JavaScript' } },
    features,
    responses: spec.responses,
    runtime_script: spec.runtime_script,
    expected_request_count: calls(),
    expected_transcript: transcript,
  };
  if (spec.call_timeout_ms !== undefined) {
    const timeout = spec.call_timeout_ms;
    if (
      chatOptions.length === 0 ||
      chatOptions.some((options) => options.timeout !== timeout)
    ) {
      throw new Error(
        `${name}: TS did not pass the forward timeout to every ai.chat call`
      );
    }
    fixture.forward_options = {
      ...clone(spec.forward_options ?? {}),
      timeoutMs: timeout,
    };
    fixture.expected_chat_options_all_subset = { timeoutMs: timeout };
    fixture.description = `Port-only: an agent forward timeoutMs reaches each of the ${chatOptions.length} stage ai.chat calls, as TS's forward timeout does (this extractor checks TS with timeout: ${timeout}).`;
  }
  if (spec.keeps_date_text) {
    if (kind !== 'agent_forward') {
      throw new Error(`${name}: keeps_date_text supports agent_forward only`);
    }
    fixture.description = spec.keeps_date_text;
  }
  for (const key of [
    ...(spec.call_timeout_ms === undefined
      ? (['forward_options'] as const)
      : []),
    'observers',
    'control',
    'control_steer',
    'runtime_on_forward',
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
    fixture.expected_chat_log_shape = ag.getChatLog().map((entry) => ({
      name: entry.name ?? null,
      stage: entry.stage ?? null,
    }));
  }
  if (spec.request_contains) {
    fixture.expected_request_contains = spec.request_contains;
  }
  // Every request's message roles, in order: a steer lands where TS puts it.
  if (spec.no_request_roles === undefined) {
    fixture.expected_request_roles = (prompts() as JsonMap[][]).map((prompt) =>
      prompt.map((message) => message.role as Json)
    );
  }
  if (spec.first_requests) {
    const firsts: JsonMap[] = [];
    const seen = new Set<string>();
    transcript.forEach((entry, position) => {
      if (!entry.startsWith('request:')) return;
      const stage = entry.slice('request:'.length);
      if (seen.has(stage)) return;
      seen.add(stage);
      const index = transcript
        .slice(0, position)
        .filter((item) => item.startsWith('request:')).length;
      const messages = (
        prompts()[index] as { role: string; content: Json }[]
      ).map((message) => ({ role: message.role, content: message.content }));
      firsts.push({ index, stage, messages });
    });
    fixture.expected_stage_first_requests = firsts;
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

// Run-end playbook learning: the executor's first turn fails at runtime and
// its second finishes, so the run carries one failure signal; the playbook's
// reflector and curator then answer after the responder.
const LOOKUP = 'lookupPolicy()';
const playbookRuntime = (): ScriptStep[] => [
  step(DISTILL, 'final', 'Answer the question', {}),
  {
    expected_code: LOOKUP,
    result: {
      is_error: true,
      kind: 'error',
      error_category: 'runtime_error',
      error: 'lookupPolicy is not defined',
    },
  },
  step(EXECUTE, 'final', 'Answer the question', EVIDENCE),
];
const playbookActors = (): ResponseSpec[] => [
  actor(DISTILL),
  actor(LOOKUP),
  actor(EXECUTE),
];
const playbookTeacher = (): ResponseSpec[] => [
  {
    content: [
      'Reasoning: The executor called a helper that does not exist.',
      'Error Identification: lookupPolicy is not defined.',
      'Root Cause Analysis: The executor assumed a helper without checking.',
      'Correct Approach: Read the policy from the evidence.',
      'Key Insight: Check that a helper exists before calling it.',
      'Bullet Tags: []',
    ].join('\n'),
  },
  {
    content: [
      'Reasoning: One avoidance rule covers the failure.',
      'Operations: [{"type":"ADD","section":"failures_to_avoid","content":"Check that a helper exists before calling it."}]',
    ].join('\n'),
  },
];

// A datetime output: TS parses it into a Date, which JSON gives as an ISO
// string; the ports do the same with parse_dates on the agent or the call.
const DATED = 'question:string -> answer:string, when:datetime';
const datedAnswer = (): ResponseSpec => ({
  content:
    'Answer: Refunds take 30 days.\nWhen: 2024-05-09 14:30 America/New_York',
});
const datedStream = (): ResponseSpec =>
  streamed(
    text('Answer: Refunds '),
    text('take 30 days.\nWhen: 2024-05-09 '),
    text('14:30 America/New_York', true)
  );

mkdirSync(outDir, { recursive: true });

// Grouped tools with explicit namespaces (TS files flat functions under
// `utils`, the ports under `tools`): one always-included module and one
// discoverable one, with parameter and return schemas. Each schema declares
// its properties in sorted order, since the fixture sync sorts object keys
// and TS renders a tool's arguments in declared order.
const TOOL_GROUPS: JsonMap[] = [
  {
    namespace: 'db',
    title: 'Database',
    selectionCriteria: 'Customer records',
    alwaysInclude: true,
    functions: [
      {
        name: 'lookup',
        description: 'Look up a customer by id',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            include: { type: 'array', items: { type: 'string' } },
          },
          required: ['id'],
        },
        returns: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            tier: { enum: ['gold', 'silver'] },
          },
        },
      },
    ],
  },
  {
    namespace: 'web',
    title: 'Web',
    selectionCriteria: 'Public pages',
    functions: [
      {
        name: 'search',
        description: 'Search public pages',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            size: { type: ['number', 'null'] },
          },
          required: ['query'],
        },
      },
    ],
  },
];

// Flat functions, each filed under its own namespace (TS fn().namespace()),
// with the namespaces interleaved and in neither name nor namespace order.
// Every one names its namespace: a flat function without one is
// `utils.<name>` in TS and `tools.<name>` in the ports.
const FLAT_NAMESPACED: JsonMap[] = [
  {
    name: 'search',
    namespace: 'web',
    description: 'Search public pages',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'lookup',
    namespace: 'crm',
    description: 'Look up a customer by id',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'fetch',
    namespace: 'web',
    description: 'Fetch a public page',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
];

const cases: Record<string, Case> = {
  // ----- each stage's first request, in full -----
  'agent-first-requests-base': {
    kind: 'agent_forward',
    options: { directResponse: 'off' },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-tools': {
    kind: 'agent_forward',
    options: { directResponse: 'off', functions: TOOL_GROUPS },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-flat-namespace': {
    kind: 'agent_forward',
    options: { directResponse: 'off', functions: FLAT_NAMESPACED },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-context-field': {
    kind: 'agent_forward',
    signature: 'question:string, policyDoc:string -> answer:string',
    input: {
      question: 'How long do refunds take?',
      policyDoc:
        'Refunds take 30 days after approval. Store credit is instant.',
    },
    options: { directResponse: 'off', contextFields: ['policyDoc'] },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-skills': {
    kind: 'agent_forward',
    options: {
      directResponse: 'off',
      skills: [
        {
          id: 'refunds',
          name: 'Refund policy',
          description: 'How refunds work',
          content: 'Refunds settle in 30 days; quote the policy.',
        },
      ],
    },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-discovery': {
    kind: 'agent_forward',
    options: {
      directResponse: 'off',
      functionDiscovery: true,
      functions: TOOL_GROUPS,
    },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-memories': {
    kind: 'agent_forward',
    options: {
      directResponse: 'off',
      memoriesCatalog: [
        { id: 'mem-refunds', content: 'Refunds settle in 30 days.' },
        { id: 'mem-credit', content: 'Store credit is instant.' },
      ],
    },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
  'agent-first-requests-skills-catalog': {
    kind: 'agent_forward',
    options: {
      directResponse: 'off',
      skillsCatalog: [
        {
          id: 'shipping',
          name: 'Shipping policy',
          description: 'How shipping works',
          content: 'Orders ship in 2 days.',
        },
        {
          id: 'refunds',
          name: 'Refund policy',
          description: 'How refunds work',
          content: 'Refunds settle in 30 days; quote the policy.',
        },
      ],
    },
    features: { functions: false, streaming: false, structured_outputs: false },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    first_requests: true,
  },
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
  // An untargeted steer queued while the distiller's request is in flight:
  // the distiller takes another step, and the steer reaches every stage.
  'agent-streaming-forward-control-steer-continues': {
    options: { directResponse: 'off' },
    control: true,
    control_steer: { during_request: 1, text: 'Answer in French.' },
    responses: [actor(DISTILL), actor(DISTILL), actor(EXECUTE), answerStream()],
    runtime_script: baseRuntime(),
    request_contains: ['Answer in French.'],
  },
  'agent-streaming-forward-control-failed': {
    options: { directResponse: 'off', citations: {} },
    control: true,
    responses: [
      ...baseActors(),
      citedStream('["made_up_source"]'),
      citedStream('["made_up_source"]'),
      citedStream('["made_up_source"]'),
      citedStream('["made_up_source"]'),
    ],
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
  'agent-streaming-forward-playbook': {
    options: { directResponse: 'off', playbook: {} },
    observers: ['playbook_update'],
    responses: [...playbookActors(), answerStream(), ...playbookTeacher()],
    runtime_script: playbookRuntime(),
  },
  'agent-streaming-forward-runtime-on-forward': {
    options: { directResponse: 'off' },
    runtime_on_forward: true,
    responses: [...baseActors(), answerStream()],
    runtime_script: baseRuntime(),
  },
  'agent-streaming-forward-parse-dates': {
    signature: DATED,
    options: { directResponse: 'off', parse_dates: true },
    responses: [...baseActors(), datedStream()],
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
    no_request_roles: RETRY_MEMORY_GAP,
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
  'agent-forward-control-steer-continues': {
    kind: 'agent_forward',
    options: { directResponse: 'off' },
    control: true,
    control_steer: { during_request: 1, text: 'Answer in French.' },
    responses: [
      actor(DISTILL),
      actor(DISTILL),
      actor(EXECUTE),
      { content: 'Answer: Refunds take 30 days.' },
    ],
    runtime_script: baseRuntime(),
    request_contains: ['Answer in French.'],
  },
  'agent-forward-control-failed': {
    kind: 'agent_forward',
    options: { directResponse: 'off', citations: {} },
    control: true,
    responses: [
      ...baseActors(),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
      cited('["made_up_source"]'),
    ],
    runtime_script: baseRuntime(),
    no_request_roles: RETRY_MEMORY_GAP,
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
  'agent-forward-playbook': {
    kind: 'agent_forward',
    options: { directResponse: 'off', playbook: {} },
    observers: ['playbook_update'],
    responses: [
      ...playbookActors(),
      { content: 'Answer: Refunds take 30 days.' },
      ...playbookTeacher(),
    ],
    runtime_script: playbookRuntime(),
  },
  'agent-forward-runtime-on-forward': {
    kind: 'agent_forward',
    options: { directResponse: 'off' },
    runtime_on_forward: true,
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
  },
  'agent-forward-parse-dates': {
    kind: 'agent_forward',
    signature: DATED,
    options: { directResponse: 'off', parse_dates: true },
    responses: [...baseActors(), datedAnswer()],
    runtime_script: baseRuntime(),
  },
  'agent-forward-parse-dates-call-wins': {
    kind: 'agent_forward',
    signature: DATED,
    options: { directResponse: 'off', parse_dates: false },
    forward_options: { parse_dates: true },
    responses: [...baseActors(), datedAnswer()],
    runtime_script: baseRuntime(),
  },
  'agent-forward-call-timeout-ms-reaches-each-stage': {
    kind: 'agent_forward',
    options: { directResponse: 'off' },
    responses: [...baseActors(), { content: 'Answer: Refunds take 30 days.' }],
    runtime_script: baseRuntime(),
    call_timeout_ms: 250,
  },
  'agent-forward-keeps-date-text-call-false': {
    kind: 'agent_forward',
    signature: DATED,
    options: { directResponse: 'off', parse_dates: true },
    forward_options: { parse_dates: false },
    responses: [...baseActors(), datedAnswer()],
    runtime_script: baseRuntime(),
    keeps_date_text:
      'Port-only: parse_dates false on the forward call wins over the agent constructor, so the responder keeps the model text of the date field; TS always parses it.',
  },
};

for (const [name, spec] of Object.entries(cases)) {
  await record(name, spec);
}
