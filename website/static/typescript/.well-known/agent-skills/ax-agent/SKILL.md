---
name: ax-agent
description: This skill helps an LLM generate correct core AxAgent code using @ax-llm/ax. Use when the user asks about agent(), child agents, namespaced functions, discovery mode, clarification, bubbleErrors, host-side final/clarification protocol, or ordinary agent runtime behavior. For RLM/code-runtime work use ax-agent-rlm; for callbacks and telemetry use ax-agent-observability; for recall/memory/skill loading use ax-agent-memory-skills; for agent.optimize(...) use ax-agent-optimize.
version: "22.0.7"
---

# AxAgent Codegen Rules (@ax-llm/ax)

Use this skill to generate small, correct `AxAgent` code. Prefer modern factory-style APIs and copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

Your job is to choose the smallest correct `AxAgent` shape for the user's needs:

- If the user wants a normal tool-using assistant, keep the config minimal.
- If the user wants long-running code execution, use the `ax-agent-rlm` skill.
- If the user wants callbacks, logs, tracing, or usage data, use the `ax-agent-observability` skill.
- If the user wants dynamic memory retrieval or skill-guide loading, use the `ax-agent-memory-skills` skill.
- If the user wants tuning or eval with `agent.optimize(...)`, use the `ax-agent-optimize` skill.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- Prefer string signatures or `f()` signatures over hand-written signature objects.
- Put `ai`, `judgeAI`, and `agentIdentity` on the `agent(...)` config when you want instance defaults or child-agent metadata.
- Prefer `fn(...)` for host-side function definitions instead of hand-writing JSON Schema objects.
- Prefer namespaced functions such as `utils.search(...)` or `kb.find(...)`.
- Pass child agents directly in `functions: [...]`. They land under their `agentIdentity.namespace` (or `utils` if unset), exactly like a `fn()` tool.
- If discovery is enabled, call `discover(...)` before using callables whose docs are not already in the prompt.
- Use explicit child agents in `functions: [...]` for specialist delegation; do not model that as recursive `llmQuery(...)`.
- Add `bubbleErrors` only for fatal infrastructure errors that should abort `.forward()`.

## Decision Guide

Map user intent to agent shape before writing code:

- "Use tools and answer" -> plain `agent(...)` with local functions, no extra observability.
- "Need child agents with distinct responsibilities" -> add child agents to the parent's `functions: [...]` list and set each child's `agentIdentity.namespace` when you want a specific runtime call site such as `team.writer(...)`.
- "Need tool discovery because names/schemas are not stable" -> enable discovery and generate discovery-first actor code.
- "Need certain errors to escape the agent loop" -> add `bubbleErrors` with error classes; those errors propagate through function handlers, actor code, and `llmQuery(...)` sub-queries to `.forward()`.
- "Inspect large context with code", "RLM", or "`llmQuery(...)`" -> use `ax-agent-rlm`.
- "Need debugging, traces, progress updates, tool-call logs, chat logs, or usage" -> use `ax-agent-observability`.
- "Need memories, recall, dynamic skill guides, `discover({ skills })`, or loaded/used tracking" -> use `ax-agent-memory-skills`.

## Critical Rules

- Use `agent(...)` factory syntax for new code.
- Add child agents to the parent's `functions: [...]` list. Each child's `agentIdentity.namespace` (or `utils`, the default) determines the runtime call site, e.g. `await team.writer({...})`.
- If discovery is enabled, call `discover(...)` before using callables whose docs are not already in the prompt.
- If a host-side `AxAgentFunction` needs to end the current actor turn, use `extra.protocol.final(...)` or `extra.protocol.askClarification(...)`.
- In public `forward()` and `streamingForward()` flows, `askClarification(...)` throws `AxAgentClarificationError`; it does not go through the responder.
- When resuming after clarification, prefer `error.getState()` from the thrown `AxAgentClarificationError`, then call `agent.setState(savedState)` before the next `forward(...)`.
- Errors listed in `bubbleErrors` bypass actor-loop catch blocks and propagate directly to the caller of `.forward()`.
- Child agents receive only the arguments the actor passes. Pass parent fields explicitly via `inputs.<field>` or use `inputUpdateCallback` when many calls need the same value.
- Audio input fields are transcribed before agent planner/executor/responder stages by default; internal agent stages receive text transcripts, not base64 audio.

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

## Audio Inputs And Speech Outputs

Agents can accept audio inputs and return scripted speech artifacts. The runtime transcribes audio input fields before internal stages run, then synthesizes `:audio` outputs after the final structured response is selected.

