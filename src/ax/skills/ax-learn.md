---
name: ax-learn
description: This skill helps an LLM generate correct AxLearn code using @ax-llm/ax. Use when the user asks about self-improving agents, trace-backed learning, feedback-aware updates, or AxLearn modes.
version: "__VERSION__"
---

# AxLearn Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxLearn` code that matches the current API.

## Core Model

- `AxLearn` wraps an `AxGen`.
- `teacher` is for judging, synthesis, and reflection.
- `runtimeAI` is the model being improved.
- `forward()` and `streamingForward()` are inference-time APIs and auto-log traces when tracing is enabled.
- `optimize()` is offline learning.
- `applyUpdate()` is a bounded update API for `continuous` and `playbook` modes.
- `ready()` should be awaited before assuming checkpoints have been restored.
- `improvement` is the score delta from the previous/restored state.

## Required Inputs

- Always provide `name`.
- Always provide `storage`.
- Always provide `teacher`.
- Always provide `runtimeAI` if you call `optimize()` or `applyUpdate()`.

## Modes

- `batch`: offline prompt learning only.
- `continuous`: offline optimization plus bounded feedback-aware `applyUpdate(...)`.
- `playbook`: structured context/playbook learning plus `applyUpdate(...)`.

## Preferred Construction

```typescript
import {
  AxLearn,
  ax,
  ai,
  type AxCheckpoint,
  type AxStorage,
  type AxTrace,
} from '@ax-llm/ax';

const storage: AxStorage = {
  save: async (_name, _item) => {
    // persist trace/checkpoint
  },
  load: async (_name, _query) => {
    // return traces/checkpoints
    return [];
  },
};

const teacher = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const runtimeAI = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

const gen = ax(`
  customerQuery:string "User message" ->
  supportReply:string "Agent reply"
`);

const agent = new AxLearn(gen, {
  name: 'support-bot-v1',
  storage,
  teacher,
  runtimeAI,
  mode: 'continuous',
  budget: 12,
  examples: [
    {
      customerQuery: 'Where is my order?',
      supportReply: 'Your order is in transit and should arrive in 2 days.',
    },
    {
      customerQuery: 'I need a refund.',
      supportReply: 'I can help with that. Please share your order number.',
    },
  ],
  generateExamples: false,
});

await agent.ready();
```

## Runtime Pattern

```typescript
const prediction = await agent.forward(runtimeAI, {
  customerQuery: 'My package is late.',
});

const traces = await agent.getTraces({ limit: 1 });
if (traces[0]) {
  await agent.addFeedback(traces[0].id, {
    score: 0,
    label: 'needs-empathy',
    comment: 'Acknowledge the frustration more directly.',
  });
}
```

## Offline Optimization

```typescript
const result = await agent.optimize({
  // Optional overrides
  budget: 20,
});

console.log(result.mode);
console.log(result.score);
console.log(result.improvement);
console.log(result.checkpointVersion);
```

`result.improvement` is the gain relative to the prior/restored score.

## Continuous Update

Use `applyUpdate(...)` only in `continuous` or `playbook` mode.

- In `continuous` mode, `example` may be input-only.
- `prediction` is the observed runtime output being critiqued.
- If `example` includes expected output fields, that expected-output row stays eligible for scored optimization.
- The observed `prediction` row is feedback/reflection context, not a scored train/validation row by itself.
- Feedback-bearing scored examples should stay in the training pool when non-feedback rows can fill validation.
- In `playbook` mode, `getInstruction()` returns the active composed prompt.

```typescript
const update = await agent.applyUpdate({
  example: {
    customerQuery: 'My package is late.',
  },
  prediction,
  feedback: {
    score: 0,
    label: 'needs-empathy',
    comment: 'Acknowledge the frustration more directly.',
  },
});
```

## Playbook Mode

- Use `mode: 'playbook'` when the learned artifact should be structured guidance, not just an instruction tweak.
- Playbook checkpoints restore through `ready()`.
- `applyUpdate(...)` in playbook mode performs an online structured update.
- `getInstruction()` should be treated as the active composed runtime prompt, even before optimization if the base prompt lives in the signature description.
- `artifact.playbookSummary` should match the persisted checkpoint `state.artifactSummary`.

## How Learning Data Is Used

- `examples` and usable traces become scored optimization rows.
- Feedback stored with `addFeedback(...)` becomes reflection feedback for later optimization.
- In continuous updates, `example + prediction + feedback` is used as an observed feedback event.
- Input-only update examples are useful for reflection, but they are not promoted into scored examples unless expected outputs are present.

## Important Options

```typescript
const agent = new AxLearn(gen, {
  name: 'agent-id',
  storage,
  teacher,
  runtimeAI,
  mode: 'batch', // 'batch' | 'continuous' | 'playbook'
  budget: 20,
  metric: async ({ prediction, example }) => {
    return prediction.supportReply === example.supportReply ? 1 : 0;
  },
  criteria: 'accuracy and tone',
  judgeOptions: {},
  examples: [],
  useTraces: true,
  generateExamples: false,
  synthCount: 20,
  validationSplit: 0.2,
  continuousOptions: {
    feedbackWindowSize: 25,
    maxRecentTraces: 100,
    updateBudget: 4,
  },
  playbookOptions: {
    maxEpochs: 2,
  },
  onTrace: (trace) => {
    console.log(trace.id);
  },
  onProgress: (progress) => {
    console.log(progress.round, progress.score);
  },
});
```

## Result Shape

```typescript
type AxLearnResult = {
  mode: 'batch' | 'continuous' | 'playbook';
  score: number;
  improvement: number;
  checkpointVersion: number;
  stats: {
    trainingExamples: number;
    validationExamples: number;
    feedbackExamples: number;
    durationMs: number;
    mode: 'batch' | 'continuous' | 'playbook';
  };
  state?: {
    mode: 'batch' | 'continuous' | 'playbook';
    instruction?: string;
    baseInstruction?: string;
    score?: number;
    continuous?: {
      feedbackTraceCount?: number;
      lastUpdateAt?: string;
    };
    playbook?: Record<string, unknown>;
    artifactSummary?: Record<string, unknown>;
  };
  artifact?: {
    playbook?: Record<string, unknown>;
    playbookSummary?: {
      feedbackEvents: number;
      historyBatches: number;
      bulletCount: number;
      updatedAt?: string;
    };
    lastUpdateAt?: string;
    feedbackExamples?: number;
  };
};
```

## Storage Notes

- `AxStorage.save(name, item)` receives either a trace or checkpoint.
- `AxStorage.load(name, query)` should return arrays of traces or checkpoints.
- Checkpoints may be returned unsorted. `AxLearn` restores the newest one client-side.

## Do This

- Use `runtimeAI` explicitly.
- Await `ready()` before relying on restored state.
- Run `optimize()` off the hot path.
- Use `continuous` mode when you want bounded feedback-aware updates.
- Use `playbook` mode when you want persistent structured guidance.
- Pass the real observed model output as `prediction` in `applyUpdate(...)`.
- Treat `getInstruction()` in playbook mode as the live composed prompt, not just the raw base instruction.

## Avoid This

- Do not assume `teacher` is the optimized runtime model.
- Do not call `applyUpdate()` in `batch` mode.
- Do not claim feedback affects learning unless you are storing it with `addFeedback(...)` or passing it to `applyUpdate(...)`.
- Do not assume checkpoints load synchronously in the constructor.
- Do not treat `prediction` as the gold answer in continuous updates.
