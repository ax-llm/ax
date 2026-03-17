---
name: ax-agent
description: This skill helps an LLM generate correct AxAgent code using @ax-llm/ax. Use when the user asks about agent(), child agents, namespaced functions, discovery mode, shared fields, llmQuery(...), RLM code execution, or offline tuning with agent.optimize(...).
version: "__VERSION__"
---

# AxAgent Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxAgent` code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- Prefer `fn(...)` for host-side function definitions instead of hand-writing JSON Schema objects.
- Prefer namespaced functions such as `utils.search(...)` or `kb.find(...)`.
- Assume the child-agent module is `agents` unless `agentIdentity.namespace` is set.
- Use `agent.optimize(...)` when the user wants to tune a fully configured agent against task datasets.
- If `functions.discovery` is `true`, discover callables from modules before using them.
- In stdout-mode RLM, use one observable `console.log(...)` step per non-final actor turn.
- For long RLM tasks, prefer `contextPolicy: { preset: 'adaptive' }` so older successful turns collapse into checkpoint summaries while live runtime state stays visible.

## Mental Model

Treat `AxAgent` as a long-running JavaScript REPL that the actor steers over multiple turns, not as a fresh script generator on every turn.

- Successful code leaves variables, functions, imports, and computed values available in the runtime session.
- The actor should continue from existing runtime state instead of recreating prior work.
- `Action Log`, `Live Runtime State`, and checkpoint summaries only control what the actor can see again in the prompt.
- Rebuild state only after an explicit runtime restart notice or when you intentionally need to overwrite a value.

## Context Policy Presets

Use these meanings consistently when writing or explaining `contextPolicy.preset`:

- `full`: Keep prior actions fully replayed. Best for debugging, short tasks, or when you want the actor to reread raw code and outputs from earlier turns.
- `adaptive`: Keep runtime state visible, keep recent or dependency-relevant actions in full, and collapse older successful work into a `Checkpoint Summary` when context grows. This is the default recommendation for long multi-turn tasks.
- `lean`: Most aggressive compression. Keep `Live Runtime State`, checkpoint older successful work, and summarize replay-pruned successful turns instead of showing their full code blocks. Use when token pressure matters more than raw replay detail.

Practical rule:

- Start with `adaptive` for most long RLM tasks.
- Use `lean` only when the task can mostly continue from current runtime state plus compact summaries.
- Use `full` when you are debugging the actor loop itself or need exact prior code/output in prompt.

Important:

- `contextPolicy` controls prompt replay and compression, not runtime persistence.
- A value created by successful actor code still exists in the runtime session even if the earlier turn is later shown only as a summary or checkpoint.
- Used discovery docs are replay artifacts too: `adaptive` and `lean` can hide old `listModuleFunctions(...)` / `getFunctionDefinitions(...)` output after the actor successfully uses the discovered callable.
- Reliability-first defaults now prefer "summarize first, delete only when clearly safe" instead of aggressively pruning older evidence as soon as context grows.

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
- In public `forward()` and `streamingForward()` flows, `ask_clarification(...)` does not go through the responder; it throws `AxAgentClarificationError`.
- When resuming after clarification, prefer `error.getState()` from the thrown `AxAgentClarificationError`, then call `agent.setState(savedState)` before the next `forward(...)`.
- For offline tuning, prefer eval-safe tools or in-memory mocks because `agent.optimize(...)` will replay tasks many times.

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
- `ask_clarification(...)` accepts either a simple string or a structured object with `question` plus optional UI hints such as `type: 'date' | 'number' | 'single_choice' | 'multiple_choice'` and `choices`.
- Do not model these protocol completions as normal registered tool functions or discovery entries.

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

- `forward()` and `streamingForward()` throw `AxAgentClarificationError` when the actor calls `ask_clarification(...)`.
- The responder is skipped for clarification in those public flows.
- `AxAgentClarificationError.question` is the user-facing question text.
- `AxAgentClarificationError.clarification` is the normalized structured payload.
- `AxAgentClarificationError.getState()` returns the saved continuation state captured at throw time.
- `agent.getState()` and `agent.setState(...)` are the lower-level APIs for explicitly exporting or restoring continuation state on the agent instance.
- `test(...)` is different: it still returns structured completion payloads for harness/debug use instead of throwing clarification exceptions.

Structured clarification payloads:

- String shorthand is allowed: `ask_clarification("What dates should I use?")`.
- Structured form is preferred for richer chat UIs:

```javascript
ask_clarification({
  question: 'Which route should I use?',
  type: 'single_choice',
  choices: ['Fastest', 'Scenic'],
});
```

