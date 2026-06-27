---
name: ax-refine
description: Use this skill when writing or reviewing Ax bestOfN/refine code, reward functions, thresholds, native sample selection, serial attempts, generated advice, and attempt diagnostics.
version: "22.0.7"
---

# Ax Refine And BestOfN

Use `bestOfN(...)` when you can score complete outputs independently. Use `refine(...)` when failed rounds should produce feedback that changes the next attempt.

## Validation And Assertions

Keep reward scoring, whole-output assertions, and streaming assertions separate:

- Use schema validation for shape, types, and field-level constraints.
- Use `addAssert(...)` for whole-output hard invariants. Failed assertions feed correction text into the normal retry loop.
- Use `addStreamingAssert(...)` for partial streaming hard invariants. It aborts the current stream attempt as soon as the partial field fails, then feeds correction text into the normal retry loop.
- Use `bestOfN(...)` for complete-candidate selection.
- Use `refine(...)` for reward-scored retry rounds with generated feedback.

## APIs

```typescript
import { bestOfN, refine } from '@ax-llm/ax';

const selected = bestOfN(program, {
  n: 4,
  threshold: 0.8,
  rewardFn: ({ input, prediction, traces, chatLog }) => score(prediction),
});

const improved = refine(program, {
  rounds: 3,
  samplesPerRound: 2,
  threshold: 0.85,
  rewardDescription: 'Prefer complete, grounded, concise answers.',
  rewardFn: ({ prediction }) => score(prediction),
});
```

Rules:

- `forward(...)` returns the selected prediction.
- `streamingForward(...)` is unsupported; score complete outputs instead.
- `getUsage()` aggregates usage across attempts.
- `getTraces()` and `getChatLog()` return the selected attempt's diagnostics.
- `getAttempts()` returns all attempt metadata, including reward, errors, and advice application.

## Reward Functions

Reward functions return a number. Higher is better. A `threshold` marks a good-enough candidate and can stop serial attempts early.

```typescript
const rewardFn = ({ prediction }) => {
  const exact = prediction.answer === 'Paris' ? 1 : 0;
  const concise = prediction.answer.length < 80 ? 0.2 : 0;
  return exact + concise;
};
```

Use serial strategy when the reward needs traces, chat logs, tools, or full flow behavior.

## Strategies

- `strategy: "auto"` uses native samples for `AxGen` and serial attempts for composite programs.
- `strategy: "native-samples"` uses `sampleCount` and a reward-backed `resultPicker`; candidate context includes outputs, not full per-candidate traces.
- `strategy: "serial"` runs isolated full-program attempts with fresh memory/session IDs.

## Refine Advice

`refine(...)` generates advice after a below-threshold round. Advice is appended temporarily to matching `kind: "instruction"` components exposed by `getOptimizableComponents()` and applied through `applyOptimizedComponents()`.

Rules:

- Original instruction values are restored in `finally`, on success and error.
- Programs without instruction components continue as best-of-N rounds and mark `adviceApplied: false`.
- Do not add DSPy-style `hint_` signature fields; Ax uses instruction-component advice.

## Streaming

Do not use `refine(...)` for streaming. For partial-output safety, use `addStreamingAssert(fieldName, fn, message?)` on `AxGen`. Streaming assertions fail fast within the current attempt with `AxStreamingAssertionError`, then retry with correction feedback when retries remain.
