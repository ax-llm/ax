# Refine And BestOfN

`bestOfN(...)` and `refine(...)` provide explicit reward-scored candidate selection.

## Breaking Migration

This is a breaking API change. The assertion APIs were removed rather than soft-deprecated:

- Removed `addAssert(...)`, `addStreamingAssert(...)`, `AxAssertion`, `AxStreamingAssertion`, and `AxAssertionError`.
- Use schema validation for output shape and field constraints.
- Use `bestOfN(...)` to choose the best complete candidate.
- Use `refine(...)` to run feedback rounds before selecting a complete candidate.
- Use `addStreamingGuard(...)` only to abort unsafe partial streaming output.

Streaming guards do not retry, refine, or feed correction messages back to the model.

## Best Of N

Use `bestOfN(...)` when a reward function can score complete predictions independently.

```typescript
import { ax, bestOfN } from '@ax-llm/ax';

const qa = ax('question:string -> answer:string, confidence:number');

const program = bestOfN(qa, {
  n: 4,
  threshold: 0.9,
  rewardFn: ({ prediction }) => prediction.confidence ?? 0,
});

const result = await program.forward(ai, { question: '...' });
```

For `AxGen`, `strategy: "auto"` uses native `sampleCount` plus a reward-backed `resultPicker`. For flows and other composite programs, it runs serial attempts with fresh memory/session IDs.

## Refine

Use `refine(...)` when below-threshold attempts should produce feedback for later rounds.

```typescript
import { ax, refine } from '@ax-llm/ax';

const writer = ax('topic:string -> title:string, outline:string[], intro:string');

const program = refine(writer, {
  rounds: 3,
  samplesPerRound: 2,
  threshold: 0.85,
  rewardDescription: 'Prefer specific, complete, practical outputs.',
  rewardFn: ({ prediction }) =>
    Math.min(prediction.outline.length / 4, 1) * 0.5 +
    Math.min(prediction.intro.length / 160, 1) * 0.5,
});
```

After a failed round, Ax generates advice from the input, attempt summaries, best failed prediction, reward value, threshold, traces/chat summary, and instruction components. Advice is appended temporarily to matching `kind: "instruction"` components through `applyOptimizedComponents()`, then restored in `finally`.

## Diagnostics

- `forward(...)` returns the selected prediction.
- `streamingForward(...)` is unsupported for these wrappers.
- `getUsage()` aggregates usage across attempts.
- `getTraces()` and `getChatLog()` return diagnostics for the selected attempt.
- `getAttempts()` exposes attempt metadata for reward, errors, strategy, and advice application.

## Streaming Guards

For streaming safety, use `addStreamingGuard(fieldName, fn, message?)` on `AxGen`.

Streaming guards only abort unsafe partial output by throwing `AxStreamingGuardError`. They do not retry, refine, or feed correction messages back to the model.
