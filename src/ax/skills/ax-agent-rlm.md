---
name: ax-agent-rlm
description: This skill helps an LLM generate correct AxAgent RLM/runtime code using @ax-llm/ax. Use when the user asks about RLM code execution, AxJSRuntime, contextFields, contextPolicy, liveRuntimeState, promptLevel, stage prompt controls, executorModelPolicy, maxRuntimeChars, agent.test(...), llmQuery(...), mode: 'advanced', recursionOptions, or long-running agent runtime behavior.
version: "__VERSION__"
---

# AxAgent RLM Runtime Rules (@ax-llm/ax)

Use this skill for code-runtime agents and recursive/delegated runtime behavior. For ordinary agent setup, child agents, tool namespaces, clarification, and `bubbleErrors`, use `ax-agent`. For callbacks and logs, use `ax-agent-observability`. For memories and skill loading, use `ax-agent-memory-skills`.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- In stdout-mode RLM, use one observable `console.log(...)` step per non-final actor turn.
- Default to `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }` for most RLM tasks.
- Prefer `contextPolicy: { preset: 'adaptive', budget: 'balanced' }` when older successful turns should collapse sooner while live runtime state stays visible.
- Prefer `promptLevel: 'default'` for normal use.
- Use `promptLevel: 'detailed'` when you want extra anti-pattern examples and tighter teaching scaffolding in the actor prompt.
- Prefer `executorModelPolicy` when the actor may need to upgrade after repeated error turns or discovery in specific namespaces without also upgrading the responder.
- Prefer `mode: 'simple'` unless recursive child agents materially improve the task.
- Prefer `maxSubAgentCalls` only when advanced recursion is enabled or the user needs explicit delegation limits.

## Mental Model

`AxAgent` is a three-stage pipeline. Each `forward()` call walks the stages in order:

```text
distiller (RLM actor) -> executor (RLM actor) -> responder (synthesizer)
```

- **distiller** always runs first. It sees all original inputs so it can understand and normalize the task; declared `contextFields` stay runtime-only when present. It distils relevant evidence by writing JS code in a multi-turn loop, then calls `final(request, evidence)`. The request becomes the executor's `inputs.executorRequest`; the distiller should expand the original user task with facts found in context, including follow-ups like "yes, do it". When no `contextFields` are configured, it still performs request normalization over the original inputs with `contextFields: []`. **The distiller has no tools and is not a capability gate.**
- **executor** always runs. It receives non-context inputs plus `inputs.executorRequest` and `inputs.distilledContext` from the distiller's `final(request, evidence)` payload. Raw context fields are not present in the executor stage. The executor owns tool use, decides whether to call its available functions or finish directly from distilled evidence, and reports actual tool results or failures.
- **responder** always runs last. It synthesizes the user's output signature from whichever upstream actor finished the run and must not contradict tool evidence gathered upstream.

Treat both actor stages as long-running JavaScript REPLs that the actor steers over multiple turns, not as fresh script generators on every turn.

- Successful code leaves variables, functions, imports, and computed values available in the runtime session.
- The actor should continue from existing runtime state instead of recreating prior work.
- `actionLog`, `liveRuntimeState`, and checkpoint summaries only control what the actor can see again in the prompt.
- Rebuild state only after an explicit runtime restart notice or when you intentionally need to overwrite a value.

## RLM Actor Code Rules

Use these rules when generating actor JavaScript for RLM in stdout mode:

- Treat each actor turn as exactly one observable step.
- Inspect what already exists before recomputing it. If a prior turn successfully created a value, prefer reusing that runtime value.
- If you need to inspect a value, compute it or read it, `console.log(...)` it, and stop immediately after that `console.log(...)`.
- On the next turn, continue from the existing runtime state and use the logged result from `Action Log` only as evidence for what happened.
- If the prompt contains `Live Runtime State`, treat it as the canonical view of current variables.
- Errors from child-agent or tool calls appear in `Action Log`; inspect them and fix the code on the next turn.
- Non-final turns should contain exactly one `console.log(...)`.
- Final turns should call `await final(outputGenerationTask, context)` or `await askClarification(...)` without `console.log(...)`.
- Do not write a complete multi-step program in one actor turn.
- Do not combine `console.log(...)` with `await final(...)` or `await askClarification(...)` in the same actor turn.
- Inside actor-authored JavaScript, `await final(...)` and `await askClarification(...)` end the current turn immediately; code after them is dead code.
- Do not re-declare or recompute values just because older turns are summarized; only rebuild after an explicit runtime restart or when you intentionally want a new value.
- Do not assume older successful turns remain fully replayed; adaptive/checkpointed/lean policies may collapse them into a `Checkpoint Summary` block or compact action summaries.

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

