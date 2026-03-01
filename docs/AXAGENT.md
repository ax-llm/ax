# AxAgent Guide

`AxAgent` is the agent framework in Ax. It wraps `AxGen` with support for child agents, tool use, and **RLM (Recursive Language Model)** mode for processing long contexts through runtime-backed code execution.

Use `AxAgent` when you need:
- Multi-step reasoning with tools
- Composing multiple agents into a hierarchy
- Processing long documents without context window limits (RLM mode)

For single-step generation without tools or agents, use [`AxGen`](./AXGEN.md) directly.

## Creating Agents

Use the `agent()` factory function with a string signature:

```typescript
import { agent, ai } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });

const myAgent = agent('userQuestion:string -> responseText:string', {
  agentIdentity: {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
  },
});

const result = await myAgent.forward(llm, { userQuestion: 'What is TypeScript?' });
console.log(result.responseText);
```

The `agent()` function accepts both string signatures and `AxSignature` objects:

```typescript
import { agent, s } from '@ax-llm/ax';

const sig = s('userQuestion:string -> responseText:string');
const myAgent = agent(sig, {
  agentIdentity: {
    name: 'helpfulAgent',
    description: 'An agent that provides helpful responses to user questions',
  },
});
```

## Agent Options

The `agent()` factory accepts a configuration object:

```typescript
const myAgent = agent('input:string -> output:string', {
  // Agent identity (required when used as a child agent)
  agentIdentity: {
    name: 'myAgent',                  // Agent name (converted to camelCase)
    description: 'Does something useful and interesting with inputs',
  },

  // Required when using context fields
  contextFields: ['largeDoc'],        // Fields removed from LLM prompt; available as JS runtime vars

  // Optional
  ai: llm,                            // Bind a specific AI service
  debug: false,                        // Debug logging

  // Child agents and sharing
  agents: {
    local: [childAgent1, childAgent2],    // Callable under agents.* in this agent
    shared: [utilityAgent],               // Propagated one level to direct children
    globallyShared: [loggerAgent],        // Propagated recursively to all descendants
    excluded: ['agentName'],              // Agent names NOT to receive from parents
  },

  // Field sharing
  fields: {
    local: ['userId'],                    // Keep shared/global fields visible in this agent
    shared: ['userId'],                   // Passed to direct child agents
    globallyShared: ['sessionId'],        // Passed to all descendants
    excluded: ['field'],                  // Fields NOT to receive from parents
  },

  // Agent functions (namespaced JS runtime globals)
  functions: {
    local: [myAgentFn],                   // Available in this agent's JS runtime
    shared: [sharedFn],                   // Propagated one level to direct children
    globallyShared: [globalFn],           // Propagated recursively to all descendants
    excluded: ['fnName'],                 // Function names NOT to receive from parents
  },

  // RLM limits (see RLM section below)
  maxSubAgentCalls: 50,                       // Sub-agent call cap (default: 50)
  maxRuntimeChars: 5000,                 // Runtime payload size cap (default: 5000)
  maxTurns: 10,                          // Actor loop turn cap (default: 10)

  actorOptions: { description: '...' },   // Extra guidance appended to Actor prompt
  responderOptions: { description: '...' }, // Extra guidance appended to Responder prompt
  recursionOptions: { maxDepth: 2 },      // llmQuery sub-agent options
});
```

### `agentIdentity`

Required when the agent is used as a child agent. Contains `name` (converted to camelCase for the function name, e.g. `'Physics Researcher'` becomes `physicsResearcher`) and `description` (shown to parent agents when they decide which child to call).

### `agents`

Grouped child agent configuration. `local` are callable under `agents.*` in this agent's JS runtime. See [Child Agents](#child-agents).

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
  agentIdentity: {
    name: 'myAgent',
    description: 'An agent that processes inputs reliably',
  },
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

Call `stop()` from any context — a timer, event handler, or another async task — to halt the multi-step loop. `stop()` aborts all in-flight calls started by the same `AxAgent` instance (including retry backoff waits), and the loop throws `AxAIServiceAbortedError`.