```typescript
const voiceAgent = agent(
  'recording:audio, question:string -> speech:audio, summary:string',
  {
    agentIdentity: {
      name: 'Voice Assistant',
      description: 'Answers spoken requests',
    },
    contextFields: [],
  }
);

const result = await voiceAgent.forward(
  llm,
  {
    recording: { data: base64Wav, format: 'wav' },
    question: 'What should I do next?',
  },
  {
    speech: {
      transcribe: { model: 'gpt-4o-mini-transcribe' },
      speak: { voice: 'alloy', format: 'mp3' },
    },
  }
);

console.log(result.summary);
console.log(result.speech.data);
```

Use direct `ax(...)` or `.chat()` if the model should receive native audio instead of a transcript-first agent pipeline.

## Child Agents As Tools

Child agents are passed in the parent's `functions` list. There is no separate `agents` option for new code. Each child agent's `agentIdentity.namespace` (or `utils`, the default) determines where it lands in the actor runtime. With `AxJSRuntime`, that produces JavaScript call sites such as `team.writer(...)`:

```typescript
const writer = agent('draft:string -> revision:string', {
  agentIdentity: {
    name: 'Writer',
    description: 'Polishes drafts',
    namespace: 'team',
  },
  contextFields: [],
});

const coordinator = agent('query:string -> answer:string', {
  functions: [writer],
  contextFields: [],
});
```

Generated runtime call:

```javascript
const result = await team.writer({ draft: '...' });
```

Without `agentIdentity.namespace`, the child lands under `utils.<name>` like any other tool:

```javascript
const result = await utils.writer({ draft: '...' });
```

Rules:

- Add child agents to `functions: [...]`, the same array as `fn(...)` tools.
- Set `agentIdentity.namespace` on the child to control its runtime call site.
- `onFunctionCall` observers receive `kind: 'internal'` for agent-derived calls and `kind: 'external'` for user-registered tools.

### Reserved namespace names

The agent runtime injects a fixed set of globals into the runtime session. These names cannot be used as `agentIdentity.namespace` values or as agent-function namespaces.

```text
inputs
llmQuery
final
askClarification
reportSuccess
reportFailure
inspectRuntime
discover
recall
```

Pick any other lowercase identifier such as `utils`, `kb`, `tools`, `team`, or `db`.

## Tool Functions And Namespaces

```typescript
import { agent, f, fn } from '@ax-llm/ax';

const findSnippets = fn('findSnippets')
  .description('Find handbook snippets by topic')
  .namespace('kb')
  .arg('topic', f.string('Topic keyword'))
  .returns(f.string('Matching snippet').array())
  .example({
    title: 'Find severity guidance',
    code: 'await kb.findSnippets({ topic: "severity" });',
  })
  .handler(async ({ topic }) => [])
  .build();

const analyst = agent('query:string -> answer:string', {
  functions: [findSnippets],
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
- With `AxJSRuntime`, use the runtime call shape `await <namespace>.<name>({...})`. Custom runtimes should expose equivalent namespaced calls through their own `formatCallable()` guidance.
- `.arg()` and `.returns()` can use Ax field helpers or any Standard Schema v1 validator directly.

## Grouped Function Modules

For discovery mode, group functions into modules using the `AxAgentFunctionGroup` shape when you want a clean namespace tree such as `kb.find(...)` or `metrics.score(...)` without setting `namespace` on every individual `fn(...)`:

```typescript
const parent = agent('query:string -> answer:string', {
  functions: [
    {
      namespace: 'kb',
      title: 'Knowledge Base',
      selectionCriteria: 'Use for handbook and documentation lookups.',
      description: 'Knowledge base lookups',
      functions: [findSnippetsFn, searchPagesFn],
    },
    {
      namespace: 'workflow',
      title: 'Workflow Controls',
      description: 'Small control functions the actor should always see',
      alwaysInclude: true,
      functions: [completeFn],
    },
  ],
  functionDiscovery: true,
  contextFields: [],
});
```

MCP clients and other `toFunction()` providers can be placed directly inside a group after initialization:

```typescript
await mcpClient.init();

