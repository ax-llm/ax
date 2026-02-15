---
title: "AxAgent Guide"
description: "Agent framework with child agents, tools, and RLM for long contexts"
---

# AxAgent Guide

`AxAgent` is the agent framework in Ax. It wraps `AxGen` with support for child agents, tool use, smart model routing, and **RLM (Recursive Language Model)** mode for processing long contexts through a code interpreter.

Use `AxAgent` when you need:
- Multi-step reasoning with tools (ReAct pattern)
- Composing multiple agents into a hierarchy
- Smart model routing across child agents
- Processing long documents without context window limits (RLM mode)

For single-step generation without tools or agents, use [`AxGen`](/axgen/) directly.

## Creating Agents

Use the `agent()` factory function with a string signature:

```typescript
import { agent, ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const myAgent = agent('userQuestion:string -> responseText:string', {
  name: 'helpfulAgent',
  description: 'An agent that provides helpful responses to user questions',
});

const result = await myAgent.forward(llm, { userQuestion: 'What is TypeScript?' });
console.log(result.responseText);
```

The `agent()` function accepts both string signatures and `AxSignature` objects:

```typescript
import { agent, s } from '@ax-llm/ax';

const sig = s('userQuestion:string -> responseText:string');
const myAgent = agent(sig, {
  name: 'helpfulAgent',
  description: 'An agent that provides helpful responses to user questions',
});
```

## Agent Options

The `agent()` factory accepts a configuration object:

```typescript
const myAgent = agent('input:string -> output:string', {
  // Required
  name: 'myAgent',                    // Agent name (min 5 chars)
  description: 'Does something useful and interesting with inputs',  // Min 20 chars

  // Optional
  ai: llm,                            // Bind a specific AI service
  definition: 'You are a helpful assistant that... (detailed prompt)',  // Min 100 chars if provided
  functions: [searchTool, calcTool],   // Tool functions
  agents: [childAgent1, childAgent2],  // Child agents
  maxSteps: 25,                        // Max reasoning steps (default: 25)
  maxRetries: 3,                       // Retries on assertion failures
  temperature: 0.7,                    // Sampling temperature
  disableSmartModelRouting: false,     // Disable automatic model selection
  excludeFieldsFromPassthrough: [],    // Fields NOT passed to child agents
  debug: false,                        // Debug logging

  // RLM mode (see RLM section below)
  rlm: { ... },
});
```

### `name`

The agent's name, used as the function name when called as a child agent. Minimum 5 characters. Converted to camelCase automatically (e.g. `'Physics Researcher'` becomes `physicsResearcher`).

### `description`

A short description of what the agent does. Minimum 20 characters. This is shown to parent agents when they decide which child to call.

### `definition`

An optional detailed system prompt for the LLM. Minimum 100 characters if provided. If omitted, the `description` is used as the prompt.

### `functions`

An array of tool functions the agent can call. Each function has a name, description, JSON Schema parameters, and an implementation.

### `agents`