```typescript
const myAgent = agent('question:string -> answer:string', {
  agentIdentity: {
    name: 'myAgent',
    description: 'An agent that answers questions thoroughly',
  },
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
    agentIdentity: {
      name: 'Physics Researcher',
      description: 'Researcher for physics questions can answer questions about advanced physics',
    },
  }
);

const summarizer = agent(
  'answer:string -> shortSummary:string',
  {
    agentIdentity: {
      name: 'Science Summarizer',
      description: 'Summarizer can write short summaries of advanced science topics',
    },
    contextFields: [],
    actorOptions: {
      description: 'Use numbered bullet points to summarize the answer in order of importance.',
    },
  }
);

const scientist = agent('question:string -> answer:string', {
  agentIdentity: {
    name: 'Scientist',
    description: 'An agent that can answer advanced science questions',
  },
  contextFields: [],
  agents: { local: [researcher, summarizer] },
});

const result = await scientist.forward(llm, {
  question: 'Why is gravity not a real force?',
});
```

### Value Passthrough

When a parent and child agent share input field names, the parent automatically passes those values to the child. For example, if the parent has `question:string` and a child also expects `question:string`, the parent's value is injected automatically — the LLM doesn't need to re-type it.

## Agent Functions (`AxAgentFunction`)

Agent functions are registered as namespaced globals in the JS runtime. Unlike child agents (which are called via `await agents.<name>(...)`), agent functions are rendered directly in the Actor prompt as callable JS APIs.

```typescript
import { agent, type AxAgentFunction } from '@ax-llm/ax';

const search: AxAgentFunction = {
  name: 'search',
  namespace: 'db',              // callable as db.search(...) in JS runtime
  description: 'Search the product catalog',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['query'],
  },
  returns: {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'string' } },
    },
  },
  func: async ({ query, limit = 5 }) => {
    return { results: [`result for ${query}`] };
  },
};

const shopAssistant = agent(
  'userQuery:string, catalog:string[] -> answer:string',
  {
    agentIdentity: { name: 'shopAssistant', description: 'Answers product questions' },
    contextFields: ['catalog'],
    functions: { local: [search] },
  }
);
```

The Actor prompt will include:

```
### Available Functions
```javascript
// db namespace
// Search the product catalog
async function db.search({ query: string, limit?: number }): Promise<{ results: string[] }>
```
```

Key rules:
- Default namespace is `'utils'` if omitted (callable as `utils.fnName(...)`)
- Reserved namespaces: `agents`, `llmQuery`, `final`, `ask_clarification`
- `parameters` is required; `returns` is optional but shown in the prompt
- Use `functions.shared` / `functions.globallyShared` to propagate to child agents

## Shared Fields and Agents

When composing agent hierarchies, you often need to pass data or utility agents to child agents without requiring the parent's LLM to explicitly route them. AxAgent provides grouped `fields`, `agents`, and `functions` options with three propagation levels each.

### `fields.shared` — Pass fields to direct children (one level)

Fields listed in `fields.shared` are automatically injected into direct child agents at runtime. By default, they bypass the parent's LLM.

```typescript
const childAgent = agent('question:string -> answer:string', {
  agentIdentity: { name: 'Child', description: 'Answers questions' },
  contextFields: [],
});

const parentAgent = agent('query:string, userId:string, knowledgeBase:string -> answer:string', {
  contextFields: ['knowledgeBase'],
  agents: { local: [childAgent] },
  fields: { shared: ['userId'] },   // userId is injected into child agents automatically
});
```

- `userId` is removed from the parent's Actor/Responder prompts
- `userId` is automatically injected into every call to child agents
- Children can opt out via `fields: { excluded: ['userId'] }`
- Add `fields.local: ['userId']` to keep `userId` available in the parent too

### `fields.globallyShared` — Pass fields to ALL descendants (recursive)

Like `fields.shared`, but propagates through the entire agent tree — children, grandchildren, and beyond.