- Supported `type` values are `text`, `number`, `date`, `single_choice`, and `multiple_choice`.
- Choice payloads require a non-empty `choices` array.
- Choice entries may be strings or `{ label, value? }` objects.
- Invalid clarification payloads are treated as actor-turn runtime errors, not as successful clarification completions.

What `AxAgentState` contains:

- `version`: serialized state schema version.
- `runtimeBindings`: the actual restorable JavaScript globals, limited to serializable values.
- `runtimeEntries`: inspect-style metadata for prompt rendering, including summary-only non-restorable values.
- `actionLogEntries`: prior actor turns that should still be replayed after resume.
- `checkpointState`: checkpoint summary text plus the covered turns when checkpointing was active.
- `provenance`: per-binding metadata for the last actor code that set that variable.

Practical notes:

- `runtimeBindings` restores execution state; `runtimeEntries`, `actionLogEntries`, and `checkpointState` restore prompt context.
- Resume does not create a fake rehydration action-log turn; provenance still points to the original actor code that set the value.
- When `contextPolicy.state.summary` is enabled, resumed prompts include `Runtime Restore` plus `Live Runtime State`.
- When `contextPolicy.state.summary` is disabled, restore still happens, but the prompt only shows the restore notice and omits the `Live Runtime State` block.
- Only serializable/structured-clone-friendly values are guaranteed to round-trip through `getState()` / `setState(...)`.
- Reserved runtime globals such as `inputs`, tools, and protocol helpers are rebuilt fresh and are not part of saved state.
- Treat one agent instance as conversation-scoped when using `setState(...)`; do not share one mutable resumed instance across unrelated concurrent conversations.

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
10. If a guessed call fails with `TypeError`, `... is not a function`, or discovery `Not found`, stop guessing nearby names. Re-run `listModuleFunctions(...)`, then `getFunctionDefinitions(...)`, inspect the markdown again, and call only the exact discovered qualified name.
11. If tool docs or tool error messages specify an exact literal, type, or query format, reuse that exact documented value instead of synonyms or inferred aliases.

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
- Do not guess alternate callable names after invalid callable errors.
- Do not assume sub-agents live under `agents` if `agentIdentity.namespace` is configured.
- Do not dump large pre-known tool definitions into actor code when discovery mode is enabled.
- Do not use `Promise.all(...)` to fan out discovery calls across modules or definitions.
- Do not convert discovery markdown into JSON before logging or using it.
- If used discovery docs disappear from later prompts under `adaptive` or `lean`, call `listModuleFunctions(...)` or `getFunctionDefinitions(...)` again when you need to re-open them.

## RLM Actor Code Rules

Use these rules when generating actor JavaScript for RLM in stdout mode:

- Treat each actor turn as exactly one observable step.
- Inspect what already exists before recomputing it. If a prior turn successfully created a value, prefer reusing that runtime value.
- If you need to inspect a value, compute it or read it, `console.log(...)` it, and stop immediately after that `console.log(...)`.
- On the next turn, continue from the existing runtime state and use the logged result from `Action Log` only as evidence for what happened.
- If the prompt contains `Live Runtime State`, treat it as the canonical view of current variables.
- Errors from child-agent or tool calls appear in `Action Log`; inspect them and fix the code on the next turn.
- Non-final turns should contain exactly one `console.log(...)`.
- Final turns should call `final(...)` or `ask_clarification(...)` without `console.log(...)`.
- Do not write a complete multi-step program in one actor turn.
- Do not re-declare or recompute values just because older turns are summarized; only rebuild after an explicit runtime restart or when you intentionally want a new value.
- Do not assume older successful turns remain fully replayed; adaptive or lean policies may collapse them into a `Checkpoint Summary` block or compact action summaries.

Small reuse example:

Turn 1:

```javascript
const customers = await kb.findCustomers({ segment: 'active' });
console.log(customers.length);
```

Turn 2:

```javascript
const topCustomers = customers.slice(0, 3);
console.log(topCustomers);
```

Reason: turn 2 reuses `customers` from the persistent runtime. `Live Runtime State` or summaries may change how turn 1 is shown in the prompt, but they do not remove the value from the runtime session.

## RLM Test Harness

Use `agent.test(code, contextFieldValues?, options?)` when the user wants to validate JavaScript snippets against the actual AxAgent runtime environment without running the full Actor/Responder loop.

```typescript
import { AxJSRuntime, agent, f, fn } from '@ax-llm/ax';

const runtime = new AxJSRuntime();

const tools = [
  fn('sum')
    .description('Return the sum of the provided numeric values')
    .namespace('math')
    .arg('values', f.number('Value to add').array())
    .returns(f.number('Sum of all values'))
    .handler(async ({ values }) =>
      values.reduce((total, value) => total + value, 0)
    )
    .build(),
];

const harness = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  functions: { local: tools },
  contextPolicy: { preset: 'adaptive' },
});

const output = await harness.test(
  'console.log(await math.sum({ values: [3, 5, 8] }))',
  { query: 'sum the values' }
);

console.log(output);
```

