---
name: ax-agent-rlm
description: This skill helps an LLM generate correct AxAgent RLM/runtime code using @ax-llm/ax. Use when the user asks about RLM code execution, AxJSRuntime, contextFields, contextPolicy, liveRuntimeState, promptLevel, stage prompt controls, executorModelPolicy, maxRuntimeChars, agent.test(...), llmQuery(...), recursionOptions, or long-running agent runtime behavior.
version: "22.0.7"
---

# AxAgent RLM Runtime Rules (@ax-llm/ax)

Use this skill for code-runtime agents and `llmQuery(...)` semantic-helper behavior. For ordinary agent setup, child agents, tool namespaces, clarification, and `bubbleErrors`, use `ax-agent`. For callbacks and logs, use `ax-agent-observability`. For memories and skill loading, use `ax-agent-memory-skills`.

## Use These Defaults

- Use `agent(...)`, not `new AxAgent(...)`.
- In stdout-mode RLM, use one observable `console.log(...)` step per non-final actor turn.
- Default to `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }` for most RLM tasks.
- Prefer `contextPolicy: { preset: 'adaptive', budget: 'balanced' }` when older successful turns should collapse sooner while live runtime state stays visible.
- Use `contextMap` for recurring long-context corpora when the distiller should start future runs with a small persisted orientation cache.
- Prefer `promptLevel: 'default'` for normal use.
- Use `promptLevel: 'detailed'` when you want extra anti-pattern examples and tighter teaching scaffolding in the actor prompt.
- Prefer `executorModelPolicy` when the actor may need to upgrade after repeated error turns or discovery in specific namespaces without also upgrading the responder.
- Use explicit child agents in `functions: [...]` when the task needs specialist agents with their own tools/runtime.
- Use `llmQuery(...)` only for focused semantic questions over narrowed context; it does not spawn a tool-using child AxAgent.
- Prefer `maxSubAgentCalls` only when you need an explicit cap on `llmQuery(...)` sub-query usage.

## Mental Model

`AxAgent` is a three-stage pipeline. Each `forward()` call walks the stages in order:

```text
distiller (RLM actor) -> executor (RLM actor) -> responder (synthesizer)
```

- **distiller** always runs first. It sees all original inputs so it can understand and normalize the task; declared `contextFields` stay runtime-only when present. It distils relevant evidence by writing runtime-language code in a multi-turn loop, then calls the runtime-exposed `final(request, evidence)` primitive. The request becomes the executor's `inputs.executorRequest`; it must be self-contained and restate the concrete action, target, and constraints, not vague wording like "do it". The distiller should expand the original user task with facts found in context, including follow-ups like "yes, do it". When no `contextFields` are configured, it still performs request normalization over the original inputs with `contextFields: []`. **The distiller has no tools and is not a capability gate.**
- **executor** always runs. It receives non-context inputs plus `inputs.executorRequest` and `inputs.distilledContext` from the distiller's `final(request, evidence)` payload. Raw context fields are not present in the executor stage. The executor owns tool use, decides whether to call its available functions or finish directly from distilled evidence, and reports actual tool results or failures.
- **responder** always runs last. It synthesizes the user's output signature from whichever upstream actor finished the run and must not contradict tool evidence gathered upstream.

Treat both actor stages as long-running code runtime sessions that the actor steers over multiple turns, not as fresh script generators on every turn. `AxJSRuntime` is the default; custom runtimes set `language` so the actor code field becomes `<language>Code` such as `pythonCode` while JavaScript keeps the legacy `javascriptCode`.

- Successful code leaves variables, functions, imports, and computed values available in the runtime session.
- The actor should continue from existing runtime state instead of recreating prior work.
- `actionLog`, `liveRuntimeState`, and checkpoint summaries only control what the actor can see again in the prompt.
- Rebuild state only after an explicit runtime restart notice or when you intentionally need to overwrite a value.

## RLM Actor Code Rules

Use these rules when generating actor JavaScript for RLM in `AxJSRuntime` stdout mode. For custom runtimes, follow the runtime's `getUsageInstructions()`, primitive overrides, and callable formatter instead.

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
- Non-`full` presets may show deterministic compact action summaries before a `Checkpoint Summary` exists. Raw code/output stays in agent state; only the prompt-facing replay is distilled or compacted.
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