```typescript
const grandchild = agent('question:string -> answer:string', {
  agentIdentity: { name: 'Grandchild', description: 'Answers questions' },
  contextFields: [],
});

const child = agent('topic:string -> summary:string', {
  agentIdentity: { name: 'Child', description: 'Summarizes topics' },
  contextFields: [],
  agents: { local: [grandchild] },
});

const parent = agent('query:string, sessionId:string -> answer:string', {
  contextFields: [],
  agents: { local: [child] },
  fields: { globallyShared: ['sessionId'] },   // sessionId reaches child AND grandchild
});
```

### `agents.shared` — Add agents to direct children (one level)

Utility agents listed in `agents.shared` are added to every direct child agent's available agents list.

```typescript
const logger = agent('message:string -> logResult:string', {
  agentIdentity: { name: 'Logger', description: 'Logs messages for debugging' },
  contextFields: [],
});

const worker = agent('task:string -> result:string', {
  agentIdentity: { name: 'Worker', description: 'Performs tasks' },
  contextFields: [],
});

const parent = agent('query:string -> answer:string', {
  contextFields: [],
  agents: {
    local: [worker],
    shared: [logger],   // worker can now call agents.logger(...)
  },
});
```

### `agents.globallyShared` — Add agents to ALL descendants (recursive)

Like `agents.shared`, but propagates through the entire agent tree.

```typescript
const logger = agent('message:string -> logResult:string', {
  agentIdentity: { name: 'Logger', description: 'Logs messages for debugging' },
  contextFields: [],
});

const grandchild = agent('question:string -> answer:string', {
  agentIdentity: { name: 'Grandchild', description: 'Answers questions' },
  contextFields: [],
});

const child = agent('topic:string -> summary:string', {
  agentIdentity: { name: 'Child', description: 'Summarizes topics' },
  contextFields: [],
  agents: { local: [grandchild] },
});

const parent = agent('query:string -> answer:string', {
  contextFields: [],
  agents: {
    local: [child],
    globallyShared: [logger],   // both child AND grandchild can call agents.logger(...)
  },
});
```

### `fields.excluded` / `agents.excluded` / `functions.excluded`

Any child agent can opt out of receiving specific shared fields, agents, or functions from parents:

```typescript
const sentiment = agent('text:string -> sentiment:string', {
  agentIdentity: { name: 'Sentiment', description: 'Analyzes sentiment' },
  contextFields: [],
  fields: { excluded: ['userId'] },      // Does not receive userId from parents
  agents: { excluded: ['loggerAgent'] }, // Does not receive logger from parents
  functions: { excluded: ['searchFn'] }, // Does not receive searchFn from parents
});
```

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
4. **Completion** — The Actor signals completion by calling `final(...args)` or asks for more user input with `ask_clarification(...args)`, then the Responder synthesizes the final answer.

The Actor writes JavaScript code to inspect, filter, and iterate over the document. It uses `llmQuery` for semantic analysis and can chunk data in code before querying.

### Configuration

```typescript
import { agent, ai } from '@ax-llm/ax';

const analyzer = agent(
  'context:string, query:string -> answer:string, evidence:string[]',
  {
    agentIdentity: {
      name: 'documentAnalyzer',
      description: 'Analyzes long documents using code interpreter and sub-LM queries',
    },
    contextFields: ['context'],                  // Fields to load into runtime session
    runtime: new AxJSRuntime(),                  // Code runtime (default: AxJSRuntime)
    maxSubAgentCalls: 30,                             // Cap on sub-LM calls (default: 50)
    maxRuntimeChars: 2_000,                      // Cap for llmQuery context + code output (default: 5000)
    maxBatchedLlmQueryConcurrency: 6,            // Max parallel batched llmQuery calls (default: 8)
    maxTurns: 10,                                // Max Actor turns before forcing Responder (default: 10)
    contextManagement: {                          // Semantic context management
      errorPruning: true,                         // Prune error entries after successful turns
      hindsightEvaluation: true,                  // Heuristic importance scoring on entries
      tombstoning: true,                          // Replace resolved errors with compact summaries
      stateInspection: { contextThreshold: 2000 }, // Enable inspect_runtime() tool
      pruneRank: 2,                               // Entries ranked below this are purged (0-5, default: 2)
    },
    actorFields: ['reasoning'],                   // Output fields produced by Actor instead of Responder
    actorCallback: async (result) => {            // Called after each Actor turn
      console.log('Actor turn:', result);
    },
    mode: 'simple',                               // Sub-query mode: 'simple' = AxGen, 'advanced' = AxAgent (default: 'simple')
    recursionOptions: {
      model: 'gpt-4o-mini',                      // Forward options for recursive llmQuery agent calls
      maxDepth: 2,                               // Maximum recursion depth
    },
  }
);
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
import { AxJSRuntime, AxJSRuntimePermission } from '@ax-llm/ax';

const runtime = new AxJSRuntime({
  permissions: [
    AxJSRuntimePermission.NETWORK,
    AxJSRuntimePermission.STORAGE,
  ],
});
```

