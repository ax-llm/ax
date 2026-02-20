---
title: "AxGen Guide"
description: "The programmable unit of Ax for building AI workflows"
---

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
import { AxAI, AxAIOpenAIModel } from '@ax-llm/ax';
  
  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    config: { model: AxAIOpenAIModel.GPT4O }
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
  model: AxAIOpenAIModel.GPT4Turbo, // Override model for this call
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

## Field Processors

Field processors allow you to transform or process output field values during or after generation. They are useful for post-processing, logging, or real-time feedback.

### Post-Generation Field Processors

Use `addFieldProcessor` to transform a field value after generation completes:

```typescript
const gen = new AxGen('document:string -> summary:string, keywords:string[]');

// Transform the summary to uppercase
gen.addFieldProcessor('summary', (value, context) => {
  return value.toUpperCase();
});

// Process keywords array
gen.addFieldProcessor('keywords', (value, context) => {
  // Filter out short keywords
  return value.filter((kw: string) => kw.length > 3);
});
```

The context object provides:
- `values`: All output field values
- `sessionId`: Current session ID (if provided)
- `done`: Whether generation is complete

### Streaming Field Processors

For real-time processing during streaming, use `addStreamingFieldProcessor`:

```typescript
const gen = new AxGen('topic:string -> content:string');

// Process content as it streams in
gen.addStreamingFieldProcessor('content', (partialValue, context) => {
  // Log streaming progress
  console.log(`Received ${partialValue.length} characters`);

  // You can return a transformed value
  return partialValue;
});
```

Streaming field processors only work with string fields (`string` or `code` types).

## Error Handling and Retry Strategies

`AxGen` implements sophisticated error handling with automatic retries for different error categories.

### Validation and Assertion Retries

When output validation or assertions fail, `AxGen` automatically retries with corrective feedback:

```typescript
const gen = new AxGen('question:string -> answer:string', {
  maxRetries: 5  // Retry up to 5 times on validation/assertion errors
});

gen.addAssert(
  (result) => result.answer.length > 100,
  "Answer must be detailed (at least 100 characters)"
);

// If the assertion fails, AxGen will:
// 1. Add error feedback to the conversation
// 2. Request a new response from the LLM
// 3. Repeat until success or maxRetries exhausted
```

### Infrastructure Error Retries

Network errors, timeouts, and server errors (5xx) are handled separately with exponential backoff:

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  maxRetries: 3,  // Also applies to infrastructure errors
  retry: {
    maxRetries: 3,
    backoffFactor: 2,    // Exponential backoff multiplier
    maxDelayMs: 60000    // Maximum delay between retries (60s)
  }
});
```

The retry sequence for infrastructure errors: 1s → 2s → 4s → 8s → ... (up to `maxDelayMs`).

### Error Types

`AxGen` provides detailed error information via `AxGenerateError`:

```typescript
import { AxGenerateError } from '@ax-llm/ax';

try {
  const result = await gen.forward(ai, { input: '...' });
} catch (error) {
  if (error instanceof AxGenerateError) {
    console.log('Model:', error.details.model);
    console.log('Max Tokens:', error.details.maxTokens);
    console.log('Streaming:', error.details.streaming);
    console.log('Signature:', error.details.signature);
    console.log('Original Error:', error.cause);
  }
}
```

## Function Calling

`AxGen` supports function calling (tool use) with three modes to accommodate different LLM providers.

### Function Calling Modes

```typescript
const tools = [{
  name: 'search',
  description: 'Search for information',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    },
    required: ['query']
  },
  func: async ({ query }) => {
    // Perform search
    return `Results for: ${query}`;
  }
}];

const result = await gen.forward(ai, { question: '...' }, {
  functions: tools,
  functionCallMode: 'auto'  // 'auto' | 'native' | 'prompt'
});
```

**Available modes:**

| Mode | Description |
|------|-------------|
| `"auto"` | (Default) Uses native function calling if the provider supports it, otherwise falls back to prompt-based emulation |
| `"native"` | Forces native function calling. Throws error if provider doesn't support it |
| `"prompt"` | Emulates function calling via prompt injection. Works with any LLM |

### Stop Functions

You can specify functions that should terminate the generation loop when called:

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  functions: tools,
  stopFunction: 'finalAnswer'  // Stop when this function is called
});

// Multiple stop functions
const result = await gen.forward(ai, { question: '...' }, {
  functions: tools,
  stopFunction: ['finalAnswer', 'done', 'complete']
});
```

## Caching

`AxGen` supports two types of caching: response caching and context (prompt) caching.

### Response Caching

Cache complete generation results to avoid redundant LLM calls:

```typescript
// Simple in-memory cache example
const cache = new Map<string, unknown>();

const gen = new AxGen('question:string -> answer:string', {
  cachingFunction: async (key, value?) => {
    if (value !== undefined) {
      // Store value
      cache.set(key, value);
      return undefined;
    }
    // Retrieve value
    return cache.get(key);
  }
});

// First call - hits LLM
const result1 = await gen.forward(ai, { question: 'What is 2+2?' });

// Second call with same input - returns cached result
const result2 = await gen.forward(ai, { question: 'What is 2+2?' });
```

The cache key is computed from:
- Signature hash
- All input field values (including nested objects and arrays)

### Context Caching (Prompt Caching)

For providers that support prompt caching (Anthropic, OpenAI), you can configure cache breakpoints:

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  contextCache: {
    cacheBreakpoint: 'after-examples'  // or 'after-functions'
  }
});
```

**Breakpoint options:**
- `"after-examples"`: Cache after examples/few-shot demonstrations (default)
- `"after-functions"`: Cache after function definitions

## Input Validation

`AxGen` validates input values against field constraints defined in your signature.

### String Constraints

```typescript
// Using the Pure Fluent API (see SIGNATURES.md)
import { s, f } from '@ax-llm/ax';

const signature = s('', '')
  .appendInputField('email', f.string('User email').email())
  .appendInputField('username', f.string('Username').min(3).max(20))
  .appendInputField('bio', f.string('Bio').max(500).optional())
  .appendOutputField('result', f.string('Result'));

const gen = new AxGen(signature);
```

### Number Constraints

```typescript
const signature = s('', '')
  .appendInputField('age', f.number('User age').min(0).max(150))
  .appendInputField('score', f.number('Score').min(0).max(100))
  .appendOutputField('result', f.string('Result'));
```

### URL and Date Validation

```typescript
const signature = s('', '')
  .appendInputField('website', f.url('Website URL'))
  .appendInputField('birthDate', f.date('Birth date'))
  .appendInputField('createdAt', f.datetime('Creation timestamp'))
  .appendOutputField('result', f.string('Result'));
```

Validation errors trigger the retry loop with corrective feedback.

## Sampling and Result Selection

Generate multiple samples in parallel and select the best result.

### Multiple Samples

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  sampleCount: 3  // Generate 3 samples in parallel
});
```

### Custom Result Picker

Use a `resultPicker` function to select the best sample:

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  sampleCount: 5,
  resultPicker: async (samples) => {
    // samples is an array of { delta: OUT, index: number }

    // Example: Select the longest answer
    let bestIndex = 0;
    let maxLength = 0;

    for (let i = 0; i < samples.length; i++) {
      const len = samples[i].delta.answer?.length ?? 0;
      if (len > maxLength) {
        maxLength = len;
        bestIndex = i;
      }
    }

    return bestIndex;
  }
});
```

## Multi-Step Processing

`AxGen` supports multi-step generation loops, useful for function calling workflows.

### Configuration

```typescript
const gen = new AxGen('question:string -> answer:string', {
  maxSteps: 25  // Maximum number of steps (default: 25)
});
```

### How It Works

In multi-step mode, `AxGen` continues generating until:
1. All output fields are filled without pending function calls
2. A stop function is called
3. `maxSteps` is reached

```typescript
const result = await gen.forward(ai, { question: 'Search and summarize...' }, {
  functions: [searchTool, summarizeTool],
  maxSteps: 10,
  stopFunction: 'finalAnswer'
});
```

Each step is traced separately for debugging and can trigger function executions.

## Extended Thinking

For models that support extended thinking (Claude, Gemini), you can configure
thinking behavior using string budget levels. See [AI.md](/ai/) for full
details on budget levels, provider differences, and customization.

```typescript
const result = await gen.forward(ai, { question: '...' }, {
  thinkingTokenBudget: 'medium',  // Budget level: 'minimal' | 'low' | 'medium' | 'high' | 'highest' | 'none'
  showThoughts: true               // Include thinking in response
});

// Access the thought process
console.log(result.thought);  // Contains the model's reasoning
```

### Custom Thought Field Name

```typescript
const gen = new AxGen('question:string -> answer:string', {
  thoughtFieldName: 'reasoning'  // Default is 'thought'
});

const result = await gen.forward(ai, { question: '...' }, {
  thinkingTokenBudget: 'high',
  showThoughts: true
});

