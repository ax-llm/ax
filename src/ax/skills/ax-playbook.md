---
name: ax-playbook
description: This skill helps an LLM generate correct playbook code using @ax-llm/ax. Use when the user asks about playbook(), AxPlaybook, context playbooks, evolving context, ACE / Agentic Context Engineering, agent.playbook(), or growing/applying task knowledge offline and online with evolve() and update().
version: "__VERSION__"
---

# Playbook Codegen Rules (@ax-llm/ax)

Use this skill to generate context-playbook code. A playbook grows an evolving body of task knowledge and renders it into a program's context. The evolution engine (ACE — Agentic Context Engineering) is hidden behind `playbook(...)`, exactly as `optimize(...)` hides its optimizer. Prefer the `playbook(...)` concept; only reach for `AxACE` directly when the user explicitly wants the low-level engine.

## Use These Defaults

- Create with `playbook(program, { studentAI, teacherAI? })`; it returns an `AxPlaybook` handle.
- Grow offline with `await pb.evolve(examples, metric)` — returns `{ bestScore, playbook }`.
- Grow online with `await pb.update({ example, prediction, feedback })` — no metric needed.
- Apply with `pb.applyTo(program)` (defaults to the bound program).
- Persist with `pb.toJSON()` and restore with `playbook(program, opts).load(snapshot)`.
- Inspect with `pb.render()` (markdown) and `pb.getState()` (`{ playbook, artifact }`).
- For agents use `agent.playbook({ target: 'actor' | 'responder' })`; default target is `'actor'`.
- Use a cheaper `studentAI` to run the program and an optional stronger `teacherAI` to reflect/curate.
- Prefer `ai()`, `ax()`, and `agent()` for new code.

## Critical Rules

- `playbook(...)` binds to an `AxGen` program; `evolve`/`update` need that program's signature.
- `evolve()` returns only `{ bestScore, playbook }`. There is no Pareto front and no `optimizedProgram` — that is `optimize(...)`'s shape, not a playbook's.
- `update({ example, prediction, feedback })` requires the full `{ example, prediction }`; `example` must match the program's input fields (plus any expected output). Do not pass bare input fields at the top level.
- `update()` works without a prior `evolve()`/`load()` — the handle hydrates lazily on first use.
- `applyTo()` injects a `## Context Playbook` block into the program description; calling it repeatedly recomposes from the original base (no stacking).
- Keep the offline `metric` deterministic and cheap, like a GEPA metric.
- A playbook is plain JSON. Persist `pb.toJSON()` and `load(...)` it into a fresh program for production.
- This is a TypeScript feature; do not suggest it for the generated (Python/Go/Rust/Java/C++) packages yet.

## Offline Pattern (evolve)

```typescript
import { type AxMetricFn, ai, ax, playbook } from '@ax-llm/ax';

const program = ax('review:string -> sentiment:class "positive, negative"');
const studentAI = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY! });
const metric: AxMetricFn = ({ prediction, example }) =>
  (prediction as any).sentiment === (example as any).sentiment ? 1 : 0;

const pb = playbook(program, { studentAI, maxEpochs: 2 });
const { bestScore } = await pb.evolve(train, metric);
pb.applyTo(program);
```

## Online Pattern (update)

```typescript
// After a real run, feed the outcome back so the playbook keeps learning.
await pb.update({
  example: { review: 'Five stars, would buy again.' },
  prediction: { sentiment: 'negative' },
  feedback: 'WRONG: enthusiastic praise is positive.',
});
pb.applyTo(program);
```

## Persist And Restore

```typescript
const snapshot = pb.toJSON(); // { playbook, artifact } — plain JSON
// later, in another process / a production program instance:
playbook(prodProgram, { studentAI }).load(snapshot).applyTo(prodProgram);
```

## Agents

```typescript
const a = agent('ticket:string -> reply:string', { ai });
const apb = a.playbook({ target: 'actor' }); // 'actor' (default) or 'responder'
await apb.update({ example, prediction, feedback }); // injected into the live stage prompt
```

Offline `evolve(...)` on an agent stage scores that stage in isolation; for full-pipeline tuning of agent instructions and demos use `agent.optimize(...)` (GEPA).

## Playbook vs optimize()

- `playbook(...)` — accumulate reusable, evolving task knowledge; the only path that also learns online via `update(...)`.
- `optimize(...)` / `agent.optimize(...)` — tune instruction text and few-shot demos offline to a best/Pareto result.
- They are complementary; a project can use both.

## Troubleshooting

- "Cannot convert undefined or null to object" from `update()` → you passed input fields at the top level; wrap them in `example: { ... }`.
- Empty playbook after `evolve()` → the model already scored well, so nothing was curated; use harder/ambiguous examples or a weaker `studentAI` to surface lessons.
- Playbook not affecting an agent's behavior → ensure `apply` is not `false` and you used `agent.playbook(...)` (not a bare `playbook()` on an internal program).

## See Also

- `ax-gepa` - `optimize(...)` and `AxGEPA` for instruction/demo tuning.
- `ax-agent-context` - choosing between contextMap, contextPolicy, `agent.playbook(...)`, and recall.
- `ax-agent-optimize` - `agent.optimize(...)` GEPA tuning for agents.
