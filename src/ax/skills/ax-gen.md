---
name: ax-gen
description: This skill helps an LLM generate correct AxGen code using @ax-llm/ax. Use when the user asks about ax(), AxGen, generators, forward(), streamingForward(), assertions, field processors, step hooks, self-tuning, or structured outputs.
version: "__VERSION__"
---

# AxGen Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxGen` code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `ax(...)` factory, not `new AxGen(...)`.
- Always pass an AI instance from `ai(...)` as the first argument to `forward()`.
- Streaming uses `streamingForward()`, not `forward()` with a stream option.
- Assertions auto-retry with error feedback on failure.
- Step hook mutations are applied at the next step boundary (pending pattern).
- `stopFunction` accepts a string or string[] for multiple stop functions.
- Multi-step continues until: all outputs filled, stop function called, or `maxSteps` reached.

## Canonical Pattern

```typescript
import { ai, ax, s } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!,
});

// Inline signature
const gen = ax('input:string -> output:string, reasoning:string');

// Reusable signature
const sig = s('question:string, context:string[] -> answer:string');
const gen2 = ax(sig);

// With options
const gen3 = ax('input -> output', {
  description: 'A helpful assistant',
  maxRetries: 3,
  maxSteps: 10,
  temperature: 0.7,
});

const result = await gen.forward(llm, { input: 'Hello world' });
console.log(result.output);
```

## Running AxGen

### `forward()`

```typescript
const result = await gen.forward(llm, { input: '...' });

// With options
const result = await gen.forward(llm, { input: '...' }, {
  maxRetries: 5,
  model: 'gpt-4.1',
  modelConfig: { temperature: 0.9, maxTokens: 1000 },
  debug: true,
});
```

### `streamingForward()`

```typescript
const stream = gen.streamingForward(llm, { input: 'Write a long story' });
for await (const chunk of stream) {
  if (chunk.delta.output) process.stdout.write(chunk.delta.output);
}
```

## Stopping And Cancellation

```typescript
import { AxAIServiceAbortedError } from '@ax-llm/ax';

const timer = setTimeout(() => gen.stop(), 3_000);

try {
  const result = await gen.forward(llm, { topic: 'Long document' }, {
    abortSignal: AbortSignal.timeout(10_000),
  });
} catch (err) {
  if (err instanceof AxAIServiceAbortedError) console.log('Aborted');
}
```

Rules:

- `gen.stop()` gracefully stops multi-step execution at the next step boundary.
- `abortSignal` cancels the underlying AI service call immediately.
- Catch `AxAIServiceAbortedError` when using either mechanism.

## Assertions And Validation

```typescript
// Standard assertion (checked after forward completes)
gen.addAssert(
  (args) => args.output.length > 50,
  'Output must be at least 50 characters'
);

// Streaming assertion (checked during streaming)
gen.addStreamingAssert(
  'output',
  (text) => !text.includes('forbidden'),
  'Output contains forbidden text'
);
```

Rules:

- Failed assertions cause an automatic retry with the error message fed back to the LLM.
- `addAssert` receives the full output object.
- `addStreamingAssert` targets a specific field and receives the partial text so far.

## Field Processors

```typescript
// Post-processing after generation
gen.addFieldProcessor('summary', (value, context) => value.toUpperCase());

// Streaming field processor (called on each chunk)
gen.addStreamingFieldProcessor('content', (partialValue, context) => {
  console.log(`Received ${partialValue.length} chars`);
  return partialValue;
});
```

Rules:

- `addFieldProcessor` runs once after the field is fully generated.
- `addStreamingFieldProcessor` runs on each streaming chunk for the target field.
- Both must return the (possibly transformed) value.

## Function Calling

```typescript
const result = await gen.forward(llm, { question: '...' }, {
  functions: tools,
  functionCallMode: 'auto',
  stopFunction: 'finalAnswer',
});
```

Rules:

- `functionCallMode` can be `'auto'`, `'none'`, or a specific function name to force.
- `stopFunction` accepts a string or string[] to halt multi-step on specific function calls.
- Multi-step continues until all outputs filled, stop function called, or `maxSteps` reached.

## Caching

### Response Caching

```typescript
const gen = ax('question:string -> answer:string', {
  cachingFunction: async (key, value?) => {
    if (value !== undefined) {
      await cache.set(key, value);
      return;
    }
    return await cache.get(key);
  },
});
```

### Context Caching

```typescript
const result = await gen.forward(llm, { question: '...' }, {
  contextCache: { cacheBreakpoint: 'after-examples' },
});
```

