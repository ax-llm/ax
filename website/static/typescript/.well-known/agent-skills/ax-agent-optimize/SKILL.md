---
name: ax-agent-optimize
description: This skill helps an LLM generate correct AxAgent tuning and evaluation code using @ax-llm/ax. Use when the user asks about agent.optimize(...), judgeOptions, eval datasets, optimization targets, saved optimizedProgram artifacts, or agent optimization guidance.
version: "22.0.7"
---

# AxAgent Optimize Codegen Rules (@ax-llm/ax)

Use this skill for `agent.optimize(...)` workflows. Prefer short, modern, copyable patterns. Do not repeat general agent-authoring guidance unless the user needs it. For generic `ax(...)` or `flow(...)` tuning with top-level `optimize(...)`, use the `ax-gepa` skill instead.

Your job is to help the model choose a good optimization setup for the user's actual goal:

- If the user wants better tool use, prefer action-aware tasks and either a deterministic metric or the built-in judge depending on how objective the scoring is.
- If the user wants better wording only, responder optimization may be enough.
- If the user wants reusable improvements, include artifact save/load.
- If the user wants cost, tool-use, or child-agent delegation behavior improved, make the eval tasks expose those tradeoffs explicitly.

## Use These Defaults

- Use `agent.optimize(...)` only after the agent is already configured and runnable.
- Prefer the built-in judge path first for normal agent tuning. Most users should start with tasks that include `input` and `criteria`, then let `agent.optimize(...)` use its default actor target and judge-based metric.
- Keep top-level `optimize(program, train, metric, options)` for non-agent generators and flows; do not rewrite normal agent task-record examples to the generic helper.
- Prefer a deterministic custom `metric` only when success is easy to score from the prediction and task record.
- Add `judgeAI` plus `judgeOptions` when the judge should run on a stronger or separate model than the agent runtime model.
- Only reach for a plain typed `AxGen` evaluator when the user needs LLM-as-judge behavior outside the built-in `agent.optimize(...)` flow.
- Default optimize target is the actor path; do not surface `target` unless the user clearly wants responder-only tuning or explicit program IDs.
- Use eval-safe tools or in-memory mocks because optimization replays tasks many times.
- Prefer precise tool return schemas such as `f.object(...)` over vague `f.json(...)` whenever the agent must reason about returned fields.
- Prefer task wording with canonical entity names like "the Atlas project" instead of ambiguous labels like "Atlas" when ambiguity could trigger pointless clarification.
- Save artifacts with `axSerializeOptimizedProgram(result.optimizedProgram!)`, then restore with `axDeserializeOptimizedProgram(saved)` and `agent.applyOptimization(...)`.
- For browser-safe persistence, let the caller store the serialized JSON anywhere they want such as localStorage, IndexedDB, or a backend.
- If `bootstrap` is enabled, bootstrapped demos are persisted inside `result.optimizedProgram.demos`; raw failed traces are not saved in v1.
- For first examples, pass a plain task array instead of splitting into `train` and `validation` unless the user already has a holdout set.
- GEPA-backed `agent.optimize(...)` now optimizes generic components exposed by the selected target programs; `target: 'actor'` only tunes actor components, `target: 'responder'` only tunes responder components, and `target: 'all'` broadens the component set.
- `result.optimizedProgram.componentMap` is the canonical saved artifact for agent GEPA runs. It may include actor instructions, descriptions, tool descriptions/names, templates, or runtime primitives depending on what the selected target exposes.
- When child-agent delegation matters, expose the child agents as named functions and tune against realistic call/no-call tasks.

## Decision Guide

Pick the optimization shape from the user's need:

- "Make the agent use tools correctly" -> keep the default actor target and use `expectedActions` and `forbiddenActions`.
- "Make final answers read better" -> consider `target: 'responder'`, but only if the task is not mostly tool-selection or clarification behavior.
- "Make the whole agent better" -> use the default actor target first; only broaden target selection when the user clearly wants that extra scope.
- "Tune child-agent delegation" -> use tasks that exercise when to call the child agent, when to call normal tools, and when to answer directly.
- "Compare before and after" -> include a held-out task plus artifact save/load and replay.

Choose task design carefully:

- Prefer a small number of realistic tasks over broad but vague datasets.
- Prefer concrete criteria over generic "be helpful" language.
- Prefer explicit action expectations when correctness depends on tools, recipients, dates, or side effects.
- Prefer eval-safe mocks anytime the task touches email, scheduling, external APIs, or persistence.

## Make Agents Optimizable

Optimization works much better when the agent and dataset remove avoidable ambiguity:

- Prefer typed tool outputs over free-form JSON blobs so the actor can rely on exact field names.
- Tell the actor the exact tool fields it may use when payload shape matters.
- Explicitly ban invented fields if the model has any reason to guess hidden IDs or alternate key names.
- If a child agent needs parent values, declare those fields in the child signature and pass them explicitly at the call site.
- For specialist synthesis, tell the agent what narrowed context should be passed to the child agent.
- Keep `maxSubAgentCalls` small in examples unless the user is explicitly testing broad fan-out behavior.
- Use canonical, unambiguous task wording so the model does not burn turns asking for fake clarification.
- In JS-runtime agents, require raw runnable JavaScript only. Ban `javascript:` prefixes, mixed prose/code, and multi-snippet turns.

