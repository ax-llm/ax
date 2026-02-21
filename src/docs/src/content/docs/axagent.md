---
title: 'AxAgent Guide'
description: 'Agent framework with child agents, tools, and RLM for long contexts'
---

# AxAgent Guide

`AxAgent` is the agent framework in Ax. It wraps `AxGen` with support for child agents, tool use, and **RLM (Recursive Language Model)** mode for processing long contexts through runtime-backed code execution.

Use `AxAgent` when you need:

- Multi-step reasoning with tools
- Composing multiple agents into a hierarchy
- Processing long documents without context window limits (RLM mode)

For single-step generation without tools or agents, use [`AxGen`](/axgen/) directly.

## Creating Agents

Use the `agent()` factory function with a string signature:

```typescript
import { agent, ai } from '@ax-llm/ax'

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! })

const myAgent = agent('userQuestion:string -> responseText:string', {
  agentIdentity: {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
  },
})

const result = await myAgent.forward(llm, {
  userQuestion: 'What is TypeScript?',
})
console.log(result.responseText)
```

The `agent()` function accepts both string signatures and `AxSignature` objects:

```typescript
import { agent, s } from '@ax-llm/ax'

const sig = s('userQuestion:string -> responseText:string')
const myAgent = agent(sig, {
  agentIdentity: {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
  },
})
```

## Agent Options

The `agent()` factory accepts a configuration object:

```typescript
const myAgent = agent('input:string -> output:string', {
  // Agent identity (required when used as a child agent)
  agentIdentity: {
    name: 'myAgent', // Agent name (converted to camelCase)
    description: 'Does something useful and interesting with inputs',
  },

  // Optional
  ai: llm, // Bind a specific AI service
  functions: [searchTool, calcTool], // Tool functions
  agents: [childAgent1, childAgent2], // Child agents
  maxSteps: 25, // Max reasoning steps (default: 25)
  maxRetries: 3, // Retries on assertion failures
  temperature: 0.7, // Sampling temperature
  debug: false, // Debug logging

  // RLM mode (see RLM section below)
  contextFields: ['context'], // Fields to load into runtime session
  runtime: new AxJSRuntime(), // Code runtime (default: AxJSRuntime)
  maxLlmCalls: 30, // Cap on sub-LM calls (default: 50)
  // ... and other RLM fields as top-level properties
})
```

### `agentIdentity`

Required when the agent is used as a child agent. Contains `name` (converted to camelCase for the function name, e.g. `'Physics Researcher'` becomes `physicsResearcher`) and `description` (shown to parent agents when they decide which child to call).

### `functions`

An array of tool functions the agent can call. Each function has a name, description, JSON Schema parameters, and an implementation.

### `agents`