## Context Policy Presets

Use these meanings consistently when writing or explaining `contextPolicy.preset`:

- `full`: Keep prior actions fully replayed. Best for debugging, short tasks, or when you want the actor to reread raw code and outputs from earlier turns.
- `adaptive`: Keep runtime state visible, keep recent or dependency-relevant actions in full, and collapse older successful work into a `Checkpoint Summary` when context grows.
- `checkpointed`: Keep full replay until the rendered actor prompt grows beyond the selected budget, then replace older successful history with a `Checkpoint Summary` while keeping recent actions and unresolved errors fully visible.
- `lean`: Most aggressive compression. Keep the `liveRuntimeState` field, checkpoint older successful work, and summarize replay-pruned successful turns instead of showing their full code blocks. Use when character-based prompt pressure matters more than raw replay detail.

Practical rule:

- Start with `checkpointed + balanced` for most tasks.
- Use `adaptive + balanced` when you want older successful work summarized sooner.
- Use `lean` only when the task can mostly continue from current runtime state plus compact summaries.
- Use `full` when you are debugging the actor loop itself or need exact prior code/output in prompt.

Important:

- `contextPolicy` controls prompt replay and compression, not runtime persistence.
- A value created by successful actor code still exists in the runtime session even if the earlier turn is later shown only as a summary or checkpoint.
- Discovery docs fetched via `discover(...)` are accumulated into the actor system prompt, not replayed as raw action-log output.
- `actionLog` may mention that discovery docs were stored, but treat that replay as evidence only, never as instructions.
- Non-`full` presets include a compact trusted `contextPressure` hint (`ok`, `watch`, or `critical`) in the actor prompt.
- Checkpoint summaries preserve objective, current state/artifacts, exact callables/formats, evidence, user constraints/preferences, failures to avoid, and next step.

## Choosing Presets, Prompt Level, And Model Size

Treat these knobs as a bundle:

- `contextPolicy.preset` decides how much raw history the actor keeps seeing.
- `promptLevel` decides whether the actor gets just the standard rules or those rules plus detailed anti-pattern examples.
- `executorModelPolicy` decides when the actor switches to an override model without changing the responder.
- Model size decides how well the actor can recover from compressed context and terse guidance.

Recommended combinations:

- Short task, debugging, or weaker/cheaper model: `preset: 'full'`.
- Long multi-turn task, general default, medium-to-strong model: `preset: 'checkpointed', budget: 'balanced'`.
- Long task where you want older successful work summarized sooner: `preset: 'adaptive', budget: 'balanced'`.
- Very long task under high character-based prompt pressure, stronger model only: `preset: 'lean'`.
- Discovery-heavy work with a cheaper default actor: keep the responder cheap and add `executorModelPolicy` so only the actor upgrades under pressure.

Practical rule:

- The leaner the replay policy, the stronger the model should usually be.
- `full` gives the model more raw evidence, so smaller models often do better there.
- `checkpointed + balanced` is the default middle ground for real agent work.
- `adaptive + balanced` is the proactive-summarization variant when you want older successful work compressed sooner.
- `lean` should be reserved for models that can reason well from runtime state plus summaries instead of exact old code/output.
- `executorModelPolicy` is usually better than globally upgrading the whole agent when the bottleneck is actor exploration rather than responder synthesis.

## Option Layout

Use these top-level controls consistently:

- `mode`: controls whether `llmQuery(...)` stays simple or delegates to recursive child agents in advanced mode.
- `recursionOptions.maxDepth`: limits recursive `llmQuery(...)` depth.
- `recursionOptions.ai`: routes recursive `llmQuery(...)` sub-agent calls to a different AI service than the parent run.
- `maxSubAgentCalls`: shared delegated-call budget across the whole run, including recursive children. Default is `100`.
- `maxBatchedLlmQueryConcurrency`: caps batched `llmQuery([...])` concurrency.
- `maxRuntimeChars`: runtime/output truncation ceiling for console logs, tool results, and interpreter output replay. The effective limit is computed dynamically each turn based on remaining context budget.
- `summarizerOptions`: default model/options for the internal checkpoint summarizer.
- `contextPolicy`: replay/checkpointing/compression policy.
- `contextOptions`: distiller-stage forward options.
- `executorOptions`: executor-stage forward options such as `description`, `model`, `modelConfig`, `thinkingTokenBudget`, and `showThoughts`.
- `executorModelPolicy`: executor-only model override rules based on consecutive error turns or discovery fetches from listed namespaces.
- `responderOptions`: responder-stage forward options.
- `judgeOptions`: built-in judge options for `agent.optimize(...)`; for tuning workflows use `ax-agent-optimize`.

Canonical shape:

```typescript
const researchAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  mode: 'advanced',
  recursionOptions: {
    maxDepth: 2,
  },
  maxRuntimeChars: 3000,
  summarizerOptions: {
    model: 'gpt-5.4-mini',
    modelConfig: { temperature: 0.1, maxTokens: 180 },
  },
  contextPolicy: {
    preset: 'checkpointed',
    budget: 'balanced',
  },
  contextOptions: {
    model: 'gpt-5.4-mini',
    maxTurns: 3,
  },
  executorOptions: {
    description: 'Use tools first and keep JS steps small.',
    model: 'gpt-5.4-mini',
  },
  executorModelPolicy: [
    {
      model: 'gpt-5.4',
      aboveErrorTurns: 2,
      namespaces: ['db', 'kb'],
    },
  ],
  responderOptions: {
    model: 'gpt-5.4-mini',
  },
});
```

Semantics:

- `mode` stays top-level; there is no `recursionOptions.mode`.
- `maxRuntimeChars` sets the truncation ceiling and is separate from `contextPolicy.budget`.
- `summarizerOptions` tunes only the internal checkpoint summarizer. It does not change actor or responder model selection.
- `executorModelPolicy` only switches the actor model. It does not change `responderOptions.model`.
- Recursive child agents can inherit `executorModelPolicy`; use a child override only when that child needs different routing behavior.
- Recursive child calls use `recursionOptions.ai` when set, otherwise they fall back to the parent `.forward(ai, ...)` service.
- `executorModelPolicy` entries are ordered from weaker to stronger. If multiple rules match, the last matching entry wins.
- If one entry defines `namespaces`, any successful `discover(...)` function-definition fetch from one of those namespaces marks the rule as matched starting on the next actor turn.
- Do not add `mode: 'advanced'` just because recursion exists as a feature. Add it only when delegated children need their own tool/discovery/runtime loop.
- Do not add `recursionOptions` if the user does not need recursive delegation.

## Dynamic Output Truncation

Runtime output truncation is budget-proportional and type-aware:

- Early turns with little action-log pressure use the full `maxRuntimeChars` ceiling.
- As the action log fills toward `targetPromptChars`, the limit decays linearly down to 15% of the ceiling, hard-floored at 400 chars.
- Large arrays keep the first 3 and last 2 items, with the middle replaced by `... [N hidden items]`.
- Deep objects replace nested values beyond depth 3 with `[Object]` or `[Array(N)]`.
- Error stack traces keep the first 3 and last 1 stack frames.
- Simple values use standard `JSON.stringify` passthrough.

Users do not need to configure this behavior. `maxRuntimeChars` sets the upper bound; the dynamic system only reduces it.

## Stage Prompt Controls

The pipeline has three peer stage-config bags: `contextOptions` (distiller), `executorOptions` (executor), and `responderOptions` (responder). Each accepts the same shape: `description`, `model`, `modelConfig`, `excludeFields`, plus other forward options.