Node safety note:

- In Node runtime, `AxJSRuntime` uses safer defaults and hides host globals like `process` and `require`.
- You can opt into unsafe host access only when you trust generated code:

```typescript
const runtime = new AxJSRuntime({
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

### Consecutive Execution Error Cutoff

`AxJSRuntime` can enforce a cutoff for consecutive execution failures. This is useful when generated code gets stuck in a failure loop.

```typescript
import { AxJSRuntime } from '@ax-llm/ax';

const runtime = new AxJSRuntime({
  consecutiveErrorCutoff: 3,
});
```

Behavior:

- The runtime tracks consecutive execution failures.
- The counter resets on successful execution.
- When failures hit the configured cutoff, the runtime throws `AxRuntimeExecutionError` and exits the session.
- Preflight guardrail errors are not counted (for example blocked `"use strict"` and reserved-name reassignment checks).

You can manually reset the runtime-level counter:

```typescript
runtime.resetConsecutiveErrorCounter();
```

### Structured Context Fields

Context fields aren't limited to plain strings. You can pass structured data — objects and arrays with typed sub-fields — and the LLM will see their full schema in the code interpreter prompt.

```typescript
import { agent, f, s } from '@ax-llm/ax';
import { AxJSRuntime } from '@ax-llm/ax';

const sig = s('query:string -> answer:string, evidence:string[]')
  .appendInputField('documents', f.object({
    id: f.number('Document ID'),
    title: f.string('Document title'),
    content: f.string('Document body'),
  }).array('Source documents'));

const analyzer = agent(sig, {
  agentIdentity: {
    name: 'structuredAnalyzer',
    description: 'Analyzes structured document collections using RLM',
  },
  contextFields: ['documents'],
  runtime: new AxJSRuntime(),
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

### The Actor Loop

The Actor generates JavaScript code in a `javascriptCode` output field. Each turn:

1. The Actor emits `javascriptCode` containing JavaScript to execute
2. The runtime executes the code and returns the result
3. The result is appended to the action log
4. The Actor sees the updated action log and decides what to do next
5. When the Actor calls `final(...args)` or `ask_clarification(...args)`, the loop ends and the Responder takes over

The Actor's typical workflow:

```
1. Explore context structure (typeof, length, slice)
2. Plan a chunking strategy based on what it observes
3. Use code for structural work (filter, map, regex, property access)
4. Use llmQuery for semantic work (summarization, interpretation)
5. Build up answers in variables across turns
6. Signal completion by calling `final(...args)` (or `ask_clarification(...args)` to request user input)
```

### Actor Fields

By default, all output fields from the signature go to the Responder. Use `actorFields` to route specific output fields to the Actor instead. The Actor produces these fields each turn (alongside `javascriptCode`), and their values are included in the action log for context. The last Actor turn's values are merged into the final output.

```typescript
const analyzer = agent(
  'context:string, query:string -> answer:string, reasoning:string',
  {
    contextFields: ['context'],
    actorFields: ['reasoning'],   // Actor produces 'reasoning', Responder produces 'answer'
  }
);
```

### Actor Callback

Use `actorCallback` to observe each Actor turn. It receives the full Actor result (including `javascriptCode` and any `actorFields`) and fires every turn, including the `final(...)`/`ask_clarification(...)` turn.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  actorCallback: async (result) => {
    console.log('Actor code:', result.javascriptCode);
  },
});
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
});
```

Priority order (low to high): constructor base options < `actorOptions`/`responderOptions` < forward-time options.

### Recursive llmQuery Options

Use `recursionOptions` to set default forward options for recursive `llmQuery` sub-agent calls.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  recursionOptions: {
    model: 'fast-model',
    maxDepth: 2,
    timeout: 60_000,
  },
});
```