An array of child agents. When provided, the agent can delegate subtasks to these children. See [Child Agents](#child-agents).

## Running Agents

### `forward()`

Run the agent and get the final result:

```typescript
const result = await myAgent.forward(llm, { userQuestion: 'Hello' })
console.log(result.responseText)
```

If the agent was created with `ai` bound, the parent AI is used as fallback:

```typescript
const myAgent = agent('input:string -> output:string', {
  agentIdentity: {
    name: 'myAgent',
    description: 'An agent that processes inputs reliably',
  },
  ai: llm, // Bound AI service
})

// Can also pass a different AI to override
const result = await myAgent.forward(differentLlm, { input: 'test' })
```

### `streamingForward()`

Stream partial results as they arrive:

```typescript
const stream = myAgent.streamingForward(llm, { userQuestion: 'Write a story' })

for await (const chunk of stream) {
  if (chunk.delta.responseText) {
    process.stdout.write(chunk.delta.responseText)
  }
}
```

### Forward Options

Both `forward` and `streamingForward` accept an options object as the third argument:

```typescript
const result = await myAgent.forward(llm, values, {
  model: 'smart', // Override model
  maxSteps: 10, // Override max steps
  debug: true, // Enable debug logging
  functions: [extraTool], // Additional tools (merged with agent's tools)
  thinkingTokenBudget: 'medium',
  abortSignal: controller.signal, // Cancel via AbortSignal
})
```

## Stopping Agents

`AxAgent`, `AxGen`, and `AxFlow` support two ways to stop an in-flight `forward()` or `streamingForward()` call. Both cause the call to throw `AxAIServiceAbortedError`, which you handle with try/catch.

### `stop()` method

Call `stop()` from any context — a timer, event handler, or another async task — to halt the multi-step loop. `stop()` aborts all in-flight calls started by the same `AxAgent` instance (including retry backoff waits), and the loop throws `AxAIServiceAbortedError`.

```typescript
const myAgent = agent('question:string -> answer:string', {
  agentIdentity: {
    name: 'myAgent',
    description: 'An agent that answers questions thoroughly',
  },
})

// Stop after 5 seconds
const timer = setTimeout(() => myAgent.stop(), 5_000)

try {
  const result = await myAgent.forward(llm, {
    question: 'Explain quantum gravity',
  })
  console.log(result.answer)
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Agent was stopped')
  } else {
    throw err
  }
} finally {
  clearTimeout(timer)
}
```

`stop()` is also available on `AxGen` and `AxFlow` instances:

```typescript
const gen = ax('topic:string -> summary:string')
setTimeout(() => gen.stop(), 3_000)

try {
  const result = await gen.forward(llm, { topic: 'Climate change' })
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Generation was stopped')
  }
}
```

### Using `AbortSignal`

Pass an `abortSignal` in the forward options to cancel via the standard `AbortController` / `AbortSignal` API. The signal is checked between each step of the multi-step loop, not only during the HTTP call, so cancellation is detected promptly even when the agent is between LLM calls.

```typescript
// Time-based deadline
try {
  const result = await myAgent.forward(llm, values, {
    abortSignal: AbortSignal.timeout(10_000), // 10-second deadline
  })
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Timed out')
  }
}

// Manual controller
const controller = new AbortController()
onUserCancel(() => controller.abort())

try {
  const result = await myAgent.forward(llm, values, {
    abortSignal: controller.signal,
  })
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Cancelled by user')
  }
}
```

## Child Agents

Agents can compose other agents as children. The parent agent sees each child as a callable function and decides when to invoke it.

```typescript
const researcher = agent(
  'question:string, physicsQuestion:string -> answer:string',
  {
    agentIdentity: {
      name: 'Physics Researcher',
      description:
        'Researcher for physics questions can answer questions about advanced physics',
    },
  }
)

const summarizer = agent('answer:string -> shortSummary:string', {
  agentIdentity: {
    name: 'Science Summarizer',
    description:
      'Summarizer can write short summaries of advanced science topics',
  },
})
summarizer.setActorDescription(
  'You are a science summarizer. You can write short summaries of advanced science topics. Use numbered bullet points to summarize the answer in order of importance.'
)

const scientist = agent('question:string -> answer:string', {
  agentIdentity: {
    name: 'Scientist',
    description: 'An agent that can answer advanced science questions',
  },
  agents: [researcher, summarizer],
})

const result = await scientist.forward(llm, {
  question: 'Why is gravity not a real force?',
})
```

### Value Passthrough

When a parent and child agent share input field names, the parent automatically passes those values to the child. For example, if the parent has `question:string` and a child also expects `question:string`, the parent's value is injected automatically — the LLM doesn't need to re-type it.

## RLM Mode

**RLM (Recursive Language Model)** mode lets agents process arbitrarily long documents without hitting context window limits. Instead of stuffing the entire document into the LLM prompt, RLM loads it into a code interpreter session and gives the LLM tools to analyze it programmatically.

### The Problem

When you pass a long document to an LLM, you face:

- **Context window limits** — the document may not fit
- **Context rot** — accuracy degrades as context grows
- **Cost** — long prompts are expensive

### How It Works

1. **Context extraction** — Fields listed in `contextFields` are removed from the LLM prompt and loaded into a runtime session as variables.
2. **Actor/Responder split** — The agent uses two internal programs:
   - **Actor** — A code generation agent that writes JavaScript to analyze context data. It NEVER generates final answers directly.
   - **Responder** — An answer synthesis agent that produces the final answer from the Actor's `actorResult` payload. It NEVER generates code.
3. **Recursive queries** — Inside code, `llmQuery(...)` delegates semantic work to a sub-query (plain AxGen in simple mode, full AxAgent in advanced mode).
4. **Completion** — The Actor signals completion by calling `submit(...args)` or asks for more user input with `ask_clarification(...args)`, then the Responder synthesizes the final answer.

The Actor writes JavaScript code to inspect, filter, and iterate over the document. It uses `llmQuery` for semantic analysis and can chunk data in code before querying.

### Configuration

```typescript
import { agent, ai } from '@ax-llm/ax'

const analyzer = agent(
  'context:string, query:string -> answer:string, evidence:string[]',
  {
    agentIdentity: {
      name: 'documentAnalyzer',
      description:
        'Analyzes long documents using code interpreter and sub-LM queries',
    },
    contextFields: ['context'], // Fields to load into runtime session
    runtime: new AxJSRuntime(), // Code runtime (default: AxJSRuntime)
    maxLlmCalls: 30, // Cap on sub-LM calls (default: 50)
    maxRuntimeChars: 2_000, // Cap for llmQuery context + code output (default: 5000)
    maxBatchedLlmQueryConcurrency: 6, // Max parallel batched llmQuery calls (default: 8)
    maxTurns: 10, // Max Actor turns before forcing Responder (default: 10)
    compressLog: true, // Store actionDescription in actionLog instead of full code
    actorFields: ['reasoning'], // Output fields produced by Actor instead of Responder
    actorCallback: async (result) => {
      // Called after each Actor turn
      console.log('Actor turn:', result)
    },
    mode: 'simple', // Sub-query mode: 'simple' = AxGen, 'advanced' = AxAgent (default: 'simple')
    recursionOptions: {
      model: 'gpt-4o-mini', // Forward options for recursive llmQuery agent calls
      maxDepth: 2, // Maximum recursion depth
    },
  }
)
```

### AxJSRuntime

In AxAgent + RLM, `AxJSRuntime` is the default JS runtime
for executing model-generated code. It is cross-runtime and works in:

- Node.js/Bun-style backends
- Deno backends
- Browser environments

It can be used both as:

- an `AxCodeRuntime` for RLM sessions (`createSession`)
- a function tool (`toFunction`) for non-RLM workflows

### Sandbox Permissions

By default, the `AxJSRuntime` sandbox blocks all dangerous Web APIs (network, storage, etc.). You can selectively grant access using the `AxJSRuntimePermission` enum:

```typescript
import { AxJSRuntime, AxJSRuntimePermission } from '@ax-llm/ax'

const runtime = new AxJSRuntime({
  permissions: [AxJSRuntimePermission.NETWORK, AxJSRuntimePermission.STORAGE],
})
```

Node safety note:

- In Node runtime, `AxJSRuntime` uses safer defaults and hides host globals like `process` and `require`.
- You can opt into unsafe host access only when you trust generated code:

```typescript
const runtime = new AxJSRuntime({
  allowUnsafeNodeHostAccess: true, // WARNING: model code can access host capabilities
})
```

Available permissions:

| Permission      | Unlocked Globals                                      | Description                             |
| --------------- | ----------------------------------------------------- | --------------------------------------- |
| `NETWORK`       | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | HTTP requests and real-time connections |
| `STORAGE`       | `indexedDB`, `caches`                                 | Client-side persistent storage          |
| `CODE_LOADING`  | `importScripts`                                       | Dynamic script loading                  |
| `COMMUNICATION` | `BroadcastChannel`                                    | Cross-tab/worker messaging              |
| `TIMING`        | `performance`                                         | High-resolution timing                  |
| `WORKERS`       | `Worker`, `SharedWorker`                              | Sub-worker spawning (see warning below) |

> **Warning**: Granting `WORKERS` allows code to spawn sub-workers that get fresh, unlocked globals. A child worker has full access to `fetch`, `indexedDB`, etc. regardless of the parent's permissions. Only grant `WORKERS` when you trust the executed code.

### Structured Context Fields

Context fields aren't limited to plain strings. You can pass structured data — objects and arrays with typed sub-fields — and the LLM will see their full schema in the code interpreter prompt.

```typescript
import { agent, f, s } from '@ax-llm/ax'
import { AxJSRuntime } from '@ax-llm/ax'

const sig = s(
  'query:string -> answer:string, evidence:string[]'
).appendInputField(
  'documents',
  f
    .object({
      id: f.number('Document ID'),
      title: f.string('Document title'),
      content: f.string('Document body'),
    })
    .array('Source documents')
)

const analyzer = agent(sig, {
  agentIdentity: {
    name: 'structuredAnalyzer',
    description: 'Analyzes structured document collections using RLM',
  },
  contextFields: ['documents'],
  runtime: new AxJSRuntime(),
})
```

When the LLM enters the code interpreter, it sees the schema:

```
- `documents` (json array of object { id: number, title: string, content: string } items)
```

The LLM can then work with the data using property access and array methods:

```javascript
// Filter documents by title
const relevant = documents.filter((d) => d.title.includes('climate'))

// Pass content to sub-LM — strings go directly, objects via JSON.stringify()
const summaries = await llmQuery(
  relevant.map((d) => ({
    query: 'Summarize this document',
    context: d.content,
  }))
)
```

Structured fields are loaded as native JavaScript objects in the interpreter, preserving their full structure for programmatic access.

### The Actor Loop

The Actor generates JavaScript code in a `javascriptCode` output field. Each turn:

1. The Actor emits `javascriptCode` containing JavaScript to execute
2. The runtime executes the code and returns the result
3. The result is appended to the action log
4. The Actor sees the updated action log and decides what to do next
5. When the Actor calls `submit(...args)` or `ask_clarification(...args)`, the loop ends and the Responder takes over

The Actor's typical workflow:

```
1. Explore context structure (typeof, length, slice)
2. Plan a chunking strategy based on what it observes
3. Use code for structural work (filter, map, regex, property access)
4. Use llmQuery for semantic work (summarization, interpretation)
5. Build up answers in variables across turns
6. Signal completion by calling `submit(...args)` (or `ask_clarification(...args)` to request user input)
```

### Actor Fields

By default, all output fields from the signature go to the Responder. Use `actorFields` to route specific output fields to the Actor instead. The Actor produces these fields each turn (alongside `javascriptCode`), and their values are included in the action log for context. The last Actor turn's values are merged into the final output.

```typescript
const analyzer = agent(
  'context:string, query:string -> answer:string, reasoning:string',
  {
    contextFields: ['context'],
    actorFields: ['reasoning'], // Actor produces 'reasoning', Responder produces 'answer'
  }
)
```

### Actor Callback

Use `actorCallback` to observe each Actor turn. It receives the full Actor result (including `javascriptCode` and any `actorFields`) and fires every turn, including the `submit(...)`/`ask_clarification(...)` turn.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  actorCallback: async (result) => {
    console.log('Actor code:', result.javascriptCode)
  },
})
```

### Actor/Responder Forward Options

Use `actorOptions` and `responderOptions` to set different forward options (model, thinking budget, etc.) for the Actor and Responder sub-programs. These are set at construction time and act as defaults that can still be overridden at forward time.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  actorOptions: {
    model: 'fast-model',
    thinkingTokenBudget: 1024,
  },
  responderOptions: {
    model: 'smart-model',
    thinkingTokenBudget: 4096,
  },
})
```