Key fields:

- `contextOptions.description`: append extra distiller-specific instructions.
- `executorOptions.description`: append extra executor-specific instructions; this is the typical place for tool-use guidance.
- `responderOptions.description`: append extra responder-specific instructions.
- `contextOptions.model` / `executorOptions.model` / `responderOptions.model`: split model choice across stages.
- `contextOptions.ai` / `executorOptions.ai` / `responderOptions.ai`: override the AI service for a specific stage.
- `executorModelPolicy`: auto-switch only the executor when the run is on a consecutive error streak or discovery fetches land in specific namespaces.

Good split-model pattern:

```typescript
const researchAgent = agent('query:string -> answer:string', {
  contextFields: ['query'],
  runtime,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
  executorOptions: {
    model: 'gpt-5.4',
  },
  responderOptions: {
    model: 'gpt-5.4-mini',
  },
});
```

Model guidance:

- Put the stronger model on the actor when the task depends on multi-turn exploration, discovery, runtime state reuse, or compressed replay.
- Put the stronger model on the responder only when the hard part is final synthesis/formatting rather than exploration.
- For cost-sensitive setups, a common pattern is stronger actor plus cheaper responder.
- Prefer `executorModelPolicy` over globally upgrading the whole agent when the actor only needs help after context grows or the run starts thrashing.

Invalid actor turn:

```javascript
await discover(['kb.findSnippets']);
const snippets = await kb.findSnippets({ topic: 'severity' });
await final("Summarize severity findings", { snippets });
```

Reason: this mixes observation and follow-up work in one turn. `discover(...)` returns `void`; read the next prompt's "Discovered Tool Docs" section before calling the function.

## AxJSRuntime Security

Default `new AxJSRuntime()` is hardened: no network, no filesystem, no child process, dynamic `import()` blocked, intrinsics frozen, `ShadowRealm` locked to `undefined`, worker IPC locked in browser/Deno/Bun, Bun workers use `smol: true`, and on Node 20+ the OS Permission Model auto-engages where available.

Permission enum (`AxJSRuntimePermission`):
`NETWORK`, `STORAGE`, `CODE_LOADING`, `COMMUNICATION`, `TIMING`, `WORKERS`, `FILESYSTEM`, `CHILD_PROCESS`.

Options quick reference:

- `permissions?: readonly AxJSRuntimePermission[]`: default `[]`; opt in capabilities.
- `blockDynamicImport?: boolean`: default `true`.
- `allowedModules?: readonly string[]`: default `[]`.
- `freezeIntrinsics?: boolean`: default `true`.
- `blockShadowRealm?: boolean`: default `true`.
- `lockWorkerIPC?: boolean`: default `true`.
- `preventGlobalThisExtensions?: boolean`: default `false`; opt-in and breaks top-level persistence.
- `useNodePermissionModel?: boolean | 'auto'`: default `'auto'`.
- `nodePermissionAllowlist?: { fsRead?; fsWrite?; childProcess?; addons?; wasi? }`.
- `resourceLimits?: { maxOldGenerationSizeMb?; maxYoungGenerationSizeMb?; codeRangeSizeMb?; stackSizeMb? }`.
- `allowDenoRemoteImport?: boolean`: default `false`.
- `allowUnsafeNodeHostAccess?: boolean`: default `false`.

Recipes:

```typescript
new AxJSRuntime();

new AxJSRuntime({ permissions: [AxJSRuntimePermission.NETWORK] });

new AxJSRuntime({
  permissions: [AxJSRuntimePermission.FILESYSTEM],
  allowedModules: ['node:fs', 'node:fs/promises', 'node:path'],
  useNodePermissionModel: 'auto',
  nodePermissionAllowlist: {
    fsRead: ['/app/data'],
    fsWrite: ['/app/data'],
  },
});
```

Rules for the LLM author:

- Default to `new AxJSRuntime()` with no options unless the user asked for a specific capability.
- When the user asks for `fetch`, add `permissions: [AxJSRuntimePermission.NETWORK]`.
- When the user asks for filesystem access, add both `permissions: [AxJSRuntimePermission.FILESYSTEM]` and `allowedModules: ['node:fs', 'node:fs/promises', 'node:path']`. Scope with `nodePermissionAllowlist` when the user names a directory.
- Do not disable `freezeIntrinsics`, `blockShadowRealm`, or `lockWorkerIPC` unless the user explicitly asks.
- Treat `allowUnsafeNodeHostAccess: true` as a red flag; only use it when the user is authoring trusted code in their own process.
- `preventGlobalThisExtensions: true` breaks top-level `var`/`let`/`const` persistence across turns; never set it for stdout-mode RLM where persistence is load-bearing.
- On Deno, `blockDynamicImport` is a no-op; the defense is the worker permission sandbox. Pass `allowDenoRemoteImport: true` only if remote module loading is genuinely required.

## RLM Test Harness

Use `agent.test(code, contextFieldValues?, options?)` when the user wants to validate JavaScript snippets against the actual AxAgent runtime environment without running the full actor/responder loop.

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

const toolHarness = agent('query:string -> answer:string', {
  contextFields: [],
  runtime,
  functions: tools,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
});

const toolOutput = await toolHarness.test(
  'console.log(await math.sum({ values: [3, 5, 8] }))'
);

console.log(toolOutput);
```

Rules:

- `test(...)` creates a fresh runtime session per call.
- Context-field snippets run in the context/distiller runtime and expose `inputs` plus non-colliding top-level aliases for configured `contextFields`.
- Tool snippets should use an agent with no `contextFields`, or test the executor stage directly, so namespaced functions, child agents, and `llmQuery(...)` are in scope.
- In `AxJSRuntime`, do not rely on calling `inspectRuntime()` from inside `test(...)` snippets yet; prefer checking runtime globals directly inside the snippet.
- It returns the formatted runtime output string.
- It throws on runtime failures instead of returning LLM-style error strings.
- Do not call `final(...)` or `askClarification(...)` inside `test(...)` snippets.
- Pass only `contextFields` values to `test(...)`; it is not a general way to inject arbitrary non-context inputs.
- If the snippet uses `llmQuery(...)`, provide an AI service through the agent config or `options.ai`.

## `llmQuery(...)` Rules

Available forms:

- `await llmQuery(query, context?)`
- `await llmQuery({ query, context? })`
- `await llmQuery([{ query, context }, ...])`

Rules:

- `llmQuery(...)` forwards only the explicit `context` argument.
- Parent inputs are not automatically available to `llmQuery(...)` children.
- In `mode: 'simple'`, `llmQuery(...)` is a direct semantic helper.
- In `mode: 'advanced'`, `llmQuery(...)` delegates a focused subtask to a child `AxAgent` with its own runtime and action log while recursion depth remains.
- In advanced mode, no parent `contextFields` are auto-inserted into recursive children. Only explicit `llmQuery(..., context)` payload is available there.
- If `context` is a plain object, safe keys are exposed as child runtime globals and the full payload is also available as `context`.
- In advanced mode, use `llmQuery(...)` to offload discovery-heavy, tool-heavy, or multi-turn semantic branches so the parent action log stays smaller and more focused.
- In advanced mode, use batched `llmQuery([...])` only for independent subtasks. Use serial calls when later work depends on earlier results.
- In advanced mode with discovery enabled, prefer putting noisy tool discovery, `discover(...)`, and branch-specific tool chatter inside delegated child calls when those branches are independent or semantically distinct.
- In advanced mode, pass compact named object context to children instead of huge raw parent payloads.
- In advanced mode, do not assume child-created variables, discovered docs, or action-log history come back to the parent. Only the child return value comes back.
- In advanced mode, if a child calls `askClarification(...)`, that clarification bubbles up and ends the top-level run.
- In advanced mode, recursion is depth-limited: `maxDepth: 0` makes top-level `llmQuery(...)` simple; `maxDepth: 1` makes top-level `llmQuery(...)` advanced and child `llmQuery(...)` simple.
- In advanced mode, batched delegated children are cancelled when a sibling child asks for clarification or aborts, so use batched form only when branches are truly independent.
- `maxSubAgentCalls` is a shared budget across the whole top-level run, including recursive children.
- Single-call `llmQuery(...)` may return `[ERROR] ...` on non-abort failures.
- Batched `llmQuery([...])` returns per-item `[ERROR] ...`.
- If a result starts with `[ERROR]`, inspect or branch on it instead of assuming success.

Minimal example:

```javascript
const summary = await llmQuery('Summarize this incident', inputs.context);
if (summary.startsWith('[ERROR]')) {
  console.log(summary);
} else {
  console.log(summary);
}
```

Advanced recursive discovery example:

```javascript
const narrowedIncidents = incidents.map((incident) => ({
  id: incident.id,
  timeline: incident.timeline,
  notes: incident.notes.slice(0, 1200),
}));

