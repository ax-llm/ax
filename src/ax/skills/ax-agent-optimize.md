---
name: ax-agent-optimize
description: This skill helps an LLM generate correct AxAgent tuning and evaluation code using @ax-llm/ax. Use when the user asks about agent.optimize(...), judgeOptions, eval datasets, optimization targets, saved optimizedProgram artifacts, or recursive optimization guidance.
version: "__VERSION__"
---

# AxAgent Optimize Codegen Rules (@ax-llm/ax)

Use this skill for `agent.optimize(...)` workflows. Prefer short, modern, copyable patterns. Do not repeat general agent-authoring guidance unless the user needs it.

Your job is to help the model choose a good optimization setup for the user's actual goal:

- If the user wants better tool use, prefer action-aware tasks and either a deterministic metric or the built-in judge depending on how objective the scoring is.
- If the user wants better wording only, responder optimization may be enough.
- If the user wants reusable improvements, include artifact save/load.
- If the user wants cost or recursion behavior improved, make the eval tasks expose those tradeoffs explicitly.

## Use These Defaults

- Use `agent.optimize(...)` only after the agent is already configured and runnable.
- Prefer a deterministic custom `metric` when success is easy to score from the prediction and task record.
- Prefer the built-in judge path for open-ended assistant tasks: `judgeAI` plus `judgeOptions`.
- Only reach for a plain typed `AxGen` evaluator when the user needs LLM-as-judge behavior outside the built-in `agent.optimize(...)` flow.
- Default optimize target is `root.actor`; use `target: 'responder'` or explicit program IDs only when the user clearly asks for that.
- Use eval-safe tools or in-memory mocks because optimization replays tasks many times.
- Prefer precise tool return schemas such as `f.object(...)` over vague `f.json(...)` whenever the agent must reason about returned fields.
- Prefer task wording with canonical entity names like "the Atlas project" instead of ambiguous labels like "Atlas" when ambiguity could trigger pointless clarification.
- Save `result.optimizedProgram`, then restore with `new AxOptimizedProgramImpl(...)` and `agent.applyOptimization(...)`.
- When recursive behavior matters, keep `mode: 'advanced'` on the agent and tune against realistic `recursionOptions`.

## Decision Guide

Pick the optimization shape from the user's need:

- "Make the agent use tools correctly" -> optimize `root.actor` with `expectedActions` and `forbiddenActions`.
- "Make final answers read better" -> consider `target: 'responder'`, but only if the task is not mostly tool-selection or clarification behavior.
- "Make the whole agent better" -> use the default actor target first; only broaden target selection when the user clearly wants that extra scope.
- "Tune recursive delegation" -> keep `mode: 'advanced'` and use tasks that actually exercise recursion depth, fan-out, and termination choices.
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
- If recursive children only see explicit `llmQuery(..., context)` payloads, say that directly in the actor prompt.
- For recursive synthesis, tell the agent what the narrowed context should look like before delegation.
- Keep `maxSubAgentCalls` small in examples unless the user is explicitly testing broad fan-out behavior.
- Use canonical, unambiguous task wording so the model does not burn turns asking for fake clarification.
- In JS-runtime agents, require raw runnable JavaScript only. Ban `javascript:` prefixes, mixed prose/code, and multi-snippet turns.

Good pattern:

- tool schema says exactly what fields exist
- task names the exact entity to look up
- actor prompt says which fields to extract before delegation
- metric or judge penalizes unnecessary recursion and tool misuse

Bad pattern:

- tool returns `json` with an underspecified shape
- task uses overloaded names like `Atlas` without clarifying whether that is a project, team, or account
- recursive child is expected to infer hidden parent state that was never passed in context
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
  contextFields: [],
  runtime: new AxJSRuntime(),
  functions: { local: tools },
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

    if ((prediction.recursiveStats?.recursiveCallCount ?? 0) === 0) {
      score += 0.2;
    }

    return score;
  },
});
```

Use this pattern when:

- the task has a known correct answer or exact action pattern
- recursion cost or tool count must be measured explicitly
- you want repeatable, low-variance optimization runs

## Built-In Judge Pattern

Use this when the agent behavior needs holistic review:

```typescript
const result = await assistant.optimize(tasks, {
  judgeAI,
  judgeOptions: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    description:
      'Be strict about unnecessary delegation, weak clarifications, and incorrect tool choices.',
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
- For recursive advanced-mode evals, the built-in judge can also see `recursiveTrace` and `recursiveStats`.
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

## Recursive Optimization Notes

- Recursive-slot artifacts require an agent configured for recursive advanced mode.
- Keep `mode: 'advanced'` top-level; child recursion behavior still follows `recursionOptions`.
- When recursive behavior matters, tune against the same `maxDepth` and tool/discovery structure you expect in production.
- Use recursive traces and recursive stats when the user wants to diagnose where token or delegation cost is coming from.
- For recursion-efficiency tuning, prefer a deterministic metric unless the user specifically needs a qualitative LLM review of decomposition quality.
- Tell the actor that recursive children only see passed context, not parent globals or prior tool results.
- For synthesis-style recursive tasks, specify the desired delegation pattern explicitly, for example "use at most one focused delegated child analysis after narrowing the tool output in JS."
- Penalize over-decomposition directly in the metric or judge prompt.
- If one training task keeps collapsing to zero, inspect that task first instead of adding more optimizer rounds. Most failures come from task ambiguity, weak tool schemas, or vague delegation guidance rather than GEPA itself.

## Artifacts And Replay

- Save `result.optimizedProgram` if the user wants portable artifacts.
- Restore artifacts with `new AxOptimizedProgramImpl(...)`, then call `agent.applyOptimization(...)`.
- For demonstrations, use fresh eval-safe tool state for baseline, optimize, and restored replay so side effects do not leak across phases.
- If the user wants to show improvement, run a held-out task before optimization, then replay it on a freshly restored optimized agent.

## Examples

- [RLM Agent Optimize](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-agent-optimize.ts) — Gemini office-assistant tuning with save/load
- [RLM Agent Recursive Optimize](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/rlm-agent-recursive-optimize.ts) — recursive-slot optimization artifacts

## Do Not Generate

- Do not optimize against production tools with real side effects unless the user explicitly wants that.
- Do not recommend responder-only optimization by default for clarification-heavy workflows.
- Do not omit artifact save/load steps when the user asks for reusable optimized configurations.
- Do not introduce a dedicated judge class or helper abstraction in new agent-optimize examples; prefer the built-in judge path or a plain typed `AxGen`.
- Do not rely on vague `json` tool returns when the agent must reason about specific fields across recursive steps.
- Do not leave recursive child context implicit. If the child needs a fact, pass it explicitly.
- Do not let code-generation agents mix prose and JavaScript if the user is optimizing runtime behavior.