console.log(result.reasoning);  // Thinking is in 'reasoning' field
```

## Step Hooks

Step hooks let you observe and control the multi-step generation loop from the outside. They fire at well-defined points during each iteration and receive an `AxStepContext` that exposes read-only state and mutation methods.

### Three Hook Points

| Hook | When it fires |
|------|--------------|
| `beforeStep` | Before the AI request is sent for this step |
| `afterStep` | After the step completes (response processed) |
| `afterFunctionExecution` | After function calls are executed (only when functions ran) |

### Basic Example

```typescript
const result = await gen.forward(ai, values, {
  stepHooks: {
    beforeStep: (ctx) => {
      console.log(`Step ${ctx.stepIndex}, first: ${ctx.isFirstStep}`);
      // Upgrade model after a specific function ran
      if (ctx.functionsExecuted.has('complexanalysis')) {
        ctx.setModel('smart');
        ctx.setThinkingBudget('high');
      }
    },
    afterStep: (ctx) => {
      console.log(`Usage so far: ${ctx.usage.totalTokens} tokens`);
    },
    afterFunctionExecution: (ctx) => {
      console.log(`Functions ran: ${[...ctx.functionsExecuted].join(', ')}`);
    },
  },
});
```

### AxStepContext Reference

**Read-only properties:**

| Property | Type | Description |
|----------|------|-------------|
| `stepIndex` | `number` | Current step number (0-based) |
| `maxSteps` | `number` | Maximum steps allowed |
| `isFirstStep` | `boolean` | True when `stepIndex === 0` |
| `functionsExecuted` | `ReadonlySet<string>` | Lowercased names of functions called this step |
| `lastFunctionCalls` | `AxFunctionCallRecord[]` | Detailed records (name, args, result) from this step |
| `usage` | `AxStepUsage` | Accumulated token usage across all steps |
| `state` | `Map<string, unknown>` | Custom state that persists across steps |

**Mutators (applied at the next step boundary):**

| Method | Description |
|--------|-------------|
| `setModel(model)` | Switch to a different model key |
| `setThinkingBudget(budget)` | Adjust reasoning depth (`'none'` to `'highest'`) |
| `setTemperature(temp)` | Change sampling temperature |
| `setMaxTokens(tokens)` | Change max output tokens |
| `setOptions(opts)` | Merge arbitrary AI service options |
| `addFunctions(fns)` | Add functions to the active set |
| `removeFunctions(...names)` | Remove functions by name |
| `stop(resultValues?)` | Terminate the loop, optionally providing result values |

Mutations use a **pending pattern**: changes are collected during a step and applied at the top of the next iteration. This prevents mid-step inconsistencies.

### Functions Also Receive Step Context

User-defined functions receive the step context via `extra.step`, enabling programmatic loop control from within function handlers:

```typescript
const gen = new AxGen('question:string -> answer:string', {
  functions: [{
    name: 'analyzeData',
    description: 'Analyze data',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Query' } } },
    func: (args, extra) => {
      // Read step state
      const step = extra?.step;
      console.log(`Running at step ${step?.stepIndex}`);

      // Mutate for next step
      step?.setThinkingBudget('high');

      return analyzeData(args.query);
    },
  }],
});
```

## Self-Tuning

Self-tuning lets the LLM adjust its own generation parameters between steps. When enabled, an `adjustGeneration` function is auto-injected that the model can call alongside regular tool calls.

### Simple Usage

```typescript
// Boolean shorthand: enables model + thinkingBudget adjustment
const result = await gen.forward(ai, values, {
  selfTuning: true,
});
```

### Granular Configuration

```typescript
const result = await gen.forward(ai, values, {
  selfTuning: {
    model: true,          // Let LLM pick from available models
    thinkingBudget: true,  // Let LLM adjust reasoning depth
    temperature: true,     // Opt-in: let LLM adjust sampling temperature
  },
});
```

### Function Pool

Use `selfTuning.functions` to provide a pool of tools the LLM can activate or deactivate on demand — useful for large toolboxes where you only want a subset active at any time:

```typescript
const result = await gen.forward(ai, values, {
  selfTuning: {
    model: true,
    thinkingBudget: true,
    functions: [searchWeb, calculate, fetchDatabase, generateChart],
  },
});
```

The LLM calls `adjustGeneration({ addFunctions: ['searchWeb'] })` to activate tools, or `adjustGeneration({ removeFunctions: ['calculate'] })` to deactivate them.

### How It Works

1. An `adjustGeneration` function is injected into the function list
2. The LLM can call it alongside other functions within the same step
3. Model selection uses the `models` list configured on the AI service (via `AxAI` model keys)
4. Thinking budget uses a 6-level enum: `none`, `minimal`, `low`, `medium`, `high`, `highest`
5. Mutations are applied at the next step boundary (same pending pattern as step hooks)

Temperature is excluded by default because LLMs have limited intuition about sampling parameters. Enable it explicitly with `temperature: true` if your use case benefits from it.