Priority order (low to high): constructor base options < `actorOptions`/`responderOptions` < forward-time options.

### Recursive llmQuery Options

Use `recursionOptions` to set default forward options for recursive `llmQuery` sub-agent calls.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  rlm: { contextFields: ['context'] },
  recursionOptions: {
    model: 'fast-model',
    maxDepth: 2,
    timeout: 60_000,
  },
})
```

Each `llmQuery` call runs a sub-query with a fresh session and the same registered tool/agent globals. The child receives only the `context` argument passed to `llmQuery(query, context)` — parent `contextFields` values are not forwarded. In simple mode (default), the child is a plain AxGen (direct LLM call). In advanced mode, the child is a full AxAgent with Actor/Responder and code runtime.

### Actor/Responder Descriptions

Use `setActorDescription()` and `setResponderDescription()` to append additional instructions to the Actor or Responder system prompts. The base RLM prompts are preserved; your text is appended after them.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
})

// Add domain-specific instructions to the Actor (code generation agent)
analyzer.setActorDescription(
  'Focus on numerical data. Use precise calculations.'
)

// Add domain-specific instructions to the Responder (answer synthesis agent)
analyzer.setResponderDescription(
  'Format answers as bullet points. Cite evidence.'
)
```

> **Note:** Signature-level descriptions (via `.description()` on the signature) are not supported on `AxAgent`. Use these methods instead to customize each sub-program independently.