const parent = agent('query:string -> answer:string', {
  functions: [
    {
      namespace: 'memory',
      title: 'Memory MCP',
      description: 'Memory server tools',
      selectionCriteria: 'Use for persistent memory lookup and updates.',
      functions: [mcpClient],
    },
  ],
  functionDiscovery: true,
  contextFields: [],
});
```

Rules:

- A group is `{ namespace, title, description, functions: [...] }`.
- `selectionCriteria` is optional but useful in discovery mode; it tells the actor when to choose that module.
- The group's `namespace`, `title`, `selectionCriteria`, and `description` show up in `discover(...)` module docs.
- Add `alwaysInclude: true` to a group when discovery mode is on but the actor should always see that group's full callable definitions inline in the prompt.
- Keep `functions: [...]` either flat or grouped. Runtime validation rejects mixed plain function entries and group objects.
- In flat mode, pass `fn(...)` tools, child agents, and `toFunction()` providers directly.
- In grouped mode, put callable entries and `toFunction()` providers inside groups. To expose a child agent inside a group, use `childAgent.getFunction()`.

## Host-Side Completion From Functions

Use this pattern when the actor should call a namespaced function, but the host-side function implementation should decide to end the turn:

```typescript
import { f, fn } from '@ax-llm/ax';

const finishReply = fn('finishReply')
  .description('Complete the actor turn with the final reply text')
  .namespace('workflow')
  .arg('reply', f.string('Final reply text'))
  .returns(f.string('Final reply text'))
  .handler(async ({ reply }, extra) => {
    extra?.protocol?.final(reply);
    return reply;
  })
  .build();

const askForOrderId = fn('askForOrderId')
  .description('Complete the actor turn by requesting clarification')
  .namespace('workflow')
  .arg('question', f.string('Clarification question'))
  .returns(f.string('Clarification question'))
  .handler(async ({ question }, extra) => {
    extra?.protocol?.askClarification(question);
    return question;
  })
  .build();
```

Rules:

- `extra.protocol` is only available when the function call comes from an active AxAgent actor runtime session.
- Use `extra.protocol.final(...)`, `extra.protocol.askClarification(...)`, or `extra.protocol.guideAgent(...)` only inside host-side function handlers.
- Inside actor-authored runtime code, use the runtime globals `final(...)` and `askClarification(...)` with the syntax documented by the active runtime.
- `extra.protocol.guideAgent(...)` is handler-only internal control flow. It stops the current actor turn and appends trusted guidance to `guidanceLog` for the next iteration.
- `askClarification(...)` accepts either a simple string or a structured object with `question` plus optional UI hints such as `type: 'date' | 'number' | 'single_choice' | 'multiple_choice'` and `choices`.

## Clarification And Resume State

Use this pattern when the actor should pause for user input and continue later from the same runtime state.

```typescript
import {
  AxAgentClarificationError,
  AxJSRuntime,
  agent,
  ai,
} from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const tripAgent = agent('request:string, answer?:string -> reply:string', {
  contextFields: [],
  runtime: new AxJSRuntime(),
});

let savedState = tripAgent.getState();

try {
  await tripAgent.forward(llm, {
    request: 'Plan a Lisbon trip',
  });
} catch (error) {
  if (error instanceof AxAgentClarificationError) {
    console.log(error.question);
    savedState = error.getState();
  } else {
    throw error;
  }
}

if (savedState) {
  tripAgent.setState(savedState);
  const resumed = await tripAgent.forward(llm, {
    request: 'Plan a Lisbon trip',
    answer: 'June 1-5',
  });
  console.log(resumed.reply);
}
```

Public flow rules:

- `forward()` and `streamingForward()` throw `AxAgentClarificationError` when the actor calls `askClarification(...)`.
- Successful `final(...)` completions always continue through the responder in public flows.
- `AxAgentClarificationError.question` is the user-facing question text.
- `AxAgentClarificationError.clarification` is the normalized structured payload.
- `AxAgentClarificationError.getState()` returns the saved continuation state captured at throw time.
- `agent.getState()` and `agent.setState(...)` export or restore continuation state on the agent instance.
- `test(...)` is different: it returns structured completion payloads for harness/debug use instead of throwing clarification exceptions.

Structured clarification payloads:

- String shorthand is allowed: `askClarification("What dates should I use?")`.
- Structured form is preferred for richer chat UIs:

```javascript
askClarification({
  question: 'Which route should I use?',
  type: 'single_choice',
  choices: ['Fastest', 'Scenic'],
});
```

- Supported `type` values are `text`, `number`, `date`, `single_choice`, and `multiple_choice`.
- `single_choice` payloads with missing, empty, or malformed `choices` are downgraded to a plain clarification question instead of failing the turn.
- `multiple_choice` payloads must include at least two valid choices; otherwise the actor turn fails with a corrective runtime error.
- Choice entries may be strings or `{ label, value? }` objects.
- Invalid clarification payloads such as a missing `question` are actor-turn runtime errors, not successful clarification completions.

State notes:

- `runtimeBindings` restores execution state; `runtimeEntries`, `actionLogEntries`, and `checkpointState` restore prompt context.
- Resume does not create a fake rehydration action-log turn; provenance still points to the original actor code that set the value.
- Only serializable/structured-clone-friendly values are guaranteed to round-trip through `getState()` / `setState(...)`.
- Reserved runtime globals such as `inputs`, tools, and protocol helpers are rebuilt fresh and are not part of saved state.
- Treat one agent instance as conversation-scoped when using `setState(...)`; do not share one mutable resumed instance across unrelated concurrent conversations.

## Bubble Errors

Use `bubbleErrors` when certain exceptions thrown inside function handlers or `llmQuery(...)` sub-query calls should propagate all the way out to `.forward()` instead of being caught by the actor loop and returned as `[ERROR]` strings.

```typescript
import { agent, f, fn } from '@ax-llm/ax';

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