Each `llmQuery` call runs a sub-query with a fresh session and the same registered tool/agent globals. The child receives only the `context` value passed to `llmQuery(...)` — parent `contextFields` values are not forwarded. In simple mode (default), the child is a plain AxGen (direct LLM call). In advanced mode, the child is a full AxAgent with Actor/Responder and code runtime.

### Actor/Responder Descriptions

Use `actorOptions.description` and `responderOptions.description` to append additional instructions to the Actor or Responder system prompts. The base prompts are preserved; your text is appended after them.

```typescript
const analyzer = agent('context:string, query:string -> answer:string', {
  contextFields: ['context'],
  actorOptions: {
    description: 'Focus on numerical data. Use precise calculations.',
  },
  responderOptions: {
    description: 'Format answers as bullet points. Cite evidence.',
  },
});
```

> **Note:** Signature-level descriptions (via `.description()` on the signature) are not supported on `AxAgent`. Use `actorOptions.description` / `responderOptions.description` instead to customize each sub-program independently.

### Few-Shot Demos

Use `setDemos()` to provide few-shot examples that guide the Actor and Responder. Demos are keyed by program ID — use `namedPrograms()` to discover available IDs.

Each demo trace must include at least one input field AND one output field. The Actor's input fields are `contextMetadata`, `actionLog`, and any non-context inputs from the original signature. The Responder's input fields are `contextMetadata`, `actorResult`, and any non-context inputs from the original signature.

Note: use `final(...)` (not `submit(...)`) in Actor demo traces to signal completion.

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
        actionLog: 'Step 1 | console.log(context.slice(0, 200))\n→ Chapter 1: The Rise of...',
        javascriptCode: 'const summary = await llmQuery("Summarize", context.slice(0, 500)); console.log(summary)',
      },
      {
        actionLog: 'Step 1 | ...\nStep 2 | llmQuery(...)\n→ The document argues about...',
        javascriptCode: 'final("analysis complete")',
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
]);
```

Demo values are validated against the target program's signature. Invalid values or missing input/output fields throw an error at `setDemos()` time.

### Available APIs in the Sandbox

Inside the code interpreter, these functions are available as globals:

| API | Description |
|-----|-------------|
| `await llmQuery(query, context?)` | Ask a sub-LM a question with optional context. Returns a string. Oversized context is truncated to `maxRuntimeChars` |
| `await llmQuery({ query, context? })` | Single-object convenience form of `llmQuery`. Returns a string |
| `await llmQuery([{ query, context }, ...])` | Run multiple sub-LM queries in parallel. Returns string[]. Failed items return `[ERROR] ...`; each query still counts toward the call limit |
| `final(...args)` | Stop Actor execution and pass payload args to Responder. Requires at least one argument |
| `ask_clarification(...args)` | Stop Actor execution and pass clarification payload args to Responder. Requires at least one argument |
| `await agents.<name>({...})` | Call a child agent by name (from `agents.local`). Parameters match the agent's JSON schema. Returns a string |
| `await <namespace>.<fnName>({...})` | Call an agent function by namespace and name (from `functions.local`). Returns the typed result |
| `print(...args)` | Available in `AxJSRuntime` when `outputMode: 'stdout'`; captured output appears in the function result |
| Context variables | All input fields are available as `inputs.<field>` (including context fields). Non-colliding top-level aliases may also exist |

By default, `AxJSRuntime` uses `outputMode: 'stdout'`, where visible output comes from `console.log(...)`, `print(...)`, and other captured stdout lines.

### Session State and `await`

`AxJSRuntime` state is session-scoped. Values survive across `execute()` calls only while you keep using the same session.

- The Actor loop runs in a persistent runtime session — variables survive across turns.
- `runtime.toFunction()` is different: it creates a new session per tool call, then closes it, so state does not persist across calls.

When code contains `await`, the runtime compiles it as an async function so top-level `await` works. In that async path, local declarations (`const`/`let`/`var`) are function-scoped and should not be relied on for cross-call state.

Prefer one of these patterns for durable state:

```javascript
// Pattern 1: Explicit global
globalThis.state = await getState();
globalThis.state.x += 1;
return globalThis.state;
```

```javascript
// Pattern 2: Shared object passed in globals/context
state.x += 1;
return state;
```

This may appear to work in some cases:

```javascript
state = await getState(); // no let/const/var
```

but `globalThis.state = ...` (or mutating a shared `state` object) is the recommended explicit pattern.

### Error Handling in the Code Interpreter

Errors thrown by code running inside `session.execute(code)` cross the worker boundary and can be caught on the host. Always `await` `session.execute()` inside a try/catch:

```typescript
import { AxRuntimeExecutionError } from '@ax-llm/ax';