### Few-Shot Demos

Use `setDemos()` to provide few-shot examples that guide the Actor and Responder. Demos are keyed by program ID — use `namedPrograms()` to discover available IDs.

Each demo trace must include at least one input field AND one output field. The Actor's input fields are `contextMetadata`, `actionLog`, and any non-context inputs from the original signature. The Responder's input fields are `contextMetadata`, `actorResult`, and any non-context inputs from the original signature.

```typescript
analyzer.setDemos([
  {
    programId: 'root.actor',
    traces: [
      {
        actionLog: '(no actions yet)',
        javascriptCode: 'console.log(context.slice(0, 200))',
      },
      {
        actionLog:
          'Step 1 | console.log(context.slice(0, 200))\n→ Chapter 1: The Rise of...',
        javascriptCode:
          'const summary = await llmQuery("Summarize", context.slice(0, 500)); console.log(summary)',
      },
      {
        actionLog:
          'Step 1 | ...\nStep 2 | llmQuery(...)\n→ The document argues about...',
        javascriptCode: 'submit("analysis complete")',
      },
    ],
  },
  {
    programId: 'root.responder',
    traces: [
      {
        query: 'What are the main arguments?',
        answer: 'The document presents arguments about distributed systems.',
        evidence: ['Chapter 1 discusses scalability', 'Chapter 2 covers CAP'],
      },
    ],
  },
])
```