An array of child agents. When provided, the agent can delegate subtasks to these children. See [Child Agents](#child-agents).

## Running Agents

### `forward()`

Run the agent and get the final result:

```typescript
const result = await myAgent.forward(llm, { userQuestion: 'Hello' });
console.log(result.responseText);
```

If the agent was created with `ai` bound, the parent AI is used as fallback:

```typescript
const myAgent = agent('input:string -> output:string', {
  name: 'myAgent',
  description: 'An agent that processes inputs reliably',
  ai: llm,  // Bound AI service
});

// Can also pass a different AI to override
const result = await myAgent.forward(differentLlm, { input: 'test' });
```

### `streamingForward()`

Stream partial results as they arrive:

```typescript
const stream = myAgent.streamingForward(llm, { userQuestion: 'Write a story' });

for await (const chunk of stream) {
  if (chunk.delta.responseText) {
    process.stdout.write(chunk.delta.responseText);
  }
}
```

### Forward Options

Both `forward` and `streamingForward` accept an options object as the third argument:

```typescript
const result = await myAgent.forward(llm, values, {
  model: 'smart',             // Override model
  maxSteps: 10,               // Override max steps
  debug: true,                // Enable debug logging
  functions: [extraTool],     // Additional tools (merged with agent's tools)
  thinkingTokenBudget: 'medium',
  abortSignal: controller.signal,  // Cancel via AbortSignal
});
```

## Stopping Agents

`AxAgent`, `AxGen`, and `AxFlow` support two ways to stop an in-flight `forward()` or `streamingForward()` call. Both cause the call to throw `AxAIServiceAbortedError`, which you handle with try/catch.

### `stop()` method

Call `stop()` from any context — a timer, event handler, or another async task — to halt the multi-step loop. The loop throws `AxAIServiceAbortedError` at the next between-step check.

```typescript
const myAgent = agent('question:string -> answer:string', {
  name: 'myAgent',
  description: 'An agent that answers questions thoroughly',
});

// Stop after 5 seconds
const timer = setTimeout(() => myAgent.stop(), 5_000);

try {
  const result = await myAgent.forward(llm, { question: 'Explain quantum gravity' });
  console.log(result.answer);
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Agent was stopped');
  } else {
    throw err;
  }
} finally {
  clearTimeout(timer);
}
```

`stop()` is also available on `AxGen` and `AxFlow` instances:

```typescript
const gen = ax('topic:string -> summary:string');
setTimeout(() => gen.stop(), 3_000);

try {
  const result = await gen.forward(llm, { topic: 'Climate change' });
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Generation was stopped');
  }
}
```

### Using `AbortSignal`

Pass an `abortSignal` in the forward options to cancel via the standard `AbortController` / `AbortSignal` API. The signal is checked between each step of the multi-step loop, not only during the HTTP call, so cancellation is detected promptly even when the agent is between LLM calls.

```typescript
// Time-based deadline
try {
  const result = await myAgent.forward(llm, values, {
    abortSignal: AbortSignal.timeout(10_000),  // 10-second deadline
  });
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Timed out');
  }
}

// Manual controller
const controller = new AbortController();
onUserCancel(() => controller.abort());

try {
  const result = await myAgent.forward(llm, values, {
    abortSignal: controller.signal,
  });
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) {
    console.log('Cancelled by user');
  }
}
```

## Child Agents

Agents can compose other agents as children. The parent agent sees each child as a callable function and decides when to invoke it.

```typescript
const researcher = agent(
  'question:string, physicsQuestion:string -> answer:string',
  {
    name: 'Physics Researcher',
    description: 'Researcher for physics questions can answer questions about advanced physics',
  }
);

const summarizer = agent(
  'answer:string -> shortSummary:string',
  {
    name: 'Science Summarizer',
    description: 'Summarizer can write short summaries of advanced science topics',
    definition: 'You are a science summarizer. You can write short summaries of advanced science topics. Use numbered bullet points to summarize the answer in order of importance.',
  }
);

const scientist = agent('question:string -> answer:string', {
  name: 'Scientist',
  description: 'An agent that can answer advanced science questions',
  agents: [researcher, summarizer],
});

const result = await scientist.forward(llm, {
  question: 'Why is gravity not a real force?',
});
```

### Value Passthrough

When a parent and child agent share input field names, the parent automatically passes those values to the child. For example, if the parent has `question:string` and a child also expects `question:string`, the parent's value is injected automatically — the LLM doesn't need to re-type it.

Control which fields are excluded from passthrough:

```typescript
const myAgent = agent('context:string, query:string -> answer:string', {
  name: 'myAgent',
  description: 'An agent that processes queries with context provided',
  agents: [childAgent],
  excludeFieldsFromPassthrough: ['context'],  // Don't pass context to children
});
```

### Smart Model Routing

When an AI service is configured with multiple models, agents automatically expose a `model` parameter to parent agents. The parent LLM can choose which model to use for each child call based on task complexity.

```typescript
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
  models: [
    { key: 'dumb', model: 'gpt-3.5-turbo', description: 'Simple questions' },
    { key: 'smart', model: 'gpt-4o-mini', description: 'Advanced questions' },
    { key: 'smartest', model: 'gpt-4o', description: 'Most complex questions' },
  ],
});
```

Disable smart routing per-agent with `disableSmartModelRouting: true`.

## RLM Mode

**RLM (Recursive Language Model)** mode lets agents process arbitrarily long documents without hitting context window limits. Instead of stuffing the entire document into the LLM prompt, RLM loads it into a code interpreter session and gives the LLM tools to analyze it programmatically.

### The Problem

When you pass a long document to an LLM, you face:
- **Context window limits** — the document may not fit
- **Context rot** — accuracy degrades as context grows
- **Cost** — long prompts are expensive

### How It Works

1. **Context extraction** — Fields listed in `contextFields` are removed from the LLM prompt and loaded into a code interpreter session as variables.
2. **Code interpreter** — The LLM gets a `codeInterpreter` tool to execute code in a persistent REPL. Variables and state persist across calls.
3. **Sub-LM queries** — Inside the code interpreter, `llmQuery(query, context?)` calls a sub-LM for semantic analysis of chunks. `llmQuery([...])` runs multiple queries in parallel.
4. **Final answer** — When done, the LLM provides its final answer with the required output fields.

The LLM writes code to chunk, filter, and iterate over the document, using `llmQuery` only for semantic understanding of small pieces. This keeps the LLM prompt small while allowing analysis of unlimited context.

### Configuration

```typescript
import { agent, ai } from '@ax-llm/ax';
import { AxJSInterpreter } from '@ax-llm/ax';

const analyzer = agent(
  'context:string, query:string -> answer:string, evidence:string[]',
  {
    name: 'documentAnalyzer',
    description: 'Analyzes long documents using code interpreter and sub-LM queries',
    maxSteps: 15,
    rlm: {
      contextFields: ['context'],              // Fields to load into interpreter
      runtime: new AxJSInterpreter(),          // Code runtime implementation
      maxLlmCalls: 30,                         // Cap on sub-LM calls (default: 50)
      maxSubQueryContextChars: 20_000,         // Hard cap per llmQuery context (default: 20_000)
      maxBatchedLlmQueryConcurrency: 6,        // Max parallel batched llmQuery calls (default: 8)
      maxInterpreterOutputChars: 8_000,        // Max chars returned per codeInterpreter call (default: 10_000)
      subModel: 'gpt-4o-mini',                // Model for llmQuery (default: same as parent)
    },
  }
);
```

### AxJSRuntime (AxJSInterpreter)

In AxAgent + RLM, `AxJSInterpreter` is the default JS runtime ("AxJSRuntime")
for executing model-generated code. It is cross-runtime and works in:

- Node.js/Bun-style backends
- Deno backends
- Browser environments

It can be used both as:

- an `AxCodeInterpreter` for RLM sessions (`createSession`)
- a function tool (`toFunction`) for non-RLM workflows

### Sandbox Permissions

By default, the `AxJSInterpreter` sandbox blocks all dangerous Web APIs (network, storage, etc.). You can selectively grant access using the `AxJSInterpreterPermission` enum:

```typescript
import { AxJSInterpreter, AxJSInterpreterPermission } from '@ax-llm/ax';

const interpreter = new AxJSInterpreter({
  permissions: [
    AxJSInterpreterPermission.NETWORK,
    AxJSInterpreterPermission.STORAGE,
  ],
});
```

Node safety note:

- In Node runtime, `AxJSInterpreter` uses safer defaults and hides host globals like `process` and `require`.
- You can opt into unsafe host access only when you trust generated code:

```typescript
const interpreter = new AxJSInterpreter({
  allowUnsafeNodeHostAccess: true, // WARNING: model code can access host capabilities
});
```

Available permissions:

| Permission | Unlocked Globals | Description |
|---|---|---|
| `NETWORK` | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | HTTP requests and real-time connections |
| `STORAGE` | `indexedDB`, `caches` | Client-side persistent storage |
| `CODE_LOADING` | `importScripts` | Dynamic script loading |
| `COMMUNICATION` | `BroadcastChannel` | Cross-tab/worker messaging |
| `TIMING` | `performance` | High-resolution timing |
| `WORKERS` | `Worker`, `SharedWorker` | Sub-worker spawning (see warning below) |

> **Warning**: Granting `WORKERS` allows code to spawn sub-workers that get fresh, unlocked globals. A child worker has full access to `fetch`, `indexedDB`, etc. regardless of the parent's permissions. Only grant `WORKERS` when you trust the executed code.

### Structured Context Fields

Context fields aren't limited to plain strings. You can pass structured data — objects and arrays with typed sub-fields — and the LLM will see their full schema in the code interpreter prompt.

```typescript
import { agent, f, s } from '@ax-llm/ax';
import { AxJSInterpreter } from '@ax-llm/ax';

const sig = s('query:string -> answer:string, evidence:string[]')
  .appendInputField('documents', f.object({
    id: f.number('Document ID'),
    title: f.string('Document title'),
    content: f.string('Document body'),
  }).array('Source documents'));

const analyzer = agent(sig, {
  name: 'structuredAnalyzer',
  description: 'Analyzes structured document collections using RLM',
  rlm: {
    contextFields: ['documents'],
    runtime: new AxJSInterpreter(),
  },
});
```

When the LLM enters the code interpreter, it sees the schema:

```
- `documents` (json array of object { id: number, title: string, content: string } items)
```

The LLM can then work with the data using property access and array methods:

```javascript
// Filter documents by title
const relevant = documents.filter(d => d.title.includes('climate'));

// Pass content to sub-LM — strings go directly, objects via JSON.stringify()
const summaries = await llmQuery(
  relevant.map(d => ({ query: 'Summarize this document', context: d.content }))
);
```

Structured fields are loaded as native JavaScript objects in the interpreter, preserving their full structure for programmatic access.

### The REPL Loop

In RLM mode, the agent gets a special function:

- **`codeInterpreter`** — Execute code in a persistent session. Context fields are available as global variables.

The LLM's typical workflow:

```
1. Peek at context structure (typeof, length, slice)
2. Chunk the context into manageable pieces
3. Use llmQuery for semantic analysis of each chunk
4. Aggregate results
5. Provide the final answer with the required output fields
```

### Available APIs in the Sandbox

Inside the code interpreter, these functions are available as globals:

| API | Description |
|-----|-------------|
| `await llmQuery(query, context?)` | Ask a sub-LM a question, optionally with a context string. Returns a string |
| `await llmQuery([{ query, context? }, ...])` | Run multiple sub-LM queries in parallel. Returns string[]. Each query counts individually toward the call limit |
| `print(...args)` | Print output (appears in the function result) |
| Context variables | All fields listed in `contextFields` are available by name |

### Custom Interpreters

The built-in `AxJSInterpreter` uses Web Workers for sandboxed code execution. For other environments, implement the `AxCodeInterpreter` interface:

```typescript
import type { AxCodeInterpreter, AxCodeSession } from '@ax-llm/ax';

class MyBrowserInterpreter implements AxCodeInterpreter {
  readonly language = 'JavaScript';

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    // Set up your execution environment with globals
    return {
      async execute(code: string): Promise<unknown> {
        // Execute code and return result
      },
      close() {
        // Clean up resources
      },
    };
  }
}
```

The `globals` object passed to `createSession` includes:
- All context field values (by field name)
- `llmQuery` function (supports both single and batched queries)
- `print` function

### RLM with Streaming

RLM mode does not support true streaming. When using `streamingForward`, RLM runs the full analysis and yields the final result as a single chunk.

### Recommended Chunk Sizing

Treat `maxSubQueryContextChars` as a hard ceiling, not your normal chunk size.

- **Target chunk size:** `2_000` to `10_000` chars
- **Hard cap:** `20_000` chars by default
- **Why:** smaller chunks usually improve latency, cost, and semantic precision for sub-calls

## API Reference

### `AxRLMConfig`

```typescript
interface AxRLMConfig {
  contextFields: string[];        // Input fields holding long context
  runtime?: AxCodeInterpreter;    // Preferred runtime key
  interpreter?: AxCodeInterpreter; // Legacy alias (deprecated)
  maxLlmCalls?: number;           // Cap on sub-LM calls (default: 50)
  maxSubQueryContextChars?: number;       // Hard cap per llmQuery context (default: 20_000)
  maxBatchedLlmQueryConcurrency?: number; // Max parallel batched llmQuery calls (default: 8)
  maxInterpreterOutputChars?: number;     // Max chars returned per codeInterpreter call (default: 10_000)
  subModel?: string;              // Model for llmQuery sub-calls
}
```

### `AxCodeInterpreter`

```typescript
interface AxCodeInterpreter {
  readonly language: string;  // e.g. 'JavaScript', 'Python'
  createSession(globals?: Record<string, unknown>): AxCodeSession;
}
```

### `AxCodeSession`

```typescript
interface AxCodeSession {
  execute(code: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  close(): void;
}
```

### `AxAgentConfig`

```typescript
interface AxAgentConfig<IN, OUT> extends AxAgentOptions {
  ai?: AxAIService;
  name: string;
  description: string;
  definition?: string;
  agents?: AxAgentic<IN, OUT>[];
  functions?: AxInputFunctionType;
}
```

### `AxAgentOptions`

Extends `AxProgramForwardOptions` (without `functions`) with:

```typescript
{
  disableSmartModelRouting?: boolean;
  excludeFieldsFromPassthrough?: string[];
  debug?: boolean;
  rlm?: AxRLMConfig;
}
```

### `stop()`

```typescript
public stop(): void
```

Available on `AxAgent`, `AxGen`, and `AxFlow`. Stops an in-flight `forward()` or `streamingForward()` call, causing it to throw `AxAIServiceAbortedError`. See [Stopping Agents](#stopping-agents).
