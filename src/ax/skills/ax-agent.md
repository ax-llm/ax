---
name: ax-agent
description: This skill helps an LLM generate correct AxAgent code using @ax-llm/ax. Use when the user asks about agent(), child agents, namespaced functions, discovery mode, shared fields, llmQuery(...), or RLM code execution.
version: "__VERSION__"
---

# AxAgent Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxAgent` code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- Prefer `fn(...)` for host-side function definitions instead of hand-writing JSON Schema objects.
- Prefer namespaced functions such as `utils.search(...)` or `kb.find(...)`.
- Assume the child-agent module is `agents` unless `agentIdentity.namespace` is set.
- If `functions.discovery` is `true`, discover callables from modules before using them.
- In stdout-mode RLM, use one observable `console.log(...)` step per non-final actor turn.
- For long RLM tasks, prefer `contextPolicy: { preset: 'adaptive' }` so older successful turns collapse into checkpoint summaries while live runtime state stays visible.

## Context Policy Presets

Use these meanings consistently when writing or explaining `contextPolicy.preset`:

- `full`: Keep prior actions fully replayed. Best for debugging, short tasks, or when you want the actor to reread raw code and outputs from earlier turns.
- `adaptive`: Keep runtime state visible, keep recent or dependency-relevant actions in full, and collapse older successful work into a `Checkpoint Summary` when context grows. This is the default recommendation for long multi-turn tasks.
- `lean`: Most aggressive compression. Keep `Live Runtime State`, checkpoint older successful work, and summarize replay-pruned successful turns instead of showing their full code blocks. Use when token pressure matters more than raw replay detail.

Practical rule:

- Start with `adaptive` for most long RLM tasks.
- Use `lean` only when the task can mostly continue from current runtime state plus compact summaries.
- Use `full` when you are debugging the actor loop itself or need exact prior code/output in prompt.

## Critical Rules

- Use `agent(...)` factory syntax for new code.
- If `agentIdentity.namespace` is set, call child agents through that module, not `agents`.
- If `functions.discovery` is `true`, call `listModuleFunctions(...)` first, then `getFunctionDefinitions(...)`, then call only discovered functions.
- In stdout-mode RLM, non-final turns must emit exactly one `console.log(...)` and stop immediately after it.
- Never combine `console.log(...)` with `final(...)` or `ask_clarification(...)` in the same actor turn.
- If a host-side `AxAgentFunction` needs to end the current actor turn, use `extra.protocol.final(...)` or `extra.protocol.askClarification(...)`.
- If a child agent needs parent inputs such as `audience`, use `fields.shared` or `fields.globallyShared`.
- `llmQuery(...)` failures may come back as `[ERROR] ...`; do not assume success.
- If `contextPolicy.state.summary` is on, rely on the `Live Runtime State` block for current variables instead of re-reading old action log code.
- If `contextPolicy.preset` is `'adaptive'` or `'lean'`, assume older successful turns may be replaced by a `Checkpoint Summary` and that replay-pruned successful turns may appear as compact summaries instead of full code blocks.

## Canonical Pattern

```typescript
import { agent, ai, f } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const assistant = agent(
  f()
    .input('query', f.string())
    .output('answer', f.string())
    .build(),
  {
    agentIdentity: {
      name: 'Assistant',
      description: 'Answers user questions',
    },
    contextFields: [],
  }
);

const result = await assistant.forward(llm, { query: 'What is TypeScript?' });
console.log(result.answer);
```

## Child Agents And Module Namespace

Default child-agent module:

```typescript
const writer = agent('draft:string -> revision:string', {
  agentIdentity: {
    name: 'Writer',
    description: 'Polishes drafts',
  },
  contextFields: [],
});

const coordinator = agent('query:string -> answer:string', {
  agents: { local: [writer] },
  contextFields: [],
});
```

Generated runtime call:

```javascript
const result = await agents.writer({ draft: '...' });
```

Custom child-agent module:

```typescript
const writer = agent('draft:string -> revision:string', {
  agentIdentity: {
    name: 'Writer',
    description: 'Polishes drafts',
  },
  contextFields: [],
});

const coordinator = agent('query:string -> answer:string', {
  agentIdentity: {
    name: 'Coordinator',
    description: 'Routes work',
    namespace: 'team',
  },
  agents: { local: [writer] },
  contextFields: [],
});
```

Generated runtime call:

```javascript
const result = await team.writer({ draft: '...' });
```

Rules:

- Default child-agent module is `agents`.
- If `agentIdentity.namespace` is set, that becomes the child-agent module.
- Do not hardcode `agents.<name>(...)` when a custom namespace is configured.

## Tool Functions And Namespaces

```typescript
import { f, fn } from '@ax-llm/ax';

const tools = [
  fn('findSnippets')
    .description('Find handbook snippets by topic')
    .namespace('kb')
    .arg('topic', f.string('Topic keyword'))
    .returns(f.string('Matching snippet').array())
    .example({
      title: 'Find severity guidance',
      code: 'await kb.findSnippets({ topic: "severity" });',
    })
    .handler(async ({ topic }) => [])
    .build(),
];

const analyst = agent('query:string -> answer:string', {
  functions: {
    local: [
      {
        namespace: 'kb',
        title: 'Knowledge Base',
        selectionCriteria: 'Use for handbook and documentation lookups.',
        description: 'Handbook and documentation search helpers.',
        functions: tools.map(({ namespace: _namespace, ...tool }) => tool),
      },
    ],
  },
  contextFields: [],
});
```

Generated runtime call:

```javascript
const snippets = await kb.findSnippets({ topic: 'severity' });
```

Rules:

- Prefer namespaced functions.
- Default function namespace is `utils` when no namespace is set.
- Use the runtime call shape `await <namespace>.<name>({...})`.

## Host-Side Completion From Functions

Use this pattern when the actor should call a namespaced function, but the host-side function implementation should decide to end the turn:

```typescript
import { f, fn } from '@ax-llm/ax';

const workflowTools = [
  fn('finishReply')
    .description('Complete the actor turn with the final reply text')
    .namespace('workflow')
    .arg('reply', f.string('Final reply text'))
    .returns(f.string('Final reply text'))
    .handler(async ({ reply }, extra) => {
      extra?.protocol?.final(reply);
      return reply;
    })
    .build(),
  fn('askForOrderId')
    .description('Complete the actor turn by requesting clarification')
    .namespace('workflow')
    .arg('question', f.string('Clarification question'))
    .returns(f.string('Clarification question'))
    .handler(async ({ question }, extra) => {
      extra?.protocol?.askClarification(question);
      return question;
    })
    .build(),
];
```

Rules:

- `extra.protocol` is only available when the function call comes from an active AxAgent actor runtime session.
- Use `extra.protocol.final(...)` or `extra.protocol.askClarification(...)` only inside host-side function handlers.
- Inside actor-authored JavaScript, keep using the runtime globals `final(...)` and `ask_clarification(...)`.
- Do not model these protocol completions as normal registered tool functions or discovery entries.

## Discovery Mode

Enable discovery mode when you want the actor to discover modules and fetch callable definitions on demand:

```typescript
const analyst = agent('context:string, query:string -> answer:string', {
  agentIdentity: {
    name: 'Analyst',
    description: 'Analyzes long context',
    namespace: 'team',
  },
  contextFields: ['context'],
  agents: { local: [writer] },
  functions: {
    discovery: true,
    local: tools,
  },
});
```

Discovery APIs:

- `await listModuleFunctions(modules: string | string[])`
- `await getFunctionDefinitions(functions: string | string[])`

Both return Markdown.

- `listModuleFunctions(...)` only lists modules that actually have callable entries.
- Grouped modules render in the Actor prompt as `<namespace> - <selection criteria>` when criteria is provided.
- If a requested module does not exist, `listModuleFunctions(...)` returns a per-module markdown error without failing the whole call.
- `getFunctionDefinitions(...)` may include argument comments from schema descriptions and fenced code examples from `AxAgentFunction.examples`.

Rules:

1. Call `listModuleFunctions(...)`.
2. If you need multiple modules, use one batched array call such as `listModuleFunctions(['timeRange', 'schedulingOrganizer'])`.
3. Log or inspect the returned markdown directly. Do not wrap it in JSON or custom objects.
4. If you need multiple callable definitions, prefer one batched `getFunctionDefinitions([...])` call.
5. Do not split discovery into separate calls with `Promise.all(...)`.
6. Inspect the logged result.
7. Call `getFunctionDefinitions(...)` for only the callables you plan to use.
8. Inspect the logged result.
9. Call discovered functions and child agents.

Examples:

```javascript
const modules = await listModuleFunctions(['team', 'kb', 'utils']);
console.log(modules);
```

```javascript
const defs = await getFunctionDefinitions(['team.writer', 'kb.findSnippets']);
console.log(defs);
```

Do not:

- Do not guess callable names when discovery mode is on.
- Do not assume sub-agents live under `agents` if `agentIdentity.namespace` is configured.
- Do not dump large pre-known tool definitions into actor code when discovery mode is enabled.
- Do not use `Promise.all(...)` to fan out discovery calls across modules or definitions.
- Do not convert discovery markdown into JSON before logging or using it.

## RLM Actor Code Rules

Use these rules when generating actor JavaScript for RLM in stdout mode:

- Treat each actor turn as exactly one observable step.
- If you need to inspect a value, compute it, `console.log(...)` it, and stop immediately after that `console.log(...)`.
- On the next turn, read the logged result from `Action Log` before writing more code that depends on it.
- If the prompt contains `Live Runtime State`, treat it as the canonical view of current variables.
- Errors from child-agent or tool calls appear in `Action Log`; inspect them and fix the code on the next turn.
- Non-final turns should contain exactly one `console.log(...)`.
- Final turns should call `final(...)` or `ask_clarification(...)` without `console.log(...)`.
- Do not write a complete multi-step program in one actor turn.
- Do not assume older successful turns remain fully replayed; adaptive or lean policies may collapse them into a `Checkpoint Summary` block or compact action summaries.

## RLM Adaptive Replay

Prefer this configuration for long, multi-turn runtime analysis:

```typescript
const analyst = agent(
  'context:string, question:string -> answer:string, findings:string[]',
  {
    contextFields: ['context'],
    runtime: new AxJSRuntime(),
    maxTurns: 10,
    contextPolicy: {
      preset: 'adaptive',
      state: {
        summary: true,
        inspect: true,
        inspectThresholdChars: 2_000,
        maxEntries: 6,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 2_000,
      },
      expert: {
        pruneErrors: true,
        rankPruning: { enabled: true, minRank: 2 },
      },
    },
  }
);
```

Rules:

- Use `preset: 'full'` when the actor should keep seeing raw prior code and outputs with minimal compression.
- Use `preset: 'adaptive'` when the task needs runtime state across many turns but older successful work should collapse into checkpoint summaries while important recent steps can still stay fully replayed.
- Use `preset: 'lean'` when you want more aggressive compression and can rely mostly on current runtime state plus checkpoint summaries and compact action summaries.
- Use `state.summary` to inject a compact `Live Runtime State` block into the actor prompt.
- Use `state.inspect` with `inspectThresholdChars` so the actor is reminded to call `inspect_runtime()` when context grows.

Good pattern:

Turn 1:

```javascript
const defs = await getFunctionDefinitions(['kb.findSnippets']);
console.log(defs);
```

Turn 2:

```javascript
const snippets = await kb.findSnippets({ topic: 'severity' });
console.log(snippets);
```

Turn 3:

```javascript
final({ answer: '...' });
```

Invalid pattern:

```javascript
const defs = await getFunctionDefinitions(['kb.findSnippets']);
console.log(defs);
const snippets = await kb.findSnippets({ topic: 'severity' });
final(snippets);
```

Reason: this mixes observation and follow-up work in one turn.

## Shared Fields

If a child agent requires a parent field such as `audience`, prefer shared fields:

```typescript
const writingCoach = agent(
  'draft:string, audience:string -> revision:string',
  {
    agentIdentity: {
      name: 'Writing Coach',
      description: 'Polishes summaries for a target audience',
    },
    contextFields: [],
  }
);

const analyst = agent(
  'context:string, audience:string, query:string -> answer:string',
  {
    agents: { local: [writingCoach] },
    fields: { shared: ['audience'] },
    contextFields: ['context'],
  }
);
```

Generated runtime call:

```javascript
const polished = await agents.writingCoach({ draft: summary });
```

Rules:

- Use `fields.shared` for direct children.
- Use `fields.globallyShared` for all descendants.
- Do not manually thread a parent field on every child call when shared fields fit the use case.

## Shared Agents And Shared Functions

Use grouped config:

```typescript
const parent = agent('query:string -> answer:string', {
  agents: {
    local: [worker],
    shared: [logger],
    globallyShared: [auditor],
  },
  functions: {
    local: [searchTool],
    shared: [scoreTool],
    globallyShared: [traceTool],
  },
  contextFields: [],
});
```

Rules:

- `agents.shared` and `functions.shared` propagate one level down.
- `agents.globallyShared` and `functions.globallyShared` propagate to all descendants.
- Use `excluded` when a child should not receive a propagated field, agent, or function.

## `llmQuery(...)` Rules

Available forms:

- `await llmQuery(query, context?)`
- `await llmQuery({ query, context? })`
- `await llmQuery([{ query, context }, ...])`

Rules:

- `llmQuery(...)` forwards only the explicit `context` argument.
- Parent inputs are not automatically available to `llmQuery(...)` children.
- Single-call `llmQuery(...)` may return `[ERROR] ...` on non-abort failures.
- Batched `llmQuery([...])` returns per-item `[ERROR] ...`.
- If a result starts with `[ERROR]`, inspect or branch on it instead of assuming success.

Example:

```javascript
const summary = await llmQuery('Summarize this incident', inputs.context);
if (summary.startsWith('[ERROR]')) {
  console.log(summary);
} else {
  console.log(summary);
}
```

## Short API Reference

### `agentIdentity`

```typescript
agentIdentity?: {
  name: string;
  description: string;
  namespace?: string;
}
```

- `name` is normalized to camelCase for child-agent function names.
- `namespace` changes the child-agent module from default `agents` to a custom module such as `team`.

### `AxAgentOptions`

```typescript
{
  contextFields: readonly (string | { field: string; promptMaxChars?: number })[];

  agents?: {
    local?: AxAnyAgentic[];
    shared?: AxAnyAgentic[];
    globallyShared?: AxAnyAgentic[];
    excluded?: string[];
  };

  fields?: {
    local?: string[];
    shared?: string[];
    globallyShared?: string[];
    excluded?: string[];
  };

  functions?: {
    local?: AxFunction[];
    shared?: AxFunction[];
    globallyShared?: AxFunction[];
    excluded?: string[];
    discovery?: boolean;
  };

  runtime?: AxCodeRuntime;
  maxSubAgentCalls?: number;
  maxRuntimeChars?: number;
  maxBatchedLlmQueryConcurrency?: number;
  maxTurns?: number;
  contextPolicy?: AxContextPolicyConfig;
  actorFields?: string[];
  actorCallback?: (result: Record<string, unknown>) => void | Promise<void>;
  inputUpdateCallback?: (currentInputs: Record<string, unknown>) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  mode?: 'simple' | 'advanced';
  recursionOptions?: Partial<Omit<AxProgramForwardOptions, 'functions'>> & {
    maxDepth?: number;
  };
  actorOptions?: Partial<AxProgramForwardOptions & { description?: string }>;
  responderOptions?: Partial<AxProgramForwardOptions & { description?: string }>;
}
```

## Do Not Generate

- Do not use `new AxAgent(...)` for new code unless explicitly required.
- Do not assume child agents are always under `agents.*`.
- Do not guess function names in discovery mode.
- Do not write a full multi-step RLM actor program in one turn.
- Do not combine `console.log(...)` with `final(...)`.
- Do not forget `fields.shared` when child agents depend on parent inputs.