Demo values are validated against the target program's signature. Invalid values or missing input/output fields throw an error at `setDemos()` time.

### Available APIs in the Sandbox

Inside the code interpreter, these functions are available as globals:

| API                                         | Description                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `await llmQuery(query, context)`            | Ask a sub-LM a question with a context value. Returns a string. Oversized context is truncated to `maxRuntimeChars`                         |
| `await llmQuery([{ query, context }, ...])` | Run multiple sub-LM queries in parallel. Returns string[]. Failed items return `[ERROR] ...`; each query still counts toward the call limit |
| `submit(...args)`                           | Stop Actor execution and pass payload args to Responder. Requires at least one argument                                                     |
| `ask_clarification(...args)`                | Stop Actor execution and pass clarification payload args to Responder. Requires at least one argument                                       |
| `await agents.<name>({...})`                | Call a child agent by name. Parameters match the agent's JSON schema. Returns a string                                                      |
| `await <toolName>({...})`                   | Call a tool function by name. Parameters match the tool's JSON schema                                                                       |
| `print(...args)`                            | Available in `AxJSRuntime` when `outputMode: 'stdout'`; captured output appears in the function result                                      |
| Context variables                           | All fields listed in `contextFields` are available by name                                                                                  |

By default, `AxJSRuntime` uses `outputMode: 'stdout'`, where visible output comes from `console.log(...)`, `print(...)`, and other captured stdout lines.

### Session State and `await`

`AxJSRuntime` state is session-scoped. Values survive across `execute()` calls only while you keep using the same session.

- The Actor loop runs in a persistent runtime session — variables survive across turns.
- `runtime.toFunction()` is different: it creates a new session per tool call, then closes it, so state does not persist across calls.

When code contains `await`, the runtime compiles it as an async function so top-level `await` works. In that async path, local declarations (`const`/`let`/`var`) are function-scoped and should not be relied on for cross-call state.

Prefer one of these patterns for durable state:

```javascript
// Pattern 1: Explicit global
globalThis.state = await getState()
globalThis.state.x += 1
return globalThis.state
```

```javascript
// Pattern 2: Shared object passed in globals/context
state.x += 1
return state
```

This may appear to work in some cases:

```javascript
state = await getState() // no let/const/var
```

but `globalThis.state = ...` (or mutating a shared `state` object) is the recommended explicit pattern.

### Custom Interpreters

The built-in `AxJSRuntime` uses Web Workers for sandboxed code execution. For other environments, implement the `AxCodeRuntime` interface:

```typescript
import type { AxCodeRuntime, AxCodeSession } from '@ax-llm/ax'

class MyBrowserInterpreter implements AxCodeRuntime {
  getUsageInstructions?(): string {
    return 'Runtime-specific guidance for writing code in this environment.'
  }

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    // Set up your execution environment with globals
    return {
      async execute(code: string): Promise<unknown> {
        // Execute code and return result
      },
      close() {
        // Clean up resources
      },
    }
  }
}
```

The `globals` object passed to `createSession` includes:

- All context field values (by field name)
- `llmQuery` function (supports both single and batched queries)
- `submit(...args)` and `ask_clarification(...args)` completion functions
- `agents` namespace object with child agent functions (e.g., `agents.summarize(...)`)
- Tool functions as flat globals
- `print` function when supported by the runtime (for `AxJSRuntime`, set `outputMode: 'stdout'`)