Rules:

- `test(...)` creates a fresh runtime session per call.
- It exposes the same runtime globals the actor would see for configured `contextFields`: `inputs`, non-colliding top-level aliases, namespaced functions, child agents, and `llmQuery`.
- In `AxJSRuntime`, do not rely on calling `inspect_runtime()` from inside `test(...)` snippets yet; prefer checking runtime globals directly inside the snippet.
- It returns the formatted runtime output string.
- It throws on runtime failures instead of returning LLM-style error strings.
- Do not call `final(...)` or `ask_clarification(...)` inside `test(...)` snippets.
- Pass only `contextFields` values to `test(...)`; it is not a general way to inject arbitrary non-context inputs.
- If the snippet uses `llmQuery(...)`, provide an AI service through the agent config or `options.ai`.

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
      summarizerOptions: {
        model: 'summary-model',
        modelConfig: { temperature: 0.2, maxTokens: 180 },
      },
      state: {
        summary: true,
        inspect: true,
        inspectThresholdChars: 8_000,
        maxEntries: 6,
        maxChars: 1_200,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 12_000,
      },
      expert: {
        pruneErrors: true,
        rankPruning: { enabled: true, minRank: 2 },
        tombstones: {
          model: 'summary-model',
          modelConfig: { maxTokens: 80 },
        },
      },
    },
  }
);
```

Rules:

- Use `preset: 'full'` when the actor should keep seeing raw prior code and outputs with minimal compression.
- Use `preset: 'adaptive'` when the task needs runtime state across many turns but older successful work should collapse into checkpoint summaries while important recent steps can still stay fully replayed.
- Use `preset: 'lean'` when you want more aggressive compression and can rely mostly on current runtime state plus checkpoint summaries and compact action summaries.
- Use `state.summary` to inject a compact `Live Runtime State` block into the actor prompt. The block is structured and provenance-aware: variables are rendered with compact type/size/preview metadata, and when Ax can infer it, a short source suffix like `from t3 via db.search` is included. Combine `maxEntries` with `maxChars` so large runtime objects do not dominate the prompt.
- Use `state.inspect` with `inspectThresholdChars` so the actor is reminded to call `inspect_runtime()` when replayed action history starts getting large.
- `adaptive` and `lean` hide used discovery docs by default; set `contextPolicy.pruneUsedDocs: false` if you want to keep replaying them.
- `full` keeps used discovery docs by default; set `contextPolicy.pruneUsedDocs: true` if you want the same cleanup there.
- Use `summarizerOptions` to tune the internal checkpoint-summary AxGen program.
- If you configure `expert.tombstones`, treat the object form as options for the internal tombstone-summary AxGen program.
- Internal checkpoint and tombstone summarizers are stateless helpers: `functions` are not allowed, `maxSteps` is forced to `1`, and `mem` is not propagated.
- Built-in `adaptive` and `lean` presets no longer enable destructive rank pruning by default. Opt in with `expert.rankPruning` only when you want lower-value successful turns deleted instead of summarized.
- If you want a quick local demo of the rendered `Live Runtime State` block, run [`src/examples/rlm-live-runtime-state.ts`](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-live-runtime-state.ts).

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

## Offline Tuning With `agent.optimize(...)`

Use `agent.optimize(...)` when the user already has a configured `AxAgent` and wants to tune it against focused tasks such as emailing, scheduling, or office-assistant workflows.

Canonical pattern:

```typescript
import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxOptimizedProgramImpl,
  axDefaultOptimizerLogger,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const tools = [
  fn('sendEmail')
    .namespace('email')
    .description('Send an email message')
    .arg('to', f.string('Recipient email address'))
    .arg('body', f.string('Email body text'))
    .returns(
      f.object({
        sent: f.boolean('Whether the email was sent'),
        to: f.string('Recipient email address'),
      })
    )
    .handler(async ({ to }) => ({ sent: true, to }))
    .build(),
];

const studentAI = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini25FlashLite, temperature: 0.2 },
});

const judgeAI = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini3Pro, temperature: 1.0 },
});

const assistant = agent('query:string -> answer:string', {
  ai: studentAI,
  judgeAI,
  judgeOptions: {
    description: 'Prefer correct tool use over polished wording.',
    model: 'judge-model',
  },
  contextFields: [],
  runtime: new AxJSRuntime(),
  functions: { local: tools },
  contextPolicy: { preset: 'adaptive' },
});

const tasks = [
  {
    input: { query: 'Send an email to Jim saying good morning.' },
    criteria: 'Use the email tool and send the message to Jim.',
    expectedActions: ['email.sendEmail'],
  },
];

