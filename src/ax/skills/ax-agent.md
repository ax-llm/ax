---
name: ax-agent
description: This skill helps an LLM generate correct AxAgent code using @ax-llm/ax. Use when the user asks about agent(), child agents, namespaced functions, discovery mode, shared fields, llmQuery(...), or RLM code execution.
version: "__VERSION__"
---

# AxAgent Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxAgent` code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- Prefer namespaced functions such as `utils.search(...)` or `kb.find(...)`.
- Assume the child-agent module is `agents` unless `agentIdentity.namespace` is set.
- If `functions.discovery` is `true`, discover callables from modules before using them.
- In stdout-mode RLM, use one observable `console.log(...)` step per non-final actor turn.

## Critical Rules

- Use `agent(...)` factory syntax for new code.
- If `agentIdentity.namespace` is set, call child agents through that module, not `agents`.
- If `functions.discovery` is `true`, call `listModuleFunctions(...)` first, then `getFunctionDefinitions(...)`, then call only discovered functions.
- In stdout-mode RLM, non-final turns must emit exactly one `console.log(...)` and stop immediately after it.
- Never combine `console.log(...)` with `final(...)` or `ask_clarification(...)` in the same actor turn.
- If a child agent needs parent inputs such as `audience`, use `fields.shared` or `fields.globallyShared`.
- `llmQuery(...)` failures may come back as `[ERROR] ...`; do not assume success.

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
import type { AxFunction } from '@ax-llm/ax';

const tools: AxFunction[] = [
  {
    name: 'findSnippets',
    namespace: 'kb',
    description: 'Find handbook snippets by topic',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic keyword' },
      },
      required: ['topic'],
    },
    returns: {
      type: 'array',
      items: { type: 'string' },
    },
    func: async ({ topic }) => [],
  },
];

const analyst = agent('query:string -> answer:string', {
  functions: { local: tools },
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
- Errors from child-agent or tool calls appear in `Action Log`; inspect them and fix the code on the next turn.
- Non-final turns should contain exactly one `console.log(...)`.
- Final turns should call `final(...)` or `ask_clarification(...)` without `console.log(...)`.
- Do not write a complete multi-step program in one actor turn.

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
  contextManagement?: AxContextManagementConfig;
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
