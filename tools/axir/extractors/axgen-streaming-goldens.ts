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
import { runControl } from '../../../src/ax/dsp/runControl.js';
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

// A native chat session's script: one entry per opened session, each a list
// of responses. A session plays its first response when it opens and the
// next one each time the run continues it. A response is its events: partial
// `response` events, then `response.completed` with the whole response.
type SessionEventSpec = {
  type: 'response' | 'response.completed';
  response_id: string;
  results: JsonMap[];
};
type SessionScript = SessionEventSpec[][][];

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

function scriptedAI(
  responses: ResponseSpec[],
  features: JsonMap | undefined,
  // Runs inside each request (1-based) before the scripted answer.
  onRequest?: (request: number) => void,
  // With a session script the client opens native chat sessions.
  sessions?: SessionScript
) {
  const queue = clone(responses);
  const sessionQueue = clone(sessions ?? []);
  // The tool results a session run submits, in order.
  const sessionResults: JsonMap[] = [];
  // What the run did to its sessions, in order: open, steer, continue (with
  // the IDs of the tool results it submitted) and close.
  const sessionLog: JsonMap[] = [];
  let calls = 0;
  // The chat prompt of each request, in call order.
  const prompts: Json[][] = [];
  // The response format type of each request (null without one).
  const formats: (string | null)[] = [];
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
    chatResponse: async (req) => {
      calls++;
      prompts.push(clone(req.chatPrompt) as unknown as Json[]);
      formats.push(
        (req.responseFormat as { type?: string } | undefined)?.type ?? null
      );
      onRequest?.(calls);
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
  // The mock has no functionCot or requiresStructuredOutput setting, so
  // report those provider features here.
  if (
    features?.function_cot !== undefined ||
    features?.requires_structured_output !== undefined
  ) {
    const baseFeatures = ai.getFeatures.bind(ai);
    ai.getFeatures = (model) => ({
      ...baseFeatures(model),
      ...(features.function_cot !== undefined
        ? { functionCot: features.function_cot as boolean }
        : {}),
      ...(features.requires_structured_output !== undefined
        ? {
            requiresStructuredOutput:
              features.requires_structured_output as boolean,
          }
        : {}),
    });
  }
  if (sessions) {
    const baseFeatures = ai.getFeatures.bind(ai);
    ai.getFeatures = (model) => ({ ...baseFeatures(model), asyncTools: true });
    Object.assign(ai, {
      async openChatSession(request: {
        chatPrompt: unknown[];
        responseFormat?: { type?: string };
      }) {
        calls++;
        prompts.push(clone(request.chatPrompt) as unknown as Json[]);
        formats.push(request.responseFormat?.type ?? null);
        sessionLog.push({ op: 'open' });
        onRequest?.(calls);
        const script = sessionQueue.shift();
        if (!script) throw new Error('scripted sessions exhausted');
        const pending: SessionEventSpec[][] = [];
        const submitted: string[] = [];
        let wake: (() => void) | undefined;
        let closed = false;
        const play = () => {
          const next = script.shift();
          if (!next) throw new Error('scripted session exhausted');
          pending.push(next);
          wake?.();
        };
        play();
        return {
          model: 'scripted-session',
          async *events() {
            while (!closed) {
              const events = pending.shift();
              if (!events) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
                continue;
              }
              for (const event of events)
                yield {
                  type: event.type,
                  responseId: event.response_id,
                  response: { results: event.results.map(tsResult) },
                };
            }
          },
          async submitToolResults(
            results: {
              functionId: string;
              result?: unknown;
              isError?: boolean;
            }[]
          ) {
            submitted.push(...results.map((result) => result.functionId));
            sessionResults.push(
              ...results.map((result) => ({
                call_id: result.functionId,
                result: clone(result.result ?? null) as Json,
                is_error: result.isError === true,
              }))
            );
          },
          async continue() {
            sessionLog.push({ op: 'continue', call_ids: submitted.splice(0) });
            play();
          },
          async steer(text: string) {
            sessionLog.push({ op: 'steer', text });
            return 'next-response' as const;
          },
          async setThinkingTokenBudget(level: string) {
            sessionLog.push({ op: 'thinking', level });
            return 'next-response' as const;
          },
          close() {
            if (closed) return;
            closed = true;
            sessionLog.push({ op: 'close' });
            wake?.();
          },
        };
      },
    });
  }
  return {
    ai,
    calls: () => calls,
    prompts: () => prompts,
    formats: () => formats,
    sessionLog: () => sessionLog,
    sessionResults: () => sessionResults,
  };
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
  strict_mode: 'strictMode',
  include_optional_input_fields_in_system_prompt:
    'includeOptionalInputFieldsInSystemPrompt',
  disable_memory_cleanup: 'disableMemoryCleanup',
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
  args?: Record<string, { type: string; description?: string }>;
  result?: Json;
  error?: string;
  // Record the extras TS gives the tool: sessionId, executionPath (under a
  // run control) and eventContext, each when set.
  record_extras?: boolean;
};