- `recursionOptions.ai`: routes `llmQuery(...)` sub-query calls to a different AI service than the parent run.
- `recursionOptions.model`, `modelConfig`, and other forward options: tune the AxGen call used by `llmQuery(...)`.
- `maxSubAgentCalls`: shared `llmQuery(...)` sub-query budget across the whole run. Default is `100`.
- `maxBatchedLlmQueryConcurrency`: caps batched `llmQuery([...])` concurrency.
- `maxRuntimeChars`: runtime/output truncation ceiling for console logs, tool results, and interpreter output replay. The effective limit is computed dynamically each turn based on remaining context budget.
- `summarizerOptions`: default model/options for the internal checkpoint summarizer.
- `contextPolicy`: replay/checkpointing/compression policy.
- `contextMap`: optional persistent orientation cache injected into the distiller and updated once after each successful run. `AxAgentContextMap` evolves indefinitely by default; use `{ infiniteEvolve: false, evolveSteps: N }` on the map object for finite warmup followed by reuse.
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
  recursionOptions: {
    model: 'gpt-5.4-mini',
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

- `maxRuntimeChars` sets the truncation ceiling and is separate from `contextPolicy.budget`.
- `summarizerOptions` tunes only the internal checkpoint summarizer. It does not change actor or responder model selection.
- `executorModelPolicy` only switches the actor model. It does not change `responderOptions.model`.
- `llmQuery(...)` uses `recursionOptions.ai` when set, otherwise it falls back to the parent `.forward(ai, ...)` service.
- `recursionOptions` configures the AxGen semantic sub-query used by `llmQuery(...)`; it does not create a child AxAgent and cannot give the sub-query tools.
- `executorModelPolicy` entries are ordered from weaker to stronger. If multiple rules match, the last matching entry wins.
- If one entry defines `namespaces`, any successful `discover(...)` function-definition fetch from one of those namespaces marks the rule as matched starting on the next actor turn.
- Do not add `recursionOptions` unless the user needs different model/options for `llmQuery(...)`.

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

Prompt/cache shape:

- Actor turns are compact observable turns, not replayed chat transcripts.
- Stable system prompt: role/stage rules, primitive descriptions, static module list, always-included callable signatures, output contract, and field definitions.
- Cached working inputs: task inputs, inline context, `contextMetadata`, `contextMap`, `memories`, `executorRequest`, `distilledContext`, `discoveredToolDocs`, `loadedSkills`, and `summarizedActorLog`.
- Dynamic turn tail: `guidanceLog`, `actionLog`, `liveRuntimeState`, and `contextPressure`.
- Prefer one compact inspection per non-final turn. Never combine inspection output with `final(...)` or `askClarification(...)`.

Invalid actor turn:

```javascript
await discover(['kb.findSnippets']);
const snippets = await kb.findSnippets({ topic: 'severity' });
await final("Summarize severity findings", { snippets });
```

Reason: this mixes observation and follow-up work in one turn. `discover(...)` returns `void`; read the next prompt's "Discovered Tool Docs" section before calling the function.

## AxJSRuntime Security

Default `new AxJSRuntime()` is hardened: no network, no filesystem, no child process, dynamic `import()` blocked, intrinsics frozen, `ShadowRealm` locked to `undefined`, worker IPC locked in browser/Deno/Bun, Bun workers use `smol: true`, and on Node 20+ the OS Permission Model auto-engages where available.

Threat model: this is defense-in-depth for LLM-authored code, not a container or VM boundary. Host callbacks and granted runtime permissions remain the authority boundary; keep durable secrets and privileged effects in host-side functions.

Permission enum (`AxJSRuntimePermission`):
`NETWORK`, `STORAGE`, `CODE_LOADING`, `COMMUNICATION`, `TIMING`, `WORKERS`, `FILESYSTEM`, `CHILD_PROCESS`.

Options quick reference:

- `permissions?: readonly AxJSRuntimePermission[]`: default `[]`; opt in capabilities.
- `blockDynamicImport?: boolean`: default `true`.
- `allowedModules?: readonly string[]`: default `[]`; narrow dynamic-import allowlist gate. Allowlisted specifiers are attempted, but full Node module namespace passthrough depends on Node vm semantics.
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
- When the user asks for filesystem access, prefer host-side tool functions. If direct runtime filesystem access is required, add `permissions: [AxJSRuntimePermission.FILESYSTEM]`, scope with `nodePermissionAllowlist` when the user names a directory, and treat `allowedModules` as an import allowlist gate rather than a portability guarantee.
- Do not disable `freezeIntrinsics`, `blockShadowRealm`, or `lockWorkerIPC` unless the user explicitly asks.
- Treat `allowUnsafeNodeHostAccess: true` as a red flag; only use it when the user is authoring trusted code in their own process.
- `preventGlobalThisExtensions: true` breaks top-level `var`/`let`/`const` persistence across turns; never set it for stdout-mode RLM where persistence is load-bearing.
- On Deno, `blockDynamicImport` is a no-op; the defense is the worker permission sandbox. Pass `allowDenoRemoteImport: true` only if remote module loading is genuinely required.

## Custom Code Runtimes

Implement `AxCodeRuntime` when the actor should write a language other than JavaScript.

- Set `language` to the model-facing language name. JavaScript aliases (`JavaScript`, `js`, `ecmascript`) keep `javascriptCode`; other values derive lower-camel code fields such as `pythonCode` or `cSharpCode`.
- Keep execution inside `createSession(globals, options)`. AxAgent passes `inputs`, `llmQuery`, `final`, `askClarification`, progress callbacks, memory/discovery primitives, and namespaced tools as host globals; the runtime decides how those globals appear in the target language.
- Put language syntax, output behavior, persistence semantics, and completion-call examples in `getUsageInstructions()`.
- Use `getPrimitiveOverrides()` to describe language-native calls for built-in primitives, and `formatCallable()` to describe language-native calls for tools and child agents.
- Implement `inspectGlobals()` on sessions when `contextPolicy` should show live runtime state for non-JavaScript runtimes; otherwise AxAgent will not run JavaScript fallback inspection snippets.

## RLM Test Harness

Use `agent.test(code, contextFieldValues?, options?)` when the user wants to validate runtime snippets against the actual AxAgent runtime environment without running the full actor/responder loop. With `AxJSRuntime`, those snippets are JavaScript.

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
- Parent inputs, runtime variables, tool results, and discovered docs are not automatically available to `llmQuery(...)`; include any needed facts in `context`.
- `llmQuery(...)` is a direct semantic helper backed by an AxGen sub-query. It does not create a child AxAgent, does not run an actor runtime session, and does not have access to tools or discovery.
- Use batched `llmQuery([...])` only for independent semantic questions. Use serial calls when later work depends on earlier results.
- Pass compact named object context instead of huge raw parent payloads.
- Do not assume anything other than the returned string comes back from `llmQuery(...)`.
- `maxSubAgentCalls` is a shared budget for `llmQuery(...)` sub-queries across the top-level run.
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

Parallel semantic review example:

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
- **Specialist/tool delegation**: needs its own tools, discovery, runtime, or reusable role -> create a child `agent(...)` and pass it in `functions: [...]`.
- **Parallel semantic fan-out**: two or more independent semantic-only subtasks -> batched `llmQuery([...])`.

Context handling:

- Always narrow with JS before delegating. Never pass raw `inputs.*`.
- Name context keys semantically, e.g. `{ emails: filtered, rubric: 'classify-urgency' }`.
- Estimate total sub-query calls before fanning out. `maxSubAgentCalls` is shared across the run.

Patterns:

- Fan-Out / Fan-In: JS narrows into categories -> `llmQuery([...])` fans out per category -> JS or one more `llmQuery(...)` merges semantic results.
- Pipeline: serial `llmQuery(...)` calls where each depends on the prior result.
- Specialist tool use: call child agents or tools via their namespaced function globals, e.g. `await team.writer({ draft })`.

## Examples

Fetch these for full working code:

- [RLM](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm.ts) - RLM basic
- [RLM Long Task](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-long-task.ts) - RLM context policy
- [RLM Discovery](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-discovery.ts) - discovery mode, grouped tools, child agents as functions, and semantic `llmQuery(...)`
- [RLM Adaptive Replay](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-adaptive-replay.ts) - adaptive replay

Flagship real-world long-agents (also ported to Python, Go, Rust, Java, and C++ under `src/examples/<lang>/long-agents/`; run with `npm run example -- <lang> <path>`):

- [Incident Log Forensics](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/incident-log-forensics.ts) - large-context log forensics over `contextFields` (Gemini)
- [Codebase Peek Map](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/codebase-peek-map.ts) - Peek-paper context-map orientation over a large repo snapshot
- [Data Analyst with Tools](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/data-analyst-with-tools.ts) - large data dictionary in `contextFields` + typed warehouse tools the model queries instead of inlining
- [Self-Improving Lab](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/typescript/long-agents/self-improving-lab.ts) - many-tool agent that runs experiments, grades them with an independent verifier, and distills verified rules into memory

## Do Not Generate

- Do not write a full multi-step RLM actor program in one turn.
- Do not combine `console.log(...)` with `final(...)`.
- Do not assume old successful turns stay fully replayed under adaptive/checkpointed/lean policies.
- Do not rebuild runtime state just because a prior turn was summarized.
- Do not describe `llmQuery(...)` as spawning a tool-using child AxAgent.
- Do not assume parent inputs are available to `llmQuery(...)` unless passed in `context`.
- Do not ignore `[ERROR] ...` results from `llmQuery(...)`.
- Do not grant `AxJSRuntime` permissions unless the user asked for the capability.