Rules:

- `cachingFunction` acts as a get/set: called with `(key)` to read, `(key, value)` to write.
- `contextCache` enables AI provider-level prompt caching for long context.

## Sampling And Result Picker

```typescript
const result = await gen.forward(llm, { question: '...' }, {
  sampleCount: 3,
  resultPicker: async (samples) => {
    // Evaluate each sample and return the index of the best one
    return bestIndex;
  },
});
```

Rules:

- `sampleCount` generates multiple completions in parallel.
- `resultPicker` receives all samples and must return the index of the chosen result.

## Extended Thinking

```typescript
const result = await gen.forward(llm, { question: '...' }, {
  thinkingTokenBudget: 'medium',
  showThoughts: true,
});
console.log(result.thought);
```

Rules:

- `thinkingTokenBudget` can be `'low'`, `'medium'`, `'high'`, or a number.
- Set `showThoughts: true` to include the model's reasoning in `result.thought`.

## Step Hooks

```typescript
const result = await gen.forward(llm, values, {
  stepHooks: {
    beforeStep: (ctx) => {
      if (ctx.functionsExecuted.has('complexanalysis')) {
        ctx.setModel('smart');
        ctx.setThinkingBudget('high');
      }
    },
    afterStep: (ctx) => {
      console.log(`Usage: ${ctx.usage.totalTokens} tokens`);
    },
  },
});
```

### AxStepContext Read-Only Properties

- `stepIndex` - current step number
- `maxSteps` - configured maximum steps
- `isFirstStep` - whether this is the first step
- `functionsExecuted` - `Set<string>` of function names called so far
- `lastFunctionCalls` - array of the most recent function call results
- `usage` - token usage statistics
- `state` - current step state

### AxStepContext Mutators

- `setModel(model)` - change the model for the next step
- `setThinkingBudget(budget)` - adjust thinking budget
- `setTemperature(temp)` - adjust temperature
- `setMaxTokens(max)` - adjust max output tokens
- `setOptions(opts)` - set arbitrary forward options
- `addFunctions(fns)` - add functions for the next step
- `removeFunctions(names)` - remove functions by name
- `stop()` - stop multi-step execution

Rules:

- All mutations are pending and applied at the next step boundary.
- `beforeStep` runs before each LLM call; `afterStep` runs after.
- Use `afterFunctionExecution` to react to specific function results.

## Self-Tuning

```typescript
// Simple: enable all self-tuning
const result = await gen.forward(llm, values, { selfTuning: true });

// Granular: pick what to tune
const result = await gen.forward(llm, values, {
  selfTuning: {
    model: true,
    thinkingBudget: true,
    functions: [searchWeb, calculate],
  },
});
```

Rules:

- `selfTuning: true` enables automatic model and parameter selection.
- Granular config allows tuning specific aspects independently.
- `selfTuning.functions` provides a pool of functions the tuner may add or remove per step.

## Error Handling

```typescript
import { AxGenerateError } from '@ax-llm/ax';

try {
  const result = await gen.forward(llm, { input: '...' });
} catch (error) {
  if (error instanceof AxGenerateError) {
    console.log(error.details.model, error.details.signature);
  }
}
```

Rules:

- `AxGenerateError` includes `details` with `model` and `signature` for debugging.
- `AxAIServiceAbortedError` is thrown on cancellation via `stop()` or `abortSignal`.

## Examples

Fetch these for full working code:

- [Streaming](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/streaming.ts) — streaming with assertions
- [Assertions](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/asserts.ts) — output validation
- [Streaming Assertions](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/streaming-asserts.ts) — streaming with assertion checks
- [Structured Output](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/structured_output.ts) — fluent API with validation
- [Debug Logging](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/debug-logging.ts) — debug mode and step hooks
- [Stop Function](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/stop-function.ts) — stop functions
- [Fibonacci](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/fibonacci.ts) — streaming with thinking
- [Extraction](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/extract.ts) — information extraction
- [Multi-Sampling](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/sample-count.ts) — sample count usage

## Do Not Generate

- Do not use `new AxGen(...)` for new code unless explicitly required.
- Do not pass raw API keys or config objects where an `ai(...)` instance is expected.
- Do not use `forward()` for streaming; use `streamingForward()`.
- Do not forget that assertions auto-retry; avoid manual retry loops around assertion logic.
- Do not mutate step hook context expecting immediate effect; mutations are pending until the next step.
- Do not assume multi-step stops after one LLM call; it continues until outputs are filled, a stop function fires, or `maxSteps` is reached.