Good pattern:

- tool schema says exactly what fields exist
- task names the exact entity to look up
- actor prompt says which fields to extract before calling a child agent
- metric or judge penalizes unnecessary child-agent calls and tool misuse

Bad pattern:

- tool returns `json` with an underspecified shape
- task uses overloaded names like `Atlas` without clarifying whether that is a project, team, or account
- child agent is expected to infer hidden parent state that was never passed in its call arguments
- code agent is allowed to mix natural language with JavaScript in the same turn

## Metric vs Judge

Choose the scoring path based on how objectively the task can be measured:

- Use a custom `metric` when you can score success directly from `prediction` and `example`.
- Use the built-in agent judge when success depends on a full-run qualitative review across tool choices, clarifications, and final output.
- Use `judgeOptions.description` to tell the built-in judge what to value most.
- Use helper-based judge code only when the user is not inside `agent.optimize(...)` and still wants LLM judging.

Quick rules:

- Tool correctness with exact expected calls or forbidden calls: prefer a deterministic metric first.
- Simple extraction or classification with known correct answers: prefer a deterministic metric.
- Open-ended assistant quality, nuanced clarification behavior, or broad synthesis quality: prefer the built-in judge.
- GEPA or optimizer flows outside agents that still need LLM judging: use a plain typed `AxGen` evaluator.

Important:

- A custom `metric` overrides the built-in judge path entirely.
- Do not introduce a dedicated judge abstraction in new examples; prefer a plain typed `AxGen`.
- Do not add both a custom `metric` and judge guidance unless the user explicitly wants two separate scoring systems and understands only the custom metric drives optimization.
- If the user builds a plain `AxGen` judge metric, prefer a numeric `score:number` output over a string tier when possible. It is simpler and less fragile in practice.

## Canonical Pattern

```typescript
import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  axDefaultOptimizerLogger,
  agent,
  ai,
  f,
  fn,
  axDeserializeOptimizedProgram,
  axSerializeOptimizedProgram,
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
  contextFields: [],
  runtime: new AxJSRuntime(),
  functions: tools,
  contextPolicy: { preset: 'checkpointed', budget: 'balanced' },
  judgeOptions: {
    description: 'Prefer correct tool use over polished wording.',
    model: 'judge-model',
  },
});

const tasks = [
  {
    input: { query: 'Send an email to Jim saying good morning.' },
    criteria: 'Use the email tool and send the message to Jim.',
    expectedActions: ['email.sendEmail'],
  },
];

const result = await assistant.optimize(tasks, {
  maxMetricCalls: 12,
  verbose: true,
});

const saved = axSerializeOptimizedProgram(result.optimizedProgram!);
const restored = axDeserializeOptimizedProgram(saved);
assistant.applyOptimization(restored);
```

## Minimal Normal-User Pattern

Start here unless the user clearly needs a hand-built scorer:

```typescript
const tasks = [
  {
    input: { query: 'Send an email to Jim saying good morning.' },
    criteria: 'Use the email tool and send the message to Jim.',
    expectedActions: ['email.sendEmail'],
  },
];

const result = await assistant.optimize(tasks);
assistant.applyOptimization(result.optimizedProgram!);
```

- `target` defaults to actor optimization.
- `metric` defaults to the built-in LLM judge.
- `judgeAI` is optional; if omitted, the agent falls back to its configured judge model or runtime model.
- `bootstrap: true` is a good next step for tool-heavy agents when you want GEPA to start from successful traces from the provided tasks.
- The one thing users still need is realistic task records with clear `criteria`.

## Deterministic Metric Pattern

Use this when the task has crisp correctness and cost/behavior tradeoffs:

```typescript
const result = await assistant.optimize(tasks, {
  target: 'actor',
  metric: ({ prediction, example }) => {
    if (prediction.completionType !== 'final' || !prediction.output) {
      return 0;
    }

    let score = 0;

    if (prediction.output.answer.includes('Jim')) score += 0.4;

    if (
      prediction.functionCalls.some(
        (call) => call.qualifiedName === 'email.sendEmail'
      )
    ) {
      score += 0.4;
    }

    if (prediction.turnCount <= 3) {
      score += 0.2;
    }

    return score;
  },
});
```

Use this pattern when:

- the task has a known correct answer or exact action pattern
- tool count, child-agent calls, or turn count must be measured explicitly
- you want repeatable, low-variance optimization runs

## Built-In Judge Pattern

Use this when the agent behavior needs holistic review:

```typescript
const result = await assistant.optimize(tasks, {
  judgeAI,
  judgeOptions: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    description:
      'Be strict about unnecessary child-agent calls, weak clarifications, and incorrect tool choices.',
  },
  maxMetricCalls: 12,
});
```

Use this pattern when:

- task quality is open-ended or hard to score exactly
- the final answer quality matters together with the action trace
- the user wants a judge to consider clarifications, tool errors, and overall completion quality