const [severityReview, followupReview] = await llmQuery([
  {
    query:
      'Use discovery and available tools to review severity policy alignment. Return compact findings.',
    context: {
      incidents: narrowedIncidents,
      rubric: 'severity-policy',
    },
  },
  {
    query:
      'Use discovery and available tools to review postmortem and follow-up obligations. Return compact findings.',
    context: {
      incidents: narrowedIncidents,
      rubric: 'postmortem-followup',
    },
  },
]);

const merged = await llmQuery(
  'Merge these delegated reviews into one manager-ready summary with next steps.',
  {
    severityReview,
    followupReview,
    audience: inputs.audience,
  }
);
```

Delegation decision guide:

- **JS-only**: deterministic logic such as filter, sort, count, regex, or date math -> do it inline.
- **Single-shot semantic**: needs LLM reasoning but no tools or multi-step exploration -> single `llmQuery(...)` with narrow context.
- **Full delegation**: needs its own discovery, tool calls, or more than two turns of exploratory work -> `llmQuery(...)` as child agent.
- **Parallel fan-out**: two or more independent subtasks each qualifying for delegation -> batched `llmQuery([...])`.

Context handling:

- In advanced mode, the `context` object is injected into the child's JS runtime as named globals. It does not go into the child's LLM prompt as raw data.
- The child prompt sees only a compact metadata summary of the delegated context.
- The child actor explores the delegated context with code, the same way the parent explores `inputs.*`.
- Always narrow with JS before delegating. Never pass raw `inputs.*`.
- Name context keys semantically, e.g. `{ emails: filtered, rubric: 'classify-urgency' }`.
- Estimate total sub-agent calls before fanning out. `maxSubAgentCalls` is shared across all recursion levels.

Patterns:

- Fan-Out / Fan-In: JS narrows into categories -> `llmQuery([...])` fans out per category -> JS or one more `llmQuery(...)` merges results.
- Pipeline: serial `llmQuery(...)` calls where each depends on the prior result.
- Scout-then-Execute: first child explores, parent processes with JS, second child acts.

## Examples

Fetch these for full working code:

- [RLM](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm.ts) - RLM basic
- [RLM Long Task](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-long-task.ts) - RLM context policy
- [RLM Discovery](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-discovery.ts) - advanced recursive `llmQuery(...)` plus discovery-heavy delegated subtasks
- [RLM Shared Fields](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-shared-fields.ts) - shared fields
- [RLM Adaptive Replay](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-adaptive-replay.ts) - adaptive replay
- [RLM Live Runtime State](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-live-runtime-state.ts) - structured runtime-state rendering
- [RLM Clarification Resume](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-clarification-resume.ts) - clarification exception plus `getState()` / `setState(...)`

## Do Not Generate

- Do not write a full multi-step RLM actor program in one turn.
- Do not combine `console.log(...)` with `final(...)`.
- Do not assume old successful turns stay fully replayed under adaptive/checkpointed/lean policies.
- Do not rebuild runtime state just because a prior turn was summarized.
- Do not add `mode: 'advanced'` unless delegated children need their own tool/discovery/runtime loop.
- Do not assume parent inputs are available in `llmQuery(...)` children unless passed in `context`.
- Do not ignore `[ERROR] ...` results from `llmQuery(...)`.
- Do not grant `AxJSRuntime` permissions unless the user asked for the capability.