If provided, `getUsageInstructions()` is appended to the RLM system prompt as runtime-specific guidance. Use it for semantics that differ by runtime (for example state persistence or async execution behavior).

### RLM with Streaming

RLM mode does not support true streaming. When using `streamingForward`, RLM runs the full analysis and yields the final result as a single chunk.

### Runtime Character Cap

`maxRuntimeChars` is a hard ceiling for runtime payloads.

- **Hard cap:** `2_000` chars by default
- **Applies to:** `llmQuery` context and `codeInterpreter` output
- **Truncation behavior:** if data exceeds the cap, it is truncated with a `...[truncated N chars]` suffix
- **Manual chunking:** optional strategy you can implement in interpreter code; not done automatically by the runtime

## API Reference

### `AxRLMConfig`

```typescript
interface AxRLMConfig {
  contextFields: string[] // Input fields holding long context
  runtime?: AxCodeRuntime // Code runtime (default: AxJSRuntime)
  maxLlmCalls?: number // Cap on sub-LM calls (default: 50)
  maxRuntimeChars?: number // Cap for llmQuery context + code output (default: 5000)
  maxBatchedLlmQueryConcurrency?: number // Max parallel batched llmQuery calls (default: 8)
  maxTurns?: number // Max Actor turns before forcing Responder (default: 10)
  compressLog?: boolean // Use actionDescription entries instead of full code in actionLog
  actorFields?: string[] // Output fields produced by Actor instead of Responder
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void> // Called after each Actor turn
  mode?: 'simple' | 'advanced' // Sub-query mode: 'simple' = AxGen, 'advanced' = AxAgent (default: 'simple')
}
```

### `AxCodeRuntime`

```typescript
interface AxCodeRuntime {
  getUsageInstructions?(): string
  createSession(globals?: Record<string, unknown>): AxCodeSession
}
```

### `AxCodeSession`

```typescript
interface AxCodeSession {
  execute(code: string, options?: { signal?: AbortSignal }): Promise<unknown>
  close(): void
}
```

### `AxAgentConfig`

```typescript
interface AxAgentConfig<IN, OUT> extends AxAgentOptions {
  ai?: AxAIService
  agentIdentity?: { name: string; description: string }
  agents?: AxAgentic<IN, OUT>[]
  functions?: AxInputFunctionType
}
```

### `AxAgentOptions`

Extends `AxProgramForwardOptions` (without `functions`) with:

```typescript
{
  debug?: boolean;
  contextFields: string[];                   // Input fields holding long context
  runtime?: AxCodeRuntime;                   // Code runtime (default: AxJSRuntime)
  maxLlmCalls?: number;                      // Cap on sub-LM calls (default: 50)
  maxRuntimeChars?: number;                  // Cap for llmQuery context + code output (default: 5000)
  maxBatchedLlmQueryConcurrency?: number;    // Max parallel batched llmQuery calls (default: 8)
  maxTurns?: number;                         // Max Actor turns before forcing Responder (default: 10)
  compressLog?: boolean;                     // Compress action log
  actorFields?: string[];                    // Output fields produced by Actor instead of Responder
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;  // Called after each Actor turn
  mode?: 'simple' | 'advanced';              // RLM mode
  recursionOptions?: Partial<Omit<AxProgramForwardOptions, 'functions'>> & {
    maxDepth?: number;  // Maximum recursion depth for llmQuery sub-agent calls (default: 2)
  };
  actorOptions?: Partial<AxProgramForwardOptions>;   // Default forward options for Actor
  responderOptions?: Partial<AxProgramForwardOptions>; // Default forward options for Responder
}
```

### `setActorDescription()`

```typescript
public setActorDescription(additionalText: string): void
```

Appends additional text to the Actor's RLM system prompt. The base prompt is preserved; the additional text is appended after it.

### `setResponderDescription()`

```typescript
public setResponderDescription(additionalText: string): void
```

Appends additional text to the Responder's RLM system prompt. The base prompt is preserved; the additional text is appended after it.

### `stop()`

```typescript
public stop(): void
```

Available on `AxAgent`, `AxGen`, and `AxFlow`. Stops an in-flight `forward()` or `streamingForward()` call, causing it to throw `AxAIServiceAbortedError`. See [Stopping Agents](#stopping-agents).
