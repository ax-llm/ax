---
name: ax-gen
description: This skill helps an LLM generate correct AxGen code using @ax-llm/ax. Use when the user asks about ax(), AxGen, generators, forward(), streamingForward(), validation, assertions, streaming assertions, field processors, step hooks, self-tuning, or structured outputs.
version: "22.0.7"
---

# AxGen Codegen Rules (@ax-llm/ax)

Use this skill to generate `AxGen` code. Prefer short, modern, copyable patterns. Do not write tutorial prose unless the user explicitly asks for explanation.

## Use These Defaults

- Use `ax(...)` factory, not `new AxGen(...)`.
- Always pass an AI instance from `ai(...)` as the first argument to `forward()`.
- Streaming uses `streamingForward()`, not `forward()` with a stream option.
- Use schema validation for field shape and constraints.
- Use `addAssert(...)` for whole-output hard invariants with correction retries.
- Use `addStreamingAssert(...)` for partial streaming hard invariants with fail-fast per-attempt correction retries.
- Use `bestOfN(...)` / `refine(...)` for reward-scored complete outputs.
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

### Signatures from zod / valibot / arktype

`ax()` accepts any signature built with `f()`, and `f().input()` / `.output()` accept [Standard Schema v1](https://standardschema.dev) validators directly — per-field or a whole `z.object({...})`:

```typescript
import { z } from 'zod';
import { ax, f } from '@ax-llm/ax';

const gen = ax(
  f()
    .input(z.object({
      productName: z.string(),
      buyerProfile: z.string(),
    }))
    .output(z.object({
      headline: z.string(),
      recommendation: z.enum(['buy', 'wait', 'skip']),
    }))
    .build()
);
```

Constraints (`.min()`, `.email()`, `.regex()`) and custom logic (`.refine()`, `.transform()`, `.superRefine()`) execute in the normal validation/retry pipeline — at parse time on complete field values, including at field boundaries during streaming. For cache/internal hints pass companion options: `.input('ctx', z.string(), { cache: true })` or `.output('reasoning', z.string(), { internal: true })`.

Define tool functions with zod the same way — `fn().arg()` / `.returns()` accept per-argument or whole-object schemas and infer the handler's argument type:

```typescript
import { z } from 'zod';
import { ax, fn } from '@ax-llm/ax';

const lookupProduct = fn('lookupProduct')
  .description('Look up a product by name')
  .arg(z.object({
    productName: z.string().min(1),
    includeSpecs: z.boolean().optional(),
  }))
  .returns(z.object({
    price: z.number(),
    inStock: z.boolean(),
    rating: z.number().min(1).max(5),
  }))
  .handler(async ({ productName, includeSpecs }) => ({
    price: 79.99,
    inStock: true,
    rating: 4.3,
  }))
  .build();

const result = await gen.forward(llm, { ... }, { functions: [lookupProduct] });
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

### Live Global Defaults

`AxGen` respects `axGlobals` for app-wide runtime defaults:

```typescript
import { axGlobals } from '@ax-llm/ax';
import { trace } from '@opentelemetry/api';

const responseCache = new Map<string, any>();

axGlobals.tracer = trace.getTracer('my-app');
axGlobals.debug = true;
axGlobals.cachingFunction = async (key, value?) => {
  if (value !== undefined) {
    responseCache.set(key, value);
    return;
  }
  return responseCache.get(key);
};
```

Rules:

- Tracing/logging precedence is: forward options, then generator options, then AI service options, then current `axGlobals`, then built-in defaults.
- `abortSignal` from `axGlobals` is merged with local forward signals.
- `customLabels` merge from globals to AI service to forward options.
- `cachingFunction` and `functionResultFormatter` also fall back to current `axGlobals` when local options do not provide them.

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

## Validation, Selection, And Guards

```typescript
import { ax, bestOfN, f } from '@ax-llm/ax';
import { z } from 'zod';

// Schema validation: output shape and field validity.
const gen = ax(
  f()
    .input('topic', z.string().min(1))
    .output('summary', z.string().min(50))
    .build()
);

// bestOfN: choose the best complete candidate.
const selected = bestOfN(gen, {
  n: 4,
  rewardFn: ({ prediction }) => prediction.summary.length,
});

// Whole-output assertion: retries with correction feedback.
gen.addAssert(
  (output) => output.summary.includes(topic) || 'Summary must mention the topic.'
);

// Streaming assertion: fail fast on unsafe partial output.
gen.addStreamingAssert(
  'summary',
  (text) => !text.includes('forbidden'),
  'Output contains forbidden text'
);
```

Rules:

- Schema validation retries with parser/constraint feedback.
- `addAssert(...)` checks the complete parsed output after validation/processors and retries with correction feedback on failure.
- `bestOfN(...)` scores complete candidates and returns the highest reward or first threshold hit.
- `refine(...)` runs rounds and can feed reward-derived advice into instruction components between rounds.
- `addStreamingAssert(...)` targets a string/code output field and receives partial text so far.
- Streaming assertions abort the current stream attempt by throwing `AxStreamingAssertionError`, then feed correction feedback into AxGen retries.

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

## Structured Outputs

```typescript
const sig = f()
  .input('text', f.string())
  .output('summary', f.string())
  .output('metadata', f.json().optional())
  .useStructured()
  .build();
```

Rules:

- `.useStructured()` asks providers with native support, including OpenAI, Anthropic, and Gemini, for schema-constrained JSON.
- Native structured-output schemas list every object property in `required`, set `additionalProperties: false` on objects, and express optional fields as nullable types.
- Flexible `json` fields and unshaped `object` fields are sent as JSON-encoded strings for native structured outputs, then parsed back into normal JavaScript values.

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

## Chat Log and Usage

### getChatLog()

After any `.forward()` or `streamingForward()` call, `gen.getChatLog()` returns the full normalized chat history — every `ai.chat()` round-trip, including the system prompt, all messages, and the model response. The log is reset at the start of each `.forward()` call. Multi-step generators (with function calls) produce one entry per step.

```typescript
await gen.forward(llm, { question: 'What is 2+2?' });

for (const entry of gen.getChatLog()) {
  console.log('model:', entry.model);
  for (const msg of entry.messages) {
    console.log(`[${msg.role}]`, msg.content);
  }
  console.log('tokens:', entry.modelUsage?.tokens);
}
```

Message roles: `system`, `user`, `assistant`, `tool`. Assistant content uses inline XML:
- `<think>...</think>` — reasoning/thinking tokens
- `<tool_call>\n{...}\n</tool_call>` — tool invocations

The system message includes a `<tools>` JSON block when functions are present.

```typescript
type AxChatLogMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; name: string; content: string };

