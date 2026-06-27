---
name: ax-agent-observability
description: This skill helps an LLM generate correct AxAgent observability code using @ax-llm/ax. Use when the user asks about actorTurnCallback, onContextEvent, agentStatusCallback, onFunctionCall, reportSuccess, reportFailure, getChatLog(), getUsage(), resetUsage(), debug traces, progress updates, or telemetry for AxAgent runs.
version: "22.0.7"
---

# AxAgent Observability Rules (@ax-llm/ax)

Use this skill when an agent needs runtime visibility, progress reporting, tracing, usage accounting, or chat-log access. For ordinary agent setup use `ax-agent`. For RLM runtime policy use `ax-agent-rlm`. For memories and dynamic skill loading use `ax-agent-memory-skills`.

## Choose The Smallest Hook

- Need a quick prompt/runtime trace during development -> start with `debug: true`.
- Need structured per-turn code, raw runtime result, formatted output, provider thoughts, or actor stage -> use `actorTurnCallback`.
- Need context-pressure and compaction telemetry -> use `onContextEvent`.
- Need real-time task progress emitted by actor code -> use `agentStatusCallback`.
- Need every runtime function call before execution -> use `onFunctionCall`.
- Need model prompts/responses after a run -> use `getChatLog()`.
- Need token usage by actor/responder -> use `getUsage()` and `resetUsage()`.
- Need usage split by context and task stages -> use `getStagedUsage()`.
- Need Ax program traces -> use `getTraces()`.
- Do not add multiple hooks unless the user clearly needs each output stream.

## Global Runtime Defaults

OpenTelemetry and debug defaults come from the shared Ax runtime surface:

```typescript
import { axGlobals, axCreateDefaultColorLogger } from '@ax-llm/ax';
import { trace } from '@opentelemetry/api';

axGlobals.tracer = trace.getTracer('agent-app');
axGlobals.debug = true;
axGlobals.logger = axCreateDefaultColorLogger();
```

These globals are live defaults for future AI, AxGen, AxFlow, and agent-internal model calls. Per-call or explicitly configured options still override `axGlobals`. Use AxAgent callbacks below when the caller needs structured agent-turn events rather than OpenTelemetry spans or debug logs.

## Actor Turn Callback

Use `actorTurnCallback` when the caller needs structured telemetry for each actor turn.

What it gives you:

- `code`: the normalized JavaScript code the actor produced
- `stage`: which actor produced the turn (`distiller` or `executor`)
- `result`: the raw untruncated runtime return value from executing that code
- `output`: the formatted action-log output string after Ax normalizes and truncates it for prompt replay
- `thought`: the actor model's `thought` field when `showThoughts` is enabled and the provider returns one
- `executorResult`: the full actor payload returned by the current actor stage, kept under this historical field name for compatibility
- `isError`: whether the execution path for that turn was treated as an error
- `usage`: token usage for this actor turn only
- `model`: model used for this turn when explicitly set through `executorModelPolicy`
- `chatLogMessages`: raw ChatML conversation for this turn, populated only when an actor turn callback is set

Use it for:

- debug UIs that want to show code plus raw runtime results
- tracing and analytics
- capturing `thought` for internal diagnostics when supported by the provider
- storing per-turn execution artifacts without scraping the prompt/action log

Important:

- `output` is not raw stdout; it is the formatted replay string used in the action log.
- `result` is the raw runtime result before Ax applies type-aware serialization and budget-proportional truncation.
- `thought` is optional and only appears when the underlying `AxGen` call had `showThoughts` enabled and the provider actually returned a thought field.
- `actionLogEntryCount` and `guidanceLogEntryCount` reflect the live log sizes after the turn is processed, including resumed runs.
- `actorTurnCallback` fires for the configured agent instance. Child agents passed through `functions: [...]` should define their own callback if you need their internal actor turns; use `onFunctionCall` on the parent to observe the parent-side child-agent invocation.

Good pattern:

```typescript
const supportAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  actorTurnCallback: ({
    stage,
    turn,
    actionLogEntryCount,
    guidanceLogEntryCount,
    code,
    result,
    output,
    thought,
    isError,
    usage,
    model,
  }) => {
    console.log({
      turn,
      stage,
      model,
      actionLogEntryCount,
      guidanceLogEntryCount,
      isError,
      code,
      rawResult: result,
      replayOutput: output,
      thought,
      usage,
    });
  },
  executorOptions: {
    model: 'gpt-5.4-mini',
    showThoughts: true,
  },
});
```

Callback type:

```typescript
actorTurnCallback?: (turn: {
  stage: 'distiller' | 'executor';
  turn: number;
  actionLogEntryCount: number;
  guidanceLogEntryCount: number;
  executorResult: Record<string, unknown>;
  code: string;
  result: unknown;
  output: string;
  isError: boolean;
  thought?: string;
  usage?: AxProgramUsage[];
  model?: string;
  chatLogMessages?: ReadonlyArray<{ role: string; content: string }>;
}) => void | Promise<void>;

actorTurnCallback?: (turn: {
  stage: 'distiller' | 'executor';
  turn: number;
  actionLogEntryCount: number;
  guidanceLogEntryCount: number;
  executorResult: Record<string, unknown>;
  code: string;
  result: unknown;
  output: string;
  isError: boolean;
  thought?: string;
  usage?: AxProgramUsage[];
  model?: string;
  chatLogMessages?: ReadonlyArray<{ role: string; content: string }>;
}) => void | Promise<void>; // deprecated alias
```

## Context Event Observability

Use `onContextEvent` when the caller needs structured telemetry about prompt pressure and compaction. It does not change model behavior directly; it is for logs, evals, and dashboards.

Events:

- `budget_check`: character-based prompt pressure before an actor turn, with detailed metrics kept out of the actor prompt
- `checkpoint_created` / `checkpoint_cleared`: checkpoint lifecycle events with covered turns and reason
- `tombstone_created`: compact resolved-error summary creation

Rules:

- `contextPressure` in the actor prompt is intentionally compact (`ok`, `watch`, `critical` plus one short instruction).
- Budget metrics are character-based for provider neutrality and are exposed through `onContextEvent`, not the actor prompt.
- Callback errors are swallowed so telemetry cannot break the agent run.
- Do not scrape actor prompts for pressure metrics.

```typescript
const supportAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
  onContextEvent: (event) => {
    if (event.kind === 'budget_check') {
      console.log(event.pressure, event.mutablePromptChars);
    }
  },
});
```

Type:

```typescript
onContextEvent?: (event: AxAgentContextEvent) => void | Promise<void>;
```

## Agent Status Callback

Use `agentStatusCallback` when the caller wants real-time progress updates from the actor. When set, the actor can call `await reportSuccess(message)` and `await reportFailure(message)` in its JavaScript turns.

```typescript
const supportAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  agentStatusCallback: (message, status) => {
    console.log(`[${status}] ${message}`);
  },
});
```

Rules:

- `agentStatusCallback` receives `(message: string, status: 'success' | 'failed')`.
- When set, the actor prompt automatically includes `reportSuccess(message)` and `reportFailure(message)` as available runtime functions.
- The actor is instructed to keep the user updated on task progress.
- `reportSuccess` and `reportFailure` are reserved runtime names when the callback is configured.
- Child agents inherit the callback via the RLM config.

Type:

```typescript
agentStatusCallback?: (
  message: string,
  status: 'success' | 'failed'
) => void | Promise<void>;
```

## On Function Call

Use `onFunctionCall` when the caller wants to observe every function call the actor makes from the JS runtime. It fires before the underlying function runs.

```typescript
const supportAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  functions: [helperAgent, lookupOrderTool],
  onFunctionCall: ({ name, qualifiedName, args, kind }) => {
    console.log(`[${kind}] ${qualifiedName}`, args);
  },
});
```

Rules:

- Receives `{ name, qualifiedName, args, kind }`.
- `name` is the bare function name, e.g. `'lookupOrder'`.
- `qualifiedName` is the namespaced name as the actor sees it, e.g. `'tools.lookupOrder'`; for un-namespaced runtime globals it equals `name`.
- `args` is the resolved positional/named arguments object (`Record<string, unknown>`).
- `kind` is `'external'` for caller-registered `functions`.
- `kind` is `'internal'` for agent-injected globals: child agents, `discover`, `recall`, and `used`.
- Fires once per call, before the function executes.
- Errors thrown inside the callback are swallowed so they cannot break the actor loop.
- This is independent from the DSP-layer `onFunctionCall` on `AxProgramForwardOptions`; that hook is for LLM tool-calls and never fires under AxAgent because AxAgent injects functions as runtime globals.

Type:

```typescript
onFunctionCall?: (call: {
  name: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  kind: 'internal' | 'external';
}) => void | Promise<void>;
```

## Chat Log, Usage, And Traces

`AxAgent` exposes actor and responder sub-programs. `getChatLog()` returns the same flat `AxChatLogEntry[]` shape as `AxGen` and `AxFlow`; use each entry's optional `name` field to distinguish `distiller`, `executor`, and `responder`. `getUsage()` returns token usage split by actor/responder.

### getChatLog()

Returns the full normalized chat history after any `.forward()` call. Each entry is one `ai.chat()` round-trip. Actor stages accumulate one entry per turn; the responder typically has one entry.

```typescript
const log = myAgent.getChatLog();

for (const entry of log) {
  console.log(entry.name, entry.model);
  for (const msg of entry.messages) {
    console.log(`[${msg.role}]`, msg.content);
  }
}
```

Each `AxChatLogEntry` captures the full prompt sent to the model and its response:

```typescript
type AxChatLogMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; name: string; content: string };

type AxChatLogEntry = {
  name?: string; // e.g. "distiller", "executor", "responder"
  model: string;
  messages: AxChatLogMessage[];
  modelUsage?: AxProgramUsage;
  stage?: 'ctx' | 'task';
};
```

### getUsage()

Returns token usage split by actor/responder. Each sub-array contains one `AxProgramUsage` entry per model/run, merged by `(ai, model)` key.

```typescript
const usage = myAgent.getUsage();
// { actor: AxProgramUsage[], responder: AxProgramUsage[] }

console.log('Actor tokens:', usage.actor[0]?.tokens);
console.log('Responder tokens:', usage.responder[0]?.tokens);
```

### getStagedUsage()

Returns usage split by pipeline stage. The `ctx` stage has the distiller actor only; the `task` stage has the executor actor plus responder.

```typescript
const staged = myAgent.getStagedUsage();
console.log(staged.ctx?.actor);
console.log(staged.task.actor);
console.log(staged.task.responder);
```

### getTraces()

Returns Ax program traces for the agent pipeline. Use it when the caller needs trace data rather than chat messages or token summaries.

```typescript
const traces = myAgent.getTraces();
```

### resetUsage()

Resets both actor and responder usage at once:

```typescript
myAgent.resetUsage();
```

Type signatures:

```typescript
// AxAgent
agent.getChatLog(): readonly AxChatLogEntry[]
agent.getUsage(): { actor: AxProgramUsage[]; responder: AxProgramUsage[] }
agent.getStagedUsage(): { ctx?: AxAgentUsage; task: AxAgentUsage }
agent.getTraces(): AxProgramTrace[]
agent.resetUsage(): void

// AxGen / AxFlow
gen.getChatLog(): readonly AxChatLogEntry[]
gen.getUsage(): AxProgramUsage[]
```

## Do Not Generate

- Do not add both `debug: true` and `actorTurnCallback` unless the user wants both unstructured prompt/runtime visibility and structured telemetry.
- Do not scrape actor prompts or action logs when a callback exposes the data directly.
- Do not let observability callback failures break the agent run; Ax swallows callback errors for telemetry hooks.
- Do not use DSP-layer `onFunctionCall` when the user wants AxAgent runtime function calls.
- Do not enable `showThoughts` unless the user needs provider thought diagnostics and the provider supports it.