try {
  const result = await session.execute(code);
  // use result
} catch (e) {
  if (e instanceof AxRuntimeExecutionError) {
    // Consecutive execution failures reached the cutoff; session was exited.
  } else if (e instanceof Error && e.name === 'WaitForUserActionError') {
    // handle domain-specific error
  }
  console.error(e instanceof Error ? e.message : String(e));
}
```

- `AxRuntimeExecutionError` is thrown when the runtime reaches the configured consecutive execution failure cutoff.
- The cutoff counter resets on successful execution.
- Preflight guardrail errors are not counted toward the cutoff.
- For custom errors thrown in the worker, use `e.name` checks if prototype identity is not preserved across the worker boundary.

### Custom Interpreters

The built-in `AxJSRuntime` uses Web Workers for sandboxed code execution. For other environments, implement the `AxCodeRuntime` interface:

```typescript
import type { AxCodeRuntime, AxCodeSession } from '@ax-llm/ax';

class MyBrowserInterpreter implements AxCodeRuntime {
  getUsageInstructions?(): string {
    return 'Runtime-specific guidance for writing code in this environment.';
  }

  createSession(globals?: Record<string, unknown>): AxCodeSession {
    // Set up your execution environment with globals
    return {
      async execute(code: string) {
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
- `final(...args)` and `ask_clarification(...args)` completion functions
- `agents` namespace object with child agent functions (e.g., `agents.summarize(...)`)
- Agent functions under their namespaces (e.g., `utils.myFn(...)`, `db.search(...)`)
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

### `AxJSRuntime`

```typescript
new AxJSRuntime({
  timeout?: number;
  permissions?: readonly AxJSRuntimePermission[];
  outputMode?: 'return' | 'stdout';
  captureConsole?: boolean;
  allowUnsafeNodeHostAccess?: boolean;
  nodeWorkerPoolSize?: number;
  debugNodeWorkerPool?: boolean;
  consecutiveErrorCutoff?: number; // Cutoff for consecutive execution failures
});

runtime.resetConsecutiveErrorCounter(): void; // Resets runtime-level consecutive failure counter
```

### `AxRuntimeExecutionError`

Thrown by `AxJSRuntime` when consecutive execution failures reach `consecutiveErrorCutoff`. When this happens, the active runtime session is exited. Preflight guardrail errors are not counted toward this cutoff.

### `AxRLMConfig`

```typescript
interface AxRLMConfig {
  contextFields: string[];                   // Input fields holding long context
  runtime?: AxCodeRuntime;                   // Code runtime (default: AxJSRuntime)
  maxSubAgentCalls?: number;                      // Cap on sub-LM calls (default: 50)
  maxRuntimeChars?: number;                  // Cap for llmQuery context + code output (default: 5000)
  maxBatchedLlmQueryConcurrency?: number;    // Max parallel batched llmQuery calls (default: 8)
  maxTurns?: number;                         // Max Actor turns before forcing Responder (default: 10)
  trajectoryPruning?: boolean;               // @deprecated Use contextManagement.errorPruning instead
  contextManagement?: AxContextManagementConfig; // Semantic context management
  actorFields?: string[];                    // Output fields produced by Actor instead of Responder
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;  // Called after each Actor turn
  mode?: 'simple' | 'advanced';                  // Sub-query mode: 'simple' = AxGen, 'advanced' = AxAgent (default: 'simple')
}

interface AxContextManagementConfig {
  errorPruning?: boolean;                    // Prune error entries after successful turns
  tombstoning?: boolean | Omit<AxProgramForwardOptions<string>, 'functions'>; // Replace resolved errors with compact summaries
  hindsightEvaluation?: boolean;             // Heuristic importance scoring on entries
  stateInspection?: { contextThreshold?: number }; // Enable inspect_runtime() tool
  pruneRank?: number;                        // Entries ranked below this are purged (0-5, default: 2)
}
```

### `AxCodeRuntime`

```typescript
interface AxCodeRuntime {
  getUsageInstructions?(): string;
  createSession(globals?: Record<string, unknown>): AxCodeSession;
}
```

### `AxCodeSession`

```typescript
interface AxCodeSession {
  execute(code: string, options?: { signal?: AbortSignal });
  close(): void;
}
```

### `AxAgentConfig`

```typescript
interface AxAgentConfig<IN, OUT> extends AxAgentOptions {
  ai?: AxAIService;
  agentIdentity?: { name: string; description: string };
}
```

### `AxAgentFunction`

```typescript
type AxAgentFunction = {
  name: string;
  description: string;
  parameters: AxFunctionJSONSchema;  // required
  returns?: AxFunctionJSONSchema;    // optional output schema
  namespace?: string;                // default: 'utils'
  func: AxFunctionHandler;
};
```

Agent functions are registered as namespaced globals in the JS runtime (e.g. `utils.search`, `db.query`). Reserved namespaces: `agents`, `llmQuery`, `final`, `ask_clarification`.

### `AxAgentOptions`

Extends `AxProgramForwardOptions` (without `functions` or `description`) with:

```typescript
{
  debug?: boolean;
  contextFields: string[];               // Input fields loaded into JS runtime (removed from LLM prompt)

  agents?: {
    local?: AxAnyAgentic[];              // Callable under agents.* in this agent
    shared?: AxAnyAgentic[];             // Propagated one level to direct children
    globallyShared?: AxAnyAgentic[];     // Propagated recursively to all descendants
    excluded?: string[];                 // Agent names NOT to receive from parents
  };

  fields?: {
    local?: string[];                    // Keep shared/global fields visible in this agent
    shared?: string[];                   // Fields passed to direct child agents
    globallyShared?: string[];           // Fields passed to all descendants
    excluded?: string[];                 // Fields NOT to receive from parents
  };

  functions?: {
    local?: AxAgentFunction[];           // Namespaced globals in this agent's JS runtime
    shared?: AxAgentFunction[];          // Propagated one level to direct children
    globallyShared?: AxAgentFunction[];  // Propagated recursively to all descendants
    excluded?: string[];                 // Function names NOT to receive from parents
  };

  runtime?: AxCodeRuntime;
  maxSubAgentCalls?: number;
  maxRuntimeChars?: number;
  maxBatchedLlmQueryConcurrency?: number;
  maxTurns?: number;
  contextManagement?: AxContextManagementConfig;
  actorFields?: string[];
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
  mode?: 'simple' | 'advanced';

  recursionOptions?: Partial<Omit<AxProgramForwardOptions, 'functions'>> & {
    maxDepth?: number;  // Maximum recursion depth for llmQuery sub-agent calls (default: 2)
  };
  actorOptions?: Partial<AxProgramForwardOptions & { description?: string }>;
  responderOptions?: Partial<AxProgramForwardOptions & { description?: string }>;
}
```

### `stop()`

```typescript
public stop(): void
```

Available on `AxAgent`, `AxGen`, and `AxFlow`. Stops an in-flight `forward()` or `streamingForward()` call, causing it to throw `AxAIServiceAbortedError`. See [Stopping Agents](#stopping-agents).