const dbTool = fn('queryUsers')
  .description('Query the user database')
  .namespace('db')
  .arg('filter', f.string('Filter expression'))
  .returns(f.string('JSON result'))
  .handler(async ({ filter }) => {
    if (!isConnected()) throw new DatabaseError('DB connection refused');
    return JSON.stringify(await db.query(filter));
  })
  .build();

const myAgent = agent('query:string -> answer:string', {
  contextFields: [],
  functions: [dbTool],
  bubbleErrors: [DatabaseError],
});
```

Rules:

- `bubbleErrors` takes an array of Error constructor classes, checked via `instanceof`.
- A matching error thrown inside a function handler, during actor code execution, or inside an `llmQuery(...)` sub-query propagates immediately to `.forward()`.
- Use `bubbleErrors` for fatal infrastructure errors such as DB down, auth failure, or quota exceeded.
- Do not use `bubbleErrors` for expected recoverable errors; let those return as `[ERROR] ...` strings so the actor can handle them.
- `AxAgentClarificationError` and `AxAIServiceAbortedError` always bubble up unconditionally.

## Unified Final Signal

There are two ways to end a successful run through the responder:

1. In actor JS code, call `final(message)` when no extra context object is needed, or `final(task, context)` when you gathered evidence.
2. In function handlers, use `extra.protocol.final(...)` with the same one-arg or two-arg forms.

Rules:

- Use `final(message)` when the actor already knows the answer and no extra context object is needed.
- Use `final(task, context)` when context was gathered and needs synthesis into output fields.
- In function handlers, use `extra.protocol.final(...)` instead of a separate respond API.
- The responder still runs for both successful `final(...)` forms.
- Use `askClarification(...)` when the user must provide more information to continue.

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
  functions: [writer, ...tools],
  functionDiscovery: true,
});
```

Discovery API:

- `await discover(item: string): void`
- `await discover(items: string[]): void`
- `await discover({ tools?: string | string[], skills?: string | string[] }): void` when `onSkillsSearch` is configured

Discovery returns `void`; fetched docs render in the next executor prompt.

Rules:

- `discover('kb')` loads a module callable list when `kb` is a discoverable module.
- `discover('kb.findSnippets')` loads a full callable definition.
- `discover('lookup')` resolves as `utils.lookup`.
- `discover({ tools: ['kb'], skills: ['release-checklist'] })` loads tool docs and skill bodies in one turn.
- Call one batched `discover(...)` with every module, callable, and skill you need.
- Do not split discovery into separate calls or wrap discovery in `Promise.all(...)`.
- Read the next prompt's "Discovered Tool Docs" and "Loaded Skills" sections.
- If a guessed call fails, stop guessing nearby names. Run `discover(...)` for that module or function and call only the exact discovered qualified name.

## Threading Parent Fields Into Child Agents

If a child agent requires a parent field such as `audience`, declare it on the child's signature and pass it explicitly when calling the child from the actor:

```typescript
const writingCoach = agent('draft:string, audience:string -> revision:string', {
  agentIdentity: {
    name: 'Writing Coach',
    description: 'Polishes summaries for a target audience',
    namespace: 'team',
  },
  contextFields: [],
});

const analyst = agent('context:string, audience:string, query:string -> answer:string', {
  functions: [writingCoach],
  contextFields: ['context'],
});
```

Generated runtime call:

```javascript
const polished = await team.writingCoach({
  draft: summary,
  audience: inputs.audience,
});
```

Rules:

- Pass parent fields explicitly via the call site.
- If many children need the same field on every call, use `inputUpdateCallback` to inject the value before each executor turn.
- Do not assume auto-propagation; child agents receive only the args the actor passes.

## Core API Reference

Factory shape:

```typescript
agent(signature, {
  ai,
  judgeAI,
  agentIdentity,
  contextFields,
  functions,
  functionDiscovery,
  ...agentOptions,
});
```

- `ai` is an optional default service for the agent instance; `.forward(ai, ...)` can still pass the runtime service.
- `judgeAI` is the optional default judge/teacher service used by optimize flows.
- `agentIdentity` controls the user-facing agent identity and child-agent function metadata.

```typescript
agentIdentity?: {
  name: string;
  description: string;
  namespace?: string;
}
```

- `name` is normalized to camelCase for child-agent function names.
- `name` and `description` are included in the actor and responder prompts as the user-facing agent identity.
- `namespace` changes the child-agent module from default `utils` to a custom module such as `team`.

Each `contextFields` entry is either a plain field name string or an object controlling how much of the value is inlined into the distiller prompt:

- `{ field, promptMaxChars: N }`: inline only when the serialized value is at most `N` chars; otherwise omit it from the prompt and keep it runtime-only.
- `{ field, keepInPromptChars: N, reverseTruncate?: boolean }`: always inline a truncated string excerpt; `reverseTruncate: true` keeps the last `N` chars.

Use `promptMaxChars` when partial data is worse than no data. Use `keepInPromptChars` when a prefix or suffix alone is useful. The two options are mutually exclusive on one field.

## Public Surface

Use these method groups as the compact AxAgent surface map:

- Running: `forward(ai, values, options?)` and `streamingForward(ai, values, options?)`.
- Forward-time agent options: `skills`, `onUsedMemories`, and `onUsedSkills`; use `ax-agent-memory-skills` for details.
- State and control: `getState()`, `setState(state?)`, `getContextMap()`, `setContextMap(map?)`, `stop()`, `getSignature()`, `setSignature(signature)`, `getFunction()`, `getId()`, and `setId(id)`. Context-map evolve policy lives on `AxAgentContextMap` (`infiniteEvolve`, `evolveSteps`, `maxChars`), not on the agent config. See [`src/examples/rlm-context-map-live.ts`](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-context-map-live.ts) for provider-backed persistence and finite-evolve usage.
- Observability: `getChatLog()`, `getUsage()`, `getStagedUsage()`, `resetUsage()`, and `getTraces()`; use `ax-agent-observability` for details.
- Demos and tuning: `setDemos(...)`, `namedPrograms()`, `namedProgramInstances()`, `optimize(...)`, `applyOptimization(...)`, `getOptimizableComponents()`, and `applyOptimizedComponents(...)`; use `ax-agent-optimize` for tuning details.

Rules:

- `getFunction()` requires `agentIdentity` because the agent needs function metadata when used as a child tool.
- Prefer `.forward(...)` for normal runs and `.streamingForward(...)` only when the caller needs streamed responder output.
- `setSignature(...)` must preserve configured `contextFields`; it throws if a configured context field is missing from the new signature.
- Treat low-level optimization component methods as advanced hooks; normal examples should use `agent.optimize(...)` and `agent.applyOptimization(...)`.

## Tuning Hand-off

When the user wants `agent.optimize(...)`, judge configuration, eval datasets, saved optimization artifacts, or optimization guidance, use `ax-agent-optimize`.

Keep this skill focused on building and running agents. For tuning work:

- use eval-safe tools
- treat `judgeOptions` as part of the optimize workflow
- choose an objective `metric` when scoring is mechanical; use the built-in judge only when run quality needs qualitative review
- keep runtime authoring guidance here and optimization guidance in `ax-agent-optimize`

## Examples

Fetch these for full working code:

- [Agent](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/agent.ts) - basic agent
- [Functions](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/function.ts) - function validation
- [Food Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/food-search.ts) - API tools
- [Smart Home](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/smart-home.ts) - state management
- [Customer Support](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/customer-support.ts) - classification agent
- [Abort Patterns](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/abort-patterns.ts) - abort handling

RLM examples are listed in `ax-agent-rlm`. Memory/skills examples are listed in `ax-agent-memory-skills`.

## Do Not Generate

- Do not use `new AxAgent(...)` for new code unless explicitly required.
- Do not assume child agents are always under `agents.*`.
- Do not guess function names in discovery mode.
- Do not write a full multi-step RLM actor program in one turn; use `ax-agent-rlm`.
- Do not combine `console.log(...)` with `final(...)`.
- Do not add `bubbleErrors` for ordinary recoverable tool errors.
- Do not call `discover()` from the distiller or responder stages.
- Do not assign or inspect the return value of `await discover(...)`; read the next prompt instead.
- Do not loop `discover()` calls or wrap them in `Promise.all`.