const result = await assistant.optimize(tasks, {
  target: 'actor',
  maxMetricCalls: 12,
  verbose: true,
  optimizerLogger: axDefaultOptimizerLogger,
  onProgress: (progress) => {
    console.log(
      `round ${progress.round}/${progress.totalRounds} current=${progress.currentScore} best=${progress.bestScore}`
    );
  },
});

const saved = JSON.stringify(result.optimizedProgram, null, 2);
const restored = new AxOptimizedProgramImpl(JSON.parse(saved));
assistant.applyOptimization(restored);
```

Rules:

- Pass already-loaded tasks. Do not invent a benchmark loader unless the user asks for one.
- Default optimize target is `root.actor`; use `target: 'responder'` or explicit program IDs only when the user clearly wants that.
- Prefer the built-in judge path. Use `judgeAI` plus `judgeOptions` instead of forcing the user to author a metric for open-ended assistant tasks.
- `judgeOptions` mirrors normal forward options and supports extra judge guidance through `description`.
- The built-in judge scores from the full agent run, not just the final reply. It can see the completion type, clarification payload when present, final output when present, action log, normalized function calls, tool errors, and turn count.
- `agent.optimize(...)` runs each evaluation rollout from a clean continuation state. Saved runtime state from `getState()` / `setState(...)` is not used during evaluation rollouts, and optimization does not overwrite the caller's existing saved state.
- During optimize/eval, `ask_clarification(...)` is treated as a scored evaluation outcome instead of going through the responder. Custom metrics and the built-in judge should branch on `prediction.completionType`.
- For clarification outcomes in custom metrics, expect `prediction.completionType === 'ask_clarification'`, `prediction.clarification` to be populated, and `prediction.output` to be absent.
- For final outcomes in custom metrics, expect `prediction.completionType === 'final'` and `prediction.output` to be populated.
- Use `expectedActions` and `forbiddenActions` in tasks when tool correctness matters.
- Use `verbose`, `optimizerLogger`, and `onProgress` when the user wants live optimization status.
- Treat `debugOptimizer` as an advanced override that forces logging even when normal verbosity is off.
- If the user provides a custom `metric`, that overrides the built-in judge path.
- `target: 'responder'` still works, but clarification-heavy tasks are low-signal for responder optimization because clarification rollouts do not invoke the responder.
- Save `result.optimizedProgram` and later restore it with `new AxOptimizedProgramImpl(...)` plus `agent.applyOptimization(...)`.
- For real examples, use fresh eval-safe tool state for the baseline run, the optimization run, and the restored replay so side effects do not leak across phases.
- If the user wants to demonstrate improvement, run a held-out task before optimization, save and reload the artifact, then replay the same task on a fresh restored agent and print the concrete side effects.
- A good office-assistant optimization example should push the weaker model into multi-step tool use it may barely handle zero-shot, such as relative-date scheduling plus correct recipient selection and “draft only” constraints.
- Remind the user that `agent.optimize(...)` replays tasks many times, so real side-effecting tools should be replaced with eval-safe mocks or in-memory state during tuning.

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
  judgeOptions?: Partial<AxJudgeOptions>;
}
```

## Examples

Fetch these for full working code:

- [Agent](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/agent.ts) — basic agent
- [Functions](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/function.ts) — function validation
- [Food Search](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/food-search.ts) — API tools
- [Smart Home](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/smart-home.ts) — state management
- [RLM](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm.ts) — RLM basic
- [RLM Long Task](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-long-task.ts) — RLM context policy
- [RLM Discovery](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-discovery.ts) — discovery mode
- [RLM Shared Fields](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-shared-fields.ts) — shared fields
- [RLM Adaptive Replay](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-adaptive-replay.ts) — adaptive replay
- [RLM Live Runtime State](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-live-runtime-state.ts) — structured runtime-state rendering
- [RLM Clarification Resume](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-clarification-resume.ts) — clarification exception plus `getState()` / `setState(...)`
- [RLM Agent Optimize](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-agent-optimize.ts) — Gemini office-assistant tuning with save/load
- [Customer Support](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/customer-support.ts) — classification agent
- [Abort Patterns](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/abort-patterns.ts) — abort handling

## Do Not Generate

- Do not use `new AxAgent(...)` for new code unless explicitly required.
- Do not assume child agents are always under `agents.*`.
- Do not guess function names in discovery mode.
- Do not write a full multi-step RLM actor program in one turn.
- Do not combine `console.log(...)` with `final(...)`.
- Do not forget `fields.shared` when child agents depend on parent inputs.
- Do not run `agent.optimize(...)` against production tools with real side effects unless the user explicitly wants that.