type AxChatLogEntry = {
  name?: string;
  model: string;
  messages: AxChatLogMessage[];
  modelUsage?: AxProgramUsage;
};

gen.getChatLog(): readonly AxChatLogEntry[]
```

### getUsage()

Returns token usage aggregated by `(ai, model)` across all steps. When a provider reports prompt-cache usage, `promptTokens` is the uncached input portion and `cacheReadTokens` / `cacheCreationTokens` carry the cache counters. Reset with `resetUsage()`.

```typescript
const usage = gen.getUsage(); // AxProgramUsage[]
console.log(usage[0]?.tokens?.promptTokens);
gen.resetUsage();
```

`AxAgent` and `AxFlow` also return flat `AxChatLogEntry[]` logs; composite programs set `entry.name` so callers can filter by node/stage.

## Examples

Fetch these for full working code:

- [Streaming](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/streaming.ts) — field-by-field streaming
- [Best Of N](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/best-of-n.ts) — reward-scored sample selection
- [Refine](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/refine.ts) — retry rounds with generated feedback
- [Streaming Assert](https://raw.githubusercontent.com/ax-llm/ax/refs/heads/main/src/examples/streaming-asserts.ts) — fail-fast partial-output correction
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
- Do not use streaming assertions as reward/refine mechanisms; they enforce hard partial-output invariants and retry with correction.
- Do not mutate step hook context expecting immediate effect; mutations are pending until the next step.
- Do not assume multi-step stops after one LLM call; it continues until outputs are filled, a stop function fires, or `maxSteps` is reached.