## Plain `AxGen` Judge Pattern

Use this only when the user needs LLM judging outside the built-in `agent.optimize(...)` path:

```typescript
import { AxGen, s } from '@ax-llm/ax';

const judgeGen = new AxGen(
  s(`
    taskInput:json "Task input",
    candidateOutput:json "Candidate output",
    expectedOutput?:json "Optional reference output"
    ->
    score:number "Normalized score from 0 to 1"
  `)
);
judgeGen.setInstruction(
  'Score the candidate output from 0 to 1. Reward correctness and task completion. Return only the score field.'
);

const metric = async ({ prediction, example }) => {
  const result = await judgeGen.forward(judgeAI, {
    taskInput: example,
    candidateOutput: prediction,
    expectedOutput: example.expectedOutput,
  });

  return Math.max(0, Math.min(1, result.score));
};

const result = await optimizer.compile(program, train, metric, {
  validationExamples: validation,
});
```

Use this pattern when:

- the user is optimizing an `AxGen`, flow, or another program directly
- the user wants LLM judging without the higher-level `agent.optimize(...)` wrapper
- the user wants to inspect judge results directly, not just a numeric score

## Dataset And Judge Rules

- Pass already-loaded tasks. Do not invent a benchmark loader unless the user asks for one.
- Use `expectedActions` and `forbiddenActions` when tool correctness matters.
- `judgeOptions` mirrors normal forward options and supports extra judge guidance through `description`.
- The built-in judge scores from the full agent run, not just the final reply. It can see completion type, clarification payload, final output, action log, normalized function calls, tool errors, and turn count.
- If the user provides a custom `metric`, that overrides the built-in judge path.
- If the user provides an LLM-based custom metric, keep the output schema as small as possible and prefer a direct numeric score.

Decision rules:

- Prefer a custom metric when the user has deterministic business scoring, exact action expectations, or explicit cost tradeoffs.
- Prefer the built-in judge when the user wants practical assistant-quality tuning and does not already have a trusted metric.
- Prefer a plain typed `AxGen` evaluator when the user is not calling `agent.optimize(...)` but still wants LLM judging.
- Prefer `judgeOptions.description` to steer the judge toward the user's real priority, such as tool correctness, brevity, groundedness, or policy compliance.

## Eval Semantics

- `agent.optimize(...)` runs each evaluation rollout from a clean continuation state.
- Saved runtime state from `getState()` and `setState(...)` is not used during eval rollouts.
- During optimize/eval, `askClarification(...)` is treated as a scored evaluation outcome instead of going through the responder.
- For clarification outcomes in custom metrics, expect `prediction.completionType === 'askClarification'`, populated `prediction.clarification`, and absent `prediction.output`.
- For final outcomes in custom metrics, expect `prediction.completionType === 'final'` and populated `prediction.output`.
- `target: 'responder'` still works, but clarification-heavy tasks are usually low-signal for responder optimization.

## Delegation Optimization Notes

- Prefer explicit child agents in `functions: [...]` for specialist delegation. Their calls appear as normal function-call records.
- When delegation behavior matters, tune against the same child-agent/tool structure you expect in production.
- Tell the actor which fields to pass to the child agent and which tasks should stay local.
- For synthesis-style tasks, specify the desired delegation pattern explicitly, for example "call `team.writer(...)` only after narrowing tool output in JS."
- Penalize unnecessary child-agent calls directly in the metric or judge prompt.
- If one training task keeps collapsing to zero, inspect that task first instead of adding more optimizer rounds. Most failures come from task ambiguity, weak tool schemas, or vague delegation guidance rather than GEPA itself.

## Artifacts And Replay

- Save `result.optimizedProgram` if the user wants portable artifacts.
- Restore artifacts with `new AxOptimizedProgramImpl(...)`, then call `agent.applyOptimization(...)`.
- Preserve the full optimized program when saving GEPA artifacts; `componentMap` reapplies the learned strings.
- For demonstrations, use fresh eval-safe tool state for baseline, optimize, and restored replay so side effects do not leak across phases.
- If the user wants to show improvement, run a held-out task before optimization, then replay it on a freshly restored optimized agent.

## Examples

- [RLM Agent Optimize](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-agent-optimize.ts) — Gemini office-assistant tuning with save/load
- [AxAgent GEPA Component Optimization](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/axagent-gepa-optimization.ts) — compact support-agent GEPA run with deterministic metric and artifact replay

## Do Not Generate

- Do not optimize against production tools with real side effects unless the user explicitly wants that.
- Do not recommend responder-only optimization by default for clarification-heavy workflows.
- Do not omit artifact save/load steps when the user asks for reusable optimized configurations.
- Do not introduce a dedicated judge class or helper abstraction in new agent-optimize examples; prefer the built-in judge path or a plain typed `AxGen`.
- Do not rely on vague `json` tool returns when the agent must reason about specific fields across tool or child-agent calls.
- Do not leave child-agent inputs implicit. If the child needs a fact, pass it explicitly.
- Do not let code-generation agents mix prose and JavaScript if the user is optimizing runtime behavior.