function tsTools(specs: ToolSpec[], calls: JsonMap[], extrasLog?: JsonMap[]) {
  return specs.map((spec) => {
    let builder = fn(spec.name).description(spec.description ?? spec.name);
    for (const [name, arg] of Object.entries(spec.args ?? {})) {
      const description = arg.description ?? name;
      const field =
        arg.type === 'number'
          ? f.number(description)
          : arg.type === 'boolean'
            ? f.boolean(description)
            : f.string(description);
      builder = builder.arg(name, field) as typeof builder;
    }
    const run = (args: Record<string, unknown>) => {
      calls.push({ name: spec.name, args: clone(args) as Json });
      if (spec.error) throw new Error(spec.error);
      return clone(spec.result);
    };
    if (spec.record_extras) {
      return builder
        .handler(
          async (
            args: Record<string, unknown>,
            extras?: {
              sessionId?: string;
              executionPath?: string;
              eventContext?: unknown;
            }
          ) => {
            const seen: JsonMap = {};
            if (extras?.sessionId !== undefined)
              seen.sessionId = extras.sessionId;
            if (extras?.executionPath !== undefined) {
              seen.executionPath = extras.executionPath;
            }
            if (extras?.eventContext !== undefined) {
              seen.eventContext = clone(extras.eventContext as Json);
            }
            extrasLog?.push({ name: spec.name, extras: seen });
            return run(args);
          }
        )
        .build();
    }
    return builder
      .handler(async (args: Record<string, unknown>) => run(args))
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
    const result = spec.echo ? value : clone(spec.returns);
    if (result !== undefined && result !== null) returned++;
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
  // Attach a run control and record its run lifecycle events.
  control?: boolean;
  // Put that run control in the AxGen constructor's options instead of the
  // forward call's.
  constructor_control?: boolean;
  // The scripted client steers the run control while this request (1-based)
  // is in flight. The fixture then records every control event (queued and
  // applied too) and each request's message roles.
  control_steer?: { during_request: number; text: string };
  // The consumer stops the stream after this many deltas.
  stop_after_deltas?: number;
  responses: ResponseSpec[];
  // The part of TS's error message the ports must produce; defaults to the
  // first line without TS's "Generate failed: " wrapper.
  error_contains?: string;
  // Pin TS's whole error message, not only its first line.
  full_error?: boolean;
  // Pin this many messages at the end of the last request's prompt.
  request_tail?: number;
  // The chunks split a surrogate pair, which only runners whose strings can
  // hold a lone surrogate (UTF-16 or code points) can represent.
  requires_lone_surrogates?: boolean;
  // Pin the first request's user message: its content as a JSON string
  // literal, which every runner's JSON text of the chat prompt must contain.
  pin_user_prompt?: boolean;
  // Pin the request layout: the first request's whole chat prompt, and each
  // request's message roles.
  pin_request_layout?: boolean;
  // The client opens native chat sessions that play this script (see
  // SessionScript); each opened session is one request. The fixture pins
  // the session log and each request's message roles.
  native_session?: SessionScript;
  // Pin each request's message roles, also when the forward fails.
  pin_request_roles?: boolean;
  // Pin the tool results the session run submits (text and error flag).
  pin_session_results?: boolean;
  // Port-only forward options, added to the fixture's forward_options but
  // not passed to TS: a port's opt-in to what TS always does.
  port_forward_options?: JsonMap;
  // An abort signal in the AxGen constructor's options (TS abortSignal; the
  // ports' cancellation token), aborted with the reason when cancelled.
  constructor_cancellation?: CancellationSpec;
  // An abort signal in the forward call's options.
  call_cancellation?: CancellationSpec;
  // Pin the tool results the last request sent back, each as a JSON string
  // literal, which every runner's JSON text of the request must contain.
  pin_function_results?: boolean;
  call_function_result_formatter?: { text?: string; throws?: string };
};

type CancellationSpec = { cancelled: boolean; reason?: string };

function abortSignalFor(spec: CancellationSpec | undefined) {
  if (!spec) return undefined;
  const controller = new AbortController();
  if (spec.cancelled) controller.abort(spec.reason ?? 'fixture-stop');
  return controller.signal;
}

async function record(name: string, spec: Case): Promise<void> {
  const kind = spec.kind ?? 'streaming_forward';
  const input = spec.input ?? { question: 'Status?' };
  const toolCalls: JsonMap[] = [];
  const toolExtras: JsonMap[] = [];
  const processorCalls: JsonMap[] = [];
  const control =
    spec.control || spec.constructor_control ? runControl() : undefined;
  const steer = spec.control_steer;
  const { ai, calls, prompts, formats, sessionLog, sessionResults } =
    scriptedAI(
      spec.responses,
      spec.features,
      (request) => {
        if (steer && control && request === steer.during_request) {
          control.steer(steer.text);
        }
      },
      spec.native_session
    );
  const constructorSignal = abortSignalFor(spec.constructor_cancellation);
  const gen = new AxGen(spec.signature, {
    ...tsOptions(spec.options),
    functions: tsTools(spec.tools ?? [], toolCalls, toolExtras),
    ...(spec.constructor_control ? { control } : {}),
    ...(constructorSignal ? { abortSignal: constructorSignal } : {}),
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
  if (spec.call_function_result_formatter) {
    const formatter = spec.call_function_result_formatter;
    forwardOptions.functionResultFormatter = () => {
      if (formatter.throws) throw new Error(formatter.throws);
      return formatter.text ?? '';
    };
  }
  if (spec.result_picker_index !== undefined) {
    const picked = spec.result_picker_index;
    forwardOptions.resultPicker = async () => picked;
  }
  if (spec.stop_functions) {
    forwardOptions.stopFunction = [...spec.stop_functions];
  }
  const callSignal = abortSignalFor(spec.call_cancellation);
  if (callSignal) forwardOptions.abortSignal = callSignal;

  const controlEvents: JsonMap[] = [];
  if (control) {
    control.onEvent(({ type, path }) => {
      if (
        steer ||
        ['started', 'completed', 'failed', 'aborted'].includes(type)
      ) {
        controlEvents.push({ type, path });
      }
    });
    if (!spec.constructor_control) forwardOptions.control = control;
  }

  const deltas: JsonMap[] = [];
  let output: Json | undefined;
  let error: string | undefined;
  let errorMessage: string | undefined;
  let errorCause: string | undefined;
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
        if (deltas.length === spec.stop_after_deltas) break;
      }
    }
  } catch (e) {
    errorMessage = (e as Error).message;
    error = errorMessage.split('\n')[0];
    // AxGenerateError keeps the failure it wraps as its cause.
    const cause = (e as Error).cause;
    if ((e as Error).name === 'AxGenerateError' && cause instanceof Error) {
      errorCause = cause.message.split('\n')[0];
    }
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
    'requires_lone_surrogates',
    'control',
    'constructor_control',
    'control_steer',
    'stop_after_deltas',
    'native_session',
    'constructor_cancellation',
    'call_cancellation',
  ] as const) {
    if (spec[key] !== undefined) fixture[key] = spec[key];
  }
  if (spec.native_session && spec.pin_session_results) {
    fixture.expected_session_tool_results = sessionResults();
  }
  if (spec.call_function_result_formatter) {
    fixture.call_function_result_formatter =
      spec.call_function_result_formatter;
  }
  if (spec.native_session) {
    fixture.expected_session_log = sessionLog();
    fixture.expected_request_roles = (prompts() as JsonMap[][]).map((prompt) =>
      prompt.map((message) => message.role as Json)
    );
  }
  if (spec.port_forward_options) {
    fixture.forward_options = {
      ...(spec.forward_options ?? {}),
      ...spec.port_forward_options,
    };
  }
  if (control) fixture.expected_control_events = controlEvents;
  if (steer) {
    // A native session takes the steer itself (the session log pins it);
    // otherwise it goes into the next request.
    if (!spec.native_session) fixture.expected_request_contains = [steer.text];
    fixture.expected_request_roles = (prompts() as JsonMap[][]).map((prompt) =>
      prompt.map((message) => message.role as Json)
    );
  }
  if (spec.tools) fixture.expected_tool_calls = toolCalls;
  if (spec.tools?.some((tool) => tool.record_extras)) {
    fixture.expected_tool_extras = toolExtras;
  }
  if (spec.request_tail !== undefined) {
    // The runners compare each message's role and content.
    fixture.expected_last_request_tail = ((prompts().at(-1) ?? []) as JsonMap[])
      .slice(-spec.request_tail)
      .map(({ role, content }) => ({ role, content }));
  }
  if (spec.feedback_processors || spec.streaming_processors)
    fixture.expected_processor_calls = processorCalls;
  if (kind === 'streaming_forward') {
    fixture.expected_deltas = deltas;
    // A consumer that stops early has no output to compare.
    if (error === undefined && spec.stop_after_deltas === undefined) {
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
  if (spec.pin_request_layout) {
    // A forward also pins the first request's response format, which tells
    // the native rung (json_schema) from json_object.
    const format = formats()[0];
    if (kind === 'forward' && format) {
      fixture.expected_request = { response_format: { type: format } };
    }
    fixture.expected_chat_prompt = clone(prompts()[0] ?? []);
    fixture.expected_request_roles = (prompts() as JsonMap[][]).map((prompt) =>
      prompt.map((message) => message.role as Json)
    );
  }
  if (spec.pin_request_roles) {
    fixture.expected_request_roles = (prompts() as JsonMap[][]).map((prompt) =>
      prompt.map((message) => message.role as Json)
    );
  }
  if (spec.pin_function_results) {
    const last = (prompts().at(-1) ?? []) as { role?: string; result?: Json }[];
    const results = last
      .filter((message) => message.role === 'function')
      .map((message) => JSON.stringify(message.result));
    if (results.length === 0) {
      throw new Error(`${name}: no function results to pin`);
    }
    fixture.expected_request_contains = results;
  }
  if (spec.pin_user_prompt) {
    const first = (prompts()[0] ?? []) as { role?: string; content?: Json }[];
    const user = first.filter((message) => message.role === 'user').at(-1);
    if (typeof user?.content !== 'string') {
      throw new Error(`${name}: no text user message to pin`);
    }
    fixture.expected_chat_prompt_contains = [JSON.stringify(user.content)];
  }
  if (error !== undefined) {
    // Without an explicit substring, pin TypeScript's first line, or its
    // whole message when asked.
    const expected =
      spec.error_contains ?? (spec.full_error ? errorMessage! : error);
    if (!errorMessage!.includes(expected)) {
      throw new Error(`${name}: TS error "${error}" lacks "${expected}"`);
    }
    fixture.expected_error_contains = expected;
    if (spec.error_contains === undefined && errorCause !== undefined) {
      fixture.expected_error_cause_contains = errorCause;
    }
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
// The lookup tool with its argument's own description, which TS's fixing
// instructions for a bad argument show.
const describedLookupTool: ToolSpec = {
  name: 'lookup',
  description: 'Look up a key',
  args: { key: { type: 'string', description: 'The key to look up' } },
  result: 'status is green',
};
// The lookup tool, recording the extras TS gives it.
const extrasLookupTool: ToolSpec = { ...lookupTool, record_extras: true };
const lookupThenAnswer: ResponseSpec[] = [
  {
    results: [
      {
        index: 0,
        content: '',
        function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
        finish_reason: 'function_call',
      },
    ],
  },
  { results: [{ index: 0, content: 'Answer: ok' }] },
];
const eventContextSample = {
  runId: 'run-1',
  routeId: 'orders',
  attempt: 1,
  identity: { subject: 'user-1' },
};
const finishTool: ToolSpec = {
  name: 'finish',
  description: 'Finish the task',
  args: { note: { type: 'string' } },
  result: 'finished',
};
const nativeFeatures: JsonMap = { functions: true, structured_outputs: true };
const jsonObjectFeatures: JsonMap = {
  functions: true,
  structured_outputs: false,
  structured_output_modes: ['json_object'],
};
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

  // ----- retry messages on the text paths -----
  // A retry after a failed check is one user message with a text part,
  // `Title: description`, as TS's renderExtraFields renders the error:
  // "Follow these instructions" for an assertion (its message ends with a
  // period), "Invalid Field" for a validation error.
  'forward-retry-message-assertion': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    request_tail: 2,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
    ],
  },
  'forward-retry-message-assertion-adds-period': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris',
      },
    ],
    request_tail: 2,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
    ],
  },
  'forward-retry-message-missing-field': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    request_tail: 2,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
    ],
  },
  'forward-retry-message-json-object-parse': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: jsonObjectFeatures,
    request_tail: 2,
    responses: [
      { results: [{ index: 0, content: 'Here you go' }] },
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
    ],
  },
  'streaming-forward-retry-message-assertion': {
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    request_tail: 2,
    responses: [
      streamed(text('Answer: Lyon'), done()),
      streamed(text('Answer: Paris'), done()),
    ],
  },

  // ----- retry memory -----
  // TS's non-streaming forward keeps a failed answer and its correction in
  // memory until a later answer parses or calls tools, and then drops them
  // (response/nonStreaming.ts): a retry after an assertion fails sends only
  // the latest failed answer, while parse and validation failures pile up.
  // disableMemoryCleanup keeps every failed attempt, and so do a stream and
  // a failed __axOutput call; after a failed __axOutput call, the call and
  // its result stay once the rest is dropped.
  'forward-retry-memory-assertion': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Nice' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
    ],
  },
  'forward-retry-memory-assertion-exhausted': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Nice' }] },
      { results: [{ index: 0, content: 'Answer: Lille' }] },
      { results: [{ index: 0, content: 'Answer: Metz' }] },
    ],
  },
  'forward-retry-memory-missing-field': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Nice' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
    ],
  },
  'forward-retry-memory-assertion-then-missing-field': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon\nCity: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
      { results: [{ index: 0, content: 'Answer: Nice\nCity: Nice' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
    ],
  },
  'forward-retry-memory-tool-step': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    tools: [lookupTool],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      {
        results: [
          {
            index: 0,
            function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
            finish_reason: 'function_call',
          },
        ],
      },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
    ],
  },
  'forward-retry-memory-feedback-step': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    feedback_processors: [
      { field: 'answer', returns: 'Name the country too.', times: 1 },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
      {
        results: [{ index: 0, content: 'Answer: Paris, France\nCity: Paris' }],
      },
    ],
  },
  'forward-retry-memory-steer-step': {
    kind: 'forward',
    signature: 'question:string -> answer:string, city:string',
    control: true,
    control_steer: { during_request: 2, text: 'Answer in French.' },
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
      { results: [{ index: 0, content: 'Answer: Paris\nCity: Paris' }] },
    ],
  },
  'forward-retry-memory-json-assertion': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    assertions: [
      { field: 'user', equals: { name: 'Ada' }, message: 'The user is Ada.' },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: '{"user":{"name":"Bob"}}' }] },
      { results: [{ index: 0, content: '{"user":{"name":"Eve"}}' }] },
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
    ],
  },
  'forward-retry-memory-json-validation': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string, age:number}',
    features: nativeFeatures,
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
      { results: [{ index: 0, content: '{"user":{"name":"Ada","age":36}}' }] },
    ],
  },
  'forward-retry-memory-function-rung-assertion': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: { functions: true, structured_outputs: false },
    options: { structured_output_mode: 'function' },
    assertions: [
      { field: 'user', equals: { name: 'Ada' }, message: 'The user is Ada.' },
    ],
    pin_request_roles: true,
    responses: [
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_1', '__axOutput', '{"user":{"name":"Bob"}}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_2', '__axOutput', '{"user":{"name":"Eve"}}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_3', '__axOutput', '{"user":{"name":"Ada"}}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
    ],
  },
  'forward-retry-memory-function-rung-then-assertion': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: { functions: true, structured_outputs: false },
    options: { structured_output_mode: 'function' },
    assertions: [
      { field: 'user', equals: { name: 'Ada' }, message: 'The user is Ada.' },
    ],
    pin_request_roles: true,
    responses: [
      {
        results: [
          {
            index: 0,
            function_calls: [call('output_1', '__axOutput', '{"user":{}}')],
            finish_reason: 'function_call',
          },
        ],
      },
      { results: [{ index: 0, content: '{"user":{"name":"Bob"}}' }] },
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_2', '__axOutput', '{"user":{"name":"Ada"}}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
    ],
  },
  'forward-retry-memory-disable-cleanup': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    forward_options: { disable_memory_cleanup: true },
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    pin_request_roles: true,
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Nice' }] },
      { results: [{ index: 0, content: 'Answer: Paris' }] },
    ],
  },
  'streaming-forward-retry-memory-assertion': {
    signature: 'question:string -> answer:string',
    assertions: [
      {
        field: 'answer',
        contains: 'Paris',
        message: 'The answer must be Paris.',
      },
    ],
    pin_request_roles: true,
    responses: [
      streamed(text('Answer: Lyon'), done()),
      streamed(text('Answer: Nice'), done()),
      streamed(text('Answer: Paris'), done()),
    ],
  },

  // ----- JS trim -----
  // TS trims values with String.prototype.trim: JS whitespace and line
  // terminators (U+FEFF, U+00A0, U+2028, U+3000 among them) go, while
  // control characters such as U+001C and U+0085 stay.
  'forward-text-trim-js-whitespace': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [
      {
        results: [
          { index: 0, content: 'Answer: \ufeff\u00a0Paris\u2028\u3000' },
        ],
      },
    ],
  },
  'forward-text-trim-keeps-control-chars': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [
      { results: [{ index: 0, content: 'Answer: \u001cParis\u0085' }] },
    ],
  },

  // ----- re-parse cadence in UTF-16 units -----
  // TS re-parses streamed structured output after 160 new characters of
  // String.prototype.length (UTF-16 code units): 90 emoji reach it (197
  // units) in the first chunk, so a partial delta streams before the end.
  'streaming-forward-structured-cadence-utf16-parse': {
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    responses: [
      streamed(
        text(`{"user":{"name":"${'\u{1F600}'.repeat(90)}`),
        text(`${'\u{1F600}'.repeat(10)}"}}`),
        done()
      ),
    ],
  },
  // 60 emoji are 137 units (257 UTF-8 bytes): below the threshold, and the
  // text doesn't end at a structural boundary, so TS waits for the end.
  'streaming-forward-structured-cadence-utf16-wait': {
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    responses: [
      streamed(
        text(`{"user":{"name":"${'\u{1F600}'.repeat(60)}`),
        text(`${'\u{1F600}'.repeat(10)}"}}`),
        done()
      ),
    ],
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

  // ----- request layout per rung -----
  // TS puts the structured-output contract in the system prompt: the output
  // section ends with the exact JSON shape, and the formatting rule names the
  // rung (a JSON object, or a call to __axOutput). The request is the system
  // prompt and the user message, with no instruction turn after them.
  'forward-request-layout-text-contract': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: 'Answer: Ada' }] }],
  },
  // includeOptionalInputFieldsInSystemPrompt: the system prompt lists the
  // unset optional input too; the user message still leaves it out.
  'forward-request-layout-optional-input-listed': {
    kind: 'forward',
    signature:
      'question:string, context?:string "Background notes" -> answer:string',
    options: { include_optional_input_fields_in_system_prompt: true },
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: 'Answer: Ada' }] }],
  },
  'forward-request-layout-optional-input-forward-option': {
    kind: 'forward',
    signature:
      'question:string, context?:string "Background notes" -> answer:string',
    forward_options: { include_optional_input_fields_in_system_prompt: true },
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: 'Answer: Ada' }] }],
  },
  // The forward's option wins over the constructor's.
  'forward-request-layout-optional-input-forward-off': {
    kind: 'forward',
    signature:
      'question:string, context?:string "Background notes" -> answer:string',
    options: { include_optional_input_fields_in_system_prompt: true },
    forward_options: { include_optional_input_fields_in_system_prompt: false },
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: 'Answer: Ada' }] }],
  },
  'forward-request-layout-native': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
    ],
  },
  'forward-request-layout-json-object': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    features: jsonObjectFeatures,
    pin_request_layout: true,
    responses: [
      { results: [{ index: 0, content: '{"user":{"name":"Ada"}}' }] },
    ],
  },
  'forward-request-layout-function': {
    kind: 'forward',
    signature: 'question:string -> user:object{name:string}',
    options: { structured_output_mode: 'function' },
    features: { functions: true, structured_outputs: false },
    pin_request_layout: true,
    responses: [
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_1', '__axOutput', '{"user":{"name":"Ada"}}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
    ],
  },
  // A provider that requires structured output gets TS's structured prompt
  // for a simple signature too: the exact JSON shape and the JSON rule.
  'forward-request-layout-requires-structured-output': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    features: { ...nativeFeatures, requires_structured_output: true },
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: '{"answer":"Ada"}' }] }],
  },
  // With structured output required, a simple signature's rung still
  // follows the provider's modes, as for a complex signature.
  'forward-request-layout-requires-structured-output-json-object': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    features: { ...jsonObjectFeatures, requires_structured_output: true },
    pin_request_layout: true,
    responses: [{ results: [{ index: 0, content: '{"answer":"Ada"}' }] }],
  },
  'forward-request-layout-requires-structured-output-function': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    features: {
      functions: true,
      structured_outputs: false,
      structured_output_modes: ['function'],
      requires_structured_output: true,
    },
    pin_request_layout: true,
    responses: [
      {
        results: [
          {
            index: 0,
            function_calls: [
              call('output_1', '__axOutput', '{"answer":"Ada"}'),
            ],
            finish_reason: 'function_call',
          },
        ],
      },
    ],
  },
  'streaming-forward-request-layout-native': {
    signature: 'question:string -> user:object{name:string}',
    features: nativeFeatures,
    pin_request_layout: true,
    responses: [streamed(text('{"user":{"name":"Ada"}}'), done())],
  },
  'streaming-forward-request-layout-json-object': {
    signature: 'question:string -> user:object{name:string}',
    features: jsonObjectFeatures,
    pin_request_layout: true,
    responses: [streamed(text('{"user":{"name":"Ada"}}'), done())],
  },
  'streaming-forward-request-layout-function': {
    signature: 'question:string -> user:object{name:string}',
    options: { structured_output_mode: 'function' },
    features: { functions: true, structured_outputs: false },
    pin_request_layout: true,
    responses: [
      streamed(
        chunk({
          function_calls: [
            call('output_1', '__axOutput', '{"user":{"name":"Ada"}}'),
          ],
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
  // The streaming loop writes tool results as TS's default
  // functionResultFormatter does: a string as it is, any other value as
  // JSON.stringify(result, null, 2). The object's keys are in sorted order,
  // which the fixture sync keeps.
  'streaming-forward-tool-result-format': {
    signature: 'question:string -> answer:string',
    tools: [
      {
        ...lookupTool,
        result: { checks: [2, 1], note: null, status: 'green' },
      },
      { ...finishTool, name: 'note', result: 'plain text' },
    ],
    pin_function_results: true,
    responses: [
      streamed(
        chunk({
          function_calls: [
            call('call_1', 'lookup', '{"key":"a"}'),
            call('call_2', 'note', '{"note":"n"}'),
          ],
          finish_reason: 'function_call',
        })
      ),
      streamed(text('Answer: gre'), done('en')),
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
    responses: [
      streamed(text('Answer: a\nScore: x'), done()),
      streamed(text('Answer: b\nScore: y'), done()),
    ],
  },
  // ----- run control lifecycle -----
  // A run the consumer stops early ends on purpose: TS reports it as
  // aborted, as control.abort() does, not as failed.
  'streaming-forward-control-early-stop': {
    signature: 'question:string -> answer:string',
    control: true,
    stop_after_deltas: 1,
    responses: [
      streamed(
        text('Answer: The '),
        text('quick '),
        text('brown '),
        done('fox.')
      ),
    ],
  },
  'streaming-forward-control-completed': {
    signature: 'question:string -> answer:string',
    control: true,
    responses: [
      streamed(
        text('Answer: The '),
        text('quick '),
        text('brown '),
        done('fox.')
      ),
    ],
  },
  'streaming-forward-control-failed': {
    signature: 'question:string -> answer:string, score:number',
    control: true,
    forward_options: { max_retries: 0 },
    error_contains: "Field 'Score' has an invalid value 'x': Invalid number",
    responses: [streamed(text('Answer: a\nScore: x'), done())],
  },
  // A steer queued while a request is in flight: TS's step loop continues
  // while an update is pending, applies the steer as a user message at the
  // next step (an applied event), and answers from the second request.
  'streaming-forward-control-steer-continues': {
    signature: 'question:string -> answer:string',
    control: true,
    control_steer: { during_request: 1, text: 'Answer in French.' },
    responses: [
      streamed(text('Answer: reply 1'), done()),
      streamed(text('Answer: reply 2'), done()),
    ],
  },
  'forward-control-steer-continues': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    control_steer: { during_request: 1, text: 'Answer in French.' },
    responses: [
      { results: [{ index: 0, content: 'Answer: reply 1' }] },
      { results: [{ index: 0, content: 'Answer: reply 2' }] },
    ],
  },
  // The applied steer stays in memory: the next step's request still
  // carries it after the tool results.
  'forward-control-steer-persists-across-tool-steps': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [lookupTool],
    control: true,
    control_steer: { during_request: 1, text: 'Answer in French.' },
    responses: [
      {
        results: [
          {
            index: 0,
            content: '',
            function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
            finish_reason: 'function_call',
          },
        ],
      },
      {
        results: [
          {
            index: 0,
            content: '',
            function_calls: [call('call_2', 'lookup', '{"key":"b"}')],
            finish_reason: 'function_call',
          },
        ],
      },
      { results: [{ index: 0, content: 'Answer: done' }] },
    ],
  },
  // Run options given to the AxGen constructor apply to every forward, as in
  // TS: a run control there reports the run's lifecycle, and an
  // executionPath there names the run's control path.
  'forward-constructor-control-events': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    constructor_control: true,
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
  },
  'streaming-forward-constructor-control-events': {
    signature: 'question:string -> answer:string',
    constructor_control: true,
    responses: [streamed(text('Answer: ok'), done())],
  },
  // An abort signal in the AxGen constructor is the default for every
  // forward, as TS's other run options there: aborted, the run stops before
  // any request; a call's own signal replaces it.
  'forward-constructor-cancellation-stops-before-request': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    constructor_cancellation: { cancelled: true, reason: 'fixture-stop' },
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
  },
  'streaming-forward-constructor-cancellation-stops-before-request': {
    signature: 'question:string -> answer:string',
    constructor_cancellation: { cancelled: true, reason: 'fixture-stop' },
    responses: [streamed(text('Answer: ok'), done())],
  },
  'forward-constructor-cancellation-call-signal-wins': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    constructor_cancellation: { cancelled: true, reason: 'fixture-stop' },
    call_cancellation: { cancelled: false },
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
  },
  'forward-constructor-cancellation-live': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    constructor_cancellation: { cancelled: false },
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
  },
  'forward-call-cancellation-over-live-constructor': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    constructor_cancellation: { cancelled: false },
    call_cancellation: { cancelled: true, reason: 'call-stop' },
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
  },
  // A tool's extras: TS gives it the run's sessionId and eventContext, and
  // under a run control its executionPath (<path>/<tool>); the AxGen
  // constructor's are defaults that the call's replace.
  'forward-tool-extras-session-and-event-context': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [extrasLookupTool],
    forward_options: {
      sessionId: 'session-1',
      eventContext: eventContextSample,
    },
    responses: lookupThenAnswer,
  },
  'forward-tool-extras-none': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [extrasLookupTool],
    responses: lookupThenAnswer,
  },
  'forward-tool-extras-execution-path-under-control': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [extrasLookupTool],
    control: true,
    forward_options: { sessionId: 'session-1', executionPath: 'root/orders' },
    responses: lookupThenAnswer,
  },
  'forward-tool-extras-constructor-defaults': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [extrasLookupTool],
    options: {
      sessionId: 'constructor-session',
      eventContext: eventContextSample,
    },
    forward_options: { sessionId: 'call-session' },
    responses: lookupThenAnswer,
  },
  'streaming-forward-tool-extras-session-and-event-context': {
    signature: 'question:string -> answer:string',
    tools: [extrasLookupTool],
    forward_options: {
      sessionId: 'session-1',
      eventContext: eventContextSample,
    },
    responses: [
      streamed(
        chunk({
          function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
          finish_reason: 'function_call',
        })
      ),
      streamed(text('Answer: ok'), done()),
    ],
  },
  'forward-constructor-execution-path': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    options: { executionPath: 'root/constructor' },
    control: true,
    responses: [{ results: [{ index: 0, content: 'Answer: ok' }] }],
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
    // The correction reads like an assertion's, closing period added.
    request_tail: 2,
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

  // A provider can split a surrogate pair across stream events: no delta
  // holds half of the character, and the answer joins it back.
  'streaming-forward-split-surrogate-pair': {
    signature: 'question:string -> answer:string',
    requires_lone_surrogates: true,
    responses: [streamed(text('Answer: hi \uD83D'), done('\uDE00 there'))],
  },

  // Feedback a streaming processor returns mid-stream waits for the end of
  // the step: it follows the full answer and the run takes another step.
  'streaming-forward-mid-stream-feedback-continues': {
    signature: 'question:string -> answer:string',
    streaming_processors: [
      { field: 'answer', returns: 'Please avoid the word draft.', times: 1 },
    ],
    request_tail: 2,
    responses: [
      streamed(text('Answer: a draft'), done(' then more text')),
      streamed(text('Answer: a final'), done(' answer')),
    ],
  },
  // Mid-stream feedback comes before the feedback given on the final value.
  'streaming-forward-mid-stream-and-final-feedback-order': {
    signature: 'question:string -> answer:string',
    streaming_processors: [
      { field: 'answer', returns: 'Avoid drafts.', times: 1 },
    ],
    feedback_processors: [
      { field: 'answer', returns: 'Keep it short.', times: 1 },
    ],
    request_tail: 3,
    responses: [
      streamed(text('Answer: a draft'), done(' then more')),
      streamed(text('Answer: ok'), done()),
    ],
  },
  // A processor that returns null gives no feedback.
  'streaming-forward-processor-null-no-feedback': {
    signature: 'question:string -> answer:string',
    streaming_processors: [{ field: 'answer', returns: null }],
    feedback_processors: [{ field: 'answer', returns: null }],
    responses: [streamed(text('Answer: a draft'), done(' then more'))],
  },
  // Feedback on a finished answer is a user message with a text part.
  'forward-feedback-request-shape': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    feedback_processors: [{ field: 'answer', returns: 'Check it.', times: 1 }],
    request_tail: 2,
    responses: [
      { results: [{ index: 0, content: 'Answer: first' }] },
      { results: [{ index: 0, content: 'Answer: second' }] },
    ],
  },

  'streaming-forward-feedback-carries-thought': {
    signature: 'question:string -> answer:string',
    forward_options: { show_thoughts: true },
    feedback_processors: [{ field: 'answer', returns: 'Check it.', times: 1 }],
    responses: [
      streamed(thought('First look. '), text('Answer: Lyon'), done()),
      streamed(thought('Rechecked.'), text('Answer: Paris'), done()),
    ],
  },
  'streaming-forward-infra-retry-replays-prefix': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(text('Answer: hello'), text(' wor'), {
        error: { type: 'network', message: 'socket hang up' },
      }),
      streamed(text('Answer: hel'), text('lo world'), done()),
    ],
  },
  'streaming-forward-text-code-fence-stripped': {
    signature: 'question:string -> answer:code',
    responses: [
      streamed(
        text('Answer: ```python\nprint(1)\n'),
        text('print(2)\n'),
        done('```')
      ),
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
  // forward with stream: true returns what a streaming consumer merges.
  'forward-stream-code-field': {
    kind: 'forward',
    signature: 'question:string -> answer:code',
    forward_options: { stream: true },
    responses: [
      streamed(text('Answer: ```py'), text('thon\nprint(1)\n```'), done()),
    ],
  },
  'forward-stream-stop-function-thought': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [lookupTool, finishTool],
    stop_functions: ['finish'],
    forward_options: { stream: true, show_thoughts: true },
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
  // Asserts check the answer, so a tool step with no answer yet skips them:
  // with no retry budget, an assert run on the tool step would fail it.
  'forward-tool-step-skips-assertions': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    options: { max_retries: 0 },
    tools: [lookupTool],
    assertions: [{ field: 'answer', contains: 'final', message: 'Say final' }],
    responses: [
      {
        results: [
          {
            index: 0,
            content: 'Answer: partial draft',
            function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
            finish_reason: 'function_call',
          },
        ],
      },
      { results: [{ index: 0, content: 'Answer: final' }] },
    ],
  },
  // Non-streaming forward keeps the stop step's thought too.
  'forward-stop-function-step-thought': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [lookupTool, finishTool],
    stop_functions: ['finish'],
    forward_options: { show_thoughts: true },
    responses: [
      {
        results: [
          {
            index: 0,
            thought: 'First. ',
            function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
            finish_reason: 'function_call',
          },
        ],
      },
      {
        results: [
          {
            index: 0,
            thought: 'Done.',
            function_calls: [call('call_2', 'finish', '{"note":"ok"}')],
            finish_reason: 'function_call',
          },
        ],
      },
    ],
  },
  'streaming-forward-text-code-before-field': {
    signature: 'question:string -> answer:code, reason:string',
    responses: [
      streamed(
        text('Answer: ```python\nprint(1)\n```\n'),
        text('Reason: short'),
        done()
      ),
    ],
  },
  'streaming-forward-text-code-trailing-backtick': {
    signature: 'question:string -> answer:code',
    responses: [streamed(text('Answer: echo `date'), done('`'))],
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
  },
  'text-extract-number-array': {
    kind: 'forward',
    signature: 'question:string -> scores:number[]',
    responses: [{ results: [{ index: 0, content: 'Scores: [1, "2", 3.5]' }] }],
  },

  // ----- error wrapping: TypeScript's whole message -----
  // Exhausted validation and assertion retries are generation failures:
  // "Generate failed: Unable to fix validation error: ..." with the last
  // attempt's output, whatever the validation message says.
  'errors-validation-missing-exhausted': {
    kind: 'forward',
    signature: 'question:string -> answer:string, reason:string',
    options: { max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: 'Answer: hi' }] },
      { results: [{ index: 0, content: 'Answer: hello' }] },
    ],
  },
  'errors-validation-type-exhausted': {
    kind: 'forward',
    signature: 'question:string -> count:number',
    options: { max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: 'Count: many' }] },
      { results: [{ index: 0, content: 'Count: lots' }] },
    ],
  },
  'errors-assertion-exhausted': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    options: { max_retries: 1 },
    assertions: [
      { field: 'answer', contains: 'Paris', message: 'Mention Paris' },
    ],
    responses: [
      { results: [{ index: 0, content: 'Answer: Lyon' }] },
      { results: [{ index: 0, content: 'Answer: Nice' }] },
    ],
  },
  'errors-streaming-validation-exhausted': {
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 1 },
    responses: [
      streamed(text('Answer: a\nScore: x'), done()),
      streamed(text('Answer: b\nScore: y'), done()),
    ],
  },
  // A processor's own error ends the forward as a generation failure, even
  // when its message has a word like "required".
  'errors-processor-throws': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    feedback_processors: [
      { field: 'answer', throws: 'upstream token required' },
    ],
    responses: [{ results: [{ index: 0, content: 'Answer: hi' }] }],
  },
  'errors-streaming-processor-throws': {
    signature: 'question:string -> answer:string',
    streaming_processors: [
      { field: 'answer', throws: 'upstream token required' },
    ],
    responses: [streamed(text('Answer: hi'), done())],
  },
  'errors-max-tokens': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    responses: [
      {
        results: [
          { index: 0, content: 'Answer: cut sh', finish_reason: 'length' },
        ],
      },
    ],
  },
  'errors-streaming-max-tokens': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(
        text('Answer: cut'),
        chunk({ content: ' sh', finish_reason: 'length' })
      ),
    ],
  },
  'errors-streaming-error-finish': {
    signature: 'question:string -> answer:string',
    responses: [
      streamed(text('Answer: hi'), chunk({ finish_reason: 'error' })),
    ],
  },

  // ----- structured output value types -----
  // As in the text contract, a numeric string becomes a number and a
  // true/false string a boolean; any other type mismatch is a validation
  // error that the model retries, with TypeScript's message.
  'structured-coerce-number-and-boolean': {
    kind: 'forward',
    signature:
      'question:string -> count:number, done:boolean, detail:object{ size:number, open:boolean }',
    features: nativeFeatures,
    responses: [
      {
        results: [
          {
            index: 0,
            content:
              '{"count":" 7 ","done":"TRUE","detail":{"size":"12","open":"false"}}',
          },
        ],
      },
    ],
  },
  'structured-type-error-retry': {
    kind: 'forward',
    signature: 'question:string -> count:number, detail:object{ note:string }',
    features: nativeFeatures,
    responses: [
      {
        results: [
          { index: 0, content: '{"count":"seven","detail":{"note":"n"}}' },
        ],
      },
      { results: [{ index: 0, content: '{"count":3,"detail":{"note":"n"}}' }] },
    ],
  },
  'structured-type-error-exhausted': {
    kind: 'forward',
    signature: 'question:string -> count:number, detail:object{ note:string }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      {
        results: [
          { index: 0, content: '{"count":"seven","detail":{"note":"n"}}' },
        ],
      },
      {
        results: [
          { index: 0, content: '{"count":"eight","detail":{"note":"n"}}' },
        ],
      },
    ],
  },
  'structured-string-for-number-exhausted': {
    kind: 'forward',
    signature: 'question:string -> label:string, detail:object{ note:string }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: '{"label":5,"detail":{"note":"n"}}' }] },
      { results: [{ index: 0, content: '{"label":6,"detail":{"note":"n"}}' }] },
    ],
  },
  'structured-class-option-exhausted': {
    kind: 'forward',
    signature:
      'question:string -> mood:class "happy, sad", detail:object{ note:string }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      {
        results: [
          { index: 0, content: '{"mood":"angry","detail":{"note":"n"}}' },
        ],
      },
      {
        results: [
          { index: 0, content: '{"mood":"calm","detail":{"note":"n"}}' },
        ],
      },
    ],
  },
  'structured-array-expected-exhausted': {
    kind: 'forward',
    signature: 'question:string -> tags:string[], detail:object{ note:string }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      {
        results: [
          { index: 0, content: '{"tags":"solo","detail":{"note":"n"}}' },
        ],
      },
      {
        results: [
          { index: 0, content: '{"tags":"duo","detail":{"note":"n"}}' },
        ],
      },
    ],
  },
  'structured-nested-type-exhausted': {
    kind: 'forward',
    signature: 'question:string -> detail:object{ size:number }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: '{"detail":{"size":"big"}}' }] },
      { results: [{ index: 0, content: '{"detail":{"size":"huge"}}' }] },
    ],
  },
  // A title-named key is not a field alias: TS drops it, so the field is
  // missing.
  'structured-title-key-exhausted': {
    kind: 'forward',
    signature: 'question:string -> count:number, detail:object{ note:string }',
    features: nativeFeatures,
    options: { max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: '{"Count":1,"detail":{"note":"n"}}' }] },
      { results: [{ index: 0, content: '{"Count":2,"detail":{"note":"n"}}' }] },
    ],
  },
  // Native JSON for a simple signature rejects keys that are not fields.
  'structured-native-simple-unknown-key-retry': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    features: nativeFeatures,
    forward_options: { structured_output_mode: 'native' },
    responses: [
      { results: [{ index: 0, content: '{"answer":"x","extra":1}' }] },
      { results: [{ index: 0, content: '{"answer":"x"}' }] },
    ],
  },
  'streaming-forward-structured-type-error-retry': {
    signature: 'question:string -> count:number, detail:object{ note:string }',
    features: nativeFeatures,
    responses: [
      streamed(
        text('{"count":"seven",'),
        text('"detail":{"note":"n"}}'),
        done()
      ),
      streamed(text('{"count":3,'), text('"detail":{"note":"n"}}'), done()),
    ],
  },
  // Array items of a nested object field are checked and coerced too.
  'structured-nested-array-coerce': {
    kind: 'forward',
    signature:
      'question:string -> detail:object{ tags:string[], sizes:number[] }',
    features: nativeFeatures,
    responses: [
      {
        results: [
          {
            index: 0,
            content: '{"detail":{"tags":["a","b"],"sizes":["1",2]}}',
          },
        ],
      },
    ],
  },
  'streaming-forward-structured-nested-array-coerce': {
    signature:
      'question:string -> detail:object{ tags:string[], sizes:number[] }',
    features: nativeFeatures,
    responses: [
      streamed(
        text('{"detail":{"tags":["a","b"],'),
        text('"sizes":["1",2]}}'),
        done()
      ),
    ],
  },
  'streaming-forward-structured-coerce': {
    signature: 'question:string -> count:number, detail:object{ note:string }',
    features: nativeFeatures,
    responses: [
      streamed(text('{"count":"7",'), text('"detail":{"note":"n"}}'), done()),
    ],
  },

  // ----- the output an exhausted retry reports -----
  // "Unable to fix validation error" ends with the last attempt's output,
  // each sample's answer joined with "\n---\n", streamed or not.
  'errors-exhausted-llm-output': {
    kind: 'forward',
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 0 },
    full_error: true,
    responses: [{ results: [{ index: 0, content: 'Answer: x\nScore: nope' }] }],
  },
  'errors-streaming-exhausted-llm-output': {
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 0 },
    full_error: true,
    responses: [streamed(text('Answer: x\n'), done('Score: nope'))],
  },
  'errors-structured-exhausted-llm-output': {
    kind: 'forward',
    signature: 'question:string -> detail:object{ n:number }',
    features: nativeFeatures,
    forward_options: { max_retries: 0 },
    full_error: true,
    responses: [{ results: [{ index: 0, content: '{"detail":{"n":"x"}}' }] }],
  },
  'errors-multi-sample-exhausted-llm-output': {
    kind: 'forward',
    signature: 'question:string -> answer:string, score:number',
    forward_options: { max_retries: 0, sample_count: 2 },
    full_error: true,
    responses: [
      {
        results: [
          { index: 0, content: 'Answer: a\nScore: nope' },
          { index: 1, content: 'Answer: b\nScore: 2' },
        ],
      },
    ],
  },

  // ----- strictMode (a forward option) -----
  // Strict mode turns off the single-field assumption: an answer without its
  // label is a missing field.
  'strict-mode-unlabeled-exhausted': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    forward_options: { strict_mode: true, max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: 'ok' }] },
      { results: [{ index: 0, content: 'fine' }] },
    ],
  },
  'strict-mode-unlabeled-retry': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    forward_options: { strict_mode: true },
    responses: [
      { results: [{ index: 0, content: 'ok' }] },
      { results: [{ index: 0, content: 'Answer: ok' }] },
    ],
  },
  'streaming-forward-strict-mode-unlabeled-retry': {
    signature: 'question:string -> answer:string',
    forward_options: { strict_mode: true },
    responses: [
      streamed(text('o'), done('k')),
      streamed(text('Answer: o'), done('k')),
    ],
  },
  // strictMode given to the AxGen constructor applies unless the call
  // overrides it.
  'strict-mode-constructor-retry': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    options: { strict_mode: true },
    responses: [
      { results: [{ index: 0, content: 'ok' }] },
      { results: [{ index: 0, content: 'Answer: ok' }] },
    ],
  },
  'strict-mode-call-overrides-constructor': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    options: { strict_mode: true },
    forward_options: { strict_mode: false },
    responses: [{ results: [{ index: 0, content: 'ok' }] }],
  },
  // The first required field is the one strict mode asks for.
  'strict-mode-first-required-exhausted': {
    kind: 'forward',
    signature: 'question:string -> note?:string, answer:number',
    forward_options: { strict_mode: true, max_retries: 1 },
    responses: [
      { results: [{ index: 0, content: 'ok' }] },
      { results: [{ index: 0, content: 'fine' }] },
    ],
  },
  // A JSON object is not a label either: strict mode retries it.
  'strict-mode-json-object-retry': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    forward_options: { strict_mode: true },
    responses: [
      { results: [{ index: 0, content: '{"answer":"ok"}' }] },
      { results: [{ index: 0, content: 'Answer: ok' }] },
    ],
  },

  // ----- functionCot (a provider feature) -----
  // With functionCot and functions, leading unlabeled text (reasoning before
  // a tool call) is not streamed as the answer.
  'streaming-forward-function-cot-leading-text': {
    signature: 'question:string -> answer:string',
    features: { functions: true, function_cot: true },
    tools: [lookupTool],
    responses: [
      streamed(
        text('Let me '),
        text('look that up. '),
        chunk({
          function_calls: [call('call_1', 'lookup', '{"key":"a"}')],
          finish_reason: 'function_call',
        })
      ),
      streamed(text('Answer: done'), done()),
    ],
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

// ----- required inputs -----
// TS renders each input field through isProvidedValue (src/ax/dsp/prompt.ts):
// a required input that is missing, null, an empty string or an empty array
// fails the forward before any request with "Value for input field '<name>'
// is required."; a whitespace-only string is a value and renders as is; an
// optional input with an empty value is left out of the prompt.
const answeredOk: ResponseSpec = {
  results: [{ index: 0, content: 'Answer: ok' }],
};
const inputCases: Record<string, Case> = {
  'forward-required-input-empty-string': {
    kind: 'forward',
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a', second: '' },
    responses: [answeredOk],
  },
  'forward-required-input-missing': {
    kind: 'forward',
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a' },
    responses: [answeredOk],
  },
  'forward-required-input-null': {
    kind: 'forward',
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a', second: null },
    responses: [answeredOk],
  },
  'forward-required-input-empty-array': {
    kind: 'forward',
    signature: 'first:string, second:string[] -> answer:string',
    input: { first: 'a', second: [] },
    responses: [answeredOk],
  },
  'forward-required-input-whitespace': {
    kind: 'forward',
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a', second: '   ' },
    responses: [answeredOk],
    pin_user_prompt: true,
  },
  'forward-optional-input-empty-string': {
    kind: 'forward',
    signature: 'first:string, second?:string -> answer:string',
    input: { first: 'a', second: '' },
    responses: [answeredOk],
    pin_user_prompt: true,
  },
  // A stream fails the same way, before any delta.
  'streaming-forward-required-input-empty-string': {
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a', second: '' },
    responses: [streamed(text('Answer: ok'), done())],
  },
  'streaming-forward-required-input-missing': {
    signature: 'first:string, second:string -> answer:string',
    input: { first: 'a' },
    responses: [streamed(text('Answer: ok'), done())],
  },
};

for (const [name, spec] of Object.entries(inputCases)) {
  await record(name, spec);
}

// ----- native chat sessions -----
// A session-capable client (asyncTools with openChatSession) under a run
// control. TS opens a fresh session for each model request and closes it once
// that request's response completes: a correction or a feedback step opens a
// new session with the whole prompt, and each session applies the run's
// updates again. A session's partial `response` events stream like a plain
// stream on their own state; a later response starts a new version, and the
// completed response adds what the partial events did not.
const sessionPartial = (id: string, fields: JsonMap): SessionEventSpec => ({
  type: 'response',
  response_id: id,
  results: [{ index: 0, ...fields }],
});
const sessionCompleted = (id: string, fields: JsonMap): SessionEventSpec => ({
  type: 'response.completed',
  response_id: id,
  results: [{ index: 0, ...fields }],
});
const sessionAnswer = (id: string, content: string): SessionEventSpec =>
  sessionCompleted(id, { content, finish_reason: 'stop' });
const mustBeParis: AssertSpec = {
  field: 'answer',
  contains: 'Paris',
  message: 'The answer must be Paris.',
};
const lookupCall = sessionCompleted('r1', {
  function_calls: [call('c1', 'lookup', '{"key":"status"}')],
});

// A session of `calls` sequential lookup responses, then a final answer.
const toolLoopSession = (
  calls: number,
  answer: string
): SessionEventSpec[][] => [
  ...Array.from({ length: calls }, (_, i) => [
    sessionCompleted(`r${i + 1}`, {
      function_calls: [call(`c${i + 1}`, 'lookup', '{"key":"status"}')],
    }),
  ]),
  [sessionAnswer(`r${calls + 1}`, answer)],
];

const sessionCases: Record<string, Case> = {
  // A request's session may make maxSteps (25) minus the step's index
  // responses: 11 complete, and the 25th with work fails the run with TS's
  // message instead of continuing.
  'forward-native-session-response-budget-completes': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [toolLoopSession(10, 'Answer: done')],
    responses: [],
  },
  'forward-native-session-response-budget-exhausted': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [toolLoopSession(25, 'Answer: done')],
    responses: [],
  },
  // A later step's session has one response fewer: after a feedback step
  // (step 1), 24 lookups exhaust it.
  'forward-native-session-response-budget-later-step': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    feedback_processors: [{ field: 'answer', returns: 'Check it.', times: 1 }],
    native_session: [
      [[sessionAnswer('r0', 'Answer: Lyon')]],
      toolLoopSession(24, 'Answer: Paris'),
    ],
    responses: [],
  },
  'forward-native-session-correction-opens-fresh-session': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    assertions: [mustBeParis],
    native_session: [
      [[sessionAnswer('r1', 'Answer: Lyon')]],
      [[sessionAnswer('r2', 'Answer: Paris')]],
    ],
    responses: [],
    request_tail: 2,
  },
  'forward-native-session-feedback-opens-fresh-session': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    feedback_processors: [{ field: 'answer', returns: 'Check it.', times: 1 }],
    native_session: [
      [[sessionAnswer('r1', 'Answer: Lyon')]],
      [[sessionAnswer('r2', 'Answer: Paris')]],
    ],
    responses: [],
    request_tail: 2,
  },
  'forward-native-session-tool-stays-in-session': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [[[lookupCall], [sessionAnswer('r2', 'Answer: green')]]],
    responses: [],
  },
  // A call whose arguments fail the tool's JSON schema is not run: TS's
  // axValidateToolArguments lists each bad argument, and the session gets
  // the fixing instructions as the call's error result, then goes on.
  'forward-native-session-tool-invalid-arguments': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [describedLookupTool],
    native_session: [
      [
        [
          sessionCompleted('r1', {
            function_calls: [call('c1', 'lookup', '{"key":7}')],
          }),
        ],
        [sessionAnswer('r2', 'Answer: green')],
      ],
    ],
    responses: [],
    pin_session_results: true,
  },
  'forward-native-session-tool-missing-argument': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [describedLookupTool],
    native_session: [
      [
        [
          sessionCompleted('r1', {
            function_calls: [call('c1', 'lookup', '{}')],
          }),
        ],
        [sessionAnswer('r2', 'Answer: green')],
      ],
    ],
    responses: [],
    pin_session_results: true,
  },
  'forward-native-session-tool-results-pinned': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [[[lookupCall], [sessionAnswer('r2', 'Answer: green')]]],
    responses: [],
    pin_session_results: true,
  },
  // A tool that runs in a native session gets the run's extras too.
  'forward-native-session-tool-extras': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [extrasLookupTool],
    forward_options: {
      sessionId: 'session-1',
      eventContext: eventContextSample,
    },
    native_session: [[[lookupCall], [sessionAnswer('r2', 'Answer: green')]]],
    responses: [],
  },
  // A correction's fresh session gets the whole conversation, the first
  // session's tool call and result included.
  'forward-native-session-tool-then-correction': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    tools: [lookupTool],
    assertions: [mustBeParis],
    native_session: [
      [[lookupCall], [sessionAnswer('r2', 'Answer: Lyon')]],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
    request_tail: 2,
  },
  'forward-native-session-steer-each-session': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    control_steer: { during_request: 1, text: 'Be brief.' },
    assertions: [mustBeParis],
    native_session: [
      [
        [sessionAnswer('r1', 'Answer: Lyon')],
        [sessionAnswer('r1b', 'Answer: Lyon')],
      ],
      [
        [sessionAnswer('r2', 'Answer: Paris')],
        [sessionAnswer('r2b', 'Answer: Paris')],
      ],
    ],
    responses: [],
    request_tail: 2,
  },
  // A forward with stream: true returns the completed response's output
  // once, however the session's partial events split it.
  'forward-native-session-stream-option': {
    kind: 'forward',
    signature: 'question:string -> answer:string, reason:string',
    control: true,
    forward_options: { stream: true },
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Pa' }),
          sessionPartial('r1', { content: 'ris\nRea' }),
          sessionPartial('r1', { content: 'son: big ' }),
          sessionPartial('r1', { content: 'city' }),
          sessionAnswer('r1', 'Answer: Paris\nReason: big city'),
        ],
      ],
    ],
    responses: [],
  },
  // A forward does not stream, so streaming assertions do not apply.
  'forward-native-session-no-streaming-assertions': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    streaming_assertions: [
      { field: 'answer', not_contains: 'BAD', message: 'No BAD.' },
    ],
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: BA' }),
          sessionPartial('r1', { content: 'D' }),
          sessionAnswer('r1', 'Answer: BAD'),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-partials-correction': {
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    assertions: [mustBeParis],
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Ly' }),
          sessionPartial('r1', { content: 'on' }),
          sessionAnswer('r1', 'Answer: Lyon'),
        ],
      ],
      [
        [
          sessionPartial('r2', { content: 'Answer: Pa' }),
          sessionPartial('r2', { content: 'ris' }),
          sessionAnswer('r2', 'Answer: Paris'),
        ],
      ],
    ],
    responses: [],
    request_tail: 2,
  },
  'streaming-forward-native-session-completed-only-correction': {
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    assertions: [mustBeParis],
    native_session: [
      [[sessionAnswer('r1', 'Answer: Lyon')]],
      [[sessionAnswer('r2', 'Answer: Paris')]],
    ],
    responses: [],
  },
  'streaming-forward-native-session-tool-response-new-version': {
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [[[lookupCall], [sessionAnswer('r2', 'Answer: green')]]],
    responses: [],
  },
  'streaming-forward-native-session-provisional-then-final': {
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Work' }),
          sessionPartial('r1', { content: 'ing' }),
          sessionCompleted('r1', {
            content: 'Answer: Working',
            function_calls: [call('c1', 'lookup', '{"key":"status"}')],
          }),
        ],
        [
          sessionPartial('r2', { content: 'Answer: gr' }),
          sessionPartial('r2', { content: 'een' }),
          sessionAnswer('r2', 'Answer: green'),
        ],
      ],
    ],
    responses: [],
  },
  // A streamed correction's fresh session gets the first session's tool call
  // and result too.
  'forward-native-session-tool-result-format': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [{ ...lookupTool, result: { a: [2], b: 1, c: null } }],
    assertions: [mustBeParis],
    pin_function_results: true,
    native_session: [
      [[lookupCall], [sessionAnswer('r2', 'Answer: Lyon')]],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
  },
  'forward-native-session-tool-result-call-formatter': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [{ ...lookupTool, result: { a: [2], b: 1, c: null } }],
    assertions: [mustBeParis],
    call_function_result_formatter: { text: 'custom result' },
    pin_function_results: true,
    native_session: [
      [[lookupCall], [sessionAnswer('r2', 'Answer: Lyon')]],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
  },
  'forward-native-session-tool-result-formatter-throws': {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [{ ...lookupTool, result: { a: [2], b: 1, c: null } }],
    assertions: [mustBeParis],
    call_function_result_formatter: { throws: 'formatter broke' },
    native_session: [
      [[lookupCall], [sessionAnswer('r2', 'Answer: Lyon')]],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
  },
  'streaming-native-session-tool-result-format': {
    kind: 'streaming_forward',
    signature: 'question:string -> answer:string',
    control: true,
    tools: [{ ...lookupTool, result: { a: [2], b: 1, c: null } }],
    assertions: [mustBeParis],
    pin_function_results: true,
    native_session: [
      [[lookupCall], [sessionAnswer('r2', 'Answer: Lyon')]],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
  },
  'streaming-forward-native-session-tool-then-correction': {
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    tools: [lookupTool],
    assertions: [mustBeParis],
    native_session: [
      [
        [lookupCall],
        [
          sessionPartial('r2', { content: 'Answer: Ly' }),
          sessionPartial('r2', { content: 'on' }),
          sessionAnswer('r2', 'Answer: Lyon'),
        ],
      ],
      [[sessionAnswer('r3', 'Answer: Paris')]],
    ],
    responses: [],
    request_tail: 2,
  },
  'streaming-forward-native-session-label-split': {
    signature: 'question:string -> answer:string, reason:string',
    control: true,
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Pa' }),
          sessionPartial('r1', { content: 'ris\nRea' }),
          sessionPartial('r1', { content: 'son: big ' }),
          sessionPartial('r1', { content: 'city' }),
          sessionAnswer('r1', 'Answer: Paris\nReason: big city'),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-thought-first': {
    signature: 'question:string -> answer:string',
    control: true,
    native_session: [
      [
        [
          sessionPartial('r1', { thought: 'Think' }),
          sessionPartial('r1', { thought: 'ing', content: 'Answer: Pa' }),
          sessionPartial('r1', { content: 'ris' }),
          sessionCompleted('r1', {
            thought: 'Thinking',
            content: 'Answer: Paris',
            finish_reason: 'stop',
          }),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-completed-thought': {
    signature: 'question:string -> answer:string',
    control: true,
    native_session: [
      [
        [
          sessionCompleted('r1', {
            thought: 'Thinking',
            content: 'Answer: Paris',
            finish_reason: 'stop',
          }),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-divergent-completion': {
    signature: 'question:string -> answer:string',
    control: true,
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Lyon' }),
          sessionAnswer('r1', 'Answer: Paris'),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-streaming-assertion-retry': {
    signature: 'question:string -> answer:string',
    input: { question: 'Capital of France?' },
    control: true,
    streaming_assertions: [
      { field: 'answer', not_contains: 'BAD', message: 'No BAD.' },
    ],
    native_session: [
      [
        [
          sessionPartial('r1', { content: 'Answer: Ly' }),
          sessionPartial('r1', { content: 'on BAD' }),
          sessionAnswer('r1', 'Answer: Lyon BAD'),
        ],
      ],
      [[sessionAnswer('r2', 'Answer: Paris')]],
    ],
    responses: [],
    request_tail: 3,
  },
  // Once a tool has run in the session, a failed streaming assertion fails
  // the run instead of replaying the tool in a fresh session.
  'streaming-forward-native-session-assertion-after-tool-fails': {
    signature: 'question:string -> answer:string',
    control: true,
    tools: [lookupTool],
    streaming_assertions: [
      { field: 'answer', not_contains: 'BAD', message: 'No BAD.' },
    ],
    native_session: [
      [
        [lookupCall],
        [
          sessionPartial('r2', { content: 'Answer: BA' }),
          sessionPartial('r2', { content: 'D' }),
          sessionAnswer('r2', 'Answer: BAD'),
        ],
      ],
    ],
    responses: [],
  },
  'streaming-forward-native-session-structured': {
    signature: 'question:string -> user:object{name:string}, tags:string[]',
    features: nativeFeatures,
    control: true,
    native_session: [
      [
        [
          sessionPartial('r1', { content: '{"user":{"na' }),
          sessionPartial('r1', { content: 'me":"Ada"},"tags":["a"' }),
          sessionPartial('r1', { content: ',"b"]}' }),
          sessionAnswer('r1', '{"user":{"name":"Ada"},"tags":["a","b"]}'),
        ],
      ],
    ],
    responses: [],
  },
};

for (const [name, spec] of Object.entries(sessionCases)) {
  await record(name, spec);
}

// TS checks a response's function calls before any function runs: a
// forward's in AxMemory.addResponse, a stream's merged calls once the stream
// ends. A call whose name is missing, null, empty or blank fails the run at
// once ("Function call at index 0 in result 0 must have a non-empty function
// name, received: ..."), with no retry and no second request. The ports do
// the same with functionCallValidation: 'fail'; their default still corrects
// the call this release (the port-only fixtures after this loop).
for (const [label, name] of [
  ['missing', undefined],
  ['null', null],
  ['empty', ''],
  ['blank', '  '],
] as const) {
  const fnPart: JsonMap = { params: '{"key":"a"}' };
  if (name !== undefined) fnPart.name = name;
  const unnamed: JsonMap = { id: 'call_1', type: 'function', function: fnPart };
  await record(`function-call-${label}-name`, {
    kind: 'forward',
    signature: 'question:string -> answer:string',
    tools: [lookupTool],
    port_forward_options: { function_call_validation: 'fail' },
    responses: [
      {
        results: [
          {
            index: 0,
            content: '',
            function_calls: [unnamed],
            finish_reason: 'function_call',
          },
        ],
      },
      { results: [{ index: 0, content: 'Answer: done' }] },
    ],
  });
  await record(`streaming-forward-function-call-${label}-name`, {
    signature: 'question:string -> answer:string',
    tools: [lookupTool],
    port_forward_options: { function_call_validation: 'fail' },
    responses: [
      streamed(
        chunk({ function_calls: [unnamed], finish_reason: 'function_call' })
      ),
      streamed(text('Answer: done'), done()),
    ],
  });
}

// Port-only: without functionCallValidation, the ports keep this release's
// correction for a call without a name. It runs as an unknown function, so
// the model gets the "Function not found" correction and another request, and
// a one-time deprecation warning names the option. An explicit 'correct'
// keeps the correction without the warning, and any other value fails. TS has
// no such path: it fails at once, as above.
const namelessCall: JsonMap = {
  id: 'call_1',
  type: 'function',
  function: { params: '{"key":"a"}' },
};
const namelessResponses: ResponseSpec[] = [
  {
    results: [
      {
        index: 0,
        content: '',
        function_calls: [namelessCall],
        finish_reason: 'function_call',
      },
    ],
  },
  { results: [{ index: 0, content: 'Answer: done' }] },
];
const namelessCorrection =
  'Function not found: null. Available functions: lookup. Call one of these exact function names.';
const namelessWarning =
  "A model function call without a name gets a correction and another request; TypeScript Ax fails the forward at once. Pass functionCallValidation: 'fail' to fail it now, or functionCallValidation: 'correct' to keep the correction. Failing becomes the default in the next major version.";
const correctedFixture = {
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  tools: [lookupTool],
  expected_output: { answer: 'done' },
  expected_tool_calls: [],
  expected_request_count: 2,
  expected_request_contains: [namelessCorrection],
};
writeFixture('function-call-missing-name-corrected', {
  kind: 'forward',
  ...correctedFixture,
  responses: namelessResponses,
  expected_deprecations: [namelessWarning],
});
writeFixture('streaming-forward-function-call-missing-name-corrected', {
  kind: 'streaming_forward',
  ...correctedFixture,
  responses: namelessResponses.map((response) => ({
    stream: [
      ...(response as { results: JsonMap[] }).results.map((result) => ({
        results: [result],
      })),
    ],
  })),
  expected_deltas: [{ version: 0, index: 0, delta: { answer: 'done' } }],
  expected_deprecations: [namelessWarning],
});
writeFixture('function-call-missing-name-correct-explicit', {
  kind: 'forward',
  ...correctedFixture,
  forward_options: { function_call_validation: 'correct' },
  responses: namelessResponses,
  expected_deprecations: [],
});
writeFixture('function-call-validation-unknown-value', {
  kind: 'forward',
  signature: 'question:string -> answer:string',
  input: { question: 'Status?' },
  tools: [lookupTool],
  forward_options: { function_call_validation: 'strict' },
  responses: namelessResponses,
  expected_error_contains:
    "functionCallValidation must be 'correct' or 'fail', received: \"strict\"",
  expected_tool_calls: [],
  expected_request_count: 1,
});
