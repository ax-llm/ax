# AxGen Guide

`AxGen` is the core programmable unit in Ax. It represents a single step in an AI workflow, encapsulating a signature (input/output definition), a prompt template, and execution logic (including retries, streaming, and assertions).

`AxGen` is designed to be composable, allowing you to build complex workflows by chaining multiple `AxGen` instances together or using them within `AxFlow`.

## Creating an AxGen Instance

To create an `AxGen` instance, you need a **Signature**. A signature defines the input fields and output fields for the generation task.

```typescript
import { AxGen } from '@ax-llm/ax';

const gen = new AxGen(
  `input:string -> output:string, reasoning:string`
);
```

You can also use the `AxSignature` builder for more complex signatures:

```typescript
import { AxGen } from '@ax-llm/ax';

const gen = new AxGen(
  `question:string, context:string[] -> answer:string`
);
```

### Options

The `AxGen` constructor accepts an optional configuration object:

```typescript
const gen = new AxGen('input -> output', {
  description: 'A helpful assistant', // Description for the prompt
  maxRetries: 3,        // Default retries for assertions/validation
  maxSteps: 10,         // Max steps for multi-step generation
  temperature: 0.7,     // Default Model temperature (can be overridden)
  fastFail: false,      // If true, fail immediately on error
  debug: false          // Enable debug logging
});
```

## Running AxGen

To run an `AxGen` instance, you use the `forward` method. This method sends the request to the AI service and processes the response.

### passing an AI Service

You must pass an `AxAI` service instance to `forward`.

```typescript
import { AxAI } from '@ax-llm/ax';

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  config: { model: 'gpt-4o' }
});

const result = await gen.forward(ai, { input: 'Hello world' });
console.log(result.output);
```

### Options for `forward`

The `forward` method accepts an options object as the third argument, allowing you to override defaults and configure per-request behavior.

```typescript
const result = await gen.forward(ai, { input: '...' }, {
  // Execution Control
  maxRetries: 5,        // Override default max retries
  stopFunction: 'stop', // Custom stop function name

  // AI Configuration
  model: 'gpt-4-turbo', // Override model for this call
  modelConfig: {
    temperature: 0.9,
    maxTokens: 1000
  },

  // Retry Configuration (Low-level)
  retry: {
    maxRetries: 3,
    backoffFactor: 2,
    maxDelayMs: 30000
  },

  // Debugging
  debug: true,          // Enable debug logging for this call
  traceLabel: 'custom-trace'
});
```

## Streaming

`AxGen` supports streaming responses, which is useful for real-time applications.

### Using `streamingForward`

Use `streamingForward` to get an async generator that yields partial results.

```typescript
const stream = gen.streamingForward(ai, { input: 'Write a long story' });

for await (const chunk of stream) {
  // chunk contains partial deltas and the current accumulated state
  if (chunk.delta.output) {
    process.stdout.write(chunk.delta.output);
  }
}
```

The `chunk` object contains:
- `delta`: The partial change in this update (e.g., newly generated tokens).
- `partial`: The full accumulated value so far.

## Structured Outputs

`AxGen` automatically handles structured outputs based on your signature. If your output signature contains types other than string (like specific classes, arrays, or JSON objects), `AxGen` will instruct the LLM to produce JSON and strict type validation will be applied.

```typescript
const gen = new AxGen<{ topic: string }, { tags: string[], sentiment: 'pos' | 'neg' }>(
  `topic:string -> tags:string[], sentiment:string`
);

const result = await gen.forward(ai, { topic: 'Ax Framework' });
// result.tags is string[]
// result.sentiment is 'pos' | 'neg'
```

## Assertions and Validation

You can add assertions to `AxGen` to validate the output. If an assertion fails, `AxGen` can automatically retry with error feedback (self-correction).

```typescript
gen.addAssert(
  (args) => args.output.length > 50,
  "Output must be at least 50 characters long"
);

// Streaming assertions work on partial updates
gen.addStreamingAssert(
  'output',
  (text) => !text.includes('forbidden'),
  "Output contains forbidden text"
);
```
